import { Command } from 'commander';
import { getAccessToken } from '../lib/auth.ts';

const LOC_BASE = 'https://developer.api.autodesk.com/construction/locations/v2/projects';

// --- Types ---

interface LocationNode {
  id: string;
  name: string;
  parentId: string | null;
  type: string;
  barcode: string | null;
  order?: number | null;
}

interface LocationNodesResponse {
  results?: LocationNode[];
  nodes?: LocationNode[];
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

/**
 * Compute depth of each node by traversing parent chain.
 * Returns a Map from node id to depth (root nodes with no parent = depth 0).
 */
function computeDepths(nodes: LocationNode[]): Map<string, number> {
  const parentMap = new Map<string, string | null>(nodes.map(n => [n.id, n.parentId]));
  const depthCache = new Map<string, number>();

  function getDepth(id: string): number {
    if (depthCache.has(id)) return depthCache.get(id)!;
    const parentId = parentMap.get(id);
    if (!parentId) {
      depthCache.set(id, 0);
      return 0;
    }
    const d = getDepth(parentId) + 1;
    depthCache.set(id, d);
    return d;
  }

  for (const node of nodes) {
    getDepth(node.id);
  }

  return depthCache;
}

// --- Command registration ---

export function registerLocationCommands(program: Command): void {
  const location = program
    .command('location')
    .description('Manage ACC Location nodes (areas) in a project')
    .addHelpText('after', '\nRequires an active login. Run `aps login` first.');

  // ── ls ──────────────────────────────────────────────────────────────────────
  location
    .command('ls <project-id>')
    .description('List all location nodes in the default location tree')
    .option('--json', 'Output raw JSON')
    .option('--depth <n>', 'Only show nodes at depth <= n (root = 0)')
    .option('--parent <node-id>', 'Only show direct children of this node ID')
    .addHelpText('after', `
Examples:
  aps location ls <projectId>
  aps location ls <projectId> --depth 2
  aps location ls <projectId> --parent <nodeId>
  aps location ls <projectId> --json`)
    .action(async (
      projectId: string,
      opts: { json?: boolean; depth?: string; parent?: string },
    ) => {
      const token = await getAccessToken();
      const pid = stripBPrefix(projectId);

      const url = `${LOC_BASE}/${encodeURIComponent(pid)}/trees/default/nodes`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to list location nodes (${res.status}): ${errBody}`);
      }

      const data = (await res.json()) as LocationNodesResponse;
      const allNodes: LocationNode[] = data.results ?? data.nodes ?? [];

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      let nodes = allNodes;

      // Filter by --parent (direct children only)
      if (opts.parent) {
        nodes = nodes.filter(n => n.parentId === opts.parent);
      }

      // Filter by --depth
      if (opts.depth !== undefined) {
        const maxDepth = parseInt(opts.depth, 10);
        if (isNaN(maxDepth)) throw new Error(`Invalid --depth value: ${opts.depth}`);
        const depths = computeDepths(allNodes);
        nodes = nodes.filter(n => (depths.get(n.id) ?? 0) <= maxDepth);
      }

      const rows = nodes.map(n => [
        n.name,
        n.id,
        n.parentId ?? '',
        n.barcode ?? '',
      ]);

      console.log(formatTable(['NAME', 'ID', 'PARENT ID', 'BARCODE'], rows));
    });

  // ── get ─────────────────────────────────────────────────────────────────────
  location
    .command('get <project-id> <node-id>')
    .description('Get details for a single location node')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  aps location get <projectId> <nodeId>
  aps location get <projectId> <nodeId> --json`)
    .action(async (projectId: string, nodeId: string, opts: { json?: boolean }) => {
      const token = await getAccessToken();
      const pid = stripBPrefix(projectId);

      const url = `${LOC_BASE}/${encodeURIComponent(pid)}/trees/default/nodes/${encodeURIComponent(nodeId)}`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to get location node (${res.status}): ${errBody}`);
      }

      const node = (await res.json()) as LocationNode;

      if (opts.json) {
        console.log(JSON.stringify(node, null, 2));
        return;
      }

      const fields: [string, string][] = [
        ['id', node.id],
        ['name', node.name],
        ['parentId', node.parentId ?? ''],
        ['type', node.type ?? ''],
        ['barcode', node.barcode ?? ''],
        ['order', node.order != null ? String(node.order) : ''],
      ];

      const labelWidth = Math.max(...fields.map(([l]) => l.length));
      for (const [label, value] of fields) {
        console.log(`${label.padEnd(labelWidth)}  ${value}`);
      }
    });

  // ── create ───────────────────────────────────────────────────────────────────
  location
    .command('create <project-id> <name>')
    .description('Create a new location node')
    .requiredOption('--parent <parent-node-id>', 'Parent node ID')
    .option('--barcode <barcode>', 'Optional barcode for the node')
    .addHelpText('after', `
Examples:
  aps location create <projectId> "Stage Left" --parent <parentNodeId>
  aps location create <projectId> "Booth A" --parent <parentNodeId> --barcode BC-001`)
    .action(async (
      projectId: string,
      name: string,
      opts: { parent: string; barcode?: string },
    ) => {
      const token = await getAccessToken();
      const pid = stripBPrefix(projectId);

      const body: Record<string, unknown> = {
        parentId: opts.parent,
        type: 'Area',
        name,
      };
      if (opts.barcode) body.barcode = opts.barcode;

      const url = `${LOC_BASE}/${encodeURIComponent(pid)}/trees/default/nodes`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to create location node (${res.status}): ${errBody}`);
      }

      const created = await res.json();
      console.log(JSON.stringify(created, null, 2));
    });

  // ── update ───────────────────────────────────────────────────────────────────
  location
    .command('update <project-id> <node-id>')
    .description('Update an existing location node')
    .option('--name <name>', 'New name for the node')
    .option('--barcode <barcode>', 'New barcode for the node')
    .addHelpText('after', `
Examples:
  aps location update <projectId> <nodeId> --name "Main Stage"
  aps location update <projectId> <nodeId> --barcode BC-999`)
    .action(async (
      projectId: string,
      nodeId: string,
      opts: { name?: string; barcode?: string },
    ) => {
      if (!opts.name && !opts.barcode) {
        throw new Error('At least one of --name or --barcode is required');
      }

      const token = await getAccessToken();
      const pid = stripBPrefix(projectId);

      const body: Record<string, unknown> = {};
      if (opts.name) body.name = opts.name;
      if (opts.barcode) body.barcode = opts.barcode;

      const url = `${LOC_BASE}/${encodeURIComponent(pid)}/trees/default/nodes/${encodeURIComponent(nodeId)}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to update location node (${res.status}): ${errBody}`);
      }

      const updated = await res.json();
      console.log(JSON.stringify(updated, null, 2));
    });
}
