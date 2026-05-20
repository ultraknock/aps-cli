import { Command } from 'commander';
import { getAccessToken } from '../lib/auth.ts';

const DM_BASE = 'https://developer.api.autodesk.com/data/v1/projects';

// --- Types ---

interface VersionAttributes {
  name?: string | null;
  displayName?: string | null;
  createTime?: string | null;
  lastModifiedTime?: string | null;
  fileType?: string | null;
  storageSize?: number | null;
  extension?: {
    type?: string | null;
    version?: string | null;
    data?: Record<string, unknown>;
  } | null;
}

interface StorageRelationship {
  data?: { type: string; id: string } | null;
}

interface DerivativesRelationship {
  data?: { type: string; id: string } | null;
}

interface VersionRelationships {
  storage?: StorageRelationship;
  derivatives?: DerivativesRelationship;
  item?: { data?: { type: string; id: string } };
}

interface VersionObject {
  type: string;
  id: string;
  attributes: VersionAttributes;
  relationships?: VersionRelationships;
}

interface VersionsResponse {
  data?: VersionObject[];
  links?: { next?: { href: string } };
}

interface ItemAttributes {
  displayName?: string | null;
  createTime?: string | null;
  lastModifiedTime?: string | null;
  hidden?: boolean | null;
  reserved?: boolean | null;
  extension?: {
    type?: string | null;
    data?: Record<string, unknown>;
  } | null;
}

interface ItemRelationships {
  tip?: { data?: { type: string; id: string } };
  versions?: { links?: { related?: { href: string } } };
  parent?: { data?: { type: string; id: string } };
}

interface ItemObject {
  type: string;
  id: string;
  attributes: ItemAttributes;
  relationships?: ItemRelationships;
}

interface ItemResponse {
  data?: ItemObject;
  errors?: Array<{ title: string; detail?: string }>;
}

interface ItemTipResponse {
  data?: VersionObject;
  errors?: Array<{ title: string; detail?: string }>;
}

interface SearchResponse {
  data?: Array<{
    type: string;
    id: string;
    attributes?: { displayName?: string; name?: string; lastModifiedTime?: string; fileType?: string; storageSize?: number };
    relationships?: { tip?: { data?: { type: string; id: string } } };
  }>;
  included?: VersionObject[];
  links?: { next?: { href: string } };
}

// --- Helpers ---

