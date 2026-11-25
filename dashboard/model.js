((g) => {
  'use strict';

  const EXCLUDED_CATS = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Staking Pool', 'CEX', 'Anchor BTC', 'Decentralized BTC', 'Stablecoin Wrapper']);
  const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  const WRAPPER_RE = /\b(wrapped|staked|staking|restaked|bridged)\b/i;
  const EXCHANGE_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
  const CHEAP_CHAINS = ['Solana', 'Base', 'Arbitrum', 'Optimism', 'Sui', 'Hyperliquid', 'Hyperliquid L1', 'Polygon', 'Binance', 'Avalanche', 'Aptos', 'Berachain', 'Monad', 'MegaETH', 'Ink', 'Abstract', 'Unichain', 'Sonic', 'Linea', 'Scroll', 'Starknet', 'zkSync Era', 'Mantle', 'Ronin'];
  const TIERS = [{ key: 'k1', cap: 1000, lbl: '$1k', hm: 1.0 }, { key: 'k10', cap: 10000, lbl: '$10k', hm: 1.2 }, { key: 'k50', cap: 50000, lbl: '$50k', hm: 1.5 }];
  const POOL_SHARE = 0.05;
  const SECTOR_LABELS = { trading: 'Trading & Perps', credit_rwa: 'Credit, CDP & RWA', yield_alloc: 'Yield & Curators', infra: 'Infra, AI & Chains', other: 'Other DeFi' };

  const classifySectorGroup = (cat) => !cat ? 'other'
    : ['Dexs', 'Derivatives', 'Prediction Market', 'Options Vault', 'OTC Marketplace', 'Interest Rate Derivatives'].includes(cat) ? 'trading'
    : ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Basis Trading', 'RWA', 'Collateral Management', 'Dual-Token Stablecoin'].includes(cat) ? 'credit_rwa'
    : ['Yield', 'Yield Aggregator', 'Risk Curators', 'Onchain Capital Allocator', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Indexes'].includes(cat) ? 'yield_alloc'
    : ['Chain', 'Privacy', 'Payments', 'AI Agents', 'Decentralized AI', 'Token Locker', 'Restaking', 'Insurance'].includes(cat) ? 'infra' : 'other';

  function isPreTokenCandidate(p, wlSet, tokWords) {
    if (p.gecko_id !== null || p.symbol !== null) return { keep: false, reason: 'live_token' };
    if (wlSet.has(p.slug)) return { keep: true, reason: 'watchlist' };
    if (p.category !== null && EXCLUDED_CATS.has(p.category)) return { keep: false, reason: 'category' };
    if (VERSION_RE.test(p.name)) return { keep: false, reason: 'versioned' };
    if (WRAPPER_RE.test(p.name)) return { keep: false, reason: 'wrapper_word' };
    if (EXCHANGE_RE.test(p.name)) return { keep: false, reason: 'cex_prefix' };
    const fw = String(p.name || '').trim().split(/\s+/)[0].toLowerCase();
    if (fw.length >= 4 && tokWords.has(fw)) return { keep: false, reason: 'parent_brand' };
    return { keep: true, reason: 'early_discovery' };
  }

  function partitionProtocols(snapshot) {
    const wlSet = new Set(snapshot.watchlist || []), tok = [], tokWords = new Set();
    for (const p of snapshot.protocols) {
      if (p.gecko_id !== null || p.symbol !== null) {
        tok.push(p);
        const fw = String(p.name || '').trim().split(/\s+/)[0].toLowerCase();
        if (fw.length >= 4) tokWords.add(fw);
      }
    }
    const audit = { total_protocols: snapshot.protocols.length, excluded_live_token: tok.length, excluded_category: 0, excluded_versioned: 0, excluded_wrapper_word: 0, excluded_cex_prefix: 0, excluded_parent_brand: 0, retained_total: 0, retained_watchlist: 0, retained_early_discovery: 0 };
    const candidates = [];
    for (const p of snapshot.protocols) {
      const res = isPreTokenCandidate(p, wlSet, tokWords);
      if (res.keep) { candidates.push(p); if (res.reason === 'watchlist') audit.retained_watchlist++; else audit.retained_early_discovery++; }
      else if (res.reason !== 'live_token') audit[`excluded_${res.reason}`]++;
    }
    audit.retained_total = candidates.length;
    return { candidates, tokenized: tok, watchlistSet: wlSet, audit };
  }

  const solveLin = (A, b) => {
    const d = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < d; c++) {
      let piv = c;
      for (let r = c + 1; r < d; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const div = Math.abs(M[c][c]) < 1e-12 ? 1e-12 : M[c][c];
      for (let k = c; k <= d; k++) M[c][k] /= div;
      for (let r = 0; r < d; r++) { if (r === c) continue; const f = M[r][c]; for (let k = c; k <= d; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r) => r[d]);
  };
  const meanStd = (a) => { const m = a.reduce((s, v) => s + v, 0) / (a.length || 1); return [m, Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length || 1)) || 1]; };
  const sig = (z) => 1 / (1 + Math.exp(-Math.max(-20, Math.min(20, z))));

  const prepRow = (p, asOfMs) => {
    const ageY = p.listed_at ? Math.max(0.04, (asOfMs - Date.parse(`${p.listed_at}T00:00:00Z`)) / (365.25 * 86400000)) : null;
    const chg = p.change_7d === null ? 0 : Math.max(-40, Math.min(80, p.change_7d));
    return { raw: p, hasTok: (p.gecko_id !== null || p.symbol !== null) ? 1 : 0, logTvl: Math.log10(Math.max(1, p.tvl_usd)), logMcap: (p.mcap_usd !== null && p.mcap_usd > 0) ? Math.log10(p.mcap_usd) : null, chgAsinh: Math.asinh(chg / 20), ageMonths: ageY !== null ? Math.max(1, Math.round(ageY * 12)) : null, logAge: ageY !== null ? Math.log10(1 + ageY) : null, logChains: Math.log10(Math.max(1, (p.chains || []).length)), grp: classifySectorGroup(p.category) };
  };

  function fitStage1Odds(train, opts) {
    const [tvlM, tvlS] = meanStd(train.map((r) => r.logTvl)), [chgM, chgS] = meanStd(train.map((r) => r.chgAsinh));
    const ages = train.filter((r) => r.logAge !== null).map((r) => r.logAge);
    const [ageM, ageS] = meanStd(ages.length ? ages : [0]), [chM, chS] = meanStd(train.map((r) => r.logChains));
    const Xf = (r) => {
      const x = [1, (r.logTvl - tvlM) / tvlS];
      if (opts.chg) x.push((r.chgAsinh - chgM) / chgS);
      if (opts.age) x.push(r.logAge !== null ? (r.logAge - ageM) / ageS : 0);
      if (opts.sec) x.push(r.grp === 'trading' ? 1 : 0, r.grp === 'yield_alloc' ? 1 : 0, r.grp === 'credit_rwa' ? 1 : 0);
      if (opts.chains) x.push((r.logChains - chM) / chS);
      return x;
    };
    const d = Xf(train[0]).length, w = new Array(d).fill(0);
    for (let it = 0; it < 20; it++) {
      const grad = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
      for (const r of train) {
        const x = Xf(r), p = sig(x.reduce((s, v, j) => s + v * w[j], 0)), err = p - r.hasTok, wt = p * (1 - p) + 1e-6;
        for (let j = 0; j < d; j++) { grad[j] += err * x[j]; for (let k = 0; k < d; k++) H[j][k] += wt * x[j] * x[k]; }
      }
      for (let j = 1; j < d; j++) { grad[j] += 3 * w[j]; H[j][j] += 3; }
      const dlt = solveLin(H, grad);
      for (let j = 0; j < d; j++) w[j] -= dlt[j];
    }
    return { weights: w, predictProb: (r) => sig(Xf(r).reduce((s, v, j) => s + v * w[j], 0)) };
  }

  function fitStage2Mcap(train, opts) {
    const n = train.length, [tvlM, tvlS] = meanStd(train.map((r) => r.logTvl)), [chM, chS] = meanStd(train.map((r) => r.logChains));
    const [chgM, chgS] = meanStd(train.map((r) => r.chgAsinh)), ages = train.filter((r) => r.logAge !== null).map((r) => r.logAge);
    const [ageM, ageS] = meanStd(ages.length ? ages : [0]), yM = train.reduce((s, r) => s + r.logMcap, 0) / n;
    let num = 0, den = 0;
    for (const r of train) { num += (r.logTvl - tvlM) * (r.logMcap - yM); den += (r.logTvl - tvlM) ** 2; }
    const slope = num / (den || 1), grpR = new Map(), catR = new Map();
    for (const r of train) {
      const res = r.logMcap - (yM + slope * (r.logTvl - tvlM));
      (grpR.get(r.grp) || grpR.set(r.grp, []).get(r.grp)).push(res);
      const c = r.raw.category || 'Unknown';
      (catR.get(c) || catR.set(c, []).get(c)).push(res);
    }
    const grpP = new Map(), catP = new Map();
    grpR.forEach((a, k) => grpP.set(k, (a.length / (a.length + 8)) * (a.reduce((x, y) => x + y, 0) / a.length)));
    catR.forEach((a, c) => { const gp = grpP.get(classifySectorGroup(c)) || 0; catP.set(c, gp + (a.length / (a.length + 8)) * (a.reduce((x, y) => x + y, 0) / a.length - gp)); });

    const Xf = (r) => {
      const x = [1, (r.logTvl - tvlM) / tvlS];
      if (opts.sector) x.push(catP.get(r.raw.category || 'Unknown') ?? grpP.get(r.grp) ?? 0);
      if (opts.chains) x.push((r.logChains - chM) / chS);
      if (opts.chg) x.push((r.chgAsinh - chgM) / chgS);
      if (opts.age) x.push(r.logAge !== null ? (r.logAge - ageM) / ageS : 0);
      return x;
    };
    const d = Xf(train[0]).length, X = train.map(Xf), y = train.map((r) => r.logMcap), wt = new Array(n).fill(1);
    let coef = new Array(d).fill(0);
    for (let it = 0; it < 20; it++) {
      const A = Array.from({ length: d }, () => new Array(d).fill(0)), b = new Array(d).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < d; j++) { b[j] += wt[i] * X[i][j] * y[i]; for (let k = 0; k < d; k++) A[j][k] += wt[i] * X[i][j] * X[i][k]; }
      for (let j = 1; j < d; j++) A[j][j] += opts.lambda;
      coef = solveLin(A, b);
      for (let i = 0; i < n; i++) { const e = Math.abs(y[i] - X[i].reduce((s, v, j) => s + v * coef[j], 0)); wt[i] = e <= 0.75 ? 1 : 0.75 / e; }
    }
    return {
      coef, catPrior: catP, grpPrior: grpP,
      predictRow: (r) => {
        const x = Xf(r), c0 = coef[0], cT = coef[1] * x[1], cS = opts.sector ? coef[2] * x[2] : 0, ci = opts.sector ? 3 : 2, cC = opts.chains ? coef[ci] * x[ci] : 0;
        const off = 2 + (opts.sector ? 1 : 0) + (opts.chains ? 1 : 0);
        const rest = x.slice(off).reduce((s, v, k) => s + v * coef[off + k], 0);
        return { logMcapPred: c0 + cT + cS + cC + rest, baseAnchorUsd: Math.round(10 ** c0), tvlMult: +(10 ** cT).toFixed(3), sectorMult: +(10 ** cS).toFixed(3), chainMult: +(10 ** cC).toFixed(3) };
      },
    };
  }

  const rocAuc = (yT, yP) => { const p = yT.map((y, i) => [yP[i], y]).sort((a, b) => a[0] - b[0]); let pos = 0, neg = 0, rs = 0; p.forEach(([_, y], i) => { if (y === 1) { pos++; rs += i + 1; } else neg++; }); return +((rs - (pos * (pos + 1)) / 2) / (pos * neg || 1)).toFixed(3); };
  const brier = (yT, yP) => +(yT.reduce((s, y, i) => s + (y - yP[i]) ** 2, 0) / yT.length).toFixed(3);
  const spearman = (a, b) => { const rk = (v) => { const ix = v.map((x, i) => [x, i]).sort((x, y) => x[0] - y[0]), r = new Array(v.length); ix.forEach((p, i) => { r[p[1]] = i + 1; }); return r; }; const ra = rk(a), rb = rk(b), n = a.length; let d2 = 0; for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2; return n <= 1 ? 0 : +(1 - (6 * d2) / (n * (n * n - 1))).toFixed(3); };
  const regMetrics = (yT, yP) => {
    const n = yT.length, yBar = yT.reduce((s, v) => s + v, 0) / n, sst = yT.reduce((s, v) => s + (v - yBar) ** 2, 0), sse = yT.reduce((s, v, i) => s + (v - yP[i]) ** 2, 0);
    const f = yT.map((t, i) => 10 ** Math.abs(t - yP[i])).sort((a, b) => a - b), mae = yT.reduce((s, t, i) => s + Math.abs(t - yP[i]), 0) / n;
    return { n, r2: +(1 - sse / (sst || 1)).toFixed(3), med_factor: +f[Math.floor(n / 2)].toFixed(2), mae_log10: +mae.toFixed(3), spearman_rho: spearman(yT, yP) };
  };
  const quant = (s, q) => { const p = (s.length - 1) * q, l = Math.floor(p), h = Math.ceil(p); return l === h ? s[l] : s[l] + (s[h] - s[l]) * (p - l); };
  const computeLaunchProbability = (row, s1) => s1.predictProb(row);

  function computeImpliedLaunchValue(row, s1, s2, q) {
    const pred = s2.predictRow(row), condMcap = Math.round(10 ** pred.logMcapPred), odds = computeLaunchProbability(row, s1);
    const ev = Math.max(100000, Math.round(condMcap * odds));
    return {
      implied_value_usd: ev, cond_mcap_usd: condMcap, launch_odds: +odds.toFixed(3),
      band_p10_usd: Math.max(50000, Math.round((10 ** (pred.logMcapPred + q.p10)) * odds)),
      band_p25_usd: Math.max(80000, Math.round((10 ** (pred.logMcapPred + q.p25)) * odds)),
      band_p75_usd: Math.round((10 ** (pred.logMcapPred + q.p75)) * odds),
      band_p90_usd: Math.round((10 ** (pred.logMcapPred + q.p90)) * odds),
      factors: { base_mcap_anchor_usd: pred.baseAnchorUsd, tvl_scale_mult: pred.tvlMult, sector_mult: pred.sectorMult, chain_footprint_mult: pred.chainMult, launch_odds_mult: +odds.toFixed(3) },
    };
  }

  const shortUsd = (n) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
  const fmtS = (n) => `${n >= 0 ? '+' : '-'}$${Math.abs(Math.round(n))}`;

  function buildProtocolFarmPlan(p, val) {
    const cat = p.category || 'DeFi', chains = p.chains || [], pri = chains.find((c) => CHEAP_CHAINS.includes(c)) || chains[0] || 'Ethereum';
    const txGas = pri === 'Ethereum' ? 8.5 : ['Bitcoin', 'Lightning'].includes(pri) ? 3.0 : ['Provenance', 'Ripple'].includes(pri) ? 1.2 : ['Solana', 'Sui', 'Aptos', 'Tron'].includes(pri) ? 0.04 : 0.20;
    const isTr = ['Derivatives', 'Prediction Market', 'Options Vault', 'OTC Marketplace', 'Interest Rate Derivatives'].includes(cat);
    const isDx = ['Dexs', 'Liquidity Manager', 'Leveraged Farming'].includes(cat);
    const isLn = ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Management', 'Basis Trading', 'Dual-Token Stablecoin'].includes(cat);
    const isChn = ['Chain', 'Payments', 'Privacy', 'AI Agents', 'Decentralized AI', 'Crypto Card Issuer'].includes(cat);
    const nTx = isTr ? 12 : isDx ? 10 : isLn ? 8 : 6, bps = isTr ? 12 : isDx ? 8 : isLn ? 5 : 3, baseHrs = isTr ? 2.0 : isDx ? 1.5 : isLn ? 1.3 : 1.0, borrowRate = isLn ? 0.001 : 0;

    const tiers = {};
    for (const t of TIERS) {
      const gas = +(nTx * txGas).toFixed(1), slip = +(t.cap * (bps / 10000)).toFixed(1), borrow = +(t.cap * borrowRate).toFixed(1);
      const friction = +(gas + slip + borrow).toFixed(1), hrs = +(baseHrs * t.hm).toFixed(1);
      const gross = +(val.implied_value_usd * POOL_SHARE * (t.cap / Math.max(p.tvl_usd, 5e6))).toFixed(1);
      const net = +(gross - friction).toFixed(1), hr = +(net / hrs).toFixed(1), apr = +((net / t.cap) * (365 / 60) * 100).toFixed(1);
      tiers[t.key] = { label: t.lbl, cap: t.cap, gas, slip, borrow, friction, hrs, gross, net, hr, apr, verdict: (net >= 40 && hr >= 18) ? 'FARM' : (net > 0 && hr >= 4) ? 'WATCH' : 'SKIP' };
    }

    const d = tiers.k10, tvl = shortUsd(p.tvl_usd), ev = shortUsd(val.implied_value_usd);
    const age = val.months_live !== null ? `${val.months_live}m no-token` : 'early stage';
    const mom = p.change_7d !== null ? `${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(1)}% 7d` : 'steady 7d';
    const lock = isTr ? 'instant margin exit (watch funding)' : isDx ? 'spot LP (rebalance biweekly)' : isLn ? 'instant repay (HF >= 1.60)' : isChn ? 'bridge + native dApp epoch' : '7-14d vault epoch lockup';
    const cLbl = `${chains.length} chain${chains.length === 1 ? '' : 's'}`;
    const act = isTr ? `Fund ${pri} margin on ${p.name} (${cat}) and hold resting maker orders across ${mom} TVL`
      : isDx ? `Deploy correlated LP on ${p.name} (${pri} ${cat}, ${tvl}, ${mom}) and route organic swaps`
      : isLn ? `Supply collateral on ${p.name} (${pri} ${cat}, ${tvl}) and loop 35-45% LTV correlated assets`
      : isChn ? `Bridge to ${p.name} (${pri} ${cat}, ${cLbl}, ${age}) and run native DEX/LP swaps`
      : `Deposit into ${p.name}'s ${cat} vault on ${pri} (${cLbl}, ${age}) and hold receipts`;
    const minV = tiers.k1.verdict !== 'SKIP' ? '$1k+' : tiers.k10.verdict !== 'SKIP' ? '$10k+' : tiers.k50.verdict !== 'SKIP' ? '$50k only' : 'Watchlist only';
    const risk = isTr ? 'funding bleed & liquidation; hedge legs.' : isDx ? 'IL risk; use correlated pairs.' : isLn ? 'keep HF >= 1.60 & check borrow APR.' : 'vault queue & points dilution risk.';

    const tRow = (t) => `${t.label} ${fmtS(t.net)} (${t.hr >= 0 ? '+' : ''}$${t.hr}/hr, ${t.apr}% APR)`;
    const steps = [
      `Deploy ($1k/$10k/$50k): ${act}; entry gas ~$${(txGas * 2).toFixed(2)} on ${pri} (${ev} EV, ${Math.round(val.launch_odds * 100)}% odds).`,
      `Cadence & Lockup: Execute ${nTx} txs over 45-60d (${tiers.k1.hrs}-${tiers.k50.hrs}h active); ${lock}.`,
      `Tier Costs ($1k/$10k/$50k): $${tiers.k1.friction.toFixed(0)} / $${d.friction.toFixed(0)} / $${tiers.k50.friction.toFixed(0)} (${nTx} txs ${pri} gas $${d.gas.toFixed(0)} + ${bps}bps slip${isLn ? ' + borrow' : ''}).`,
      `Net $/hr & APR: ${tRow(tiers.k1)} | ${tRow(d)} | ${tRow(tiers.k50)}.`,
      `Skip Rule (${minV}): ${tiers.k1.verdict === 'SKIP' ? 'Skip $1k (gas/TVL drag); ' : ''}abort if 7d TVL drops >15% or dilution >2x; ${risk}`,
    ];
    return { gasLabel: `~$${d.friction.toFixed(0)} (${nTx} txs ${pri} + ${bps}bps)`, cadence: `${d.hrs}h / 60d · ${lock}`, risk, steps, tiers, grossShareUsd: d.gross, frictionUsd: d.friction, effortHours: d.hrs, netEvUsd: d.net, hourlyEv: d.hr, aprPct: d.apr, verdict: d.verdict };
  }

  function buildEmpiricalModel(snapshot) {
    const asOfMs = Date.parse(`${snapshot.as_of}T00:00:00Z`), part = partitionProtocols(snapshot);
    const cleanPre = part.candidates.map((p) => prepRow(p, asOfMs));
    const cleanTok = part.tokenized.filter((p) => !EXCLUDED_CATS.has(p.category || '') && !VERSION_RE.test(p.name) && !WRAPPER_RE.test(p.name) && !EXCHANGE_RE.test(p.name)).map((p) => prepRow(p, asOfMs));
    const s1U = cleanTok.concat(cleanPre).sort((a, b) => a.logTvl - b.logTvl || a.raw.slug.localeCompare(b.raw.slug));

    const d1 = s1U.filter((r) => r.raw.listed_at).sort((a, b) => a.raw.listed_at.localeCompare(b.raw.listed_at) || a.raw.slug.localeCompare(b.raw.slug)), ud1 = s1U.filter((r) => !r.raw.listed_at);
    const f1_0 = s1U.filter((_, i) => i % 2 === 0), f1_1 = s1U.filter((_, i) => i % 2 === 1);
    const s1Specs = [
      { id: 's1_tvl', label: 'S1 P(Token): log10(TVL) base', opts: {} },
      { id: 's1_chg', label: 'S1 + 7d Growth asinh(chg/20)', opts: { chg: true } },
      { id: 's1_age', label: 'S1 + Age log10(1 + age_yrs)', opts: { chg: true, age: true } },
      { id: 's1_sec', label: 'S1 + Sector Group Dummies', opts: { chg: true, age: true, sec: true } },
      { id: 's1_chn', label: 'S1 + Chain Breadth log10(chains)', opts: { chg: true, age: true, sec: true, chains: true } },
    ];
    let prevAuc = 0;
    const s1Validation = s1Specs.map((sp, idx) => {
      const m0 = fitStage1Odds(f1_1, sp.opts), m1 = fitStage1Odds(f1_0, sp.opts);
      const yB = f1_0.map((r) => r.hasTok).concat(f1_1.map((r) => r.hasTok)), pB = f1_0.map(m0.predictProb).concat(f1_1.map(m1.predictProb));
      const yWF = [], pWF = [];
      for (let k = Math.floor(d1.length * 0.5); k < d1.length; k += 10) { const fit = fitStage1Odds(ud1.concat(d1.slice(0, k)), sp.opts); d1.slice(k, k + 10).forEach((r) => { yWF.push(r.hasTok); pWF.push(fit.predictProb(r)); }); }
      const cvAuc = rocAuc(yB, pB), dAuc = idx === 0 ? 0 : +(cvAuc - prevAuc).toFixed(3), status = idx === 0 ? 'baseline' : dAuc > 0.002 ? 'kept' : 'dropped';
      if (status !== 'dropped') prevAuc = cvAuc;
      return { id: sp.id, label: sp.label, status, delta_auc: dAuc, cv_auc: cvAuc, cv_brier: brier(yB, pB), wf_auc: rocAuc(yWF, pWF), wf_brier: brier(yWF, pWF) };
    });

    const tokRef = cleanTok.filter((r) => r.logMcap !== null).sort((a, b) => a.logTvl - b.logTvl || a.raw.slug.localeCompare(b.raw.slug));
    const d2 = tokRef.filter((r) => r.raw.listed_at).sort((a, b) => a.raw.listed_at.localeCompare(b.raw.listed_at) || a.raw.slug.localeCompare(b.raw.slug)), ud2 = tokRef.filter((r) => !r.raw.listed_at);
    const f2_0 = tokRef.filter((_, i) => i % 2 === 0), f2_1 = tokRef.filter((_, i) => i % 2 === 1);
    const s2Specs = [
      { id: 'tvl_only', label: 'log10(TVL) baseline', opts: { sector: false, chains: false, chg: false, age: false, lambda: 2 } },
      { id: 'tvl_sector', label: '+ EB Sector Multiple', opts: { sector: true, chains: false, chg: false, age: false, lambda: 4 } },
      { id: 'tvl_sector_chains', label: '+ Chain Footprint', opts: { sector: true, chains: true, chg: false, age: false, lambda: 6 } },
      { id: 'plus_chg', label: '+ 7d TVL Velocity', opts: { sector: true, chains: true, chg: true, age: false, lambda: 6 } },
      { id: 'plus_age', label: '+ Track Record Age', opts: { sector: true, chains: true, chg: false, age: true, lambda: 6 } },
    ];
    let looRes = [], bestR2 = -9, bestMae = 9;
    const s2Ablation = s2Specs.map((sp, idx) => {
      const m0 = fitStage2Mcap(f2_1, sp.opts), m1 = fitStage2Mcap(f2_0, sp.opts);
      const yB = f2_0.map((r) => r.logMcap).concat(f2_1.map((r) => r.logMcap)), pB = f2_0.map((r) => m0.predictRow(r).logMcapPred).concat(f2_1.map((r) => m1.predictRow(r).logMcapPred));
      const cv2 = regMetrics(yB, pB), yL = [], pL = [], resL = [], yW = [], pW = [];
      for (let i = 0; i < tokRef.length; i++) { const pred = fitStage2Mcap(tokRef.filter((_, j) => j !== i), sp.opts).predictRow(tokRef[i]).logMcapPred; yL.push(tokRef[i].logMcap); pL.push(pred); resL.push(tokRef[i].logMcap - pred); }
      if (sp.id === 'tvl_sector_chains') looRes = resL;
      for (let k = 25; k < d2.length; k++) { yW.push(d2[k].logMcap); pW.push(fitStage2Mcap(ud2.concat(d2.slice(0, k)), sp.opts).predictRow(d2[k]).logMcapPred); }
      const dR2 = idx === 0 ? 0 : +(cv2.r2 - bestR2).toFixed(3), dMae = idx === 0 ? 0 : +(cv2.mae_log10 - bestMae).toFixed(3), status = idx === 0 ? 'baseline' : (dR2 > 0 && dMae < 0) ? 'kept' : 'dropped';
      if (status !== 'dropped') { bestR2 = cv2.r2; bestMae = cv2.mae_log10; }
      return { id: sp.id, label: sp.label, status, delta_r2: dR2, delta_mae: dMae, cv2, loo: regMetrics(yL, pL), walk_forward: regMetrics(yW, pW) };
    });

    looRes.sort((a, b) => a - b);
    const quantiles = { p10: quant(looRes, 0.1), p25: quant(looRes, 0.25), p75: quant(looRes, 0.75), p90: quant(looRes, 0.9) };
    const stage1Fit = fitStage1Odds(s1U, s1Specs[3].opts), stage2Fit = fitStage2Mcap(tokRef, s2Specs[2].opts), buckets = new Map();
    tokRef.forEach((r) => (buckets.get(r.grp) || buckets.set(r.grp, []).get(r.grp)).push(r.raw.mcap_usd / r.raw.tvl_usd));
    const sectorMultiples = ['trading', 'credit_rwa', 'infra', 'yield_alloc', 'other'].map((k) => { const v = (buckets.get(k) || [0.25]).slice().sort((a, b) => a - b); return { group: k, label: SECTOR_LABELS[k], count: v.length, median_mcap_tvl: +v[Math.floor(v.length / 2)].toFixed(2) }; });

    return {
      part, cleanPre, tokRef, stage1Fit, stage2Fit, quantiles,
      summary: {
        stage1_universe_size: s1U.length, stage2_ref_size: tokRef.length, tiers: TIERS.map((t) => t.lbl), illustrative_pool_share: POOL_SHARE,
        stage1_validation: s1Validation, stage2_ablation: s2Ablation, sector_multiples: sectorMultiples,
        range_honesty: `2-Fold OOS R² ${s2Ablation[2].cv2.r2.toFixed(3)} (MAE ${s2Ablation[2].cv2.mae_log10.toFixed(3)}) · LOO x${s2Ablation[2].loo.med_factor.toFixed(2)} · WF x${s2Ablation[2].walk_forward.med_factor.toFixed(2)} across ${tokRef.length} DeFi peers.`,
      },
    };
  }

  function runBoardPipeline(snapshot) {
    const m = buildEmpiricalModel(snapshot), wl = m.part.watchlistSet;
    const unordered = m.cleanPre.map((row) => {
      const p = row.raw, val = computeImpliedLaunchValue(row, m.stage1Fit, m.stage2Fit, m.quantiles);
      val.months_live = row.ageMonths;
      const farm = buildProtocolFarmPlan(p, val), onWl = wl.has(p.slug);
      const comparables = m.tokRef.map((pr) => ({ pr, d: (pr.raw.category === p.category ? 0 : pr.grp === row.grp ? 0.35 : 1.2) + Math.abs(pr.logTvl - row.logTvl) }))
        .sort((a, b) => a.d - b.d || a.pr.raw.slug.localeCompare(b.pr.raw.slug)).slice(0, 3)
        .map(({ pr }) => ({ slug: pr.raw.slug, name: pr.raw.name, symbol: pr.raw.symbol, category: pr.raw.category || 'DeFi', tvl_usd: pr.raw.tvl_usd, mcap_usd: pr.raw.mcap_usd, mcap_tvl_ratio: +(pr.raw.mcap_usd / pr.raw.tvl_usd).toFixed(2) }));

      return {
        slug: p.slug, name: p.name, category: p.category || 'DeFi', sector_group: row.grp, sector_label: SECTOR_LABELS[row.grp],
        chains: p.chains, primary_chain: p.chains[0] || 'Multi-Chain', tvl_usd: p.tvl_usd, change_7d: p.change_7d, listed_at: p.listed_at,
        months_live: val.months_live, on_watchlist: onWl, tier: onWl ? 'Flagship Watchlist' : (p.tvl_usd >= snapshot.floor_usd ? 'High-TVL Discovery' : 'Early Radar'),
        launch_odds: val.launch_odds, cond_mcap_usd: val.cond_mcap_usd, implied_value_usd: val.implied_value_usd,
        band_p10_usd: val.band_p10_usd, band_p25_usd: val.band_p25_usd, band_p75_usd: val.band_p75_usd, band_p90_usd: val.band_p90_usd,
        factors: val.factors, comparables, est_gas_cost: farm.gasLabel, time_commitment: farm.cadence, risk_note: farm.risk,
        tiers: farm.tiers, gross_share_usd: farm.grossShareUsd, friction_usd: farm.frictionUsd, effort_hours: farm.effortHours,
        net_ev_usd: farm.netEvUsd, hourly_ev: farm.hourlyEv, apr_pct: farm.aprPct, verdict: farm.verdict, farm_steps: farm.steps,
      };
    });

    unordered.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
    const rows = unordered.map((r, i) => ({ rank: i + 1, ...r }));
    const chMap = new Map();
    rows.forEach((r) => r.chains.forEach((c) => chMap.set(c, (chMap.get(c) || 0) + 1)));
    const topChains = Array.from(chMap.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 12).map(([chain, count]) => ({ chain, count }));
    const verdictCounts = rows.reduce((a, r) => { a[r.verdict]++; return a; }, { FARM: 0, WATCH: 0, SKIP: 0 });
    const tokenizedPeers = m.part.tokenized.filter((p) => p.mcap_usd > 0).sort((a, b) => b.mcap_usd - a.mcap_usd).slice(0, 12).map((p) => ({
      slug: p.slug, name: p.name, symbol: p.symbol, category: p.category || 'DeFi', tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, multiple: +(p.mcap_usd / Math.max(1, p.tvl_usd)).toFixed(2),
    }));

    return {
      meta: { as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd, total_tracked_targets: rows.length, watchlist_count: m.part.audit.retained_watchlist, early_discovery_count: m.part.audit.retained_early_discovery, total_pretoken_tvl_usd: rows.reduce((s, r) => s + r.tvl_usd, 0), total_implied_ev_usd: rows.reduce((s, r) => s + r.implied_value_usd, 0), verdict_counts: verdictCounts, top_chains: topChains },
      filter_audit: m.part.audit, model: m.summary, tokenized_peers_sample: tokenizedPeers, rows,
    };
  }

  const api = { SECTOR_LABELS, classifySectorGroup, isPreTokenCandidate, partitionProtocols, buildEmpiricalModel, computeLaunchProbability, computeImpliedLaunchValue, buildProtocolFarmPlan, runBoardPipeline };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else g.TokenRadarEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
