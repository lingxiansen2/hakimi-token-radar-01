(() => {
  const RAW = window.__TOKEN_RADAR_SNAPSHOT__, ENG = window.TokenRadarEngine, root = document.getElementById('app');
  if (!RAW || !ENG || !root) { if (root) root.textContent = 'Missing offline snapshot or model.js.'; return; }

  const DATA = ENG.runBoardPipeline(RAW);
  const SCOL = { trading: '#38bdf8', credit_rwa: '#10b981', yield_alloc: '#a78bfa', infra: '#f59e0b', other: '#94a3b8' };
  const P = new URLSearchParams(window.location.search);
  const st = { view: P.get('view') || 'board', search: P.get('q') || '', tier: P.get('tier') || 'all', verdict: P.get('verdict') || 'all', sector: P.get('sector') || 'all', chain: P.get('chain') || 'all', momentum: P.get('momentum') || 'all', sortKey: P.get('sort') || 'rank', sortDir: P.get('dir') || 'asc', selectedSlug: P.get('slug') || '' };

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtUsd = (n) => n == null ? '—' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
  const fmtPct = (v) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  const vCls = (v) => v === 'FARM' ? 'emerald' : v === 'WATCH' ? 'amber' : 'rose';
  const mb = (l, v, c = '') => `<div class="mini-box"><div class="lbl">${l}</div><div class="val num ${c}">${v}</div></div>`;
  const fr = (l, v, c = '') => `<div class="factor-row"><span>${l}</span><span class="num ${c}">${v}</span></div>`;
  const shortLbl = (n) => { const c = n.replace('International', "Int'l").replace('Financial', 'Fin.').replace('Asset Management', 'AM').replace('Network', '').replace('Protocol', '').trim(); if (c.length <= 15) return c; const w = c.split(/\s+/); return w[0].length >= 12 ? w[0].slice(0, 14) : w.slice(0, 2).join(' ').slice(0, 15); };

  function getFiltered() {
    const q = st.search.trim().toLowerCase();
    const list = DATA.rows.filter((r) => {
      if ((st.tier === 'watchlist' && !r.on_watchlist) || (st.tier === 'early' && r.on_watchlist)) return false;
      if (st.verdict !== 'all' && r.verdict !== st.verdict) return false;
      if (st.sector !== 'all' && r.sector_group !== st.sector) return false;
      if (st.chain !== 'all' && !r.chains.includes(st.chain)) return false;
      if (st.momentum === 'positive' && !(r.change_7d > 0)) return false;
      if (q && !`${r.name} ${r.slug} ${r.category} ${r.chains.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = st.sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va = a[st.sortKey], vb = b[st.sortKey];
      if (st.sortKey === 'change_7d' || st.sortKey === 'months_live') { va = va ?? -9999; vb = vb ?? -9999; }
      return (typeof va === 'string' ? va.localeCompare(vb) : (va ?? 0) - (vb ?? 0)) * dir || a.rank - b.rank;
    });
    return list;
  }

  function renderScatter(rows) {
    const W = 660, H = 148, pad = { l: 48, r: 16, t: 10, b: 22 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const minX = 6.6, maxX = 9.6, minY = 5.8, maxY = 7.6;
    const sx = (v) => pad.l + ((Math.max(minX, Math.min(maxX, Math.log10(Math.max(1, v)))) - minX) / (maxX - minX)) * iw;
    const sy = (v) => pad.t + ih - ((Math.max(minY, Math.min(maxY, Math.log10(Math.max(1, v)))) - minY) / (maxY - minY)) * ih;
    const gx = [7, 8, 9].map((e) => ({ x: pad.l + ((e - minX) / (maxX - minX)) * iw, l: e === 7 ? '$10M' : e === 8 ? '$100M' : '$1B' }));
    const gy = [6.0, 6.7, 7.4].map((e) => ({ y: pad.t + ih - ((e - minY) / (maxY - minY)) * ih, l: e < 6.5 ? '$1M' : e < 7 ? '$5M' : '$25M' }));
    const dots = rows.map((r) => { const sel = r.slug === st.selectedSlug; return `<circle class="scatter-dot" data-slug="${esc(r.slug)}" cx="${sx(r.tvl_usd).toFixed(1)}" cy="${sy(r.implied_value_usd).toFixed(1)}" r="${sel ? 5.6 : r.on_watchlist ? 3.8 : 2.6}" fill="${SCOL[r.sector_group] || '#94a3b8'}" fill-opacity="${sel ? 1 : r.on_watchlist ? 0.92 : 0.65}" stroke="${sel ? '#fff' : r.on_watchlist ? '#0b0f14' : 'none'}" stroke-width="${sel ? 2 : 1}" style="cursor:pointer"></circle>`; }).join('');
    const placed = [];
    const labels = rows.slice(0, 9).map((r) => {
      const px = sx(r.tvl_usd), py = sy(r.implied_value_usd), txt = shortLbl(r.name), w = txt.length * 5.8 + 8, h = 12;
      for (const [cx, cy] of [[px + 9, py - 6], [px - 9 - w, py - 6], [px + 9, py + 13], [px - 9 - w, py + 13]]) {
        const x0 = Math.max(pad.l + 2, Math.min(W - pad.r - w - 2, cx)), y0 = Math.max(pad.t + 10, Math.min(H - pad.b - 3, cy));
        const box = { x1: x0 - 4, y1: y0 - h, x2: x0 + w + 4, y2: y0 + 3 };
        if (!placed.some((b) => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2))) { placed.push(box); return `<text x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" fill="#dbe6f5" font-size="9.5" font-weight="600">${esc(txt)}</text>`; }
      }
      return '';
    }).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="TVL vs Expected Value">${gx.map((g) => `<line x1="${g.x}" y1="${pad.t}" x2="${g.x}" y2="${H - pad.b}" stroke="#1f2a3c" stroke-dasharray="3 3"/><text x="${g.x}" y="${H - 6}" fill="#687a94" font-size="9.5" text-anchor="middle">${g.l} TVL</text>`).join('')}${gy.map((g) => `<line x1="${pad.l}" y1="${g.y}" x2="${W - pad.r}" y2="${g.y}" stroke="#1f2a3c" stroke-dasharray="3 3"/><text x="${pad.l - 5}" y="${g.y + 3}" fill="#687a94" font-size="9.5" text-anchor="end">${g.l}</text>`).join('')}${dots}${labels}</svg>`;
  }

  function renderSectors() {
    const secs = DATA.model.sector_multiples, maxM = Math.max(...secs.map((s) => s.median_mcap_tvl), 0.5);
    const bars = secs.map((s) => `<div style="margin-bottom:4px"><div style="display:flex;justify-content:space-between;font-size:10.5px;margin-bottom:1px"><span><i style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${SCOL[s.group]};margin-right:5px"></i>${esc(s.label)} <span style="color:var(--muted)">(${s.count})</span></span><b class="num">${s.median_mcap_tvl.toFixed(2)}x</b></div><div style="height:5px;background:var(--bg);border-radius:3px;overflow:hidden;border:1px solid var(--border)"><div style="width:${Math.max(8, Math.round((s.median_mcap_tvl / maxM) * 100))}%;height:100%;background:${SCOL[s.group]}"></div></div></div>`).join('');
    const s1 = DATA.model.stage1_validation[1], kept = DATA.model.stage2_ablation[1], hc = DATA.model.hazard_check;
    return `${bars}<div class="factor-row" style="margin-top:5px;padding:5px 7px;font-size:10px;color:var(--text-2)"><span><b class="pos">Blind Tests:</b> LOO x<b class="num">${kept.loo.med_factor}</b> · WF x<b class="num">${kept.walk_forward.med_factor}</b> · Stage1 AUC <b class="num">${s1.cv_auc}</b> · 6-24m vs 48m+ odds: <b class="num">${hc.young_6_24m_avg_odds}%→${hc.old_48m_plus_avg_odds}%</b></span></div>`;
  }

  const renderAblation = () => `<table class="radar-table"><thead><tr><th>Stage 2 Model Term</th><th>Status</th><th class="r">LOO</th><th class="r">LOO Rho</th><th class="r">Walk-Fwd</th><th class="r">WF Rho</th></tr></thead><tbody>${DATA.model.stage2_ablation.map((s) => `<tr><td><b>${esc(s.label)}</b></td><td><span class="pill ${s.status === 'kept' ? 'emerald' : s.status === 'baseline' ? 'cyan' : 'rose'}">${s.status.toUpperCase()}</span></td><td class="r num">x${s.loo.med_factor.toFixed(2)}</td><td class="r num">${s.loo.spearman_rho.toFixed(3)}</td><td class="r num">x${s.walk_forward.med_factor.toFixed(2)}</td><td class="r num">${s.walk_forward.spearman_rho.toFixed(3)}</td></tr>`).join('')}</tbody></table>`;

  function renderAuditBottom() {
    const a = DATA.filter_audit, c = DATA.model.conformal, hc = DATA.model.hazard_check, sr = DATA.model.survival_ratios;
    return `<div class="panel" style="margin-top:8px"><div class="panel-head"><h3 class="panel-title">Model Audit &amp; 758-Protocol Census (Conformal + Age-Hazard Verification)</h3><span class="panel-sub">Executed live by dashboard/model.js</span></div>
      <div class="census-grid">
        <div class="mini-box"><div class="lbl">758-Protocol Census Funnel</div><div style="font-size:10.5px;margin-top:2px"><b>${a.total_protocols}</b> total → <span class="neg">-${a.excluded_live_token}</span> tokenized → <span class="neg">-${a.excluded_category + a.excluded_versioned + a.excluded_wrapper_word + a.excluded_cex_prefix}</span> wrappers/CEX/V2 → <span class="neg">-${a.excluded_parent_brand}</span> parent forks (Solv, Manta, Kava, MetalX, Flying Tulip) = <b class="pos">${a.retained_total}</b> targets (${a.retained_watchlist}/${a.retained_watchlist} WL)</div></div>
        <div class="mini-box"><div class="lbl">Nested Conformal LOO Calibration (n=${c.n})</div><div style="font-size:10.5px;margin-top:2px">Out-of-sample P25–P75 coverage: <b class="pos num">${c.cov_50_pct}%</b> (target 50%) · P10–P90 coverage: <b class="pos num">${c.cov_80_pct}%</b> (target 80%). Wide bands reflect true peer dispersion.</div></div>
        <div class="mini-box"><div class="lbl">Age-Falling Survival Hazard Decay</div><div style="font-size:10.5px;margin-top:2px">Cohort retention S(b)/S(0) [&lt;1y→4y+]: <b class="num">${sr.join(' → ')}</b>. Tokenless 48m+ avg <b class="num">${hc.old_48m_plus_avg_odds}%</b> vs 6-24m <b class="pos num">${hc.young_6_24m_avg_odds}%</b> (zero survivorship bias).</div></div>
      </div></div>`;
  }

  function renderInspector(row, full = false) {
    if (!row) return '<div class="inspector">No protocol matches active filters.</div>';
    const lo = Math.log10(Math.max(5e4, row.band_p10_usd)), hi = Math.log10(Math.max(5e5, row.band_p90_usd)), span = Math.max(0.2, hi - lo);
    const pct = (v) => Math.max(0, Math.min(100, ((Math.log10(Math.max(5e4, v)) - lo) / span) * 100));
    const p25 = pct(row.band_p25_usd), p75 = pct(row.band_p75_usd), p50 = pct(row.implied_value_usd), f = row.factors;

    const left = `<div>
      <div class="detail-header"><div>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap"><span class="pill cyan num">#${row.rank} [${row.rank_low}–${row.rank_high}]</span><h2 class="detail-title">${esc(row.name)}</h2><span class="pill ${vCls(row.verdict)}">${row.verdict} ${row.hourly_ev >= 0 ? '+' : ''}$${row.hourly_ev}/hr</span></div>
        <div class="proto-meta" style="margin-top:2px;color:var(--text-2)">${esc(row.category)} · ${row.chains.slice(0, 4).map(esc).join(', ')}${row.chains.length > 4 ? ` +${row.chains.length - 4}` : ''} · Records no token</div>
      </div>${!full ? '<button class="chip" id="openFullDetailBtn">Full Playbook</button>' : ''}</div>
      <div class="detail-metrics">
        ${mb('Expected Value', fmtUsd(row.implied_value_usd), 'cy')}
        ${mb('E[MCap] × Odds', `${fmtUsd(row.cond_mcap_usd)} <span class="pos" style="font-size:10px">× ${Math.round(row.launch_odds * 100)}%</span>`)}
        ${mb('TVL / 7d / Age', `${fmtUsd(row.tvl_usd)} · <span class="${row.change_7d > 0 ? 'pos' : row.change_7d < 0 ? 'neg' : ''}">${fmtPct(row.change_7d)}</span> · ${row.months_live ? row.months_live + 'm' : 'n/a'}`)}
      </div>
      <div class="section-label">Conformal Valuation Band (P10–P90 · Rank #${row.rank_low}–#${row.rank_high})</div>
      <div class="band-bar">
        <div class="band-labels num"><span>P10:${fmtUsd(row.band_p10_usd)}</span><span>P25:${fmtUsd(row.band_p25_usd)}</span><span class="pos"><b>EV:${fmtUsd(row.implied_value_usd)}</b></span><span>P75:${fmtUsd(row.band_p75_usd)}</span><span>P90:${fmtUsd(row.band_p90_usd)}</span></div>
        <div class="band-track"><div class="band-outer" style="left:0;width:100%"></div><div class="band-inner" style="left:${p25.toFixed(1)}%;width:${Math.max(4, p75 - p25).toFixed(1)}%"></div><div class="band-median" style="left:${p50.toFixed(1)}%"></div></div>
      </div>
      <div class="section-label">Factor Decomposition (Zero Unfitted Constants)</div>
      <div class="factor-list">
        ${fr('1. Reference MCap Anchor', fmtUsd(f.base_mcap_anchor_usd))}
        ${fr(`2. TVL Elasticity (${fmtUsd(row.tvl_usd)})`, `${f.tvl_scale_mult.toFixed(2)}x`, f.tvl_scale_mult >= 1 ? 'pos' : 'neg')}
        ${fr(`3. EB Sector × Chains (${row.chains.length})`, `${(f.sector_mult * f.chain_footprint_mult).toFixed(2)}x`)}
        ${fr(`4. Propensity × Survival (${row.months_live ? row.months_live + 'm' : 'avg'})`, `${Math.round(f.base_odds * 100)}% × ${f.hazard_mult.toFixed(2)} = ${Math.round(f.launch_odds_mult * 100)}%`, 'pos')}
      </div>
      ${full ? `<div class="section-label" style="margin-top:8px">Two-Blind-Test Ablation Proof (LOO &amp; Walk-Forward)</div>${renderAblation()}` : `<div class="factor-row" style="margin-top:6px;padding:5px 7px"><span><b>$${DATA.model.ref_wallet_usd.toLocaleString()} Wallet:</b> $${row.friction_usd.toFixed(0)} cost · ${row.effort_hours}h</span><span class="pill ${vCls(row.verdict)}">${row.verdict} · Net $${row.net_ev_usd.toFixed(0)} (${row.hourly_ev >= 0 ? '+' : ''}$${row.hourly_ev}/hr)</span></div>`}
    </div>`;

    const right = `<div>
      <div class="section-label" style="margin-top:0">Costed Farm Unit Economics ($${DATA.model.ref_wallet_usd.toLocaleString()} Ref. Wallet · 5% Illustrative Pool)</div>
      <div class="econ-grid">
        ${mb('Est. Share', `$${row.gross_share_usd.toFixed(0)}`)}
        ${mb('Gas + Slip', `-$${row.friction_usd.toFixed(1)}`, 'neg')}
        ${mb('Net EV / Time', `$${row.net_ev_usd.toFixed(0)} / ${row.effort_hours}h`, row.net_ev_usd >= 0 ? 'pos' : 'neg')}
        ${mb('Hourly Verdict', `${row.hourly_ev >= 0 ? '+' : ''}$${row.hourly_ev}/hr`, row.hourly_ev >= 15 ? 'pos' : row.hourly_ev > 0 ? '' : 'neg')}
      </div>
      <div class="section-label">Actionable Costed Farming Steps</div>
      <ol class="step-list">${row.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <div style="margin-top:4px;font-size:10px;color:var(--amber)">Risk: ${esc(row.risk_note)} · ${esc(row.est_gas_cost)}</div>
      <div class="section-label">Nearest Tokenized Peers (Snapshot Ground Truth)</div>
      <table class="peers-table"><thead><tr><th>Peer</th><th>Sector</th><th class="r">TVL</th><th class="r">MCap</th><th class="r">Mult</th></tr></thead>
      <tbody>${row.comparables.map((c) => `<tr><td><b>${esc(c.name)}</b> <span style="color:var(--muted)">${esc(c.symbol || '')}</span></td><td style="color:var(--text-2)">${esc(c.category)}</td><td class="r num">${fmtUsd(c.tvl_usd)}</td><td class="r num">${fmtUsd(c.mcap_usd)}</td><td class="r num">${c.mcap_tvl_ratio.toFixed(2)}x</td></tr>`).join('')}</tbody></table>
    </div>`;

    return full ? `<div class="detail-full-grid"><div class="panel">${left}</div><div class="panel">${right}</div></div>${renderAuditBottom()}` : `<aside class="inspector">${left}</aside>`;
  }

  function renderModelView() {
    const m = DATA.model;
    return `<div class="audit-grid"><div class="panel">
      <div class="panel-head"><h3 class="panel-title">Stage 1: Token Propensity (${m.stage1_universe_size} Protocols)</h3><span class="panel-sub">No-Age + Survival Hazard</span></div>
      <table class="radar-table"><thead><tr><th>Features</th><th class="r">CV AUC</th><th class="r">CV Brier</th><th class="r">WF AUC</th><th class="r">WF Brier</th></tr></thead>
      <tbody>${m.stage1_validation.map((s) => `<tr><td><b>${esc(s.label)}</b></td><td class="r num">${s.cv_auc}</td><td class="r num">${s.cv_brier}</td><td class="r num">${s.wf_auc}</td><td class="r num">${s.wf_brier}</td></tr>`).join('')}</tbody></table>
      <div class="panel-head" style="margin-top:10px"><h3 class="panel-title">Stage 2: E[mcap] Huber-Ridge (${m.stage2_ref_size} Peers)</h3><span class="panel-sub">LOO &amp; Walk-Forward</span></div>${renderAblation()}
    </div>
    <div class="panel">
      <div class="panel-head"><h3 class="panel-title">Separated Live-Token Peers</h3><span class="panel-sub">Excluded from board</span></div>
      <table class="radar-table"><thead><tr><th>Protocol</th><th>Ticker</th><th class="r">TVL</th><th class="r">MCap</th><th class="r">Mult</th></tr></thead>
      <tbody>${DATA.tokenized_peers_sample.slice(0, 9).map((p) => `<tr><td><b>${esc(p.name)}</b></td><td><span class="pill">${esc(p.symbol || 'TOK')}</span></td><td class="r num">${fmtUsd(p.tvl_usd)}</td><td class="r num">${fmtUsd(p.mcap_usd)}</td><td class="r num">${p.multiple.toFixed(2)}x</td></tr>`).join('')}</tbody></table>
    </div></div>${renderAuditBottom()}`;
  }

  function render() {
    const filtered = getFiltered();
    if (!filtered.some((r) => r.slug === st.selectedSlug) && filtered[0]) st.selectedSlug = filtered[0].slug;
    const sel = DATA.rows.find((r) => r.slug === st.selectedSlug) || filtered[0] || DATA.rows[0];
    const s1 = DATA.model.stage1_validation[1], kept = DATA.model.stage2_ablation[1], vc = DATA.meta.verdict_counts, a = DATA.filter_audit;
    const fTvl = filtered.reduce((s, r) => s + r.tvl_usd, 0), fEv = filtered.reduce((s, r) => s + r.implied_value_usd, 0);

    const topBar = `<header class="topbar">
      <div class="brand"><div class="brand-mark">TR</div><div><h1>TOKEN RADAR <span class="cy">// PRE-TOKEN ALPHA</span></h1><div class="brand-sub">Snapshot ${esc(DATA.meta.as_of)} · ${DATA.meta.total_tracked_targets} Targets · Pure E[MCap] × P(Token|Age)</div></div></div>
      <div class="meta-pill-row"><span class="pill emerald">Stage 1: CV AUC ${s1.cv_auc} · Age-Falling Hazard</span><span class="pill cyan">Stage 2: LOO x${kept.loo.med_factor} · WF x${kept.walk_forward.med_factor}</span></div>
      <nav class="nav-tabs" aria-label="Views"><button class="tab-btn ${st.view === 'board' ? 'active' : ''}" data-tab="board">Radar Board</button><button class="tab-btn ${st.view === 'detail' ? 'active' : ''}" data-tab="detail">Protocol Playbook</button><button class="tab-btn ${st.view === 'model' ? 'active' : ''}" data-tab="model">Model &amp; Audit</button></nav>
    </header>
    <div class="integrity-strip">
      <span><b class="pos">${a.total_protocols} Audited</b> (${a.excluded_live_token} Tokenized · ${a.excluded_category + a.excluded_versioned + a.excluded_wrapper_word + a.excluded_cex_prefix} Wrappers/CEX/V2 + ${a.excluded_parent_brand} Parent Forks Purged · ${a.retained_watchlist}/${a.retained_watchlist} Watchlist) · Conformal (${DATA.model.conformal.cov_50_pct}%/${DATA.model.conformal.cov_80_pct}%) · 0 Unfitted Constants</span>
      <span>$${DATA.model.ref_wallet_usd.toLocaleString()}: <b class="pos">${vc.FARM} FARM</b> / <b style="color:var(--amber)">${vc.WATCH} WATCH</b> / ${vc.SKIP} SKIP</span>
    </div>`;

    let body = '';
    if (st.view === 'model') body = renderModelView();
    else if (st.view === 'detail') {
      body = `<div class="filter-bar" style="justify-content:space-between"><div style="display:flex;align-items:center;gap:8px"><span style="color:var(--text-2);font-weight:600">Inspect Protocol:</span><select id="detailSelect" class="select-input">${DATA.rows.map((r) => `<option value="${esc(r.slug)}" ${r.slug === sel.slug ? 'selected' : ''}>#${r.rank} [${r.rank_low}-${r.rank_high}] ${esc(r.name)} (${fmtUsd(r.implied_value_usd)} · ${r.verdict} ${r.hourly_ev >= 0 ? '+' : ''}$${r.hourly_ev}/hr)</option>`).join('')}</select></div><button class="chip" data-tab="board">Back to Radar Board</button></div>${renderInspector(sel, true)}`;
    } else {
      const th = (k, l, r = false) => `<th${r ? ' class="r"' : ''} data-sort="${k}">${l}${st.sortKey === k ? (st.sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
      const bestHr = [...filtered].sort((a, b) => b.hourly_ev - a.hourly_ev)[0];
      const kc = (l, v, sub, vc = '') => `<div class="kpi-card"><div class="kpi-label">${l}</div><div class="kpi-val num ${vc}">${v}</div><div class="kpi-sub">${sub}</div></div>`;
      body = `<section class="kpi-grid">
        ${kc('Active Targets', `${filtered.length} <span style="font-size:11px;color:var(--muted)">/ ${DATA.meta.total_tracked_targets}</span>`, `${filtered.filter((r) => r.on_watchlist).length} Watchlist · ${filtered.filter((r) => !r.on_watchlist).length} Early`)}
        ${kc('Filtered TVL', fmtUsd(fTvl), `Total ${fmtUsd(DATA.meta.total_pretoken_tvl_usd)}`)}
        ${kc('Expected Launch Value', fmtUsd(fEv), 'EV = E[MCap] × P(Token)', 'cy')}
        ${kc('Top EV Protocol', `<span style="font-family:var(--sans);font-size:13.5px">${esc(filtered[0] ? filtered[0].name : '—')}</span>`, filtered[0] ? `${fmtUsd(filtered[0].implied_value_usd)} (${Math.round(filtered[0].launch_odds * 100)}% odds)` : '')}
        ${kc('Best $/hr ($2.5k Wallet)', `<span style="font-family:var(--sans);font-size:13.5px">${esc(bestHr ? bestHr.name : '—')}</span>`, bestHr ? `${bestHr.hourly_ev >= 0 ? '+' : ''}$${bestHr.hourly_ev}/hr (${bestHr.verdict})` : '', 'pos')}
      </section>
      <section class="charts-row">
        <div class="panel"><div class="panel-head"><h3 class="panel-title">Log-Scale TVL vs. Expected Launch Value (E[MCap] × P(Token))</h3><span class="panel-sub">Click any node · Large dots = Watchlist ($50M+)</span></div>${renderScatter(filtered)}</div>
        <div class="panel"><div class="panel-head"><h3 class="panel-title">Sector Multiples &amp; Held-Out Proof</h3><span class="panel-sub">Fit on ${DATA.model.stage2_ref_size} DeFi peers</span></div>${renderSectors()}</div>
      </section>
      <section class="filter-bar">
        <input id="searchInput" class="search-input" type="search" placeholder="Search protocol, category, chain..." value="${esc(st.search)}">
        <div class="chip-group">
          <button class="chip ${st.verdict === 'all' ? 'active' : ''}" data-verdict="all">All (${DATA.rows.length})</button>
          <button class="chip ${st.verdict === 'FARM' ? 'active' : ''}" data-verdict="FARM">FARM (${vc.FARM})</button>
          <button class="chip ${st.verdict === 'WATCH' ? 'active' : ''}" data-verdict="WATCH">WATCH (${vc.WATCH})</button>
          <button class="chip ${st.verdict === 'SKIP' ? 'active' : ''}" data-verdict="SKIP">SKIP (${vc.SKIP})</button>
        </div>
        <div class="chip-group">
          <button class="chip ${st.tier === 'watchlist' ? 'active' : ''}" data-tier="watchlist">Watchlist (${DATA.meta.watchlist_count})</button>
          <button class="chip ${st.tier === 'early' ? 'active' : ''}" data-tier="early">Early (${DATA.meta.early_discovery_count})</button>
        </div>
        <select id="sectorSelect" class="select-input"><option value="all" ${st.sector === 'all' ? 'selected' : ''}>All Sectors</option><option value="trading" ${st.sector === 'trading' ? 'selected' : ''}>Trading &amp; Perps</option><option value="credit_rwa" ${st.sector === 'credit_rwa' ? 'selected' : ''}>Credit, CDP &amp; RWA</option><option value="yield_alloc" ${st.sector === 'yield_alloc' ? 'selected' : ''}>Yield &amp; Curators</option><option value="infra" ${st.sector === 'infra' ? 'selected' : ''}>Infra, AI &amp; Chains</option></select>
        <select id="chainSelect" class="select-input"><option value="all" ${st.chain === 'all' ? 'selected' : ''}>All Chains</option>${DATA.meta.top_chains.map((c) => `<option value="${esc(c.chain)}" ${st.chain === c.chain ? 'selected' : ''}>${esc(c.chain)} (${c.count})</option>`).join('')}</select>
        <button class="chip ${st.momentum === 'positive' ? 'active' : ''}" id="momToggle">7d &gt; 0%</button><button class="reset-btn" id="resetFilters">Reset</button>
      </section>
      <section class="workspace-split">
        <div class="table-wrap"><div class="table-scroll"><table class="radar-table">
          <thead><tr>${th('rank', '#')}${th('name', 'Protocol')}${th('category', 'Sector')}${th('tvl_usd', 'TVL', true)}${th('change_7d', '7d Δ', true)}${th('months_live', 'Age', true)}${th('launch_odds', 'Odds', true)}${th('implied_value_usd', 'Expected EV', true)}${th('hourly_ev', '$/hr', true)}</tr></thead>
          <tbody>${filtered.map((r) => `<tr data-slug="${esc(r.slug)}" class="${r.slug === sel.slug ? 'selected' : ''}"><td class="num">${r.rank}</td><td><div class="proto-name">${r.on_watchlist ? '<span class="wl-dot"></span>' : ''}${esc(r.name)}</div><div class="proto-meta">${esc(r.primary_chain)}${r.chains.length > 1 ? ` +${r.chains.length - 1}` : ''}</div></td><td><span class="pill">${esc(r.category)}</span></td><td class="r num">${fmtUsd(r.tvl_usd)}</td><td class="r num ${r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : ''}">${fmtPct(r.change_7d)}</td><td class="r num">${r.months_live ? r.months_live + 'm' : 'n/a'}</td><td class="r num">${Math.round(r.launch_odds * 100)}%</td><td class="r num"><b>${fmtUsd(r.implied_value_usd)}</b></td><td class="r num"><span class="pill ${vCls(r.verdict)}">${r.verdict} ${r.hourly_ev >= 0 ? '+' : ''}$${r.hourly_ev}</span></td></tr>`).join('')}</tbody>
        </table></div></div>
        ${renderInspector(sel, false)}
      </section>`;
    }

    root.innerHTML = `${topBar}${body}<footer class="disclaimer"><span>Live browser engine (dashboard/model.js) on ${esc(DATA.meta.as_of)} snapshot; ${esc(DATA.model.range_honesty)}</span><span class="num">Zero-network offline artifact</span></footer>`;

    root.querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => { st.view = el.getAttribute('data-tab'); render(); }));
    const openFull = root.querySelector('#openFullDetailBtn');
    if (openFull) openFull.addEventListener('click', () => { st.view = 'detail'; render(); });
    const dSel = root.querySelector('#detailSelect');
    if (dSel) dSel.addEventListener('change', (e) => { st.selectedSlug = e.target.value; render(); });
    const sIn = root.querySelector('#searchInput');
    if (sIn) sIn.addEventListener('input', (e) => { st.search = e.target.value; render(); const a = root.querySelector('#searchInput'); if (a) { a.focus(); a.setSelectionRange(a.value.length, a.value.length); } });
    root.querySelectorAll('[data-verdict]').forEach((el) => el.addEventListener('click', () => { st.verdict = el.getAttribute('data-verdict'); render(); }));
    root.querySelectorAll('[data-tier]').forEach((el) => el.addEventListener('click', () => { const t = el.getAttribute('data-tier'); st.tier = st.tier === t ? 'all' : t; render(); }));
    const secS = root.querySelector('#sectorSelect');
    if (secS) secS.addEventListener('change', (e) => { st.sector = e.target.value; render(); });
    const chS = root.querySelector('#chainSelect');
    if (chS) chS.addEventListener('change', (e) => { st.chain = e.target.value; render(); });
    const momB = root.querySelector('#momToggle');
    if (momB) momB.addEventListener('click', () => { st.momentum = st.momentum === 'positive' ? 'all' : 'positive'; render(); });
    const rstB = root.querySelector('#resetFilters');
    if (rstB) rstB.addEventListener('click', () => { st.search = ''; st.tier = 'all'; st.verdict = 'all'; st.sector = 'all'; st.chain = 'all'; st.momentum = 'all'; st.sortKey = 'rank'; st.sortDir = 'asc'; render(); });
    root.querySelectorAll('th[data-sort]').forEach((h) => h.addEventListener('click', () => { const k = h.getAttribute('data-sort'); if (st.sortKey === k) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc'; else { st.sortKey = k; st.sortDir = ['rank', 'name', 'category'].includes(k) ? 'asc' : 'desc'; } render(); }));
    root.querySelectorAll('tr[data-slug], .scatter-dot[data-slug]').forEach((el) => el.addEventListener('click', () => { st.selectedSlug = el.getAttribute('data-slug'); render(); }));
  }

  render();
})();
