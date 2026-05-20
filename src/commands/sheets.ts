import { Command } from 'commander';
import { getAccessToken } from '../lib/auth.ts';

const SHEETS_BASE = 'https://developer.api.autodesk.com/construction/sheets/v1/projects';
const DM_BASE = 'https://developer.api.autodesk.com/data/v1/projects';
const MD_BASE = 'https://developer.api.autodesk.com/modelderivative/v2/designdata';

// --- Types ---

interface Sheet {
  id: string;
  number?: string | null;
  title?: string | null;
  uploadFileName?: string | null;
  isCurrent?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  versionSet?: { id: string; name: string; issuanceDate?: string } | null;
}

interface SheetsListResponse {
  results?: Sheet[];
  data?: Sheet[];
  pagination?: { limit: number; offset: number; totalResults: number };
}

interface SheetVersion {
  version?: number | null;
  versionNumber?: number | null;
  publishedBy?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
}

interface SheetVersionsResponse {
  results?: SheetVersion[];
  data?: SheetVersion[];
}

// --- Helpers ---

function stripBPrefix(id: string): string {
  return id.replace(/^b\./, '');
}

function addBPrefix(id: string): string {
  return id.startsWith('b.') ? id : `b.${id}`;
}

function formatTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return '(no results)';
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => (r[i] ?? '').length))
  );
  const pad = (s: string, w: number) => (s ?? '').padEnd(w);
  const sep = widths.map(w => '-'.repeat(w)).join('  ');
  const header = headers.map((h, i) => pad(h, widths[i])).join('  ');
  const body = rows.map(r => r.map((c, i) => pad(c, widths[i])).join('  ')).join('\n');
  return `${header}\n${sep}\n${body}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function truncate(s: string | null | undefined, maxLen: number): string {
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

// Minimal tip version response (for resolving derivativesUrn)
interface TipVersionRelationships {
  derivatives?: { data?: { type: string; id: string } | null };
}
interface TipVersionObject {
  id: string;
  relationships?: TipVersionRelationships;
}
interface ItemTipResponse {
  data?: TipVersionObject;
}

// --- Command registration ---

export function registerSheetCommands(program: Command): void {
  const sheet = program
    .command('sheet')
    .description('Query ACC Sheets in a project')
    .addHelpText('after', '\nRequires an active login. Run `aps login` first.');

  // ── ls ──────────────────────────────────────────────────────────────────────
  sheet
    .command('ls <project-id>')
    .description('List sheets in a project')
    .option('--json', 'Output raw JSON')
    .option('--status <status>', 'Filter by status (processing/processed/failed)')
    .addHelpText('after', `
