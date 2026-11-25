import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFarmPlan } from './lib/farming.ts';
import { partitionProtocols, type Snapshot } from './lib/filter.ts';
import { fitAndScore, SECTOR_LABELS } from './lib/valuation.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));
const TEXT_CAP_BYTES = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASH_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const VALID_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

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
      for (const child of copyTree(full, join(dstDir, name))) {
        copied.push(`${name}/${child}`);
      }
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
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Snapshot;

const { candidates, tokenized, watchlistSet, audit } = partitionProtocols(snapshot);
const { predictions, summary } = fitAndScore(candidates, tokenized, snapshot.as_of);

const unordered = candidates.map((p) => {
  const val = predictions.get(p.slug)!;
  const farm = buildFarmPlan(p, val);
  const onWatchlist = watchlistSet.has(p.slug);
  const tier = onWatchlist
    ? 'Flagship Watchlist'
    : p.tvl_usd >= snapshot.floor_usd
      ? 'High-TVL Discovery'
      : 'Early Radar';

  return {
    slug: p.slug,
    name: p.name,
    category: p.category ?? 'DeFi',
    sector_group: val.sector_group,
    sector_label: SECTOR_LABELS[val.sector_group],
    chains: p.chains,
    primary_chain: p.chains[0] ?? 'Multi-Chain',
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    months_live: val.months_live,
    on_watchlist: onWatchlist,
    tier,
    implied_value_usd: val.implied_value_usd,
    band_p10_usd: val.band_p10_usd,
    band_p25_usd: val.band_p25_usd,
    band_p75_usd: val.band_p75_usd,
    band_p90_usd: val.band_p90_usd,
    implied_mcap_tvl_ratio: val.implied_mcap_tvl_ratio,
    confidence_tier: val.confidence_tier,
    radar_score: val.radar_score,
    factors: val.factors,
    comparables: val.comparables,
    strategy_summary: farm.strategy_summary,
    est_gas_cost: farm.est_gas_cost,
    time_commitment: farm.time_commitment,
    risk_note: farm.risk_note,
    farm_steps: farm.steps,
  };
});

unordered.sort(
  (a, b) =>
    b.implied_value_usd - a.implied_value_usd ||
    b.tvl_usd - a.tvl_usd ||
    a.slug.localeCompare(b.slug),
);

const rows = unordered.map((row, index) => ({
  rank: index + 1,
  ...row,
}));

// Self-verify gate invariants deterministically
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
    const trimmed = s.trim();
    if (trimmed.length < 20 || trimmed.length > 600) {
      throw new Error(`Farm step length violation for ${r.slug}: ${trimmed.length}`);
    }
  }
}

const totalPreTokenTvl = rows.reduce((s, r) => s + r.tvl_usd, 0);
const totalImpliedFdv = rows.reduce((s, r) => s + r.implied_value_usd, 0);
const chainCounts = new Map<string, number>();
for (const r of rows) {
  for (const c of r.chains) chainCounts.set(c, (chainCounts.get(c) ?? 0) + 1);
}
const topChains = [...chainCounts.entries()]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  .slice(0, 12)
  .map(([chain, count]) => ({ chain, count }));

const tokenizedPeersSample = tokenized
  .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
  .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0))
  .slice(0, 24)
  .map((p) => ({
    slug: p.slug,
    name: p.name,
    symbol: p.symbol,
    category: p.category ?? 'DeFi',
    tvl_usd: p.tvl_usd,
    mcap_usd: p.mcap_usd!,
    multiple: +(p.mcap_usd! / Math.max(1, p.tvl_usd)).toFixed(2),
  }));

const payload = {
  meta: {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    total_tracked_targets: rows.length,
    watchlist_count: audit.retained_watchlist,
    early_discovery_count: audit.retained_early_discovery,
    total_pretoken_tvl_usd: totalPreTokenTvl,
    total_implied_fdv_usd: totalImpliedFdv,
    top_chains: topChains,
  },
  filter_audit: audit,
  model: summary,
  tokenized_peers_sample: tokenizedPeersSample,
  rows,
};

mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, 'dashboard'), { recursive: true, force: true });
rmSync(join(outDir, 'screenshots'), { recursive: true, force: true });

writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ meta: payload.meta, filter_audit: audit, model: summary, rows }, null, 2)}\n`);
writeFileSync(join(outDir, 'data.js'), `window.__TOKEN_RADAR_DATA__ = ${JSON.stringify(payload)};\n`);

const dashFiles = copyTree(join(ROOT_DIR, 'dashboard'), join(outDir, 'dashboard'));
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
    `token-radar-01: scored ${rows.length} pre-token targets (${audit.retained_watchlist} watchlist + ${audit.retained_early_discovery} early; ${audit.excluded_live_token} live-token excluded); wrote board.json, data.js, ${dashFiles.length} dashboard files, ${shotFiles.length} screenshots, dossier.json (${dossierBytes.length} bytes)\n`,
  );
} else {
  process.stdout.write(
    `token-radar-01: scored ${rows.length} pre-token targets (${audit.retained_watchlist} watchlist + ${audit.retained_early_discovery} early); awaiting >=3 screenshots in screenshots/ before writing dossier.json\n`,
  );
}
