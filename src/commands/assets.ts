import { Command } from 'commander';
import { getAccessToken } from '../lib/auth.ts';

const ASSETS_V2_BASE = 'https://developer.api.autodesk.com/construction/assets/v2/projects';
const ASSETS_V1_BASE = 'https://developer.api.autodesk.com/construction/assets/v1/projects';

// --- Types ---

interface AssetCategory {
  id: string;
  name: string;
  parentId: string | null;
  statusStepSetId?: string | null;
}

interface AssetCategoriesResponse {
  results?: AssetCategory[];
  data?: AssetCategory[];
}

interface StatusStep {
  id: string;
  label: string;
}

interface StatusStepSet {
  id: string;
  name: string;
  steps?: StatusStep[];
}

interface StatusStepSetsResponse {
  results?: StatusStepSet[];
  data?: StatusStepSet[];
}

interface CustomAttribute {
  name: string;
  displayName?: string;
  dataType?: string;
  required?: boolean;
}

interface CustomAttributesResponse {
  results?: CustomAttribute[];
  data?: CustomAttribute[];
}

interface AssetRecord {
  id: string;
  clientAssetId?: string | null;
  description?: string | null;
  categoryId?: string | null;
  categoryName?: string | null;
  statusId?: string | null;
  statusName?: string | null;
  locationId?: string | null;
  locationName?: string | null;
  barcode?: string | null;
  customAttributes?: Record<string, unknown>;
}

