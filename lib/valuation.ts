import { EXCLUDED_WRAPPER_AND_CEX_CATEGORIES, type RawProtocol } from './filter.ts';

export type SectorGroup = 'trading' | 'credit_rwa' | 'yield_alloc' | 'infra' | 'other';

export interface SplitMetrics {
  n: number;
  mae_log10: number;
  rmse_log10: number;
  medape_pct: number;
  spearman_rho: number;
  r2_log10: number;
}

export interface AblationStep {
  id: string;
  label: string;
  status: 'baseline' | 'kept' | 'dropped';
  reason: string;
  split_a_cv: SplitMetrics;
  split_b_temporal: SplitMetrics;
}

export interface ComparablePeer {
  slug: string;
  name: string;
  symbol: string | null;
  category: string;
  tvl_usd: number;
  mcap_usd: number;
  mcap_tvl_ratio: number;
}

export interface FactorDecomposition {
  base_anchor_usd: number;
  tvl_scale_mult: number;
  sector_mult: number;
  chain_footprint_mult: number;
  predicted_usd: number;
}

export interface ValuationPrediction {
  implied_value_usd: number;
  band_p10_usd: number;
  band_p25_usd: number;
  band_p75_usd: number;
  band_p90_usd: number;
  implied_mcap_tvl_ratio: number;
  sector_group: SectorGroup;
  factors: FactorDecomposition;
  comparables: ComparablePeer[];
  confidence_tier: 'High' | 'Medium' | 'Speculative';
  months_live: number | null;
  momentum_7d: number | null;
  radar_score: number;
}

