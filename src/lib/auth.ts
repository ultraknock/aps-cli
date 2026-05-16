import { readFileSync, writeFileSync, mkdirSync, chmodSync, unlinkSync, existsSync, openSync, closeSync, statSync } from 'node:fs';
import { tmpdir, userInfo, hostname } from 'node:os';
import { join } from 'node:path';
import { createCipheriv, createDecipheriv, createSign, randomBytes, scryptSync } from 'node:crypto';

const CONFIG_DIR = process.env.XDG_CONFIG_HOME
  ? join(process.env.XDG_CONFIG_HOME, 'aps-cli')
  : process.env.HOME
    ? join(process.env.HOME, '.config', 'aps-cli')
    : join(tmpdir(), '.aps-cli');

const TOKEN_PATH = join(CONFIG_DIR, 'token.json');
const CREDENTIALS_PATH = join(CONFIG_DIR, 'credentials.json');
const SSA_PATH = join(CONFIG_DIR, 'ssa.json');
const REFRESH_BUFFER_MS = 60_000; // refresh 60s before expiry
const LOCK_PATH = join(CONFIG_DIR, 'token.lock');
const LOCK_STALE_MS = 30_000; // steal lock if process crashed (older than 30s)

function ensureConfigDir(): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  chmodSync(CONFIG_DIR, 0o700);
}

const AUTH_TOKEN_URL = 'https://developer.api.autodesk.com/authentication/v2/token';
const SSA_SCOPES = ['data:read', 'data:write', 'data:create', 'data:search'];

const ALGORITHM = 'aes-256-gcm';
const SALT = 'aps-cli-v1';

function deriveKey(): Buffer {
  const secret = `${userInfo().username}@${hostname()}`;
  return scryptSync(secret, SALT, 32);
}

function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(ciphertext: string): string {
  const key = deriveKey();
  const [ivHex, tagHex, dataHex] = ciphertext.split(':');
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const data = Buffer.from(dataHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data).toString('utf8') + decipher.final('utf8');
}

export interface CredentialsData {
  client_id: string;
  client_secret: string;
}

export function saveCredentials(data: CredentialsData): void {
  ensureConfigDir();
  writeFileSync(CREDENTIALS_PATH, encrypt(JSON.stringify(data)));
}

export function loadCredentials(): CredentialsData | null {
  if (!existsSync(CREDENTIALS_PATH)) return null;
  try {
    return JSON.parse(decrypt(readFileSync(CREDENTIALS_PATH, 'utf8'))) as CredentialsData;
  } catch {
    return null;
  }
}

/**
 * Retrieve a credential value. Checks the environment variable first so that
 * CI/CD overrides still work, then falls back to the stored credentials file.
 */
export function getCredential(key: 'APS_CLIENT_ID' | 'APS_CLIENT_SECRET'): string {
  const envVal = process.env[key];
  if (envVal) return envVal;

  const stored = loadCredentials();
  if (stored) {
    const val = key === 'APS_CLIENT_ID' ? stored.client_id : stored.client_secret;
    if (val) return val;
  }

  throw new Error(
    `Missing credential: ${key}. Run \`aps configure --client-id <id> --client-secret <secret>\` or set the environment variable.`,
  );
}

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export function saveToken(data: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}): void {
  ensureConfigDir();
  const token: TokenData = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
  writeFileSync(TOKEN_PATH, encrypt(JSON.stringify(token)));
}

export function clearToken(): void {
  if (existsSync(TOKEN_PATH)) {
    unlinkSync(TOKEN_PATH);
  }
}

export function loadToken(): TokenData | null {
  if (!existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(decrypt(readFileSync(TOKEN_PATH, 'utf8'))) as TokenData;
  } catch {
    return null;
  }
}

function acquireLock(): () => void {
  while (true) {
    try {
      ensureConfigDir();
      // O_CREAT | O_EXCL: atomic — throws EEXIST if lock already held
      closeSync(openSync(LOCK_PATH, 'wx'));
      return () => { try { unlinkSync(LOCK_PATH); } catch { /* already gone */ } };
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'EEXIST') throw err;
    }

    // Check whether the existing lock is stale (crashed process)
    try {
      const stat = statSync(LOCK_PATH);
      if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
        unlinkSync(LOCK_PATH); // steal it
        continue;
      }
    } catch {
      continue; // lock vanished between EEXIST and statSync — retry create
    }

    // Another live process holds the lock — wait 50ms and retry
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
}