interface AssetsListResponse {
  results?: AssetRecord[];
  data?: AssetRecord[];
  pagination?: { limit: number; offset: number; totalResults: number };
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

// --- Command registration ---

export function registerAssetCommands(program: Command): void {
  const asset = program
    .command('asset')
    .description('Manage ACC Assets in a project')
    .addHelpText('after', '\nRequires an active login. Run `aps login` first.');

  // ── ls ──────────────────────────────────────────────────────────────────────
  asset
    .command('ls <project-id>')
    .description('List assets in a project')
    .option('--limit <n>', 'Max results to return (default 50)', '50')
    .option('--category <id>', 'Filter by category ID')
    .option('--status <id>', 'Filter by status ID')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  aps asset ls <projectId>
  aps asset ls <projectId> --limit 100
  aps asset ls <projectId> --category <categoryId>
  aps asset ls <projectId> --json`)
    .action(async (
      projectId: string,
      opts: { limit: string; category?: string; status?: string; json?: boolean },
    ) => {
      const token = await getAccessToken();
      const bpid = addBPrefix(projectId);

      const params = new URLSearchParams({
        limit: opts.limit,
        offset: '0',
        includeCustomAttributes: 'true',
      });
      if (opts.category) params.set('filter[categoryId]', opts.category);
      if (opts.status) params.set('filter[statusId]', opts.status);

      const url = `${ASSETS_V2_BASE}/${encodeURIComponent(bpid)}/assets?${params}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to list assets (${res.status}): ${errBody}`);
      }

      const data = (await res.json()) as AssetsListResponse;

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const assets: AssetRecord[] = data.results ?? data.data ?? [];
      const total = data.pagination?.totalResults;
      if (total !== undefined) {
        process.stderr.write(`Showing ${assets.length} of ${total} assets\n`);
      }

      const rows = assets.map(a => [
        truncate(a.clientAssetId, 20),
        truncate(a.description, 40),
        truncate(a.categoryName ?? a.categoryId, 25),
        truncate(a.statusName ?? a.statusId, 20),
        truncate(a.locationName ?? a.locationId, 25),
        a.barcode ?? '',
      ]);

      console.log(formatTable(
        ['CLIENT ASSET ID', 'DESCRIPTION', 'CATEGORY', 'STATUS', 'LOCATION', 'BARCODE'],
        rows,
      ));
    });

  // ── get ─────────────────────────────────────────────────────────────────────
  asset
    .command('get <project-id> <asset-id>')
    .description('Get details for a single asset')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  aps asset get <projectId> <assetId>
  aps asset get <projectId> <assetId> --json`)
    .action(async (projectId: string, assetId: string, opts: { json?: boolean }) => {
      const token = await getAccessToken();
      const bpid = addBPrefix(projectId);

      const url = `${ASSETS_V2_BASE}/${encodeURIComponent(bpid)}/assets/${encodeURIComponent(assetId)}?includeCustomAttributes=true`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to get asset (${res.status}): ${errBody}`);
      }

      const a = (await res.json()) as AssetRecord & Record<string, unknown>;

      if (opts.json) {
        console.log(JSON.stringify(a, null, 2));
        return;
      }

      const coreFields: [string, string][] = [
        ['id', a.id],
        ['clientAssetId', a.clientAssetId ?? ''],
        ['description', a.description ?? ''],
        ['categoryId', a.categoryId ?? ''],
        ['categoryName', a.categoryName ?? ''],
        ['statusId', a.statusId ?? ''],
        ['statusName', a.statusName ?? ''],
        ['locationId', a.locationId ?? ''],
        ['locationName', a.locationName ?? ''],
        ['barcode', a.barcode ?? ''],
      ];

      const labelWidth = Math.max(...coreFields.map(([l]) => l.length));
      for (const [label, value] of coreFields) {
        console.log(`${label.padEnd(labelWidth)}  ${value}`);
      }

      if (a.customAttributes && typeof a.customAttributes === 'object') {
        const attrs = a.customAttributes as Record<string, unknown>;
        const keys = Object.keys(attrs);
        if (keys.length > 0) {
          console.log('\nCustom Attributes:');
          const attrLabelWidth = Math.max(...keys.map(k => k.length));
          for (const key of keys) {
            const val = attrs[key];
            const displayVal = val == null ? '' : String(val);
            console.log(`  ${key.padEnd(attrLabelWidth)}  ${displayVal}`);
          }
        }
      }
    });

  // ── categories ───────────────────────────────────────────────────────────────
  asset
    .command('categories <project-id>')
    .description('List asset categories configured for the project')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  aps asset categories <projectId>
  aps asset categories <projectId> --json`)
    .action(async (projectId: string, opts: { json?: boolean }) => {
      const token = await getAccessToken();
      const bpid = addBPrefix(projectId);

      const url = `${ASSETS_V1_BASE}/${encodeURIComponent(bpid)}/categories`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to get categories (${res.status}): ${errBody}`);
      }

      const data = (await res.json()) as AssetCategoriesResponse;

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const categories: AssetCategory[] = data.results ?? data.data ?? [];
      const rows = categories.map(c => [
        c.id,
        c.name,
        c.parentId ?? '',
        c.statusStepSetId ? 'yes' : 'no',
      ]);

      console.log(formatTable(['ID', 'NAME', 'PARENT ID', 'STATUS SET BOUND'], rows));
    });

  // ── status-sets ──────────────────────────────────────────────────────────────
  asset
    .command('status-sets <project-id>')
    .description('List asset status step sets configured for the project')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  aps asset status-sets <projectId>
  aps asset status-sets <projectId> --json`)
    .action(async (projectId: string, opts: { json?: boolean }) => {
      const token = await getAccessToken();
      const bpid = addBPrefix(projectId);

      const url = `${ASSETS_V1_BASE}/${encodeURIComponent(bpid)}/status-step-sets`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to get status step sets (${res.status}): ${errBody}`);
      }

      const data = (await res.json()) as StatusStepSetsResponse;

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const sets: StatusStepSet[] = data.results ?? data.data ?? [];
      const rows = sets.map(s => [
        s.id,
        s.name,
        (s.steps ?? []).map(step => step.label).join(', '),
      ]);

      console.log(formatTable(['ID', 'NAME', 'STEPS'], rows));
    });

  // ── custom-attrs ─────────────────────────────────────────────────────────────
  asset
    .command('custom-attrs <project-id>')
    .description('List custom attribute definitions for assets in the project')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  aps asset custom-attrs <projectId>
  aps asset custom-attrs <projectId> --json`)
    .action(async (projectId: string, opts: { json?: boolean }) => {
      const token = await getAccessToken();
      const bpid = addBPrefix(projectId);

      const url = `${ASSETS_V1_BASE}/${encodeURIComponent(bpid)}/custom-attributes`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to get custom attributes (${res.status}): ${errBody}`);
      }

      const data = (await res.json()) as CustomAttributesResponse;

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const attrs: CustomAttribute[] = data.results ?? data.data ?? [];
      const rows = attrs.map(a => [
        a.name,
        a.displayName ?? '',
        a.dataType ?? '',
        a.required ? 'yes' : 'no',
      ]);

      console.log(formatTable(['NAME', 'DISPLAY NAME', 'DATA TYPE', 'REQUIRED'], rows));
    });
}