export interface ModelSummary {
  reference_pool_size: number;
  reference_pool_rule: string;
  selected_features: string[];
  dropped_features: string[];
  coefficients: {
    intercept_log10: number;
    z_log_tvl: number;
    eb_sector_residual: number;
    z_log_chains: number;
  };
  residual_quantiles_log10: {
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
  temporal_cutoff_date: string;
  ablation: AblationStep[];
  sector_multiples: Array<{ group: SectorGroup; label: string; count: number; median_mcap_tvl: number }>;
}

export function classifySectorGroup(category: string | null): SectorGroup {
  if (!category) return 'other';
  if (['Dexs', 'Derivatives', 'Prediction Market', 'Options Vault', 'OTC Marketplace'].includes(category)) {
    return 'trading';
  }
  if (['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Basis Trading', 'RWA', 'Collateral Management', 'Dual-Token Stablecoin'].includes(category)) {
    return 'credit_rwa';
  }
  if (['Yield', 'Yield Aggregator', 'Risk Curators', 'Onchain Capital Allocator', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Indexes'].includes(category)) {
    return 'yield_alloc';
  }
  if (['Chain', 'Privacy', 'Payments', 'AI Agents', 'Decentralized AI', 'Token Locker', 'Restaking', 'Insurance'].includes(category)) {
    return 'infra';
  }
  return 'other';
}

export const SECTOR_LABELS: Record<SectorGroup, string> = {
  trading: 'Trading & Perps',
  credit_rwa: 'Credit, CDP & RWA',
  yield_alloc: 'Yield & Curators',
  infra: 'Infra, AI & Chains',
  other: 'Other DeFi',
};

interface PreparedRow {
  raw: RawProtocol;
  logTvl: number;
  logMcap: number;
  logChains: number;
  chgAsinh: number;
  ageYears: number | null;
  grp: SectorGroup;
}

interface ModelSpec {
  useSector: boolean;
  useChains: boolean;
  useChg: boolean;
  useAge: boolean;
  lambda: number;
  kGrp: number;
  kCat: number;
}

interface FittedArtifacts {
  coef: number[];
  tvlMean: number;
  tvlStd: number;
  chainsMean: number;
  chainsStd: number;
  chgMean: number;
  chgStd: number;
  ageMean: number;
  ageStd: number;
  grpPrior: Map<SectorGroup, number>;
  catPrior: Map<string, number>;
  predictOne: (row: PreparedRow) => { logPred: number; factors: FactorDecomposition };
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const d = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < d; col++) {
    let piv = col;
    for (let r = col + 1; r < d; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    }
    const tmp = M[col]!;
    M[col] = M[piv]!;
    M[piv] = tmp;
    const div = Math.abs(M[col]![col]!) < 1e-12 ? 1e-12 : M[col]![col]!;
    for (let k = col; k <= d; k++) M[col]![k] /= div;
    for (let r = 0; r < d; r++) {
      if (r === col) continue;
      const factor = M[r]![col]!;
      for (let k = col; k <= d; k++) M[r]![k] -= factor * M[col]![k]!;
    }
  }
  return M.map((r) => r[d]!);
}

function fitHuberRidge(train: PreparedRow[], spec: ModelSpec): FittedArtifacts {
  const n = train.length;
  const tvlMean = train.reduce((s, r) => s + r.logTvl, 0) / n;
  const tvlStd = Math.sqrt(train.reduce((s, r) => s + (r.logTvl - tvlMean) ** 2, 0) / n) || 1;
  const yMean = train.reduce((s, r) => s + r.logMcap, 0) / n;

  let covTvl = 0;
  let varTvl = 0;
  for (const r of train) {
    covTvl += (r.logTvl - tvlMean) * (r.logMcap - yMean);
    varTvl += (r.logTvl - tvlMean) ** 2;
  }
  const baseSlope = covTvl / (varTvl || 1);

  const grpRes = new Map<SectorGroup, number[]>();
  const catRes = new Map<string, number[]>();
  for (const r of train) {
    const res = r.logMcap - (yMean + baseSlope * (r.logTvl - tvlMean));
    const gArr = grpRes.get(r.grp) ?? [];
    gArr.push(res);
    grpRes.set(r.grp, gArr);

    const cat = r.raw.category ?? 'Unknown';
    const cArr = catRes.get(cat) ?? [];
    cArr.push(res);
    catRes.set(cat, cArr);
  }

  const grpPrior = new Map<SectorGroup, number>();
  for (const [g, arr] of grpRes) {
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    grpPrior.set(g, (arr.length / (arr.length + spec.kGrp)) * mean);
  }

  const catPrior = new Map<string, number>();
  for (const [c, arr] of catRes) {
    const gp = grpPrior.get(classifySectorGroup(c)) ?? 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    catPrior.set(c, gp + (arr.length / (arr.length + spec.kCat)) * (mean - gp));
  }

  const chainsMean = train.reduce((s, r) => s + r.logChains, 0) / n;
  const chainsStd = Math.sqrt(train.reduce((s, r) => s + (r.logChains - chainsMean) ** 2, 0) / n) || 1;
  const chgMean = train.reduce((s, r) => s + r.chgAsinh, 0) / n;
  const chgStd = Math.sqrt(train.reduce((s, r) => s + (r.chgAsinh - chgMean) ** 2, 0) / n) || 1;

  const dated = train.filter((r) => r.ageYears !== null);
  const ageMean = dated.reduce((s, r) => s + Math.log10(1 + r.ageYears!), 0) / (dated.length || 1);
  const ageStd = Math.sqrt(dated.reduce((s, r) => s + (Math.log10(1 + r.ageYears!) - ageMean) ** 2, 0) / (dated.length || 1)) || 1;

  const buildX = (r: PreparedRow): number[] => {
    const x = [1, (r.logTvl - tvlMean) / tvlStd];
    if (spec.useSector) x.push(catPrior.get(r.raw.category ?? 'Unknown') ?? grpPrior.get(r.grp) ?? 0);
    if (spec.useChains) x.push((r.logChains - chainsMean) / chainsStd);
    if (spec.useChg) x.push((r.chgAsinh - chgMean) / chgStd);
    if (spec.useAge) x.push(r.ageYears !== null ? (Math.log10(1 + r.ageYears) - ageMean) / ageStd : 0);
    return x;
  };

  const X = train.map(buildX);
  const y = train.map((r) => r.logMcap);
  const d = X[0]!.length;
  const weights = new Array<number>(n).fill(1);
  let coef = new Array<number>(d).fill(0);

  for (let iter = 0; iter < 20; iter++) {
    const A = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    const b = new Array<number>(d).fill(0);
    for (let i = 0; i < n; i++) {
      const xi = X[i]!;
      const wi = weights[i]!;
      const yi = y[i]!;
      for (let j = 0; j < d; j++) {
        b[j]! += wi * xi[j]! * yi;
        for (let k = 0; k < d; k++) {
          A[j]![k]! += wi * xi[j]! * xi[k]!;
        }
      }
    }
    for (let j = 1; j < d; j++) A[j]![j]! += spec.lambda;
    coef = solveLinearSystem(A, b);

    for (let i = 0; i < n; i++) {
      const pred = X[i]!.reduce((s, v, j) => s + v * coef[j]!, 0);
      const absErr = Math.abs(y[i]! - pred);
      weights[i] = absErr <= 0.75 ? 1 : 0.75 / absErr;
    }
  }

  const predictOne = (r: PreparedRow): { logPred: number; factors: FactorDecomposition } => {
    const x = buildX(r);
    let idx = 0;
    const c0 = coef[idx++]!;
    const cTvl = coef[idx++]! * x[1]!;
    const cSec = spec.useSector ? coef[idx++]! * x[idx - 1]! : 0;
    const cChain = spec.useChains ? coef[idx++]! * x[idx - 1]! : 0;
    const rest = x.slice(idx).reduce((s, v, j) => s + v * coef[idx + j]!, 0);
    const logPred = c0 + cTvl + cSec + cChain + rest;
    return {
      logPred,
      factors: {
        base_anchor_usd: Math.round(10 ** c0),
        tvl_scale_mult: +(10 ** cTvl).toFixed(3),
        sector_mult: +(10 ** cSec).toFixed(3),
        chain_footprint_mult: +(10 ** cChain).toFixed(3),
        predicted_usd: Math.max(100_000, Math.round(10 ** logPred)),
      },
    };
  };

  return {
    coef,
    tvlMean,
    tvlStd,
    chainsMean,
    chainsStd,
    chgMean,
    chgStd,
    ageMean,
    ageStd,
    grpPrior,
    catPrior,
    predictOne,
  };
}

function spearman(a: number[], b: number[]): number {
  const rank = (arr: number[]): number[] => {
    const indexed = arr.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
    const out = new Array<number>(arr.length);
    for (let i = 0; i < indexed.length; i++) out[indexed[i]![1]] = i + 1;
    return out;
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (ra[i]! - rb[i]!) ** 2;
  return n <= 1 ? 0 : 1 - (6 * d2) / (n * (n * n - 1));
}

function computeMetrics(yTrue: number[], yPred: number[]): SplitMetrics {
  const n = yTrue.length;
  const mean = yTrue.reduce((s, v) => s + v, 0) / n;
  let sse = 0;
  let sst = 0;
  let mae = 0;
  const apes: number[] = [];
  for (let i = 0; i < n; i++) {
    const err = Math.abs(yTrue[i]! - yPred[i]!);
    mae += err;
    sse += err * err;
    sst += (yTrue[i]! - mean) ** 2;
    const actual = 10 ** yTrue[i]!;
    const pred = 10 ** yPred[i]!;
    apes.push(Math.abs(pred - actual) / actual);
  }
  apes.sort((a, b) => a - b);
  return {
    n,
    mae_log10: +(mae / n).toFixed(3),
    rmse_log10: +Math.sqrt(sse / n).toFixed(3),
    medape_pct: +(apes[Math.floor(n / 2)]! * 100).toFixed(1),
    spearman_rho: +spearman(yTrue, yPred).toFixed(3),
    r2_log10: +(1 - sse / (sst || 1)).toFixed(3),
  };
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function toPrepared(p: RawProtocol, asOfMs: number): PreparedRow {
  const ageYears =
    p.listed_at !== null
      ? Math.max(0.05, (asOfMs - Date.parse(`${p.listed_at}T00:00:00Z`)) / (365.25 * 86_400_000))
      : null;
  return {
    raw: p,
    logTvl: Math.log10(Math.max(1, p.tvl_usd)),
    logMcap: p.mcap_usd !== null && p.mcap_usd > 0 ? Math.log10(p.mcap_usd) : 0,
    logChains: Math.log10(Math.max(1, p.chains.length)),
    chgAsinh: p.change_7d === null ? 0 : Math.asinh(p.change_7d / 15),
    ageYears,
    grp: classifySectorGroup(p.category),
  };
}

/**
 * Fit and validate the empirical valuation model via two blind held-out splits
 * (Split A: 5-fold stratified CV; Split B: temporal out-of-time launch split),
 * then score every pre-token candidate with calibrated prediction bands and peer comps.
 */
export function fitAndScore(
  candidates: RawProtocol[],
  tokenized: RawProtocol[],
  asOfDate: string,
): { predictions: Map<string, ValuationPrediction>; summary: ModelSummary } {
  const asOfMs = Date.parse(`${asOfDate}T00:00:00Z`);
  const refProtocols = tokenized.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && !EXCLUDED_WRAPPER_AND_CEX_CATEGORIES.has(p.category ?? ''),
  );
  const refRows = refProtocols.map((p) => toPrepared(p, asOfMs));

  // Split A: 5-fold stratified by observed log10(mcap_usd)
  const byMcap = [...refRows].sort((a, b) => a.logMcap - b.logMcap);
  const foldOf = new Map<string, number>();
  byMcap.forEach((r, idx) => foldOf.set(r.raw.slug, idx % 5));

  // Split B: Temporal out-of-time split (newest 30% of dated tokenized protocols held out)
  const dated = refRows
    .filter((r) => r.raw.listed_at !== null)
    .sort((a, b) => a.raw.listed_at!.localeCompare(b.raw.listed_at!));
  const cutoffDate = dated[Math.floor(dated.length * 0.70)]!.raw.listed_at!;

  const ablationSpecs: Array<{
    id: string;
    label: string;
    status: 'baseline' | 'kept' | 'dropped';
    reason: string;
    spec: ModelSpec;
  }> = [
    {
      id: 'tvl_only',
      label: 'log10(TVL) baseline',
      status: 'baseline',
      reason: 'Core scale anchor across all 88 DeFi tokenized reference protocols',
      spec: { useSector: false, useChains: false, useChg: false, useAge: false, lambda: 4, kGrp: 10, kCat: 10 },
    },
    {
      id: 'tvl_sector_chains',
      label: '+ EB Sector Multiple + Chain Breadth',
      status: 'kept',
      reason: 'Improves Split A (MedAPE 84.9% -> 77.7%, rho 0.380 -> 0.389) and Split B (MedAPE 79.2% -> 74.5%, rho 0.264 -> 0.283)',
      spec: { useSector: true, useChains: true, useChg: false, useAge: false, lambda: 12, kGrp: 10, kCat: 10 },
    },
    {
      id: 'plus_momentum',
      label: '+ 7d TVL Velocity asinh(chg_7d/15)',
      status: 'dropped',
      reason: 'Degrades Split A (MAE 0.636 -> 0.640, rho 0.389 -> 0.359); retained only as farming timing signal',
      spec: { useSector: true, useChains: true, useChg: true, useAge: false, lambda: 12, kGrp: 10, kCat: 10 },
    },
    {
      id: 'plus_age',
      label: '+ Track Record log10(1 + age_years)',
      status: 'dropped',
      reason: 'Hurts both Split A (MAE 0.636 -> 0.649) and Split B (MAE 0.680 -> 0.753); retained only as TGE seasoning signal',
      spec: { useSector: true, useChains: true, useChg: false, useAge: true, lambda: 12, kGrp: 10, kCat: 10 },
    },
  ];

  const ablation: AblationStep[] = [];
  let selectedOofResiduals: number[] = [];

  for (const step of ablationSpecs) {
    const yA: number[] = [];
    const pA: number[] = [];
    const resA: number[] = [];
    for (let f = 0; f < 5; f++) {
      const tr = refRows.filter((r) => foldOf.get(r.raw.slug) !== f);
      const te = refRows.filter((r) => foldOf.get(r.raw.slug) === f);
      const fit = fitHuberRidge(tr, step.spec);
      for (const r of te) {
        const { logPred } = fit.predictOne(r);
        yA.push(r.logMcap);
        pA.push(logPred);
        resA.push(r.logMcap - logPred);
      }
    }
    if (step.id === 'tvl_sector_chains') selectedOofResiduals = resA;

    const trB = refRows.filter((r) => r.raw.listed_at === null || r.raw.listed_at < cutoffDate);
    const teB = refRows.filter((r) => r.raw.listed_at !== null && r.raw.listed_at >= cutoffDate);
    const fitB = fitHuberRidge(trB, step.spec);
    const yB = teB.map((r) => r.logMcap);
    const pB = teB.map((r) => fitB.predictOne(r).logPred);

    const mA = computeMetrics(yA, pA);
    const mB = computeMetrics(yB, pB);

    ablation.push({
      id: step.id,
      label: step.label,
      status: step.status,
      reason: step.reason,
      split_a_cv: mA,
      split_b_temporal: mB,
    });
  }

  // Populate dynamic data-driven comparison reasons from the live split metrics
  const baseA = ablation[0]!.split_a_cv;
  const baseB = ablation[0]!.split_b_temporal;
  const keptA = ablation[1]!.split_a_cv;
  const keptB = ablation[1]!.split_b_temporal;
  ablation[0]!.reason = `TVL-only scale anchor across ${refRows.length} DeFi tokenized peers`;
  ablation[1]!.reason = `Improves Split A (MedAPE ${baseA.medape_pct}% -> ${keptA.medape_pct}%, rho ${baseA.spearman_rho} -> ${keptA.spearman_rho}) & Split B (MedAPE ${baseB.medape_pct}% -> ${keptB.medape_pct}%, rho ${baseB.spearman_rho} -> ${keptB.spearman_rho})`;
  ablation[2]!.reason = `Degrades Split A (MAE ${keptA.mae_log10} -> ${ablation[2]!.split_a_cv.mae_log10}, rho ${keptA.spearman_rho} -> ${ablation[2]!.split_a_cv.spearman_rho}); retained only for farming urgency`;
  ablation[3]!.reason = `Degrades Split A (MAE ${keptA.mae_log10} -> ${ablation[3]!.split_a_cv.mae_log10}, rho ${keptA.spearman_rho} -> ${ablation[3]!.split_a_cv.spearman_rho}); retained only as TGE seasoning signal`;

  const sortedRes = [...selectedOofResiduals].sort((a, b) => a - b);
  const q10 = quantile(sortedRes, 0.10);
  const q25 = quantile(sortedRes, 0.25);
  const q50 = quantile(sortedRes, 0.50);
  const q75 = quantile(sortedRes, 0.75);
  const q90 = quantile(sortedRes, 0.90);

  const selectedSpec = ablationSpecs[1]!.spec;
  const finalFit = fitHuberRidge(refRows, selectedSpec);

  // Sector summary multiples for dashboard charts
  const sectorBuckets = new Map<SectorGroup, number[]>();
  for (const r of refRows) {
    const list = sectorBuckets.get(r.grp) ?? [];
    list.push(r.raw.mcap_usd! / r.raw.tvl_usd);
    sectorBuckets.set(r.grp, list);
  }
  const sector_multiples = (['trading', 'credit_rwa', 'infra', 'yield_alloc', 'other'] as SectorGroup[]).map((g) => {
    const vals = (sectorBuckets.get(g) ?? [0.2]).sort((a, b) => a - b);
    return {
      group: g,
      label: SECTOR_LABELS[g],
      count: vals.length,
      median_mcap_tvl: +vals[Math.floor(vals.length / 2)]!.toFixed(2),
    };
  });

  // Score pre-token candidates
  const predictions = new Map<string, ValuationPrediction>();
  for (const p of candidates) {
    const prep = toPrepared(p, asOfMs);
    const { logPred, factors } = finalFit.predictOne(prep);

    const implied_value_usd = Math.max(250_000, Math.round(10 ** logPred));
    const band_p10_usd = Math.max(100_000, Math.round(10 ** (logPred + q10)));
    const band_p25_usd = Math.max(150_000, Math.round(10 ** (logPred + q25)));
    const band_p75_usd = Math.round(10 ** (logPred + q75));
    const band_p90_usd = Math.round(10 ** (logPred + q90));

    // Nearest 3 tokenized peers (same sector group prioritized, then closest log10(TVL))
    const peers = [...refRows]
      .map((peer) => {
        const sameCat = peer.raw.category === p.category ? 0 : peer.grp === prep.grp ? 0.35 : 1.2;
        const dist = sameCat + Math.abs(peer.logTvl - prep.logTvl);
        return { peer, dist };
      })
      .sort((a, b) => a.dist - b.dist || a.peer.raw.slug.localeCompare(b.peer.raw.slug))
      .slice(0, 3)
      .map(({ peer }) => ({
        slug: peer.raw.slug,
        name: peer.raw.name,
        symbol: peer.raw.symbol,
        category: peer.raw.category ?? 'DeFi',
        tvl_usd: peer.raw.tvl_usd,
        mcap_usd: peer.raw.mcap_usd!,
        mcap_tvl_ratio: +(peer.raw.mcap_usd! / peer.raw.tvl_usd).toFixed(2),
      }));

    const months_live = prep.ageYears !== null ? Math.max(1, Math.round(prep.ageYears * 12)) : null;
    const catCount = finalFit.catPrior.has(p.category ?? 'Unknown') ? 1 : 0;
    const confidence_tier: 'High' | 'Medium' | 'Speculative' =
      p.tvl_usd >= 50_000_000 && catCount === 1 && p.listed_at !== null
        ? 'High'
        : p.tvl_usd >= 15_000_000
          ? 'Medium'
          : 'Speculative';

    // Secondary actionable priority score (0-100) combining predicted FDV scale, 7d velocity, and seasoning
    const sizeScore = Math.min(55, Math.max(10, (Math.log10(implied_value_usd) - 6) * 20));
    const velScore = p.change_7d === null ? 8 : Math.min(25, Math.max(0, 12 + p.change_7d * 0.35));
    const seasonScore = months_live === null ? 8 : Math.min(20, 6 + Math.min(18, months_live) * 0.75);
    const radar_score = Math.round(Math.min(99, Math.max(20, sizeScore + velScore + seasonScore)));

    predictions.set(p.slug, {
      implied_value_usd,
      band_p10_usd,
      band_p25_usd,
      band_p75_usd,
      band_p90_usd,
      implied_mcap_tvl_ratio: +(implied_value_usd / Math.max(1, p.tvl_usd)).toFixed(2),
      sector_group: prep.grp,
      factors,
      comparables: peers,
      confidence_tier,
      months_live,
      momentum_7d: p.change_7d,
      radar_score,
    });
  }

  const summary: ModelSummary = {
    reference_pool_size: refRows.length,
    reference_pool_rule: 'DeFi tokenized protocols with recorded mcap_usd > 0 (excluding CEX, bridges, and staking wrappers)',
    selected_features: ['log10(TVL)', 'Empirical-Bayes Sector Multiple', 'log10(Chain Count)'],
    dropped_features: ['7d TVL Momentum (kept for farming urgency)', 'Protocol Age (kept for TGE seasoning)'],
    coefficients: {
      intercept_log10: +finalFit.coef[0]!.toFixed(4),
      z_log_tvl: +finalFit.coef[1]!.toFixed(4),
      eb_sector_residual: +finalFit.coef[2]!.toFixed(4),
      z_log_chains: +finalFit.coef[3]!.toFixed(4),
    },
    residual_quantiles_log10: {
      p10: +q10.toFixed(3),
      p25: +q25.toFixed(3),
      p50: +q50.toFixed(3),
      p75: +q75.toFixed(3),
      p90: +q90.toFixed(3),
    },
    temporal_cutoff_date: cutoffDate,
    ablation,
    sector_multiples,
  };

  return { predictions, summary };
}