Examples:
  aps sheet ls <projectId>
  aps sheet ls <projectId> --status processed
  aps sheet ls <projectId> --json`)
    .action(async (projectId: string, opts: { json?: boolean; status?: string }) => {
      const token = await getAccessToken();
      const pid = stripBPrefix(projectId);

      const params = new URLSearchParams();
      if (opts.status) params.set('filter[status]', opts.status);

      const qs = params.toString();
      const url = `${SHEETS_BASE}/${encodeURIComponent(pid)}/sheets${qs ? `?${qs}` : ''}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to list sheets (${res.status}): ${errBody}`);
      }

      const data = (await res.json()) as SheetsListResponse;

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const sheets: Sheet[] = data.results ?? data.data ?? [];
      const total = data.pagination?.totalResults;
      if (total !== undefined) {
        process.stderr.write(`Showing ${sheets.length} of ${total} sheets\n`);
      }

      const rows = sheets.map(s => [
        s.number ?? '',
        truncate(s.title, 40),
        truncate(s.uploadFileName, 50),
        s.isCurrent ? 'current' : '',
        fmtDate(s.createdAt),
      ]);

      console.log(formatTable(['NUM', 'TITLE', 'FILE NAME', 'CURRENT', 'CREATED AT'], rows));
    });

  // ── get ─────────────────────────────────────────────────────────────────────
  sheet
    .command('get <project-id> <sheet-id>')
    .description('Get details for a single sheet')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  aps sheet get <projectId> <sheetId>
  aps sheet get <projectId> <sheetId> --json`)
    .action(async (projectId: string, sheetId: string, opts: { json?: boolean }) => {
      const token = await getAccessToken();
      const pid = stripBPrefix(projectId);

      const url = `${SHEETS_BASE}/${encodeURIComponent(pid)}/sheets/${encodeURIComponent(sheetId)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to get sheet (${res.status}): ${errBody}`);
      }

      const s = (await res.json()) as Sheet & Record<string, unknown>;

      if (opts.json) {
        console.log(JSON.stringify(s, null, 2));
        return;
      }

      const fields: [string, string][] = [
        ['id', s.id],
        ['number', s.number ?? ''],
        ['title', s.title ?? ''],
        ['uploadFileName', s.uploadFileName ?? ''],
        ['isCurrent', s.isCurrent ? 'yes' : 'no'],
        ['versionSet', s.versionSet ? `${s.versionSet.name} (${s.versionSet.issuanceDate ?? ''})` : ''],
        ['createdAt', fmtDate(s.createdAt)],
        ['updatedAt', fmtDate(s.updatedAt)],
      ];

      const labelWidth = Math.max(...fields.map(([l]) => l.length));
      for (const [label, value] of fields) {
        console.log(`${label.padEnd(labelWidth)}  ${value}`);
      }
    });

  // ── thumbnail ──────────────────────────────────────────────────────────────────
  sheet
    .command('thumbnail <project-id> <item-id>')
    .description('Download Model Derivative thumbnail for a sheet item')
    .option('-o, --output <path>', 'Output file path (default: <item-slug>.png)')
    .option('--width <px>', 'Thumbnail width: 100, 200, or 400', '400')
    .addHelpText('after', `
The item-id is a Data Management lineage URN. Get it from:
  aps file get <projectId> <itemId>   (shows "derivatives" field)
  aps ls <projectId> <folderId>        (lists item URNs)

The item must have been successfully processed (viewable) in ACC before
a thumbnail is available.

Examples:
  aps sheet thumbnail <projectId> urn:adsk.wipprod:dm.lineage:xxxx
  aps sheet thumbnail <projectId> urn:adsk.wipprod:dm.lineage:xxxx -o site_map.png
  aps sheet thumbnail <projectId> urn:adsk.wipprod:dm.lineage:xxxx --width 200`)
    .action(async (projectId: string, itemId: string, opts: { output?: string; width?: string }) => {
      const token = await getAccessToken();
      const pid = addBPrefix(projectId);

      const tipRes = await fetch(
        `${DM_BASE}/${encodeURIComponent(pid)}/items/${encodeURIComponent(itemId)}/tip`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!tipRes.ok) {
        const body = await tipRes.text();
        throw new Error(`Failed to get item tip (${tipRes.status}): ${body}`);
      }
      const tipData = (await tipRes.json()) as ItemTipResponse;
      const derivativesUrn = tipData.data?.relationships?.derivatives?.data?.id;
      if (!derivativesUrn) {
        throw new Error(
          'No derivatives URN — the file may not have been processed yet.\n' +
          `Check with: aps file get ${projectId} ${itemId}`,
        );
      }

      const width = opts.width ?? '400';
      const thumbUrl = `${MD_BASE}/${encodeURIComponent(derivativesUrn)}/thumbnail?width=${width}&height=${width}`;
      const thumbRes = await fetch(thumbUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!thumbRes.ok) {
        const body = await thumbRes.text();
        throw new Error(`Thumbnail fetch failed (${thumbRes.status}): ${body}`);
      }

      const slug = itemId.split(':').pop() ?? itemId;
      const outputPath = opts.output ?? `${slug}.png`;
      const { promises: fsP } = await import('fs');
      await fsP.writeFile(outputPath, Buffer.from(await thumbRes.arrayBuffer()));
      process.stderr.write(`Saved ${width}px thumbnail → ${outputPath}\n`);
    });

  // ── versions ─────────────────────────────────────────────────────────────────
  sheet
    .command('versions <project-id> <sheet-id>')
    .description('List versions for a sheet')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  aps sheet versions <projectId> <sheetId>
  aps sheet versions <projectId> <sheetId> --json`)
    .action(async (projectId: string, sheetId: string, opts: { json?: boolean }) => {
      const token = await getAccessToken();
      const pid = stripBPrefix(projectId);

      const url = `${SHEETS_BASE}/${encodeURIComponent(pid)}/sheets/${encodeURIComponent(sheetId)}/versions`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to get sheet versions (${res.status}): ${errBody}`);
      }

      const data = (await res.json()) as SheetVersionsResponse;

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const versions: SheetVersion[] = data.results ?? data.data ?? [];
      const rows = versions.map(v => [
        String(v.version ?? v.versionNumber ?? ''),
        v.publishedBy ?? v.createdBy ?? '',
        fmtDate(v.publishedAt ?? v.createdAt),
      ]);

      console.log(formatTable(['VERSION', 'PUBLISHED BY', 'PUBLISHED AT'], rows));
    });
}
