import { Command } from 'commander';
import { getAccessToken } from '../lib/auth.ts';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

const RECAP_BASE = 'https://developer.api.autodesk.com/photo-to-3d/v1';

// --- Types ---

interface PhotosceneCreateResponse {
  msg: string;
  Photoscene: { photosceneid: string };
}

interface PhotosceneProgressResponse {
  Photoscene: {
    photosceneid: string;
    progressmsg: string;
    progress: string;
  };
}

interface PhotosceneResultResponse {
  Photoscene: {
    photosceneid: string;
    progressmsg: string;
    progress: string;
    scenelink?: string;
    filesize?: string;
  };
}

interface FileRecord {
  filename: string;
  filesize: string;
  msg: string;
}

interface FileUploadResponse {
  photosceneid: string;
  Files: { file: FileRecord | FileRecord[] };
}

// --- Helpers ---

function toArray<T>(val: T | T[]): T[] {
  return Array.isArray(val) ? val : [val];
}

// --- Command registration ---

export function registerRecapCommands(program: Command): void {
  const recap = program
    .command('recap')
    .description('Reality Capture API — create 3D meshes from overlapping photos')
    .addHelpText('after', `
Requires an active login with data:read and data:write scopes. Run \`aps login\` first.

Typical workflow:
  1. aps recap create "my-scan" --format rcm,ortho   → prints photosceneId
  2. aps recap add-files <id> ./img1.jpg ./img2.jpg  → associate photos
  3. aps recap process <id>                          → start processing
  4. aps recap status <id> --watch                   → poll until DONE
  5. aps recap result <id> --output ./scan.rcm       → download output`);

  // ── create ──────────────────────────────────────────────────────────────────
  recap
    .command('create <scene-name>')
    .description('Create a new photoscene')
    .option('--format <formats>', 'Comma-separated output formats: rcm,rcs,obj,fbx,ortho,report', 'rcm')
    .option(
      '--meta <key=value>',
      'Metadata pair (repeatable). Use for coordinate system or processing options.',
      (v: string, prev: string[]) => [...prev, v],
      [] as string[],
    )
    .addHelpText('after', `
Output formats:
  rcm    Autodesk ReCap Photo Mesh (default)
  rcs    Autodesk ReCap Point Cloud
  obj    Wavefront Object
  fbx    Autodesk FBX 3D asset exchange
  ortho  Ortho Photo and Elevation Map
  report Quality Report

Outputs the photoscene ID to stdout on success (suitable for shell capture).

Examples:
  aps recap create "site-scan-may26"
  aps recap create "site-scan" --format rcm,ortho
  aps recap create "utm-scan" --meta 'metadata_name[0]=targetcs' --meta 'metadata_value[0]=UTM84-32N'`)
    .action(async (sceneName: string, opts: { format: string; meta: string[] }) => {
      const token = await getAccessToken();

      const body = new URLSearchParams();
      body.set('scenename', sceneName);
      body.set('format', opts.format);
      for (const pair of opts.meta) {
        const eq = pair.indexOf('=');
        if (eq < 1) throw new Error(`Invalid --meta format (expected key=value): ${pair}`);
        body.set(pair.slice(0, eq), pair.slice(eq + 1));
      }

      const res = await fetch(`${RECAP_BASE}/photoscene`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to create photoscene (${res.status}): ${errBody}`);
      }

      const data = (await res.json()) as PhotosceneCreateResponse;
      if (data.msg !== 'No error') throw new Error(`ReCap API error: ${data.msg}`);

      process.stderr.write(`Created photoscene\n`);
      console.log(data.Photoscene.photosceneid);
    });

  // ── add-files ────────────────────────────────────────────────────────────────
  recap
    .command('add-files <photoscene-id> <files...>')
    .description('Add JPEG images to a photoscene by local path or HTTPS URL')
    .option('--type <type>', 'File type: image or survey (default: image)', 'image')
    .addHelpText('after', `
Files can be local paths or HTTPS/HTTP/FTP URLs. Cannot mix in a single call.
Only JPEG images are supported. Recommend separate calls for large batches to
avoid API timeouts.

Examples:
  aps recap add-files <photosceneId> ./img1.jpg ./img2.jpg ./img3.jpg
  aps recap add-files <photosceneId> https://example.com/a.jpg https://example.com/b.jpg`)
    .action(async (photosceneId: string, files: string[], opts: { type: string }) => {
      const token = await getAccessToken();

      const isUrl = (s: string) => /^https?:\/\/|^ftp:\/\//.test(s);
      const hasUrls = files.some(isUrl);
      const hasLocal = files.some(f => !isUrl(f));

      if (hasUrls && hasLocal) {
        throw new Error('Cannot mix local paths and URLs in a single call. Use separate calls.');
      }

      let res: Response;

      if (hasUrls) {
        const body = new URLSearchParams();
        body.set('photosceneid', photosceneId);
        body.set('type', opts.type);
        files.forEach((url, i) => body.set(`file[${i}]`, url));

        res = await fetch(`${RECAP_BASE}/file`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: body.toString(),
        });
      } else {
        const form = new FormData();
        form.append('photosceneid', photosceneId);
        form.append('type', opts.type);

        for (let i = 0; i < files.length; i++) {
          const buf = await readFile(files[i] as string);
          const blob = new Blob([buf], { type: 'image/jpeg' });
          form.append(`file[${i}]`, blob, basename(files[i]));
        }

        res = await fetch(`${RECAP_BASE}/file`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: form,
        });
      }

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to add files (${res.status}): ${errBody}`);
      }

      const data = (await res.json()) as FileUploadResponse;
      const fileList = toArray(data.Files?.file ?? []);

      for (const f of fileList) {
        const ok = f.msg === 'No error';
        process.stderr.write(`  ${f.filename} (${f.filesize} bytes): ${ok ? 'OK' : `ERROR: ${f.msg}`}\n`);
      }

      const errors = fileList.filter(f => f.msg !== 'No error');
      if (errors.length > 0) throw new Error(`${errors.length} file(s) failed`);
      process.stderr.write(`Added ${fileList.length} file(s) to ${photosceneId}\n`);
    });

  // ── process ──────────────────────────────────────────────────────────────────
  recap
    .command('process <photoscene-id>')
    .description('Start processing a photoscene (async — poll with `aps recap status`)')
    .addHelpText('after', `
Initiates camera calibration, mesh reconstruction, and output conversion.
Processing is async. Use 'aps recap status --watch' to track progress.

Processing time: ~15 min for small sets; hours for 500+ images.

Examples:
  aps recap process <photosceneId>`)
    .action(async (photosceneId: string) => {
      const token = await getAccessToken();

      const res = await fetch(`${RECAP_BASE}/photoscene/${encodeURIComponent(photosceneId)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to start processing (${res.status}): ${errBody}`);
      }

      const data = (await res.json()) as PhotosceneCreateResponse;
      if (data.msg !== 'No error') throw new Error(`ReCap API error: ${data.msg}`);

      process.stderr.write(`Processing started\n`);
      process.stderr.write(`Run: aps recap status ${photosceneId} --watch\n`);
    });

  // ── status ───────────────────────────────────────────────────────────────────
  recap
    .command('status <photoscene-id>')
    .description('Check processing progress of a photoscene')
    .option('--watch', 'Poll every 30 seconds until complete or failed')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Examples:
  aps recap status <photosceneId>
  aps recap status <photosceneId> --watch
  aps recap status <photosceneId> --json`)
    .action(async (photosceneId: string, opts: { watch?: boolean; json?: boolean }) => {
      const token = await getAccessToken();

      const poll = async (): Promise<PhotosceneProgressResponse> => {
        const res = await fetch(
          `${RECAP_BASE}/photoscene/${encodeURIComponent(photosceneId)}/progress`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Failed to get status (${res.status}): ${errBody}`);
        }
        return (await res.json()) as PhotosceneProgressResponse;
      };

      if (!opts.watch) {
        const data = await poll();
        if (opts.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }
        const s = data.Photoscene;
        console.log(`Status:   ${s.progressmsg}`);
        console.log(`Progress: ${s.progress}%`);
        return;
      }

      process.stderr.write('Watching (Ctrl+C to stop)...\n');
      const terminalStates = new Set(['DONE', 'CANCELLED']);
      while (true) {
        const data = await poll();
        const s = data.Photoscene;
        const ts = new Date().toLocaleTimeString();
        process.stderr.write(`[${ts}] ${s.progressmsg} — ${s.progress}%\n`);
        if (terminalStates.has(s.progressmsg) || s.progressmsg?.startsWith('ERROR')) break;
        await new Promise<void>(r => setTimeout(r, 30_000));
      }
    });

  // ── result ───────────────────────────────────────────────────────────────────
  recap
    .command('result <photoscene-id>')
    .description('Get the download link (or download directly) for a completed photoscene')
    .option('--format <fmt>', 'Output format: rcm, rcs, obj, fbx, ortho, report (default: rcm)', 'rcm')
    .option('-o, --output <path>', 'Download the file to this path')
    .option('--json', 'Output raw JSON')
    .addHelpText('after', `
Returns a time-limited S3 download link (valid 7 days from project completion).
Use --output to stream the file directly to disk.

Each format must be requested separately (separate calls per format).

Examples:
  aps recap result <photosceneId>                         # print link for rcm
  aps recap result <photosceneId> --format obj
  aps recap result <photosceneId> --format rcm --output ./scan.rcm`)
    .action(async (photosceneId: string, opts: { format: string; output?: string; json?: boolean }) => {
      const token = await getAccessToken();

      const params = new URLSearchParams({ format: opts.format });
      const res = await fetch(
        `${RECAP_BASE}/photoscene/${encodeURIComponent(photosceneId)}?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to get result (${res.status}): ${errBody}`);
      }

      const data = (await res.json()) as PhotosceneResultResponse;

      if (opts.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const scene = data.Photoscene;

      if (scene.progressmsg !== 'DONE') {
        throw new Error(`Photoscene not complete. Status: ${scene.progressmsg} (${scene.progress}%)`);
      }

      if (!scene.scenelink) {
        throw new Error('No scenelink in response. Ensure the photoscene finished processing.');
      }

      if (!opts.output) {
        console.log(scene.scenelink);
        if (scene.filesize) {
          const mb = (Math.round(parseInt(scene.filesize) / 1024 / 1024 * 10) / 10).toFixed(1);
          process.stderr.write(`File size: ${mb} MB\n`);
        }
        process.stderr.write('Link valid for 7 days from project completion.\n');
        return;
      }

      process.stderr.write(`Downloading ${opts.format} to: ${opts.output}\n`);
      const fileRes = await fetch(scene.scenelink);
      if (!fileRes.ok) throw new Error(`Download failed (${fileRes.status})`);
      const buf = await fileRes.arrayBuffer();
      writeFileSync(opts.output, Buffer.from(buf));
      process.stderr.write(`Done\n`);
      console.log(opts.output);
    });

  // ── cancel ───────────────────────────────────────────────────────────────────
  recap
    .command('cancel <photoscene-id>')
    .description('Abort processing of a photoscene')
    .addHelpText('after', `
Examples:
  aps recap cancel <photosceneId>`)
    .action(async (photosceneId: string) => {
      const token = await getAccessToken();

      const res = await fetch(
        `${RECAP_BASE}/photoscene/${encodeURIComponent(photosceneId)}/cancel`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to cancel (${res.status}): ${errBody}`);
      }

      process.stderr.write(`Cancelled photoscene: ${photosceneId}\n`);
    });

  // ── delete ───────────────────────────────────────────────────────────────────
  recap
    .command('delete <photoscene-id>')
    .description('Delete a photoscene and all associated input/output files')
    .addHelpText('after', `
Permanently removes the photoscene and all data. Cannot be undone.

Examples:
  aps recap delete <photosceneId>`)
    .action(async (photosceneId: string) => {
      const token = await getAccessToken();

      const res = await fetch(
        `${RECAP_BASE}/photoscene/${encodeURIComponent(photosceneId)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Failed to delete (${res.status}): ${errBody}`);
      }

      process.stderr.write(`Deleted photoscene: ${photosceneId}\n`);
    });
}