function addBPrefix(id: string): string {
  return id.startsWith('b.') ? id : `b.${id}`;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function truncate(s: string | null | undefined, maxLen: number): string {
  if (!s) return '';
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
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

// --- Command registration ---

export function registerFileCommands(program: Command): void {
  const file = program
    .command('file')
    .description('Inspect and search files in ACC via the Data Management API')
    .addHelpText('after', '\nRequires an active login. Run `aps login` first.');

  // ── get ─────────────────────────────────────────────────────────────────────
  file
    .command('get <project-id> <item-id>')
    .description('Get metadata for a file item and its current (tip) version')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Returns item-level metadata plus the current version's attributes, storage URN,
and extension data. Use --json to see the full API response including derivative links.

Examples:
  aps file get <projectId> urn:adsk.wipprod:dm.lineage:xxxx
  aps file get <projectId> urn:adsk.wipprod:dm.lineage:xxxx --json`)
    .action(async (projectId: string, itemId: string, opts: { json?: boolean }) => {
      const token = await getAccessToken();
      const pid = addBPrefix(projectId);

      const [itemRes, tipRes] = await Promise.all([
        fetch(`${DM_BASE}/${encodeURIComponent(pid)}/items/${encodeURIComponent(itemId)}`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
        fetch(`${DM_BASE}/${encodeURIComponent(pid)}/items/${encodeURIComponent(itemId)}/tip`, {
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      if (!itemRes.ok) {
        const body = await itemRes.text();
        throw new Error(`Failed to get item (${itemRes.status}): ${body}`);
      }
      if (!tipRes.ok) {
        const body = await tipRes.text();
        throw new Error(`Failed to get item tip (${tipRes.status}): ${body}`);
      }

      const itemData = (await itemRes.json()) as ItemResponse;
      const tipData = (await tipRes.json()) as ItemTipResponse;

      if (opts.json) {
        console.log(JSON.stringify({ item: itemData, tip: tipData }, null, 2));
        return;
      }

      const item = itemData.data;
      const tip = tipData.data;
      const storageUrn = tip?.relationships?.storage?.data?.id ?? null;
      const derivativesUrn = tip?.relationships?.derivatives?.data?.id ?? null;
      const extData = tip?.attributes?.extension?.data;

      const fields: [string, string][] = [
        ['itemId',       itemId],
        ['name',         tip?.attributes?.displayName ?? tip?.attributes?.name ?? item?.attributes?.displayName ?? ''],
        ['fileType',     tip?.attributes?.fileType ?? ''],
        ['size',         formatBytes(tip?.attributes?.storageSize)],
        ['tipVersionId', tip?.id ?? ''],
        ['created',      fmtDate(item?.attributes?.createTime)],
        ['modified',     fmtDate(tip?.attributes?.lastModifiedTime)],
        ['storageUrn',   storageUrn ?? ''],
        ['derivatives',  derivativesUrn ?? ''],
        ['hidden',       item?.attributes?.hidden ? 'yes' : 'no'],
        ['reserved',     item?.attributes?.reserved ? 'yes' : 'no'],
      ];

      if (extData && Object.keys(extData).length > 0) {
        for (const [k, v] of Object.entries(extData)) {
          fields.push([`ext.${k}`, typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')]);
        }
      }

      const labelWidth = Math.max(...fields.map(([l]) => l.length));
      for (const [label, value] of fields) {
        if (value) console.log(`${label.padEnd(labelWidth)}  ${value}`);
      }
    });

  // ── versions ─────────────────────────────────────────────────────────────────
  file
    .command('versions <project-id> <item-id>')
    .description('List all versions of a file item (newest first)')
    .option('--json', 'Output raw JSON')
    .option('--limit <n>', 'Max number of versions to return', '50')
    .addHelpText('after', `
Examples:
  aps file versions <projectId> urn:adsk.wipprod:dm.lineage:xxxx
  aps file versions <projectId> urn:adsk.wipprod:dm.lineage:xxxx --json`)
    .action(async (projectId: string, itemId: string, opts: { json?: boolean; limit?: string }) => {
      const token = await getAccessToken();
      const pid = addBPrefix(projectId);
      const limit = parseInt(opts.limit ?? '50', 10);

      const versions: VersionObject[] = [];
      let url: string | null =
        `${DM_BASE}/${encodeURIComponent(pid)}/items/${encodeURIComponent(itemId)}/versions?page[limit]=50`;

      while (url && versions.length < limit) {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Failed to get versions (${res.status}): ${body}`);
        }
        const data = (await res.json()) as VersionsResponse;
        versions.push(...(data.data ?? []));
        url = data.links?.next?.href ?? null;
      }

      const trimmed = versions.slice(0, limit);

      if (opts.json) {
        console.log(JSON.stringify(trimmed, null, 2));
        return;
      }

      const rows = trimmed.map((v, i) => [
        String(trimmed.length - i),
        v.id,
        fmtDate(v.attributes.createTime ?? v.attributes.lastModifiedTime),
        v.attributes.fileType ?? '',
        formatBytes(v.attributes.storageSize),
        v.relationships?.storage?.data?.id ?? '',
      ]);

      console.log(formatTable(
        ['VER', 'VERSION URN', 'DATE', 'TYPE', 'SIZE', 'STORAGE URN'],
        rows,
      ));
    });

  // ── search ───────────────────────────────────────────────────────────────────
  file
    .command('search <project-id>')
    .description('Search files in a project by name pattern')
    .requiredOption('--name <pattern>', 'Filename substring to search for (case-insensitive)')
    .option('--folder-id <urn>', 'Restrict search to a specific folder URN')
    .option('--ext <extension>', 'Filter by file extension, e.g. pdf or dwg')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Searches for files whose display name contains the given pattern.
Without --folder-id, searches the entire project via the DM search endpoint.
With --folder-id, walks the folder and filters client-side.

