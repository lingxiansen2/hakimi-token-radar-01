import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));
const TEXT_CAP_BYTES = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASH_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const VALID_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const require = createRequire(import.meta.url);
const { runBoardPipeline } = require('./dashboard/model.js') as {
  runBoardPipeline: (snapshot: {
    as_of: string;
    source: string;
    floor_usd: number;
    protocols: unknown[];
    watchlist: string[];
  }) => {
    meta: Record<string, unknown>;
    filter_audit: Record<string, number>;
    model: Record<string, unknown>;
    rows: Array<{
      rank: number;
      slug: string;
      name: string;
      implied_value_usd: number;
      farm_steps: string[];
    }>;
  };
};

function readCliArg(flag: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${flag}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1]!;
  const eq = process.argv.find((item) => item.startsWith(`--${flag}=`));
  return eq ? eq.slice(flag.length + 3) : fallback;
}

function copyTree(srcDir: string, dstDir: string): string[] {
  if (!existsSync(srcDir)) return [];
  mkdirSync(dstDir, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(srcDir).sort()) {
    if (name.startsWith('.')) continue;
    const full = join(srcDir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      for (const child of copyTree(full, join(dstDir, name))) copied.push(`${name}/${child}`);
    } else if (st.isFile()) {
      copyFileSync(full, join(dstDir, name));
      copied.push(name);
    }
  }
  return copied;
}

const inputArg = readCliArg('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  process.stderr.write(`token-radar-01: snapshot not found at ${snapshotPath}\n`);
  process.exit(2);
}

const outDir = readCliArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const rawSnapshotText = readFileSync(snapshotPath, 'utf8');
const snapshot = JSON.parse(rawSnapshotText) as {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: unknown[];
  watchlist: string[];
};

const boardPayload = runBoardPipeline(snapshot);
const { rows } = boardPayload;

if (rows.length < 100 || rows.length > 4000) {
  throw new Error(`Row count ${rows.length} outside [100, 4000]`);
}
const rowSlugs = new Set(rows.map((r) => r.slug));
for (const wlSlug of snapshot.watchlist) {
  if (!rowSlugs.has(wlSlug)) throw new Error(`Missing watchlist slug: ${wlSlug}`);
}
for (let i = 0; i < rows.length; i++) {
  const r = rows[i]!;
  if (r.rank !== i + 1) throw new Error(`Invalid rank at index ${i}`);
  if (i > 0 && r.implied_value_usd > rows[i - 1]!.implied_value_usd) {
    throw new Error(`Non-monotonic implied_value_usd at rank ${r.rank}`);
  }
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
    throw new Error(`Invalid farm_steps length for ${r.slug}`);
  }
  for (const s of r.farm_steps) {
    const t = s.trim();
    if (t.length < 20 || t.length > 600) throw new Error(`Invalid farm step length for ${r.slug}: ${t.length}`);
  }
}

mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, 'dashboard'), { recursive: true, force: true });
rmSync(join(outDir, 'screenshots'), { recursive: true, force: true });

writeFileSync(
  join(outDir, 'board.json'),
  `${JSON.stringify({ meta: boardPayload.meta, filter_audit: boardPayload.filter_audit, model: boardPayload.model, rows }, null, 2)}\n`,
);
// Provide the raw snapshot to the offline dashboard so dashboard/model.js runs the full pipeline live in the browser
writeFileSync(join(outDir, 'data.js'), `window.__TOKEN_RADAR_SNAPSHOT__ = ${JSON.stringify(snapshot)};\n`);

const dashFiles = copyTree(join(ROOT_DIR, 'dashboard'), join(outDir, 'dashboard'));
const dashTotalBytes = dashFiles.reduce((s, f) => s + statSync(join(outDir, 'dashboard', f)).size, 0);
if (dashTotalBytes > 64_000) {
  process.stderr.write(`token-radar-01: warning dashboard/ total bytes ${dashTotalBytes} > 64000\n`);
}
const shotFiles = copyTree(join(ROOT_DIR, 'screenshots'), join(outDir, 'screenshots'));

if (shotFiles.length >= 3 && shotFiles.length <= 4) {
  for (const name of shotFiles) {
    if (!VALID_NAME.test(name)) throw new Error(`Invalid screenshot filename: ${name}`);
  }
  const dossierBytes = buildDossier(outDir, {
    text_max_bytes: TEXT_CAP_BYTES,
    screenshots: SHOT_CAPS,
    dashboard: DASH_CAPS,
  });
  writeFileSync(join(outDir, 'dossier.json'), dossierBytes);
  process.stdout.write(
    `token-radar-01: scored ${rows.length} pre-token targets; wrote board.json, data.js, ${dashFiles.length} dashboard files, ${shotFiles.length} screenshots, dossier.json (${dossierBytes.length} bytes)\n`,
  );
} else {
  process.stdout.write(`token-radar-01: scored ${rows.length} targets; waiting for 3 screenshots in screenshots/\n`);
}
