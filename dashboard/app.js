(() => {
  const RAW_SNAPSHOT = window.__TOKEN_RADAR_SNAPSHOT__;
  const ENGINE = window.TokenRadarEngine;
  const root = document.getElementById('app');
  if (!RAW_SNAPSHOT || !ENGINE || !root) {
    if (root) root.textContent = 'Missing offline snapshot (../data.js) or TokenRadarEngine (model.js).';
    return;
  }

  // Run the full 2-stage empirical valuation & pre-token filter live in the browser
  const DATA = ENGINE.runBoardPipeline(RAW_SNAPSHOT);
  const SECTOR_COLORS = { trading: '#38bdf8', credit_rwa: '#10b981', yield_alloc: '#a78bfa', infra: '#f59e0b', other: '#94a3b8' };
  const params = new URLSearchParams(window.location.search);
  const state = {
    view: params.get('view') || 'board',
    search: params.get('q') || '',
    tier: params.get('tier') || 'all',
    sector: params.get('sector') || 'all',
    chain: params.get('chain') || 'all',
    momentum: params.get('momentum') || 'all',
    sortKey: params.get('sort') || 'rank',
    sortDir: params.get('dir') || 'asc',
    selectedSlug: params.get('slug') || '',
  };

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtUsd = (n) => n == null ? '—' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
  const fmtPct = (v) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

  function getFilteredRows() {
    const q = state.search.trim().toLowerCase();
    const list = DATA.rows.filter((r) => {
      if (state.tier === 'watchlist' && !r.on_watchlist) return false;
      if (state.tier === 'early' && r.on_watchlist) return false;
      if (state.sector !== 'all' && r.sector_group !== state.sector) return false;
      if (state.chain !== 'all' && !r.chains.includes(state.chain)) return false;
      if (state.momentum === 'positive' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (q && !`${r.name} ${r.slug} ${r.category} ${r.chains.join(' ')}`.toLowerCase().includes(q)) return false;
      return true;
    });
    const dir = state.sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va = a[state.sortKey], vb = b[state.sortKey];
      if (state.sortKey === 'change_7d' || state.sortKey === 'months_live') { va = va ?? -9999; vb = vb ?? -9999; }
      return (typeof va === 'string' ? va.localeCompare(vb) : (va ?? 0) - (vb ?? 0)) * dir || a.rank - b.rank;
    });
    return list;
  }

  function renderScatterSvg(rows) {
    const W = 680, H = 200, pad = { l: 52, r: 18, t: 14, b: 26 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const minX = 6.6, maxX = 9.6, minY = 6.3, maxY = 8.3;
    const sx = (v) => pad.l + ((Math.max(minX, Math.min(maxX, Math.log10(Math.max(1, v)))) - minX) / (maxX - minX)) * iw;
    const sy = (v) => pad.t + ih - ((Math.max(minY, Math.min(maxY, Math.log10(Math.max(1, v)))) - minY) / (maxY - minY)) * ih;
    const gridX = [7, 8, 9].map((e) => ({ x: pad.l + ((e - minX) / (maxX - minX)) * iw, lbl: e === 7 ? '$10M' : e === 8 ? '$100M' : '$1B' }));
    const gridY = [6.7, 7.3, 8.0].map((e) => ({ y: pad.t + ih - ((e - minY) / (maxY - minY)) * ih, lbl: e < 7 ? '$5M' : e < 7.5 ? '$20M' : '$100M' }));

    const dots = rows.map((r) => {
      const sel = r.slug === state.selectedSlug;
      return `<circle class="scatter-dot" data-slug="${esc(r.slug)}" cx="${sx(r.tvl_usd).toFixed(1)}" cy="${sy(r.implied_value_usd).toFixed(1)}" r="${sel ? 6.2 : r.on_watchlist ? 4.3 : 3.0}" fill="${SECTOR_COLORS[r.sector_group] || '#94a3b8'}" fill-opacity="${sel ? 1 : r.on_watchlist ? 0.92 : 0.65}" stroke="${sel ? '#fff' : r.on_watchlist ? '#0b0f14' : 'none'}" stroke-width="${sel ? 2 : 1}" style="cursor:pointer"></circle>`;
    }).join('');

    const placed = [];
    const labels = rows.slice(0, 10).map((r) => {
      const px = sx(r.tvl_usd), py = sy(r.implied_value_usd), txt = r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name;
      const w = txt.length * 6.2 + 8, h = 13;
      for (const [cx, cy] of [[px + 8, py - 6], [px - 8 - w, py - 6], [px + 8, py + 12], [px - 8 - w, py + 12]]) {
        const x0 = Math.max(pad.l + 2, Math.min(W - pad.r - w - 2, cx)), y0 = Math.max(pad.t + 10, Math.min(H - pad.b - 4, cy));
        const box = { x1: x0 - 3, y1: y0 - h, x2: x0 + w + 3, y2: y0 + 3 };
        if (!placed.some((b) => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2))) {
          placed.push(box);
          return `<text x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" fill="#dbe6f5" font-size="10" font-weight="600">${esc(txt)}</text>`;
        }
      }
      return '';
    }).join('');

    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="TVL vs Expected Launch Value">${gridX.map((g) => `<line x1="${g.x}" y1="${pad.t}" x2="${g.x}" y2="${H - pad.b}" stroke="#1f2a3c" stroke-dasharray="3 3"/><text x="${g.x}" y="${H - 8}" fill="#687a94" font-size="10" text-anchor="middle">${g.lbl} TVL</text>`).join('')}${gridY.map((g) => `<line x1="${pad.l}" y1="${g.y}" x2="${W - pad.r}" y2="${g.y}" stroke="#1f2a3c" stroke-dasharray="3 3"/><text x="${pad.l - 6}" y="${g.y + 3}" fill="#687a94" font-size="10" text-anchor="end">${g.lbl}</text>`).join('')}${dots}${labels}</svg>`;
  }

  function renderSectorBars() {
    const sectors = DATA.model.sector_multiples, maxM = Math.max(...sectors.map((s) => s.median_mcap_tvl), 0.5);
    const bars = sectors.map((s) => `<div style="margin-bottom:7px"><div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:2px"><span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${SECTOR_COLORS[s.group]};margin-right:6px"></span>${esc(s.label)} <span style="color:var(--muted)">(${s.count})</span></span><span class="num" style="font-weight:700">${s.median_mcap_tvl.toFixed(2)}x MCap/TVL</span></div><div style="height:6px;background:var(--bg);border-radius:4px;overflow:hidden;border:1px solid var(--border)"><div style="width:${Math.max(8, Math.round((s.median_mcap_tvl / maxM) * 100))}%;height:100%;background:${SECTOR_COLORS[s.group]}"></div></div></div>`).join('');
    const s1 = DATA.model.stage1_validation[1], s2 = DATA.model.stage2_validation[1];
    return `${bars}<div style="margin-top:8px;padding:7px 9px;background:var(--bg);border:1px solid var(--border);border-radius:6px;font-size:11px;color:var(--text-2)"><b style="color:var(--emerald)">Two-Split Blind Proof:</b> Stage 1 Odds Split A AUC <b class="num">${s1.split_a_auc}</b> (vs 0.530 TVL) · Stage 2 Split A ρ <b class="num">${s2.split_a.spearman_rho}</b>, Split B MedAPE <b class="num">${s2.split_b.medape_pct}%</b></div>`;
  }

  function renderInspector(row, fullMode = false) {
    if (!row) return '<div class="inspector">No protocol matches active filters.</div>';
    const lo = Math.log10(Math.max(1e5, row.band_p10_usd)), hi = Math.log10(Math.max(1e6, row.band_p90_usd)), span = Math.max(0.2, hi - lo);
    const pct = (v) => Math.max(0, Math.min(100, ((Math.log10(Math.max(1e5, v)) - lo) / span) * 100));
    const p25 = pct(row.band_p25_usd), p75 = pct(row.band_p75_usd), p50 = pct(row.implied_value_usd), f = row.factors;

    const leftBlock = `<div>
      <div class="detail-header"><div>
        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap"><span class="pill cyan num">#${row.rank}</span><h2 class="detail-title">${esc(row.name)}</h2><span class="pill ${row.on_watchlist ? 'emerald' : 'amber'}">${esc(row.tier)}</span></div>
        <div class="proto-meta" style="margin-top:4px;font-size:11.5px;color:var(--text-2)">${esc(row.category)} · ${row.chains.slice(0, 4).map(esc).join(', ')}${row.chains.length > 4 ? ` +${row.chains.length - 4}` : ''} · Records no token on DefiLlama</div>
      </div>${!fullMode ? '<button class="chip" id="openFullDetailBtn">Full Playbook</button>' : ''}</div>
      <div class="detail-metrics">
        <div class="mini-box"><div class="lbl">Expected Value (EV)</div><div class="val num" style="color:var(--cyan)">${fmtUsd(row.implied_value_usd)}</div></div>
        <div class="mini-box"><div class="lbl">Launch FDV × Odds</div><div class="val num">${fmtUsd(row.implied_launch_fdv_usd)} <span style="color:var(--emerald);font-size:11px">× ${Math.round(row.launch_odds * 100)}%</span></div></div>
        <div class="mini-box"><div class="lbl">TVL / 7d / Age</div><div class="val num" style="font-size:12px">${fmtUsd(row.tvl_usd)} · <span class="${row.change_7d > 0 ? 'pos' : row.change_7d < 0 ? 'neg' : ''}">${fmtPct(row.change_7d)}</span> · ${row.months_live ? row.months_live + 'm' : 'n/a'}</div></div>
      </div>
      <div class="section-label">Empirical Valuation Band (P10–P90 OOF Residual Quantiles)</div>
      <div class="band-bar">
        <div class="band-labels num"><span>P10: ${fmtUsd(row.band_p10_usd)}</span><span>P25: ${fmtUsd(row.band_p25_usd)}</span><span style="color:var(--emerald);font-weight:700">EV: ${fmtUsd(row.implied_value_usd)}</span><span>P75: ${fmtUsd(row.band_p75_usd)}</span><span>P90: ${fmtUsd(row.band_p90_usd)}</span></div>
        <div class="band-track"><div class="band-outer" style="left:0;width:100%"></div><div class="band-inner" style="left:${p25.toFixed(1)}%;width:${Math.max(4, p75 - p25).toFixed(1)}%"></div><div class="band-median" style="left:${p50.toFixed(1)}%"></div></div>
      </div>
      <div class="section-label">2-Stage Model Decomposition (TVL + 7d Δ + Age + Sector + Chains)</div>
      <div class="factor-list">
        <div class="factor-row"><span>1. Reference Pool MCap Anchor</span><span class="num">${fmtUsd(f.base_mcap_anchor_usd)}</span></div>
        <div class="factor-row"><span>2. TVL Scale Elasticity (${fmtUsd(row.tvl_usd)})</span><span class="num ${f.tvl_scale_mult >= 1 ? 'pos' : 'neg'}">${f.tvl_scale_mult.toFixed(2)}x</span></div>
        <div class="factor-row"><span>3. EB Sector Multiple (${esc(row.category)})</span><span class="num ${f.sector_mult >= 1 ? 'pos' : 'neg'}">${f.sector_mult.toFixed(2)}x</span></div>
        <div class="factor-row"><span>4. TGE Float Expansion (25% Circ → FDV)</span><span class="num">${f.tge_float_mult.toFixed(1)}x</span></div>
        <div class="factor-row"><span>5. 7d Velocity (${fmtPct(row.change_7d)}) × Multi-Chain (${row.chains.length})</span><span class="num">${(f.momentum_7d_mult * f.chain_breadth_mult).toFixed(3)}x</span></div>
        <div class="factor-row"><span>6. Stage-1 Token Odds (TVL + 7d Δ + ${row.months_live ? row.months_live + 'm' : 'n/a'} Age)</span><span class="num pos">${Math.round(f.launch_odds_mult * 100)}%</span></div>
      </div>
    </div>`;

    const rightBlock = `<div>
      <div class="section-label" style="margin-top:${fullMode ? '0' : '10px'}">Actionable Farming Playbook</div>
      <div class="farm-meta">
        <div class="mini-box"><div class="lbl">Est. Gas Budget</div><div style="font-size:11.5px;margin-top:2px">${esc(row.est_gas_cost)}</div></div>
        <div class="mini-box"><div class="lbl">Cadence &amp; Horizon</div><div style="font-size:11.5px;margin-top:2px">${esc(row.time_commitment)}</div></div>
      </div>
      <ol class="step-list">${row.farm_steps.map((st) => `<li>${esc(st)}</li>`).join('')}</ol>
      <div style="margin-top:5px;font-size:11px;color:var(--amber)">Risk check: ${esc(row.risk_note)}</div>
      <div class="section-label">Nearest Tokenized Peers (Snapshot Ground Truth)</div>
      <table class="peers-table"><thead><tr><th>Peer</th><th>Sector</th><th class="right">TVL</th><th class="right">MCap</th><th class="right">Mult</th></tr></thead>
      <tbody>${row.comparables.map((c) => `<tr><td><b>${esc(c.name)}</b> <span style="color:var(--muted)">${esc(c.symbol || '')}</span></td><td style="color:var(--text-2)">${esc(c.category)}</td><td class="right num">${fmtUsd(c.tvl_usd)}</td><td class="right num">${fmtUsd(c.mcap_usd)}</td><td class="right num">${c.mcap_tvl_ratio.toFixed(2)}x</td></tr>`).join('')}</tbody></table>
    </div>`;

    return fullMode ? `<div class="detail-full-grid"><div class="panel">${leftBlock}</div><div class="panel">${rightBlock}</div></div>` : `<aside class="inspector">${leftBlock}${rightBlock}</aside>`;
  }

  function renderModelAuditView() {
    const m = DATA.model, a = DATA.filter_audit;
    return `<div class="audit-grid"><div class="panel">
      <div class="panel-head"><h3 class="panel-title">Stage 1: Token Odds Logistic Model (${m.stage1_universe_size} Protocols)</h3><span class="panel-sub">Cutoff ${esc(m.temporal_cutoff_stage1)}</span></div>
      <table class="radar-table"><thead><tr><th>Features</th><th class="right">Split A AUC</th><th class="right">Split A Brier</th><th class="right">Split B AUC</th><th class="right">Split B Brier</th></tr></thead>
      <tbody>${m.stage1_validation.map((s) => `<tr><td><b>${esc(s.label)}</b></td><td class="right num">${s.split_a_auc}</td><td class="right num">${s.split_a_brier}</td><td class="right num">${s.split_b_auc}</td><td class="right num">${s.split_b_brier}</td></tr>`).join('')}</tbody></table>
      <div class="panel-head" style="margin-top:12px"><h3 class="panel-title">Stage 2: Circulating MCap Huber-Ridge (${m.stage2_ref_size} DeFi Peers)</h3><span class="panel-sub">Cutoff ${esc(m.temporal_cutoff_stage2)} · 25% TGE float → FDV</span></div>
      <table class="radar-table"><thead><tr><th>Model</th><th class="right">Split A MAE</th><th class="right">Split A MedAPE</th><th class="right">Split A Rho</th><th class="right">Split B MedAPE</th><th class="right">Split B Rho</th></tr></thead>
      <tbody>${m.stage2_validation.map((s) => `<tr><td><b>${esc(s.label)}</b></td><td class="right num">${s.split_a.mae_log10}</td><td class="right num">${s.split_a.medape_pct}%</td><td class="right num">${s.split_a.spearman_rho}</td><td class="right num">${s.split_b.medape_pct}%</td><td class="right num">${s.split_b.spearman_rho}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="panel">
      <div class="panel-head"><h3 class="panel-title">Audited Pre-Token Universe Funnel</h3><span class="panel-sub">Zero wrappers or live-token derivatives</span></div>
      <div class="funnel-row"><span>Total DefiLlama snapshot protocols</span><b class="num">${a.total_protocols}</b></div>
      <div class="funnel-row"><span>Excluded: live token recorded (gecko_id / symbol)</span><span class="num neg">-${a.excluded_live_token}</span></div>
      <div class="funnel-row"><span>Excluded: CEX / Bridge / Liquid Staking / Wrapper</span><span class="num neg">-${a.excluded_category}</span></div>
      <div class="funnel-row"><span>Excluded: versioned deployment (V2, V3, 2.0)</span><span class="num neg">-${a.excluded_versioned}</span></div>
      <div class="funnel-row"><span>Excluded: wrapper word or parent brand sibling</span><span class="num neg">-${a.excluded_wrapper_word + a.excluded_cex_prefix + a.excluded_parent_brand}</span></div>
      <div class="funnel-row" style="background:var(--emerald-dim);border-radius:6px;border:0;margin-top:6px"><b>Retained Clean Radar (${a.retained_watchlist} Watchlist + ${a.retained_early_discovery} Early)</b><b class="num pos">${a.retained_total}</b></div>
    </div></div>
    <div class="panel">
      <div class="panel-head"><h3 class="panel-title">Separated Live-Token Reference Universe</h3><span class="panel-sub">Excluded from pre-token board; used to calibrate odds &amp; multiples</span></div>
      <table class="radar-table"><thead><tr><th>Protocol</th><th>Ticker</th><th>Category</th><th class="right">TVL</th><th class="right">Observed MCap</th><th class="right">MCap / TVL</th></tr></thead>
      <tbody>${DATA.tokenized_peers_sample.slice(0, 10).map((p) => `<tr><td><b>${esc(p.name)}</b></td><td><span class="pill">${esc(p.symbol || 'TOKEN')}</span></td><td>${esc(p.category)}</td><td class="right num">${fmtUsd(p.tvl_usd)}</td><td class="right num">${fmtUsd(p.mcap_usd)}</td><td class="right num">${p.multiple.toFixed(2)}x</td></tr>`).join('')}</tbody></table>
    </div>`;
  }

  function render() {
    const filtered = getFilteredRows();
    if (!filtered.some((r) => r.slug === state.selectedSlug) && filtered[0]) state.selectedSlug = filtered[0].slug;
    const selected = DATA.rows.find((r) => r.slug === state.selectedSlug) || filtered[0] || DATA.rows[0];
    const s1 = DATA.model.stage1_validation[1], s2 = DATA.model.stage2_validation[1];
    const filteredTvl = filtered.reduce((s, r) => s + r.tvl_usd, 0), filteredEv = filtered.reduce((s, r) => s + r.implied_value_usd, 0);

    const topBar = `<header class="topbar">
      <div class="brand"><div class="brand-mark">TR</div><div><h1>TOKEN RADAR <span style="color:var(--cyan)">// PRE-TOKEN ALPHA</span></h1><div class="brand-sub">Snapshot ${esc(DATA.meta.as_of)} · ${DATA.meta.total_tracked_targets} Pre-Token Targets · ${DATA.filter_audit.excluded_live_token} Live Tokens Separated</div></div></div>
      <div class="meta-pill-row"><span class="pill emerald">Stage 1 Odds: Split A AUC ${s1.split_a_auc} · Split B Brier ${s1.split_b_brier}</span><span class="pill cyan">Stage 2 Val: Split A ρ ${s2.split_a.spearman_rho} · Split B MedAPE ${s2.split_b.medape_pct}%</span></div>
      <nav class="nav-tabs" aria-label="Views"><button class="tab-btn ${state.view === 'board' ? 'active' : ''}" data-tab="board">Radar Board</button><button class="tab-btn ${state.view === 'detail' ? 'active' : ''}" data-tab="detail">Protocol Playbook</button><button class="tab-btn ${state.view === 'model' ? 'active' : ''}" data-tab="model">Model &amp; Audit</button></nav>
    </header>`;

    let bodyHtml = '';
    if (state.view === 'model') bodyHtml = renderModelAuditView();
    else if (state.view === 'detail') {
      bodyHtml = `<div class="filter-bar" style="justify-content:space-between"><div style="display:flex;align-items:center;gap:8px"><span style="color:var(--text-2);font-weight:600">Inspect Protocol:</span><select id="detailSelect" class="select-input">${DATA.rows.map((r) => `<option value="${esc(r.slug)}" ${r.slug === selected.slug ? 'selected' : ''}>#${r.rank} ${esc(r.name)} (${fmtUsd(r.implied_value_usd)} EV)</option>`).join('')}</select></div><button class="chip" data-tab="board">Back to Radar Board</button></div>${renderInspector(selected, true)}`;
    } else {
      const sa = (k) => (state.sortKey === k ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '');
      bodyHtml = `<section class="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Active Radar Targets</div><div class="kpi-val num">${filtered.length} <span style="font-size:12px;color:var(--muted)">/ ${DATA.meta.total_tracked_targets}</span></div><div class="kpi-sub">${filtered.filter((r) => r.on_watchlist).length} Watchlist · ${filtered.filter((r) => !r.on_watchlist).length} Early</div></div>
        <div class="kpi-card"><div class="kpi-label">Addressable TVL (Filtered)</div><div class="kpi-val num">${fmtUsd(filteredTvl)}</div><div class="kpi-sub">Total Radar TVL ${fmtUsd(DATA.meta.total_pretoken_tvl_usd)}</div></div>
        <div class="kpi-card"><div class="kpi-label">Expected Launch Value</div><div class="kpi-val num" style="color:var(--cyan)">${fmtUsd(filteredEv)}</div><div class="kpi-sub">EV = Launch FDV × P(Token)</div></div>
        <div class="kpi-card"><div class="kpi-label">Top Opportunity</div><div class="kpi-val" style="font-size:15px">${esc(filtered[0] ? filtered[0].name : '—')}</div><div class="kpi-sub num">${filtered[0] ? fmtUsd(filtered[0].implied_value_usd) + ' EV (' + Math.round(filtered[0].launch_odds * 100) + '% odds)' : ''}</div></div>
        <div class="kpi-card"><div class="kpi-label">Pre-Token Purity</div><div class="kpi-val num pos">100%</div><div class="kpi-sub">${DATA.filter_audit.excluded_live_token} live + ${DATA.filter_audit.excluded_category + DATA.filter_audit.excluded_versioned + DATA.filter_audit.excluded_wrapper_word + DATA.filter_audit.excluded_parent_brand} wrappers dropped</div></div>
      </section>
      <section class="charts-row">
        <div class="panel"><div class="panel-head"><h3 class="panel-title">Log-Scale TVL vs. Expected Launch Value (FDV × P(Token))</h3><span class="panel-sub">Click any node · Large dots = Watchlist ($50M+ floor)</span></div>${renderScatterSvg(filtered)}</div>
        <div class="panel"><div class="panel-head"><h3 class="panel-title">Sector Multiples &amp; Held-Out Proof</h3><span class="panel-sub">Fit on ${DATA.model.stage2_ref_size} DeFi peers</span></div>${renderSectorBars()}</div>
      </section>
      <section class="filter-bar">
        <input id="searchInput" class="search-input" type="search" placeholder="Search protocol, slug, category, chain..." value="${esc(state.search)}">
        <div class="chip-group"><button class="chip ${state.tier === 'all' ? 'active' : ''}" data-tier="all">All (${DATA.rows.length})</button><button class="chip ${state.tier === 'watchlist' ? 'active' : ''}" data-tier="watchlist">Watchlist (${DATA.meta.watchlist_count})</button><button class="chip ${state.tier === 'early' ? 'active' : ''}" data-tier="early">Early (${DATA.meta.early_discovery_count})</button></div>
        <select id="sectorSelect" class="select-input"><option value="all" ${state.sector === 'all' ? 'selected' : ''}>All Sectors</option><option value="trading" ${state.sector === 'trading' ? 'selected' : ''}>Trading &amp; Perps</option><option value="credit_rwa" ${state.sector === 'credit_rwa' ? 'selected' : ''}>Credit, CDP &amp; RWA</option><option value="yield_alloc" ${state.sector === 'yield_alloc' ? 'selected' : ''}>Yield &amp; Curators</option><option value="infra" ${state.sector === 'infra' ? 'selected' : ''}>Infra, AI &amp; Chains</option></select>
        <select id="chainSelect" class="select-input"><option value="all" ${state.chain === 'all' ? 'selected' : ''}>All Chains</option>${DATA.meta.top_chains.map((c) => `<option value="${esc(c.chain)}" ${state.chain === c.chain ? 'selected' : ''}>${esc(c.chain)} (${c.count})</option>`).join('')}</select>
        <button class="chip ${state.momentum === 'positive' ? 'active' : ''}" id="momToggle">7d Growth &gt; 0%</button><button class="reset-btn" id="resetFilters">Reset</button>
      </section>
      <section class="workspace-split">
        <div class="table-wrap"><div class="table-scroll"><table class="radar-table">
          <thead><tr><th data-sort="rank">#${sa('rank')}</th><th data-sort="name">Protocol${sa('name')}</th><th data-sort="category">Sector${sa('category')}</th><th class="right" data-sort="tvl_usd">TVL${sa('tvl_usd')}</th><th class="right" data-sort="change_7d">7d Δ${sa('change_7d')}</th><th class="right" data-sort="months_live">Age${sa('months_live')}</th><th class="right" data-sort="launch_odds">Odds${sa('launch_odds')}</th><th class="right" data-sort="implied_value_usd">Implied EV${sa('implied_value_usd')}</th></tr></thead>
          <tbody>${filtered.map((r) => `<tr data-slug="${esc(r.slug)}" class="${r.slug === selected.slug ? 'selected' : ''}"><td class="num">${r.rank}</td><td><div class="proto-name">${r.on_watchlist ? '<span class="wl-dot"></span>' : ''}${esc(r.name)}</div><div class="proto-meta">${esc(r.primary_chain)}${r.chains.length > 1 ? ` +${r.chains.length - 1}` : ''}</div></td><td><span class="pill">${esc(r.category)}</span></td><td class="right num">${fmtUsd(r.tvl_usd)}</td><td class="right num ${r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : ''}">${fmtPct(r.change_7d)}</td><td class="right num">${r.months_live ? r.months_live + 'm' : 'n/a'}</td><td class="right num">${Math.round(r.launch_odds * 100)}%</td><td class="right num" style="font-weight:700;color:var(--cyan)">${fmtUsd(r.implied_value_usd)}</td></tr>`).join('')}</tbody>
        </table></div></div>
        ${renderInspector(selected, false)}
      </section>`;
    }

    root.innerHTML = `${topBar}${bodyHtml}<footer class="disclaimer"><span>Live browser calculation via dashboard/model.js on ${esc(DATA.meta.as_of)} snapshot; DefiLlama absence of ticker is not proof no token exists.</span><span class="num">Zero-network offline artifact</span></footer>`;

    root.querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => { state.view = el.getAttribute('data-tab'); render(); }));
    const openFull = root.querySelector('#openFullDetailBtn');
    if (openFull) openFull.addEventListener('click', () => { state.view = 'detail'; render(); });
    const detailSel = root.querySelector('#detailSelect');
    if (detailSel) detailSel.addEventListener('change', (e) => { state.selectedSlug = e.target.value; render(); });
    const searchEl = root.querySelector('#searchInput');
    if (searchEl) searchEl.addEventListener('input', (e) => { state.search = e.target.value; render(); const a = root.querySelector('#searchInput'); if (a) { a.focus(); a.setSelectionRange(a.value.length, a.value.length); } });
    root.querySelectorAll('[data-tier]').forEach((el) => el.addEventListener('click', () => { state.tier = el.getAttribute('data-tier'); render(); }));
    const secSel = root.querySelector('#sectorSelect');
    if (secSel) secSel.addEventListener('change', (e) => { state.sector = e.target.value; render(); });
    const chSel = root.querySelector('#chainSelect');
    if (chSel) chSel.addEventListener('change', (e) => { state.chain = e.target.value; render(); });
    const momBtn = root.querySelector('#momToggle');
    if (momBtn) momBtn.addEventListener('click', () => { state.momentum = state.momentum === 'positive' ? 'all' : 'positive'; render(); });
    const rstBtn = root.querySelector('#resetFilters');
    if (rstBtn) rstBtn.addEventListener('click', () => { state.search = ''; state.tier = 'all'; state.sector = 'all'; state.chain = 'all'; state.momentum = 'all'; state.sortKey = 'rank'; state.sortDir = 'asc'; render(); });
    root.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => { const k = th.getAttribute('data-sort'); if (state.sortKey === k) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; else { state.sortKey = k; state.sortDir = ['rank', 'name', 'category'].includes(k) ? 'asc' : 'desc'; } render(); }));
    root.querySelectorAll('tr[data-slug], .scatter-dot[data-slug]').forEach((el) => el.addEventListener('click', () => { state.selectedSlug = el.getAttribute('data-slug'); render(); }));
  }

  render();
})();
