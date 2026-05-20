import { Command } from 'commander';
import { login } from './commands/login.ts';
import { configure, configureSsa } from './commands/configure.ts';
import { logout } from './commands/logout.ts';
import { query } from './commands/query.ts';
import { queryDocs, categoryNames } from './commands/query-docs.ts';
import { urlCommand } from './commands/url.ts';
import { downloadCommand } from './commands/download.ts';
import { lsCommand } from './commands/ls.ts';
import { registerRfiCommands } from './commands/rfi.ts';
import { registerLocationCommands } from './commands/locations.ts';
import { registerAssetCommands } from './commands/assets.ts';
import { registerSheetCommands } from './commands/sheets.ts';
import { registerFileCommands } from './commands/files.ts';
import { registerRecapCommands } from './commands/recap.ts';

const program = new Command();

program
  .name('aps')
  .description('CLI for Autodesk Platform Services APIs')
  .addHelpText('after', ``);

program
  .command('configure')
  .description('Store APS client credentials')
  .option('--client-id <id>', 'Your APS application client ID')
  .option('--client-secret <secret>', 'Your APS application client secret')
  .option('--token <path>', 'Path to a token JSON file to import (bypasses browser login)')
  .option('--ssa', 'Create a Secure Service Account (SSA) and store credentials')
  .action(async (opts, cmd) => {
    if (!opts.clientId && !opts.clientSecret && !opts.token && !opts.ssa) {
      cmd.help();
    }
    if (opts.ssa) {
      await configureSsa(opts.clientId, opts.clientSecret);
      return;
    }
    await configure(opts.clientId, opts.clientSecret, opts.token);
  });

program
  .command('login')
  .description('Authenticate via OAuth (3-legged)')
  .addHelpText('after', `
Requires APS_CLIENT_ID and APS_CLIENT_SECRET (or run \`aps configure\` first).
Opens the auth URL in your browser, waits for the OAuth callback on a local
HTTP listener, then saves the token to ~/.config/aps-cli/token.json.`)
  .action(async () => {
    await login();
  });

program
  .command('logout')
  .description('Clear stored credentials')
  .addHelpText('after', '\nRemoves the token stored at ~/.config/aps-cli/token.json.')
  .action(() => {
    logout();
  });

program
  .command('url')
  .description('Resolve an ACC URL to AEC Data Model hub and project IDs')
  .argument('<acc-url>', 'ACC file or project URL containing a project UUID in the path')
  .addHelpText('after', `
Extracts the project UUID from the ACC URL, then queries the AEC Data Model
GraphQL API to find the matching hub and project. Outputs JSON to stdout.

Output fields:
  hubId          AEC Data Model hub ID
  hubName        Hub display name
  projectId      AEC Data Model project ID
  projectName    Project display name
  entityId       Entity lineage URN from URL query (if present)
  fileName       File name resolved from entityId (if present and accessible)

Requires an active login. Run \`aps login\` first.`)
  .action(async (accUrl: string) => {
    await urlCommand(accUrl);
  });