// ── SSA JWT helpers ─────────────────────────────────────────────────────────

function base64url(data: string | Buffer): string {
  const b64 = typeof data === 'string'
    ? Buffer.from(data, 'utf8').toString('base64')
    : data.toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function buildJwtAssertion(
  clientId: string,
  serviceAccountId: string,
  kid: string,
  privateKeyPem: string,
  scopes: string[],
): string {
  const header = { alg: 'RS256', kid };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: clientId,
    sub: serviceAccountId,
    aud: AUTH_TOKEN_URL,
    exp: now + 300,
    scope: scopes,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signer = createSign('RSA-SHA256');
  signer.update(signingInput);
  return `${signingInput}.${base64url(signer.sign(privateKeyPem))}`;
}

async function refreshSsaToken(ssaData: SsaData): Promise<string> {
  const release = acquireLock();
  try {
    // Double-check: another process may have already refreshed while we waited
    const fresh = loadToken();
    if (fresh && Date.now() < fresh.expires_at - REFRESH_BUFFER_MS) {
      return fresh.access_token;
    }

    const clientId = getCredential('APS_CLIENT_ID');
    const clientSecret = getCredential('APS_CLIENT_SECRET');
    const assertion = buildJwtAssertion(
      clientId,
      ssaData.serviceAccountId,
      ssaData.kid,
      ssaData.privateKey,
      SSA_SCOPES,
    );

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(AUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
        scope: SSA_SCOPES.join(' '),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`SSA token exchange failed (${res.status}): ${body}`);
    }

    const tokenData = await res.json() as { access_token: string; expires_in: number };
    // SSA tokens have no refresh_token; store empty string so TokenData shape is preserved
    saveToken({ ...tokenData, refresh_token: '' });
    return tokenData.access_token;
  } finally {
    release();
  }
}

// ── getAccessToken ────────────────────────────────────────────────────────────

export async function getAccessToken(): Promise<string> {
  const ssaData = loadSsaData();

  if (ssaData) {
    // Fast path: cached SSA token still valid
    const token = loadToken();
    if (token && Date.now() < token.expires_at - REFRESH_BUFFER_MS) {
      return token.access_token;
    }
    // Slow path: generate new SSA token via JWT assertion exchange
    return refreshSsaToken(ssaData);
  }

  // ── Regular 3-legged OAuth flow ──────────────────────────────────────────
  const token = loadToken();
  if (!token) {
    throw new Error('Not logged in. Run: aps login');
  }

  // Fast path: token still valid — no lock needed
  if (Date.now() < token.expires_at - REFRESH_BUFFER_MS) {
    return token.access_token;
  }

  // Slow path: refresh needed — acquire exclusive lock
  const release = acquireLock();
  try {
    // Double-check: another process may have already refreshed while we waited
    const fresh = loadToken();
    if (fresh && Date.now() < fresh.expires_at - REFRESH_BUFFER_MS) {
      return fresh.access_token;
    }

    const clientId = getCredential('APS_CLIENT_ID');
    const clientSecret = getCredential('APS_CLIENT_SECRET');
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const res = await fetch(AUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: (fresh ?? token).refresh_token,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Token refresh failed (${res.status}): ${body}`);
    }

    const refreshed = await res.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };
    saveToken(refreshed);
    return refreshed.access_token;
  } finally {
    release();
  }
}

export function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export interface SsaData {
  serviceAccountId: string;
  email: string;
  kid: string;
  privateKey: string;
}

export function saveSsaData(data: SsaData): void {
  ensureConfigDir();
  writeFileSync(SSA_PATH, encrypt(JSON.stringify(data)));
}

export function loadSsaData(): SsaData | null {
  if (!existsSync(SSA_PATH)) return null;
  try {
    return JSON.parse(decrypt(readFileSync(SSA_PATH, 'utf8'))) as SsaData;
  } catch {
    return null;
  }
}

export function clearSsaData(): void {
  if (existsSync(SSA_PATH)) {
    unlinkSync(SSA_PATH);
  }
}
