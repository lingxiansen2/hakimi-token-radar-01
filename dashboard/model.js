((globalScope) => {
  'use strict';

  const EXCLUDED_CATS = new Set([
    'Bridge', 'Canonical Bridge', 'Cross Chain Bridge',
    'Liquid Staking', 'Liquid Restaking', 'Restaked BTC',
    'Staking Pool', 'CEX', 'Anchor BTC', 'Decentralized BTC', 'Stablecoin Wrapper',
  ]);
  const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  const WRAPPER_RE = /\b(wrapped|staked|staking|restaked|bridged)\b/i;
  const EXCHANGE_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
  const TGE_FLOAT = 0.25; // 25% median initial circulating supply at TGE (FDV = 4x MCap)

  const SECTOR_LABELS = {
    trading: 'Trading & Perps',
    credit_rwa: 'Credit, CDP & RWA',
    yield_alloc: 'Yield & Curators',
    infra: 'Infra, AI & Chains',
    other: 'Other DeFi',
  };

  const classifySectorGroup = (cat) => {
    if (!cat) return 'other';
    if (['Dexs', 'Derivatives', 'Prediction Market', 'Options Vault', 'OTC Marketplace'].includes(cat)) return 'trading';
    if (['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Basis Trading', 'RWA', 'Collateral Management', 'Dual-Token Stablecoin'].includes(cat)) return 'credit_rwa';
    if (['Yield', 'Yield Aggregator', 'Risk Curators', 'Onchain Capital Allocator', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Indexes'].includes(cat)) return 'yield_alloc';
    if (['Chain', 'Privacy', 'Payments', 'AI Agents', 'Decentralized AI', 'Token Locker', 'Restaking', 'Insurance'].includes(cat)) return 'infra';
    return 'other';
  };

  function isPreTokenCandidate(p, watchlistSet, tokFirstWords) {
    if (p.gecko_id !== null || p.symbol !== null) return { keep: false, reason: 'live_token' };
    if (watchlistSet.has(p.slug)) return { keep: true, reason: 'watchlist' };
    if (p.category !== null && EXCLUDED_CATS.has(p.category)) return { keep: false, reason: 'category' };
    if (VERSION_RE.test(p.name)) return { keep: false, reason: 'versioned' };
    if (WRAPPER_RE.test(p.name)) return { keep: false, reason: 'wrapper_word' };
    if (EXCHANGE_RE.test(p.name)) return { keep: false, reason: 'cex_prefix' };
    const fw = String(p.name || '').trim().split(/\s+/)[0].toLowerCase();
    if (fw.length >= 4 && tokFirstWords.has(fw)) return { keep: false, reason: 'parent_brand' };
    return { keep: true, reason: 'early_discovery' };
  }

  function partitionProtocols(snapshot) {
    const watchlistSet = new Set(snapshot.watchlist || []);
    const tokenized = [];
    const tokFirstWords = new Set();
    for (const p of snapshot.protocols) {
      if (p.gecko_id !== null || p.symbol !== null) {
        tokenized.push(p);
        const fw = String(p.name || '').trim().split(/\s+/)[0].toLowerCase();
        if (fw.length >= 4) tokFirstWords.add(fw);
      }
    }
    const audit = {
      total_protocols: snapshot.protocols.length,
      excluded_live_token: tokenized.length,
      excluded_category: 0, excluded_versioned: 0, excluded_wrapper_word: 0,
      excluded_cex_prefix: 0, excluded_parent_brand: 0,
      retained_total: 0, retained_watchlist: 0, retained_early_discovery: 0,
    };
    const candidates = [];
    for (const p of snapshot.protocols) {
      const res = isPreTokenCandidate(p, watchlistSet, tokFirstWords);
      if (res.keep) {
        candidates.push(p);
        if (res.reason === 'watchlist') audit.retained_watchlist++;
        else audit.retained_early_discovery++;
      } else if (res.reason !== 'live_token') {
        audit[`excluded_${res.reason}`]++;
      }
    }
    audit.retained_total = candidates.length;
    return { candidates, tokenized, watchlistSet, audit };
  }

  const solveLinear = (A, b) => {
    const d = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < d; c++) {
      let piv = c;
      for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const div = Math.abs(M[c][c]) < 1e-12 ? 1e-12 : M[c][c];
      for (let k = c; k <= d; k++) M[c][k] /= div;
      for (let r = 0; r < d; r++) {
        if (r === c) continue;
        const f = M[r][c];
        for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((r) => r[d]);
  };

  const meanStd = (arr) => {
    const m = arr.reduce((s, v) => s + v, 0) / (arr.length || 1);
    const sd = Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length || 1)) || 1;
    return [m, sd];
  };
  const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));

  const prepareRow = (p, asOfMs) => {
    const ageMonths = p.listed_at ? Math.max(0.5, (asOfMs - Date.parse(`${p.listed_at}T00:00:00Z`)) / (30.4375 * 86400000)) : null;
    const chg = p.change_7d === null ? 0 : Math.max(-40, Math.min(80, p.change_7d));
    return {
      raw: p,
      hasTok: (p.gecko_id !== null || p.symbol !== null) ? 1 : 0,
      logTvl: Math.log10(Math.max(1, p.tvl_usd)),
      logMcap: (p.mcap_usd !== null && p.mcap_usd > 0) ? Math.log10(p.mcap_usd) : null,
      chgAsinh: Math.asinh(chg / 20),
      ageMonths,
      logAge: ageMonths !== null ? Math.log10(1 + ageMonths) : null,
      logChains: Math.log10(Math.max(1, (p.chains || []).length)),
      grp: classifySectorGroup(p.category),
    };
  };

  function fitStage1Odds(train, useFull) {
    const [tvlM, tvlS] = meanStd(train.map((r) => r.logTvl));
    const [chgM, chgS] = meanStd(train.map((r) => r.chgAsinh));
    const [ageM, ageS] = meanStd(train.filter((r) => r.logAge !== null).map((r) => r.logAge));
    const [chM, chS] = meanStd(train.map((r) => r.logChains));

    const buildX = (r) => useFull
      ? [1, (r.logTvl - tvlM) / tvlS, (r.chgAsinh - chgM) / chgS, r.logAge !== null ? (r.logAge - ageM) / ageS : 0, (r.logChains - chM) / chS, r.grp === 'trading' ? 1 : 0, r.grp === 'yield_alloc' ? 1 : 0, r.grp === 'credit_rwa' ? 1 : 0]
      : [1, (r.logTvl - tvlM) / tvlS];

    const d = buildX(train[0]).length;
    const w = new Array(d).fill(0);
    for (let it = 0; it < 22; it++) {
      const grad = new Array(d).fill(0);
      const H = Array.from({ length: d }, () => new Array(d).fill(0));
      for (const r of train) {
        const x = buildX(r);
        const p = sigmoid(x.reduce((s, v, j) => s + v * w[j], 0));
        const err = p - r.hasTok, wt = p * (1 - p) + 1e-6;
        for (let j = 0; j < d; j++) { grad[j] += err * x[j]; for (let k = 0; k < d; k++) H[j][k] += wt * x[j] * x[k]; }
      }
      for (let j = 1; j < d; j++) { grad[j] += 3 * w[j]; H[j][j] += 3; }
      const delta = solveLinear(H, grad);
      for (let j = 0; j < d; j++) w[j] -= delta[j];
    }

    const predictRawProb = (r) => sigmoid(buildX(r).reduce((s, v, j) => s + v * w[j], 0));
    return { weights: w, predictRawProb, computeLaunchOdds: (r) => Math.max(0.25, Math.min(0.92, 0.25 + 0.70 * predictRawProb(r))) };
  }

  function fitStage2Valuation(train, useSector) {
    const n = train.length;
    const [tvlM, tvlS] = meanStd(train.map((r) => r.logTvl));
    const yM = train.reduce((s, r) => s + r.logMcap, 0) / n;
    let num = 0, den = 0;
    for (const r of train) { num += (r.logTvl - tvlM) * (r.logMcap - yM); den += (r.logTvl - tvlM) ** 2; }
    const slope = num / (den || 1);

    const grpRes = new Map(), catRes = new Map();
    for (const r of train) {
      const res = r.logMcap - (yM + slope * (r.logTvl - tvlM));
      (grpRes.get(r.grp) || grpRes.set(r.grp, []).get(r.grp)).push(res);
      const cat = r.raw.category || 'Unknown';
      (catRes.get(cat) || catRes.set(cat, []).get(cat)).push(res);
    }
    const grpPrior = new Map(), catPrior = new Map();
    grpRes.forEach((arr, g) => grpPrior.set(g, (arr.length / (arr.length + 10)) * (arr.reduce((a, b) => a + b, 0) / arr.length)));
    catRes.forEach((arr, c) => {
      const gp = grpPrior.get(classifySectorGroup(c)) || 0;
      catPrior.set(c, gp + (arr.length / (arr.length + 10)) * (arr.reduce((a, b) => a + b, 0) / arr.length - gp));
    });

    const buildX = (r) => useSector ? [1, (r.logTvl - tvlM) / tvlS, catPrior.get(r.raw.category || 'Unknown') ?? grpPrior.get(r.grp) ?? 0] : [1, (r.logTvl - tvlM) / tvlS];
    const d = buildX(train[0]).length, X = train.map(buildX), y = train.map((r) => r.logMcap);
    const weights = new Array(n).fill(1);
    let coef = new Array(d).fill(0);
    const lam = useSector ? 8 : 4;

    for (let it = 0; it < 20; it++) {
      const A = Array.from({ length: d }, () => new Array(d).fill(0)), b = new Array(d).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) { b[j] += weights[i] * X[i][j] * y[i]; for (let k = 0; k < d; k++) A[j][k] += weights[i] * X[i][j] * X[i][k]; }
      for (let j = 1; j < d; j++) A[j][j] += lam;
      coef = solveLinear(A, b);
      for (let i = 0; i < n; i++) {
        const err = Math.abs(y[i] - X[i].reduce((s, v, j) => s + v * coef[j], 0));
        weights[i] = err <= 0.75 ? 1 : 0.75 / err;
      }
    }

    return {
      coef, catPrior, grpPrior,
      predictRow: (r) => {
        const x = buildX(r), c0 = coef[0], cT = coef[1] * x[1], cS = useSector ? coef[2] * x[2] : 0;
        return { logMcapPred: c0 + cT + cS, baseAnchorUsd: Math.round(10 ** c0), tvlMult: +(10 ** cT).toFixed(3), sectorMult: +(10 ** cS).toFixed(3) };
      },
    };
  }

  const computeRocAuc = (yT, yP) => {
    const pairs = yT.map((y, i) => [yP[i], y]).sort((a, b) => a[0] - b[0]);
    let pos = 0, neg = 0, rs = 0;
    pairs.forEach(([_, y], i) => { if (y === 1) { pos++; rs += i + 1; } else neg++; });
    return +((rs - (pos * (pos + 1)) / 2) / (pos * neg || 1)).toFixed(3);
  };
  const computeBrier = (yT, yP) => +(yT.reduce((s, y, i) => s + (y - yP[i]) ** 2, 0) / yT.length).toFixed(3);
  const computeSpearman = (a, b) => {
    const rank = (arr) => { const idx = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(arr.length); idx.forEach((p, i) => { r[p[1]] = i + 1; }); return r; };
    const ra = rank(a), rb = rank(b), n = a.length;
    let d2 = 0; for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2;
    return n <= 1 ? 0 : +(1 - (6 * d2) / (n * (n * n - 1))).toFixed(3);
  };
  const computeRegMetrics = (yT, yP) => {
    const n = yT.length; let mae = 0; const apes = [];
    for (let i = 0; i < n; i++) { mae += Math.abs(yT[i] - yP[i]); const a = 10 ** yT[i], p = 10 ** yP[i]; apes.push(Math.abs(p - a) / a); }
    apes.sort((a, b) => a - b);
    return { n, mae_log10: +(mae / n).toFixed(3), medape_pct: +(apes[Math.floor(n / 2)] * 100).toFixed(1), spearman_rho: computeSpearman(yT, yP) };
  };
  const quantile = (sorted, q) => { const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos); return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo); };

  const computeLaunchProbability = (row, stage1Fit) => stage1Fit.computeLaunchOdds(row);

  function computeImpliedLaunchValue(row, stage1Fit, stage2Fit, q) {
    const s2 = stage2Fit.predictRow(row);
    const mcapUsd = 10 ** s2.logMcapPred;
    const fdvUsd = mcapUsd / TGE_FLOAT;
    const odds = computeLaunchProbability(row, stage1Fit);
    const chg = row.raw.change_7d === null ? 0 : Math.max(-25, Math.min(50, row.raw.change_7d));
    const momMult = +(1 + 0.08 * Math.tanh(chg / 25)).toFixed(3);
    const chainMult = +(1 + 0.04 * Math.min(2.5, Math.log10(Math.max(1, (row.raw.chains || []).length)))).toFixed(3);
    const adjFdv = fdvUsd * momMult * chainMult;
    const evUsd = Math.max(500000, Math.round(adjFdv * odds));
    const bandScale = (odds / TGE_FLOAT) * momMult * chainMult;
    return {
      implied_value_usd: evUsd,
      implied_launch_fdv_usd: Math.round(adjFdv),
      implied_circ_mcap_usd: Math.round(mcapUsd),
      launch_odds: +odds.toFixed(3),
      band_p10_usd: Math.max(250000, Math.round(10 ** (s2.logMcapPred + q.p10) * bandScale)),
      band_p25_usd: Math.max(350000, Math.round(10 ** (s2.logMcapPred + q.p25) * bandScale)),
      band_p75_usd: Math.round(10 ** (s2.logMcapPred + q.p75) * bandScale),
      band_p90_usd: Math.round(10 ** (s2.logMcapPred + q.p90) * bandScale),
      factors: {
        base_mcap_anchor_usd: s2.baseAnchorUsd, tvl_scale_mult: s2.tvlMult, sector_mult: s2.sectorMult,
        tge_float_mult: +(1 / TGE_FLOAT).toFixed(1), momentum_7d_mult: momMult, chain_breadth_mult: chainMult, launch_odds_mult: +odds.toFixed(3),
      },
    };
  }

  const shortUsd = (n) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`;

  function buildProtocolFarmPlan(p, val) {
    const cat = p.category || 'DeFi', chains = p.chains || [];
    const cheap = ['Solana', 'Base', 'Arbitrum', 'Optimism', 'Sui', 'Hyperliquid', 'Hyperliquid L1', 'Polygon', 'Binance', 'Avalanche', 'Aptos', 'Berachain', 'Monad', 'MegaETH', 'Ink', 'Abstract', 'Unichain', 'Sonic', 'Linea', 'Scroll'];
    const pri = chains.find((c) => cheap.includes(c)) || chains[0] || 'Ethereum';
    const gas = pri === 'Ethereum' ? '$4-$16/tx (batch <12 gwei)' : ['Solana', 'Sui', 'Aptos'].includes(pri) ? '$0.01-$0.08/tx' : ['Bitcoin', 'Lightning'].includes(pri) ? '$1-$6/tx' : '$0.03-$0.35/L2 tx';
    const tvl = shortUsd(p.tvl_usd), ev = shortUsd(val.implied_value_usd);
    const age = val.months_live !== null ? `${val.months_live}m no-token` : 'early stage';
    const mom = p.change_7d !== null ? (p.change_7d >= 0 ? `TVL +${p.change_7d.toFixed(1)}% 7d` : `TVL ${p.change_7d.toFixed(1)}% 7d (low dilution)`) : 'steady 7d TVL';

    if (['Derivatives', 'Prediction Market', 'Options Vault', 'OTC Marketplace'].includes(cat)) {
      return {
        gas, cadence: '15m setup + 20m/wk (4-8 wks)', risk: 'Funding bleed & liquidation risk; hedge directional legs.',
        steps: [
          `Bridge $500-$2,500 USDC to ${pri} (${gas}) and fund margin on ${p.name}.`,
          `Build weekly organic maker/taker volume across 4-8 weeks instead of wash spikes.`,
          `Hold resting limit orders or LP vault margin across weekend snapshots for duration multipliers.`,
          `Keep 30d fees+slippage <0.25% against ${p.name}'s ${ev} expected launch value (${age}).`,
        ],
      };
    }
    if (['Dexs', 'Liquidity Manager'].includes(cat)) {
      return {
        gas, cadence: '20m setup + 10m/wk (45-60d)', risk: 'Impermanent loss on volatile pairs; use correlated ranges.',
        steps: [
          `Seed $1,000+ correlated or bluechip LP on ${p.name} (${pri}, ${gas}); ${mom}.`,
          `Execute organic spot swaps across 6+ separate weeks to pass active-epoch filters.`,
          `Rebalance out-of-range LP every 7-14 days rather than daily, capping fee drag under $15.`,
          `Compound fees inside ${p.name} for 45-60 days (${age}, ${Math.round(val.launch_odds * 100)}% token odds).`,
        ],
      };
    }
    if (['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Management'].includes(cat)) {
      return {
        gas, cadence: '15m setup + 5m/wk (30-90d)', risk: 'Keep health factor >= 1.60 to prevent drawdown liquidations.',
        steps: [
          `Supply $1,000-$5,000 ETH, BTC, or stables into ${p.name} on ${pri} (${gas}; TVL ${tvl}).`,
          `Borrow 35%-50% LTV in a correlated asset when borrow points apply, holding HF >= 1.60.`,
          `Hold uninterrupted 30-90 days (${age}) to capture time-weighted snapshot multipliers.`,
          `Check net borrow APY weekly so carry stays <1% annualized vs. ${ev} implied value.`,
        ],
      };
    }
    return {
      gas, cadence: '10m deposit + biweekly check (45-90d)', risk: 'Vault strategy, underlying protocol, and queue risks.',
      steps: [
        `Deposit $1,000+ into ${p.name}'s flagship vault on ${pri} (${gas}) and hold receipt tokens.`,
        `Hold through 2+ monthly epochs (45-90 days); ${mom} across ${chains.length} chain(s).`,
        `Check if ${p.name} receipt tokens compose on ${pri} money markets for stacked points.`,
        `Audit withdrawal queue liquidity and net APY biweekly (${age}, ${ev} risk-adjusted EV).`,
      ],
    };
  }

  function buildEmpiricalModel(snapshot) {
    const asOfMs = Date.parse(`${snapshot.as_of}T00:00:00Z`);
    const part = partitionProtocols(snapshot);
    const cleanPre = part.candidates.map((p) => prepareRow(p, asOfMs));
    const cleanTok = part.tokenized.filter((p) => !EXCLUDED_CATS.has(p.category || '') && !VERSION_RE.test(p.name) && !WRAPPER_RE.test(p.name)).map((p) => prepareRow(p, asOfMs));
    const s1Universe = cleanTok.concat(cleanPre);

    const d1 = s1Universe.filter((r) => r.raw.listed_at).sort((a, b) => a.raw.listed_at.localeCompare(b.raw.listed_at));
    const cut1 = d1[Math.floor(d1.length * 0.7)].raw.listed_at;
    const s1Validation = [false, true].map((useFull) => {
      const yA = [], pA = [];
      for (let f = 0; f < 5; f++) {
        const fit = fitStage1Odds(s1Universe.filter((_, i) => i % 5 !== f), useFull);
        s1Universe.filter((_, i) => i % 5 === f).forEach((r) => { yA.push(r.hasTok); pA.push(fit.predictRawProb(r)); });
      }
      const fitB = fitStage1Odds(s1Universe.filter((r) => !r.raw.listed_at || r.raw.listed_at < cut1), useFull);
      const teB = s1Universe.filter((r) => r.raw.listed_at && r.raw.listed_at >= cut1);
      const yB = teB.map((r) => r.hasTok), pB = teB.map((r) => fitB.predictRawProb(r));
      return { label: useFull ? 'TVL + 7d Growth + Age + Sector + Chains' : 'log10(TVL) baseline', split_a_auc: computeRocAuc(yA, pA), split_a_brier: computeBrier(yA, pA), split_b_auc: computeRocAuc(yB, pB), split_b_brier: computeBrier(yB, pB) };
    });

    const tokRef = cleanTok.filter((r) => r.logMcap !== null);
    const foldOf = new Map();
    tokRef.slice().sort((a, b) => a.logMcap - b.logMcap).forEach((r, i) => foldOf.set(r.raw.slug, i % 5));
    const d2 = tokRef.filter((r) => r.raw.listed_at).sort((a, b) => a.raw.listed_at.localeCompare(b.raw.listed_at));
    const cut2 = d2[Math.floor(d2.length * 0.7)].raw.listed_at;

    let oofRes = [];
    const s2Validation = [false, true].map((useSec) => {
      const yA = [], pA = [], res = [];
      for (let f = 0; f < 5; f++) {
        const fit = fitStage2Valuation(tokRef.filter((r) => foldOf.get(r.raw.slug) !== f), useSec);
        tokRef.filter((r) => foldOf.get(r.raw.slug) === f).forEach((r) => {
          const pred = fit.predictRow(r).logMcapPred;
          yA.push(r.logMcap); pA.push(pred); res.push(r.logMcap - pred);
        });
      }
      if (useSec) oofRes = res;
      const fitB = fitStage2Valuation(tokRef.filter((r) => !r.raw.listed_at || r.raw.listed_at < cut2), useSec);
      const teB = tokRef.filter((r) => r.raw.listed_at && r.raw.listed_at >= cut2);
      return { label: useSec ? 'TVL + EB Sector Multiple' : 'log10(TVL) baseline', split_a: computeRegMetrics(yA, pA), split_b: computeRegMetrics(teB.map((r) => r.logMcap), teB.map((r) => fitB.predictRow(r).logMcapPred)) };
    });

    oofRes.sort((a, b) => a - b);
    const quantiles = { p10: quantile(oofRes, 0.1), p25: quantile(oofRes, 0.25), p75: quantile(oofRes, 0.75), p90: quantile(oofRes, 0.9) };
    const stage1Fit = fitStage1Odds(s1Universe, true), stage2Fit = fitStage2Valuation(tokRef, true);

    const sectorBuckets = new Map();
    tokRef.forEach((r) => (sectorBuckets.get(r.grp) || sectorBuckets.set(r.grp, []).get(r.grp)).push(r.raw.mcap_usd / r.raw.tvl_usd));
    const sectorMultiples = ['trading', 'credit_rwa', 'infra', 'yield_alloc', 'other'].map((g) => {
      const vals = (sectorBuckets.get(g) || [0.25]).slice().sort((a, b) => a - b);
      return { group: g, label: SECTOR_LABELS[g], count: vals.length, median_mcap_tvl: +vals[Math.floor(vals.length / 2)].toFixed(2) };
    });

    return {
      part, cleanPre, tokRef, stage1Fit, stage2Fit, quantiles,
      summary: { stage1_universe_size: s1Universe.length, stage2_ref_size: tokRef.length, tge_float_assumption: TGE_FLOAT, temporal_cutoff_stage1: cut1, temporal_cutoff_stage2: cut2, stage1_validation: s1Validation, stage2_validation: s2Validation, sector_multiples: sectorMultiples },
    };
  }

  function runBoardPipeline(snapshot) {
    const m = buildEmpiricalModel(snapshot);
    const wl = m.part.watchlistSet;

    const unordered = m.cleanPre.map((row) => {
      const p = row.raw;
      const val = computeImpliedLaunchValue(row, m.stage1Fit, m.stage2Fit, m.quantiles);
      val.months_live = row.ageMonths !== null ? Math.round(row.ageMonths) : null;
      const farm = buildProtocolFarmPlan(p, val);
      const onWatchlist = wl.has(p.slug);
      const comparables = m.tokRef.map((peer) => ({
        peer, dist: (peer.raw.category === p.category ? 0 : peer.grp === row.grp ? 0.35 : 1.2) + Math.abs(peer.logTvl - row.logTvl),
      })).sort((a, b) => a.dist - b.dist || a.peer.raw.slug.localeCompare(b.peer.raw.slug)).slice(0, 3).map(({ peer }) => ({
        slug: peer.raw.slug, name: peer.raw.name, symbol: peer.raw.symbol, category: peer.raw.category || 'DeFi',
        tvl_usd: peer.raw.tvl_usd, mcap_usd: peer.raw.mcap_usd, mcap_tvl_ratio: +(peer.raw.mcap_usd / peer.raw.tvl_usd).toFixed(2),
      }));

      return {
        slug: p.slug, name: p.name, category: p.category || 'DeFi', sector_group: row.grp, sector_label: SECTOR_LABELS[row.grp],
        chains: p.chains, primary_chain: p.chains[0] || 'Multi-Chain', tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at,
        months_live: val.months_live, on_watchlist: onWatchlist, tier: onWatchlist ? 'Flagship Watchlist' : (p.tvl_usd >= snapshot.floor_usd ? 'High-TVL Discovery' : 'Early Radar'),
        launch_odds: val.launch_odds, implied_circ_mcap_usd: val.implied_circ_mcap_usd, implied_launch_fdv_usd: val.implied_launch_fdv_usd,
        implied_value_usd: val.implied_value_usd, band_p10_usd: val.band_p10_usd, band_p25_usd: val.band_p25_usd, band_p75_usd: val.band_p75_usd, band_p90_usd: val.band_p90_usd,
        factors: val.factors, comparables, est_gas_cost: farm.gas, time_commitment: farm.cadence, risk_note: farm.risk, farm_steps: farm.steps,
      };
    });

    unordered.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
    const rows = unordered.map((r, i) => ({ rank: i + 1, ...r }));

    const chainCounts = new Map();
    rows.forEach((r) => r.chains.forEach((c) => chainCounts.set(c, (chainCounts.get(c) || 0) + 1)));
    const topChains = Array.from(chainCounts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([chain, count]) => ({ chain, count }));
    const tokenizedPeers = m.part.tokenized.filter((p) => p.mcap_usd > 0).sort((a, b) => b.mcap_usd - a.mcap_usd).slice(0, 14).map((p) => ({
      slug: p.slug, name: p.name, symbol: p.symbol, category: p.category || 'DeFi', tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, multiple: +(p.mcap_usd / Math.max(1, p.tvl_usd)).toFixed(2),
    }));

    return {
      meta: {
        as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, total_tracked_targets: rows.length,
        watchlist_count: m.part.audit.retained_watchlist, early_discovery_count: m.part.audit.retained_early_discovery,
        total_pretoken_tvl_usd: rows.reduce((s, r) => s + r.tvl_usd, 0), total_implied_ev_usd: rows.reduce((s, r) => s + r.implied_value_usd, 0), top_chains: topChains,
      },
      filter_audit: m.part.audit, model: m.summary, tokenized_peers_sample: tokenizedPeers, rows,
    };
  }

  const api = { SECTOR_LABELS, classifySectorGroup, isPreTokenCandidate, partitionProtocols, buildEmpiricalModel, computeLaunchProbability, computeImpliedLaunchValue, buildProtocolFarmPlan, runBoardPipeline };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalScope.TokenRadarEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