program
  .command('query')
  .description('Query the AEC Data Model GraphQL API')
  .requiredOption('-q, --query <graphql>', 'GraphQL query string')
  .option(
    '--var <key=value>',
    'GraphQL variable in key=value format (repeatable)',
    (val: string, prev: string[]) => [...prev, val],
    [] as string[],
  )
  .addHelpText('after', `
JSON result goes to stdout.

Example:
  aps query --query 'query($id: ID!) { project(projectId: $id) { name } }' --var id=<projectId>

For doc on how to write a query, run \`aps query-docs --help\`.`)
  .action(async (opts) => {
    const vars: Record<string, string> = {};
    for (const pair of opts.var as string[]) {
      const eq = pair.indexOf('=');
      if (eq < 1) throw new Error(`Invalid --var format (expected key=value): ${pair}`);
      vars[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    await query(opts.query, vars);
  });

program
  .command('query-docs')
  .description('Browse AEC Data Model doc resources by category')
  .argument('[category]', `Doc category: ${categoryNames.join(', ')}`)
  .addHelpText('after', `
If no category is given, all doc resources are printed.

Examples:
  aps query-docs
  aps query-docs getting-started
  aps query-docs queries`)
  .action((category?: string) => {
    queryDocs(category);
  });

program
  .command('ls')
  .description('List projects or files in a project folder')
  .argument('[project-id]', 'ACC project UUID (without b. prefix). Omit to list all accessible projects.')
  .argument('[folder-id]', 'Folder URN (e.g. urn:adsk.wipprod:fs.folder:co.xxxxx)')
  .option('--ext <extension>', 'Filter by file extension, e.g. xlsx or .xlsx')
  .option('--since <duration>', 'Only files modified within this window, e.g. 24h, 7d, 30m')
  .option('--type <type>', 'Filter by type: items, folders, all (default: all)', 'all')
  .option('--json', 'Output raw JSON array instead of a table')
  .addHelpText('after', `
Default output is a human-readable table. Use --json for machine-readable output.

Requires an active login. Run \`aps login\` first.

Examples:
  aps ls                                                        # list all accessible projects
  aps ls --json                                                 # list projects as JSON
  aps ls 3064c64b-0114-4079-a656-efee7f5a9e2b 'urn:adsk.wipprod:fs.folder:co.xxx'
  aps ls 3064c64b-... 'urn:adsk.wipprod:fs.folder:co.xxx' --ext xlsx --since 24h
  aps ls 3064c64b-... 'urn:adsk.wipprod:fs.folder:co.xxx' --type items --json`)
  .action(async (projectId: string | undefined, folderId: string | undefined, opts: { ext?: string; since?: string; type?: string; json?: boolean }) => {
    await lsCommand(projectId, folderId, opts);
  });

program
  .command('download')
  .description('Download a file or folder of files from ACC to disk')
  .argument('[acc-url]', 'ACC URL containing an entityId query parameter')
  .option('-o, --output <path>', 'Output file path (single file) or directory (folder mode)')
  .option('--project-id <uuid>', 'ACC project UUID (alternative to passing the full URL)')
  .option('--entity-id <urn>', 'ACC entity lineage URN — downloads a single file')
  .option('--folder-id <urn>', 'Folder URN — downloads all matching files in the folder')
  .option('--ext <extension>', 'Filter by file extension when using --folder-id (e.g. xlsx)')
  .option('--since <duration>', 'Only files modified within this window when using --folder-id (e.g. 24h, 7d)')
  .addHelpText('after', `
Single-file mode (default): extracts the entityId from the ACC URL or --entity-id flag,
fetches metadata via the Data Management API, generates a signed S3 download URL, and
writes the file to disk.

Folder mode (--folder-id): lists all matching files in the folder and downloads each one
to the --output directory (created if it does not exist).

Requires an active login. Run \`aps login\` first.

Examples:
  aps download "https://acc.autodesk.com/docs/files/projects/...?entityId=urn:adsk.wipprod:dm.lineage:..."
  aps download --project-id 8e2088c1-... --entity-id urn:adsk.wipprod:dm.lineage:6-un4f7J...
  aps download --project-id 3064c64b-... --folder-id 'urn:adsk.wipprod:fs.folder:co.xxx' --ext xlsx --since 24h --output /tmp/sheets/`)
  .action(async (
    accUrl: string | undefined,
    opts: { output?: string; projectId?: string; entityId?: string; folderId?: string; ext?: string; since?: string }
  ) => {
    await downloadCommand(accUrl, opts);
  });

registerRfiCommands(program);
registerLocationCommands(program);
registerAssetCommands(program);
registerSheetCommands(program);
registerFileCommands(program);
registerRecapCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${msg}`);
  process.exit(1);
});