Examples:
  aps file search <projectId> --name "site plan"
  aps file search <projectId> --name "NN_A4" --ext pdf
  aps file search <projectId> --name "location" --folder-id urn:adsk.wipprod:fs.folder:co.xxx --json`)
    .action(async (
      projectId: string,
      opts: { name: string; folderId?: string; ext?: string; json?: boolean },
    ) => {
      const token = await getAccessToken();
      const pid = addBPrefix(projectId);
      const pattern = opts.name.toLowerCase();
      const extFilter = opts.ext
        ? (opts.ext.startsWith('.') ? opts.ext.toLowerCase() : `.${opts.ext.toLowerCase()}`)
        : undefined;

      if (opts.folderId) {
        // Folder-scoped: use folder contents endpoint and filter client-side
        const { listFolderItems } = await import('./ls.ts');
        const items = await listFolderItems(projectId, opts.folderId, { ext: opts.ext });
        const matches = items.filter(i => i.name.toLowerCase().includes(pattern));

        if (opts.json) {
          console.log(JSON.stringify(matches, null, 2));
          return;
        }

        const rows = matches.map(i => [
          i.name,
          i.id,
          fmtDate(i.lastModifiedTime),
          formatBytes(i.storageSize),
          i.fileType ?? '',
        ]);
        console.log(formatTable(['NAME', 'ITEM ID', 'MODIFIED', 'SIZE', 'TYPE'], rows));
        return;
      }

      // Project-wide search using DM search endpoint
      const results: SearchResponse['data'] = [];
      const included: VersionObject[] = [];
      let page = 0;

      while (true) {
        const params = new URLSearchParams();
        params.set('filter[attributes.displayName]', opts.name);
        params.set('page[limit]', '100');
        params.set('page[number]', String(page));

        const url = `${DM_BASE}/${encodeURIComponent(pid)}/search?${params.toString()}`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

        if (!res.ok) {
          const body = await res.text();
          throw new Error(`Search failed (${res.status}): ${body}`);
        }

        const data = (await res.json()) as SearchResponse;
        results.push(...(data.data ?? []));
        included.push(...(data.included ?? []));
        if (!data.links?.next) break;
        page++;
      }

      // Build version lookup for storage size / fileType
      const versionMap = new Map<string, VersionObject>();
      for (const v of included) {
        if (v.type === 'versions') versionMap.set(v.id, v);
      }

      const filtered = (results ?? []).filter(r => {
        const name = (r.attributes?.displayName ?? r.attributes?.name ?? '').toLowerCase();
        if (!name.includes(pattern)) return false;
        if (extFilter) {
          const tipId = r.relationships?.tip?.data?.id;
          const version = tipId ? versionMap.get(tipId) : undefined;
          const ft = version?.attributes?.fileType ?? r.attributes?.fileType ?? '';
          if (!ft.toLowerCase().includes(extFilter.replace('.', ''))) return false;
        }
        return true;
      });

      if (opts.json) {
        console.log(JSON.stringify(filtered, null, 2));
        return;
      }

      const rows = filtered.map(r => {
        const tipId = r.relationships?.tip?.data?.id;
        const version = tipId ? versionMap.get(tipId) : undefined;
        return [
          truncate(r.attributes?.displayName ?? r.attributes?.name ?? '', 50),
          r.id,
          fmtDate(r.attributes?.lastModifiedTime ?? version?.attributes?.lastModifiedTime),
          version?.attributes?.fileType ?? r.attributes?.fileType ?? '',
          formatBytes(version?.attributes?.storageSize ?? r.attributes?.storageSize),
        ];
      });

      console.log(formatTable(['NAME', 'ITEM ID', 'MODIFIED', 'TYPE', 'SIZE'], rows));
    });

  // ── refs ─────────────────────────────────────────────────────────────────────
  file
    .command('refs <project-id> <item-id>')
    .description('List refs (xrefs and derived files) for a file item')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Returns the relationships/refs for an item — external references (xrefs) and
any derivative outputs linked to this file.

Examples:
  aps file refs <projectId> urn:adsk.wipprod:dm.lineage:xxxx
  aps file refs <projectId> urn:adsk.wipprod:dm.lineage:xxxx --json`)
    .action(async (projectId: string, itemId: string, opts: { json?: boolean }) => {
      const token = await getAccessToken();
      const pid = addBPrefix(projectId);

      const res = await fetch(
        `${DM_BASE}/${encodeURIComponent(pid)}/items/${encodeURIComponent(itemId)}/relationships/refs`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to get refs (${res.status}): ${body}`);
      }

      const data = await res.json() as { data?: Array<{ type: string; id: string; meta?: { refType?: string; direction?: string } }> };

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const refs = data.data ?? [];
      const rows = refs.map(r => [
        r.type,
        r.id,
        r.meta?.refType ?? '',
        r.meta?.direction ?? '',
      ]);

      console.log(formatTable(['TYPE', 'REF ID', 'REF TYPE', 'DIRECTION'], rows));
    });

  // ── viewer-urn ────────────────────────────────────────────────────────────────
  file
    .command('viewer-urn')
    .description('Output the base64url-encoded URN needed to load a file in the APS Viewer')
    .argument('[project-id]', 'ACC project UUID (without b. prefix)')
    .argument('[item-id]', 'Item lineage URN (urn:adsk.wipprod:dm.lineage:...)')
    .option('--acc-url <url>', 'Parse project ID and entity ID directly from an ACC viewer URL')
    .addHelpText('after', `
Fetches the item's tip (latest) version and prints the base64url-encoded URN
suitable for passing to the APS Viewer or aps-viewer-screenshot.

Output is the URN only (stdout) — designed for shell capture.

Examples:
  aps file viewer-urn <projectId> urn:adsk.wipprod:dm.lineage:xxxx
  aps file viewer-urn --acc-url "https://acc.autodesk.com/build/files/projects/..."

Pipe to screenshot tool:
  URN=$(aps file viewer-urn --acc-url "<url>")
  node ~/Dev/viewer-screenshot/screenshot.mjs --urn "$URN" -o out.jpg`)
    .action(async (projectId: string | undefined, itemId: string | undefined, opts: { accUrl?: string }) => {
      if (opts.accUrl) {
        const { parseAccUrl } = await import('../lib/url-parser.ts');
        const ctx = parseAccUrl(opts.accUrl);
        projectId = ctx.projectId;
        itemId = ctx.entityId ?? undefined;
      }

      if (!projectId || !itemId) {
        throw new Error('Provide <project-id> <item-id> or --acc-url');
      }

      const token = await getAccessToken();
      const pid = addBPrefix(projectId);

      const res = await fetch(
        `${DM_BASE}/${encodeURIComponent(pid)}/items/${encodeURIComponent(itemId)}/tip`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to fetch tip version (${res.status}): ${body}`);
      }

      const data = (await res.json()) as ItemTipResponse;
      const versionUrn = data.data?.id;
      if (!versionUrn) throw new Error('No version URN in tip response');

      const viewerUrn = Buffer.from(versionUrn).toString('base64url');
      console.log(viewerUrn);
    });
}
