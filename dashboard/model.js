((g) => {
  'use strict';

  const EXCLUDED_CATS = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Staking Pool', 'CEX', 'Anchor BTC', 'Decentralized BTC', 'Stablecoin Wrapper']);
  const VERSION_RE = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
  const WRAPPER_RE = /\b(wrapped|staked|staking|restaked|bridged)\b/i;
  const EXCHANGE_RE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
  const CHEAP_CHAINS = ['Solana', 'Base', 'Arbitrum', 'Optimism', 'Sui', 'Hyperliquid', 'Hyperliquid L1', 'Polygon', 'Binance', 'Avalanche', 'Aptos', 'Berachain', 'Monad', 'MegaETH', 'Ink', 'Abstract', 'Unichain', 'Sonic', 'Linea', 'Scroll', 'Starknet', 'zkSync Era', 'Mantle'];
  const AGE_BOUNDS = [0, 12, 24, 36, 48, 999], REF_WALLET = 2500, POOL_SHARE = 0.05;
  const SECTOR_LABELS = { trading: 'Trading & Perps', credit_rwa: 'Credit, CDP & RWA', yield_alloc: 'Yield & Curators', infra: 'Infra, AI & Chains', other: 'Other DeFi' };

  const classifySectorGroup = (c) => !c ? 'other'
    : ['Dexs', 'Derivatives', 'Prediction Market', 'Options Vault', 'OTC Marketplace', 'Interest Rate Derivatives'].includes(c) ? 'trading'
    : ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Basis Trading', 'RWA', 'Collateral Management', 'Dual-Token Stablecoin'].includes(c) ? 'credit_rwa'
    : ['Yield', 'Yield Aggregator', 'Risk Curators', 'Onchain Capital Allocator', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Indexes'].includes(c) ? 'yield_alloc'
    : ['Chain', 'Privacy', 'Payments', 'AI Agents', 'Decentralized AI', 'Token Locker', 'Restaking', 'Insurance'].includes(c) ? 'infra' : 'other';

  function isPreTokenCandidate(p, wlSet, tokWords) {
    if (p.gecko_id !== null || p.symbol !== null) return { keep: false, reason: 'live_token' };
    if (wlSet.has(p.slug)) return { keep: true, reason: 'watchlist' };
    if (p.category !== null && EXCLUDED_CATS.has(p.category)) return { keep: false, reason: 'category' };
    if (VERSION_RE.test(p.name)) return { keep: false, reason: 'versioned' };
    if (WRAPPER_RE.test(p.name)) return { keep: false, reason: 'wrapper_word' };
    if (EXCHANGE_RE.test(p.name)) return { keep: false, reason: 'cex_prefix' };
    const fw = String(p.name || '').trim().split(/\s+/)[0].toLowerCase();
    return (fw.length >= 4 && tokWords.has(fw)) ? { keep: false, reason: 'parent_brand' } : { keep: true, reason: 'early_discovery' };
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
      const r = isPreTokenCandidate(p, wlSet, tokWords);
      if (r.keep) { candidates.push(p); if (r.reason === 'watchlist') audit.retained_watchlist++; else audit.retained_early_discovery++; }
      else if (r.reason !== 'live_token') audit[`excluded_${r.reason}`]++;
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

  function fitStage1Odds(train, full) {
    const [tvlM, tvlS] = meanStd(train.map((r) => r.logTvl)), [chgM, chgS] = meanStd(train.map((r) => r.chgAsinh)), [chM, chS] = meanStd(train.map((r) => r.logChains));
    const Xf = (r) => full ? [1, (r.logTvl - tvlM) / tvlS, (r.chgAsinh - chgM) / chgS, (r.logChains - chM) / chS, r.grp === 'trading' ? 1 : 0, r.grp === 'yield_alloc' ? 1 : 0, r.grp === 'credit_rwa' ? 1 : 0] : [1, (r.logTvl - tvlM) / tvlS];
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
    const F = [];
    let maxF = 0;
    for (let b = 0; b < 5; b++) {
      const sub = train.filter((r) => r.ageMonths !== null && r.ageMonths >= AGE_BOUNDS[b] && r.ageMonths < AGE_BOUNDS[b + 1]);
      maxF = Math.max(maxF, (sub.filter((r) => r.hasTok).length + 1) / (sub.length + 2));
      F.push(maxF);
    }
    const S = F.map((f) => 1 - f), ratios = S.map((s) => s / (S[0] || 1));
    const bOf = (m) => { for (let i = 0; i < 5; i++) if (m >= AGE_BOUNDS[i] && m < AGE_BOUNDS[i + 1]) return i; return 4; };
    const datedPre = train.filter((r) => !r.hasTok && r.ageMonths !== null);
    const meanHaz = datedPre.length ? datedPre.reduce((s, r) => s + ratios[bOf(r.ageMonths)], 0) / datedPre.length : ratios[1];
    const hazardOf = (r) => r.ageMonths === null ? meanHaz : ratios[bOf(r.ageMonths)];
    const predictBaseProb = (r) => sig(Xf(r).reduce((s, v, j) => s + v * w[j], 0));
    return { weights: w, survivalRatios: ratios.map((v) => +v.toFixed(3)), predictBaseProb, hazardOf, predictProb: (r) => predictBaseProb(r) * hazardOf(r) };
  }

  function fitStage2Mcap(train, opts) {
    const n = train.length, [tvlM, tvlS] = meanStd(train.map((r) => r.logTvl)), [chM, chS] = meanStd(train.map((r) => r.logChains));
    const [chgM, chgS] = meanStd(train.map((r) => r.chgAsinh)), [ageM, ageS] = meanStd(train.filter((r) => r.logAge !== null).map((r) => r.logAge));
    const yM = train.reduce((s, r) => s + r.logMcap, 0) / n;
    let num = 0, den = 0;
    for (const r of train) { num += (r.logTvl - tvlM) * (r.logMcap - yM); den += (r.logTvl - tvlM) ** 2; }
    const slope = num / (den || 1), grpR = new Map();
    for (const r of train) (grpR.get(r.grp) || grpR.set(r.grp, []).get(r.grp)).push(r.logMcap - (yM + slope * (r.logTvl - tvlM)));
    const grpP = new Map();
    grpR.forEach((a, k) => grpP.set(k, (a.length / (a.length + 5)) * (a.reduce((x, y) => x + y, 0) / a.length)));

    const Xf = (r) => {
      const x = [1, (r.logTvl - tvlM) / tvlS];
      if (opts.sector) x.push(grpP.get(r.grp) ?? 0);
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
      for (let i = 0; i < n; i++) { const e = Math.abs(y[i] - X[i].reduce((s, v, j) => s + v * coef[j], 0)); wt[i] = e <= 0.5 ? 1 : 0.5 / e; }
    }
    return {
      coef, grpPrior: grpP,
      predictRow: (r) => {
        const x = Xf(r), c0 = coef[0], cT = coef[1] * x[1], cS = opts.sector ? coef[2] * x[2] : 0, ci = opts.sector ? 3 : 2, cC = opts.chains ? coef[ci] * x[ci] : 0;
        const off = 2 + (opts.sector ? 1 : 0) + (opts.chains ? 1 : 0), rest = x.slice(off).reduce((s, v, k) => s + v * coef[off + k], 0);
        return { logMcapPred: c0 + cT + cS + cC + rest, baseAnchorUsd: Math.round(10 ** c0), tvlMult: +(10 ** cT).toFixed(3), sectorMult: +(10 ** cS).toFixed(3), chainMult: +(10 ** cC).toFixed(3) };
      },
    };
  }

  const rocAuc = (yT, yP) => { const p = yT.map((y, i) => [yP[i], y]).sort((a, b) => a[0] - b[0]); let pos = 0, neg = 0, rs = 0; p.forEach(([_, y], i) => { if (y === 1) { pos++; rs += i + 1; } else neg++; }); return +((rs - (pos * (pos + 1)) / 2) / (pos * neg || 1)).toFixed(3); };
  const brier = (yT, yP) => +(yT.reduce((s, y, i) => s + (y - yP[i]) ** 2, 0) / yT.length).toFixed(3);
  const spearman = (a, b) => { const rk = (v) => { const ix = v.map((x, i) => [x, i]).sort((x, y) => x[0] - y[0]), r = new Array(v.length); ix.forEach((p, i) => { r[p[1]] = i + 1; }); return r; }; const ra = rk(a), rb = rk(b), n = a.length; let d2 = 0; for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2; return n <= 1 ? 0 : +(1 - (6 * d2) / (n * (n * n - 1))).toFixed(3); };
  const factorMetrics = (yT, yP) => { const n = yT.length, f = yT.map((t, i) => 10 ** Math.abs(t - yP[i])).sort((a, b) => a - b), mae = yT.reduce((s, t, i) => s + Math.abs(t - yP[i]), 0) / n; return { n, med_factor: +f[Math.floor(n / 2)].toFixed(2), gmean_factor: +(10 ** mae).toFixed(2), mae_log10: +mae.toFixed(3), spearman_rho: spearman(yT, yP) }; };
  const quant = (s, q) => { const p = (s.length - 1) * q, l = Math.floor(p), h = Math.ceil(p); return l === h ? s[l] : s[l] + (s[h] - s[l]) * (p - l); };
  const computeLaunchProbability = (row, s1) => s1.predictProb(row);

  function computeImpliedLaunchValue(row, s1, s2, q) {
    const pred = s2.predictRow(row), condMcap = Math.round(10 ** pred.logMcapPred);
    const baseProb = s1.predictBaseProb(row), hazMult = s1.hazardOf(row), odds = baseProb * hazMult;
    return {
      implied_value_usd: Math.max(100000, Math.round(condMcap * odds)), cond_mcap_usd: condMcap, launch_odds: +odds.toFixed(3), base_odds: +baseProb.toFixed(3), hazard_mult: +hazMult.toFixed(3),
      band_p10_usd: Math.max(50000, Math.round((10 ** (pred.logMcapPred + q.p10)) * odds)),
      band_p25_usd: Math.max(80000, Math.round((10 ** (pred.logMcapPred + q.p25)) * odds)),
      band_p75_usd: Math.round((10 ** (pred.logMcapPred + q.p75)) * odds),
      band_p90_usd: Math.round((10 ** (pred.logMcapPred + q.p90)) * odds),
      factors: { base_mcap_anchor_usd: pred.baseAnchorUsd, tvl_scale_mult: pred.tvlMult, sector_mult: pred.sectorMult, chain_footprint_mult: pred.chainMult, base_odds: +baseProb.toFixed(3), hazard_mult: +hazMult.toFixed(3), launch_odds_mult: +odds.toFixed(3) },
    };
  }

  const shortUsd = (n) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;

  function buildProtocolFarmPlan(p, val) {
    const cat = p.category || 'DeFi', chains = p.chains || [], pri = chains.find((c) => CHEAP_CHAINS.includes(c)) || chains[0] || 'Ethereum';
    const txGas = pri === 'Ethereum' ? 8.5 : ['Solana', 'Sui', 'Aptos'].includes(pri) ? 0.04 : ['Bitcoin', 'Lightning'].includes(pri) ? 3.0 : 0.22;
    const isTr = ['Derivatives', 'Prediction Market', 'Options Vault', 'OTC Marketplace', 'Interest Rate Derivatives'].includes(cat);
    const isDx = ['Dexs', 'Liquidity Manager'].includes(cat), isLn = ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Management'].includes(cat);
    const nTx = isTr ? 12 : isDx ? 10 : 6, slip = isTr ? 6.5 : isDx ? 4.0 : 1.5, friction = +(nTx * txGas + slip).toFixed(2), hrs = isTr ? 2.2 : isDx ? 1.6 : 1.2;
    const gross = +(val.implied_value_usd * POOL_SHARE * (REF_WALLET / Math.max(p.tvl_usd, 5e6))).toFixed(2);
    const net = +(gross - friction).toFixed(2), hr = +(net / hrs).toFixed(1);
    const verdict = (net >= 25 && hr >= 15) ? 'FARM' : (net > 0 && hr > 0) ? 'WATCH' : 'SKIP';
    const tvl = shortUsd(p.tvl_usd), ev = shortUsd(val.implied_value_usd), age = val.months_live !== null ? `${val.months_live}m no-token` : 'early stage';
    const mom = p.change_7d !== null ? (p.change_7d >= 0 ? `TVL +${p.change_7d.toFixed(1)}% 7d` : `TVL ${p.change_7d.toFixed(1)}% 7d (low dilution)`) : 'steady 7d TVL';
    const gasLabel = `~$${friction.toFixed(0)} (${nTx} txs ${pri} @ $${txGas.toFixed(2)} + $${slip.toFixed(0)} slip)`;
    const s4 = `Unit econ ($${REF_WALLET}): $${gross.toFixed(0)} est. share - $${friction.toFixed(0)} cost = $${net.toFixed(0)} (${hr >= 0 ? '+' : ''}$${hr}/hr, ${verdict}${verdict === 'WATCH' ? '; best for $25k+ LP' : ''}; ${ev} EV).`;
    const steps = isTr ? [
      `Bridge $${REF_WALLET} USDC to ${pri} (~$${(txGas * 2).toFixed(2)} gas) and fund margin on ${p.name}.`,
      `Build weekly maker/taker volume over 4-8 wks (1.5h; ~$${(txGas * 8 + slip).toFixed(2)} fees+slip).`,
      `Hold resting limit orders or LP margin across weekend snapshots (0.5h/mo; ${age}).`, s4,
    ] : isDx ? [
      `Deploy $${REF_WALLET} correlated LP on ${p.name} (${pri}, ~$${(txGas * 2).toFixed(2)} gas); ${mom}.`,
      `Execute organic spot swaps across 6+ weeks (~$${(txGas * 6 + slip).toFixed(2)} cost; 0.8h active).`,
      `Rebalance out-of-range LP biweekly (~$${(txGas * 2).toFixed(2)} gas, 0.5h) and compound 45-60d.`, s4,
    ] : isLn ? [
      `Supply $${REF_WALLET} collateral on ${p.name} (${pri}, ~$${(txGas * 2).toFixed(2)} gas; TVL ${tvl}).`,
      `Borrow 35%-50% LTV in a correlated asset if points apply (HF >= 1.60; ~$${(txGas * 2 + slip).toFixed(2)} cost).`,
      `Hold 30-90d with 10m/wk health checks (1.2h total; ${age}) across snapshot windows.`, s4,
    ] : [
      `Deposit $${REF_WALLET} into ${p.name}'s vault on ${pri} (~$${(txGas * 2).toFixed(2)} gas) and hold receipts.`,
      `Hold 2+ monthly epochs (45-90d; ${mom} across ${chains.length} chain(s)) with ~$${(txGas * 4 + slip).toFixed(2)} cost.`,
      `Check if ${p.name} receipts compose on ${pri} money markets (0.5h review; ${age}).`, s4,
    ];
    const risk = isTr ? 'Funding & liquidation risk; hedge legs.' : isDx ? 'Impermanent loss risk; use correlated pairs.' : isLn ? 'Keep HF >= 1.60 to prevent liquidations.' : 'Vault strategy & queue risks.';
    return { gasLabel, cadence: `${hrs}h active / 45-90d`, risk, steps, grossShareUsd: gross, frictionUsd: friction, effortHours: hrs, netEvUsd: net, hourlyEv: hr, verdict };
  }

  function buildEmpiricalModel(snapshot) {
    const asOfMs = Date.parse(`${snapshot.as_of}T00:00:00Z`), part = partitionProtocols(snapshot);
    const cleanPre = part.candidates.map((p) => prepRow(p, asOfMs));
    const cleanTok = part.tokenized.filter((p) => !EXCLUDED_CATS.has(p.category || '') && !VERSION_RE.test(p.name) && !WRAPPER_RE.test(p.name) && !EXCHANGE_RE.test(p.name)).map((p) => prepRow(p, asOfMs));
    const s1U = cleanTok.concat(cleanPre);

    const d1 = s1U.filter((r) => r.raw.listed_at).sort((a, b) => a.raw.listed_at.localeCompare(b.raw.listed_at) || a.raw.slug.localeCompare(b.raw.slug));
    const ud1 = s1U.filter((r) => !r.raw.listed_at);
    const s1Val = [false, true].map((full) => {
      const yCV = [], pCV = [], yWF = [], pWF = [];
      for (let f = 0; f < 10; f++) { const fit = fitStage1Odds(s1U.filter((_, i) => i % 10 !== f), full); s1U.filter((_, i) => i % 10 === f).forEach((r) => { yCV.push(r.hasTok); pCV.push(fit.predictBaseProb(r)); }); }
      for (let k = Math.floor(d1.length * 0.5); k < d1.length; k += 10) { const fit = fitStage1Odds(ud1.concat(d1.slice(0, k)), full); d1.slice(k, k + 10).forEach((r) => { yWF.push(r.hasTok); pWF.push(fit.predictBaseProb(r)); }); }
      return { label: full ? 'TVL + 7d Growth + Chains + Sector (No-Age)' : 'log10(TVL) baseline', cv_auc: rocAuc(yCV, pCV), cv_brier: brier(yCV, pCV), wf_auc: rocAuc(yWF, pWF), wf_brier: brier(yWF, pWF) };
    });

    const tokRef = cleanTok.filter((r) => r.logMcap !== null);
    const d2 = tokRef.filter((r) => r.raw.listed_at).sort((a, b) => a.raw.listed_at.localeCompare(b.raw.listed_at) || a.raw.slug.localeCompare(b.raw.slug));
    const ud2 = tokRef.filter((r) => !r.raw.listed_at);
    const specs = [
      { id: 'tvl_only', label: 'log10(TVL) baseline', status: 'baseline', opts: { sector: false, chains: false, chg: false, age: false, lambda: 4 } },
      { id: 'tvl_sector_chains', label: '+ EB Sector Group + Chain Breadth', status: 'kept', opts: { sector: true, chains: true, chg: false, age: false, lambda: 6 } },
      { id: 'plus_chg', label: '+ 7d TVL Velocity asinh(chg/20)', status: 'dropped', opts: { sector: true, chains: true, chg: true, age: false, lambda: 6 } },
      { id: 'plus_age', label: '+ Track Record log10(1 + age_yrs)', status: 'dropped', opts: { sector: true, chains: true, chg: false, age: true, lambda: 6 } },
    ];
    let looPairs = [];
    const s2Abl = specs.map((sp) => {
      const yL = [], pL = [], pairsL = [], yW = [], pW = [];
      for (let i = 0; i < tokRef.length; i++) {
        const pred = fitStage2Mcap(tokRef.filter((_, j) => j !== i), sp.opts).predictRow(tokRef[i]).logMcapPred;
        yL.push(tokRef[i].logMcap); pL.push(pred); pairsL.push({ actual: tokRef[i].logMcap, pred, res: tokRef[i].logMcap - pred });
      }
      if (sp.id === 'tvl_sector_chains') looPairs = pairsL;
      for (let k = 25; k < d2.length; k++) { yW.push(d2[k].logMcap); pW.push(fitStage2Mcap(ud2.concat(d2.slice(0, k)), sp.opts).predictRow(d2[k]).logMcapPred); }
      return { id: sp.id, label: sp.label, status: sp.status, loo: factorMetrics(yL, pL), walk_forward: factorMetrics(yW, pW) };
    });

    let cov50 = 0, cov80 = 0;
    for (let i = 0; i < looPairs.length; i++) {
      const others = looPairs.filter((_, j) => j !== i).map((x) => x.res).sort((a, b) => a - b), { actual, pred } = looPairs[i];
      if (actual >= pred + quant(others, 0.25) && actual <= pred + quant(others, 0.75)) cov50++;
      if (actual >= pred + quant(others, 0.1) && actual <= pred + quant(others, 0.9)) cov80++;
    }
    const looRes = looPairs.map((x) => x.res).sort((a, b) => a - b);
    const quantiles = { p10: quant(looRes, 0.1), p25: quant(looRes, 0.25), p75: quant(looRes, 0.75), p90: quant(looRes, 0.9) };
    const stage1Fit = fitStage1Odds(s1U, true), stage2Fit = fitStage2Mcap(tokRef, specs[1].opts);
    const buckets = new Map();
    tokRef.forEach((r) => (buckets.get(r.grp) || buckets.set(r.grp, []).get(r.grp)).push(r.raw.mcap_usd / r.raw.tvl_usd));
    const sectorMultiples = ['trading', 'credit_rwa', 'infra', 'yield_alloc', 'other'].map((k) => { const v = (buckets.get(k) || [0.25]).slice().sort((a, b) => a - b); return { group: k, label: SECTOR_LABELS[k], count: v.length, median_mcap_tvl: +v[Math.floor(v.length / 2)].toFixed(2) }; });
    const cov50Pct = +(cov50 / looPairs.length * 100).toFixed(1), cov80Pct = +(cov80 / looPairs.length * 100).toFixed(1);

    return {
      part, cleanPre, tokRef, stage1Fit, stage2Fit, quantiles,
      summary: {
        stage1_universe_size: s1U.length, stage2_ref_size: tokRef.length, ref_wallet_usd: REF_WALLET, illustrative_pool_share: POOL_SHARE,
        stage1_validation: s1Val, stage2_ablation: s2Abl, sector_multiples: sectorMultiples, survival_ratios: stage1Fit.survivalRatios,
        conformal: { cov_50_pct: cov50Pct, cov_80_pct: cov80Pct, n: looPairs.length },
        range_honesty: `Conformal LOO coverage ${cov50Pct}% (P25-P75) / ${cov80Pct}% (P10-P90); bands reflect real peer dispersion (LOO x${s2Abl[1].loo.med_factor}, WF x${s2Abl[1].walk_forward.med_factor}).`,
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
        launch_odds: val.launch_odds, base_odds: val.base_odds, hazard_mult: val.hazard_mult, cond_mcap_usd: val.cond_mcap_usd, implied_value_usd: val.implied_value_usd,
        band_p10_usd: val.band_p10_usd, band_p25_usd: val.band_p25_usd, band_p75_usd: val.band_p75_usd, band_p90_usd: val.band_p90_usd,
        factors: val.factors, comparables, est_gas_cost: farm.gasLabel, time_commitment: farm.cadence, risk_note: farm.risk,
        gross_share_usd: farm.grossShareUsd, friction_usd: farm.frictionUsd, effort_hours: farm.effortHours,
        net_ev_usd: farm.netEvUsd, hourly_ev: farm.hourlyEv, verdict: farm.verdict, farm_steps: farm.steps,
      };
    });

    unordered.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || a.slug.localeCompare(b.slug));
    const evList = unordered.map((r) => r.implied_value_usd);
    const rows = unordered.map((r, i) => {
      const rank = i + 1;
      return { rank, rank_low: Math.min(rank, 1 + evList.filter((v) => v > r.band_p75_usd).length), rank_high: Math.max(rank, 1 + evList.filter((v) => v > r.band_p25_usd).length), ...r };
    });

    const datedPre = rows.filter((r) => r.months_live !== null);
    const young = datedPre.filter((r) => r.months_live >= 6 && r.months_live <= 24), old48 = datedPre.filter((r) => r.months_live >= 48);
    m.summary.hazard_check = {
      young_6_24m_avg_odds: +(young.reduce((s, r) => s + r.launch_odds, 0) / (young.length || 1) * 100).toFixed(1),
      old_48m_plus_avg_odds: +(old48.reduce((s, r) => s + r.launch_odds, 0) / (old48.length || 1) * 100).toFixed(1),
    };

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
