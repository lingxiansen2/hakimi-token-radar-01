(() => {
  const RAW = window.__TOKEN_RADAR_SNAPSHOT__, ENG = window.TokenRadarEngine, root = document.getElementById('app');
  if (!RAW || !ENG || !root) { if (root) root.textContent = 'Missing offline snapshot or TokenRadarEngine.'; return; }

  // Execute identical empirical 2-stage model & pre-token partition live in the browser
  const DATA = ENG.runBoardPipeline(RAW);
  const SCOL = { trading: '#38bdf8', credit_rwa: '#10b981', yield_alloc: '#a78bfa', infra: '#f59e0b', other: '#94a3b8' };
  const P = new URLSearchParams(window.location.search);
  const st = {
    view: P.get('view') || 'board',
    capTier: ['k1', 'k10', 'k50'].includes(P.get('cap')) ? P.get('cap') : 'k10',
    search: P.get('q') || '', tier: P.get('tier') || 'all', verdict: P.get('verdict') || 'all',
    sector: P.get('sector') || 'all', chain: P.get('chain') || 'all', momentum: P.get('momentum') || 'all',
    sortKey: P.get('sort') || 'rank', sortDir: P.get('dir') || 'asc', selectedSlug: P.get('slug') || '',
  };

  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const usd = (n) => n == null ? '—' : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`;
  const pct = (v) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  const vCls = (v) => v === 'FARM' ? 'emerald' : v === 'WATCH' ? 'amber' : 'rose';
  const sCls = (s) => s === 'kept' ? 'emerald' : s === 'baseline' ? 'cyan' : 'rose';
  const pill = (c, t) => `<span class="pill ${c}">${t}</span>`;
  const mb = (l, v) => `<div class="mini-box"><div class="lbl">${l}</div><div class="val num">${v}</div></div>`;
  const td = (v, c = '') => `<td class="${c}">${v}</td>`;
  const rTd = (v, c = '') => `<td class="right num ${c}">${v}</td>`;
  const tOf = (r) => r.tiers[st.capTier] || r.tiers.k10;
  const tLbl = () => st.capTier === 'k1' ? '$1k' : st.capTier === 'k50' ? '$50k' : '$10k';
  const sgn = (v, d = 3) => `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
  const dCls = (v) => v > 0 ? 'pos' : v < 0 ? 'neg' : '';

  function getFiltered() {
    const q = st.search.trim().toLowerCase();
    const list = DATA.rows.filter((r) => {
      if (st.tier === 'watchlist' && !r.on_watchlist) return false;
      if (st.tier === 'early' && r.on_watchlist) return false;
      if (st.verdict !== 'all' && tOf(r).verdict !== st.verdict) return false;
      if (st.sector !== 'all' && r.sector_group !== st.sector) return false;
      if (st.chain !== 'all' && !r.chains.includes(st.chain)) return false;
      if (st.momentum === 'positive' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      return !q || `${r.name} ${r.slug} ${r.category} ${r.chains.join(' ')}`.toLowerCase().includes(q);
    });
    const dir = st.sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va = st.sortKey === 'hourly_ev' ? tOf(a).hr : a[st.sortKey], vb = st.sortKey === 'hourly_ev' ? tOf(b).hr : b[st.sortKey];
      if (st.sortKey === 'change_7d' || st.sortKey === 'months_live') { va = va ?? -9999; vb = vb ?? -9999; }
      return (typeof va === 'string' ? va.localeCompare(vb) : (va ?? 0) - (vb ?? 0)) * dir || a.rank - b.rank;
    });
    return list;
  }

  function renderScatter(rows) {
    const W = 580, H = 138, pad = { l: 44, r: 16, t: 10, b: 18 }, iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const sx = (v) => pad.l + ((Math.max(6.6, Math.min(9.6, Math.log10(Math.max(1, v)))) - 6.6) / 3.0) * iw;
    const sy = (v) => pad.t + ih - ((Math.max(5.9, Math.min(7.85, Math.log10(Math.max(1, v)))) - 5.9) / 1.95) * ih;
    const gx = [7, 8, 9].map((e) => ({ x: pad.l + ((e - 6.6) / 3.0) * iw, l: e === 7 ? '$10M' : e === 8 ? '$100M' : '$1B' }));
    const gy = [6.3, 7.0, 7.6].map((e) => ({ y: pad.t + ih - ((e - 5.9) / 1.95) * ih, l: e < 6.5 ? '$2M' : e === 7 ? '$10M' : '$40M' }));
    const dots = rows.map((r) => {
      const sel = r.slug === st.selectedSlug;
      return `<circle class="scatter-dot" data-slug="${esc(r.slug)}" cx="${sx(r.tvl_usd).toFixed(1)}" cy="${sy(r.implied_value_usd).toFixed(1)}" r="${sel ? 5.5 : r.on_watchlist ? 3.8 : 2.6}" fill="${SCOL[r.sector_group] || '#94a3b8'}" fill-opacity="${sel ? 1 : r.on_watchlist ? 0.92 : 0.65}" stroke="${sel ? '#fff' : r.on_watchlist ? '#080c12' : 'none'}" stroke-width="${sel ? 1.8 : 0.9}" style="cursor:pointer"/>`;
    }).join('');
    const placed = rows.slice(0, 12).map((r) => { const x = sx(r.tvl_usd), y = sy(r.implied_value_usd); return { x1: x - 5, y1: y - 5, x2: x + 5, y2: y + 5 }; });
    const labels = rows.slice(0, 8).map((r) => {
      const px = sx(r.tvl_usd), py = sy(r.implied_value_usd), txt = r.name.length > 26 ? r.name.slice(0, 24) + '…' : r.name, w = txt.length * 5.2 + 8;
      for (const [cx, cy] of [[px + 8, py - 4], [px - 8 - w, py - 4], [px + 8, py + 12], [px - 8 - w, py + 12], [px + 8, py - 14], [px - 8 - w, py + 20]]) {
        const x0 = Math.max(pad.l + 2, Math.min(W - pad.r - w - 2, cx)), y0 = Math.max(pad.t + 10, Math.min(H - pad.b - 3, cy));
        const box = { x1: x0 - 2, y1: y0 - 10, x2: x0 + w + 2, y2: y0 + 3 };
        if (!placed.some((b) => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2))) {
          placed.push(box);
          return `<text x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" fill="#dce7f5" font-size="8.8" font-weight="600">${esc(txt)}</text>`;
        }
      }
      return '';
    }).join('');
    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="TVL vs EV">${gx.map((g) => `<line x1="${g.x}" y1="${pad.t}" x2="${g.x}" y2="${H - pad.b}" stroke="#1c2738" stroke-dasharray="3 3"/><text x="${g.x}" y="${H - 5}" fill="#6b7d97" font-size="9" text-anchor="middle">${g.l} TVL</text>`).join('')}${gy.map((g) => `<line x1="${pad.l}" y1="${g.y}" x2="${W - pad.r}" y2="${g.y}" stroke="#1c2738" stroke-dasharray="3 3"/><text x="${pad.l - 4}" y="${g.y + 3}" fill="#6b7d97" font-size="9" text-anchor="end">${g.l}</text>`).join('')}${dots}${labels}</svg>`;
  }

  function renderBoardAblation() {
    const s2 = DATA.model.stage2_ablation, s1k = DATA.model.stage1_validation[3], s1d = DATA.model.stage1_validation[4];
    const rows = s2.map((s) => `<tr>${td(`<b>${esc(s.label)}</b>`)}${td(pill(sCls(s.status), s.status.toUpperCase()))}${rTd(s.cv2.r2.toFixed(3))}${rTd(s.status === 'baseline' ? '—' : sgn(s.delta_r2), dCls(s.delta_r2))}${rTd(s.cv2.mae_log10.toFixed(3))}${rTd('x' + s.loo.med_factor.toFixed(2))}</tr>`).join('');
    const secs = DATA.model.sector_multiples.slice(0, 4).map((s) => `<span><b style="color:${SCOL[s.group]}">■</b> ${esc(s.label.split(' ')[0])}: <b class="num">${s.median_mcap_tvl.toFixed(2)}x</b></span>`).join('');
    return `<table class="radar-table"><thead><tr><th>Stage 2 Term</th><th>Status</th><th class="right">2F R²</th><th class="right">ΔR²</th><th class="right">OOS MAE</th><th class="right">LOO</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="ab-note"><span><b class="pos">S1 P(Token):</b> Kept TVL+7dΔ+Age+Sec (<b>AUC ${s1k.cv_auc}</b>)</span><span class="neg">Dropped Chains (${s1d.delta_auc})</span></div>
      <div class="sector-strip">${secs}</div>`;
  }

  function renderFullAblation() {
    const s1 = DATA.model.stage1_validation, s2 = DATA.model.stage2_ablation;
    return `<table class="radar-table"><thead><tr><th>Stage 1 P(Token) Term</th><th>Decision</th><th class="right">2F AUC</th><th class="right">ΔAUC</th><th class="right">Brier</th><th class="right">WF AUC</th></tr></thead>
      <tbody>${s1.map((x) => `<tr>${td(`<b>${esc(x.label)}</b>`)}${td(pill(sCls(x.status), x.status.toUpperCase()))}${rTd(x.cv_auc.toFixed(3))}${rTd(x.status === 'baseline' ? '—' : sgn(x.delta_auc), dCls(x.delta_auc))}${rTd(x.cv_brier.toFixed(3))}${rTd(x.wf_auc.toFixed(3))}</tr>`).join('')}</tbody></table>
      <div style="height:6px"></div>
      <table class="radar-table"><thead><tr><th>Stage 2 E[MCap] Term</th><th>Decision</th><th class="right">2F R²</th><th class="right">ΔR²</th><th class="right">MAE</th><th class="right">LOO</th><th class="right">WF</th></tr></thead>
      <tbody>${s2.map((x) => `<tr>${td(`<b>${esc(x.label)}</b>`)}${td(pill(sCls(x.status), x.status.toUpperCase()))}${rTd(x.cv2.r2.toFixed(3))}${rTd(x.status === 'baseline' ? '—' : sgn(x.delta_r2), dCls(x.delta_r2))}${rTd(x.cv2.mae_log10.toFixed(3))}${rTd('x' + x.loo.med_factor.toFixed(2))}${rTd('x' + x.walk_forward.med_factor.toFixed(2))}</tr>`).join('')}</tbody></table>`;
  }

  function renderTierCards(row) {
    return `<div class="tier-grid">${['k1', 'k10', 'k50'].map((k) => {
      const t = row.tiers[k];
      return `<div class="tier-card ${st.capTier === k ? 'active-tier' : ''}"><div class="tier-head"><span>${t.label} Tier</span>${pill(vCls(t.verdict), t.verdict)}</div>
        <div class="tier-line"><span>Cost (${t.hrs}h)</span><span class="num neg">-$${t.friction.toFixed(0)}</span></div>
        <div class="tier-line"><span>Net EV</span><span class="num ${t.net >= 0 ? 'pos' : 'neg'}">${t.net >= 0 ? '+' : '-'}$${Math.abs(Math.round(t.net))}</span></div>
        <div class="tier-line"><span>$/hr · APR</span><span class="num ${t.hr >= 18 ? 'pos' : ''}">${t.hr >= 0 ? '+' : ''}$${t.hr}/h · ${t.apr}%</span></div></div>`;
    }).join('')}</div>`;
  }

  function renderInspector(row, full = false) {
    if (!row) return '<div class="inspector">No protocol matches active filters.</div>';
    const lo = Math.log10(Math.max(5e4, row.band_p10_usd)), hi = Math.log10(Math.max(5e5, row.band_p90_usd)), span = Math.max(0.2, hi - lo);
    const bp = (v) => Math.max(0, Math.min(100, ((Math.log10(Math.max(5e4, v)) - lo) / span) * 100));
    const p25 = bp(row.band_p25_usd), p75 = bp(row.band_p75_usd), p50 = bp(row.implied_value_usd), f = row.factors, t = tOf(row);

    const fRow = (lbl, val, cls = '') => `<div class="factor-row"><span>${lbl}</span><span class="num ${cls}">${val}</span></div>`;
    const left = `<div>
      <div class="detail-header"><div>
        <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">${pill('cyan num', '#' + row.rank)}<h2 class="detail-title">${esc(row.name)}</h2>${pill(vCls(t.verdict), `${t.label}: ${t.verdict} ${t.hr >= 0 ? '+' : ''}$${t.hr}/hr`)}</div>
        <div class="proto-meta" style="margin-top:2px;color:var(--text-2)">${esc(row.category)} · ${row.chains.slice(0, 4).map(esc).join(', ')}${row.chains.length > 4 ? ` +${row.chains.length - 4}` : ''} · Records no token</div>
      </div>${!full ? '<button class="chip" id="openFullDetailBtn">Full Playbook</button>' : ''}</div>
      <div class="detail-metrics">${mb('Expected Value (EV)', usd(row.implied_value_usd))}${mb('E[MCap] × Odds', `${usd(row.cond_mcap_usd)} <span class="pos">× ${Math.round(row.launch_odds * 100)}%</span>`)}${mb('TVL / 7d / Age', `${usd(row.tvl_usd)} · <span class="${dCls(row.change_7d)}">${pct(row.change_7d)}</span> · ${row.months_live ? row.months_live + 'm' : 'n/a'}`)}</div>
      <div class="section-label">Empirical Valuation Band (P10–P90 LOO Residuals)</div>
      <div class="band-bar">
        <div class="band-labels num"><span>P10: ${usd(row.band_p10_usd)}</span><span>P25: ${usd(row.band_p25_usd)}</span><span class="pos"><b>EV: ${usd(row.implied_value_usd)}</b></span><span>P75: ${usd(row.band_p75_usd)}</span><span>P90: ${usd(row.band_p90_usd)}</span></div>
        <div class="band-track"><div class="band-outer" style="left:0;width:100%"></div><div class="band-inner" style="left:${p25.toFixed(1)}%;width:${Math.max(4, p75 - p25).toFixed(1)}%"></div><div class="band-median" style="left:${p50.toFixed(1)}%"></div></div>
      </div>
      <div class="section-label">Fitted Factor Decomposition (Zero Unfitted Constants)</div>
      <div class="${full ? 'factor-list' : 'factor-grid-2'}">
        ${fRow(full ? '1. Reference Pool MCap Anchor' : '1. Pool Anchor', usd(f.base_mcap_anchor_usd))}
        ${fRow(full ? `2. TVL Scale Elasticity (${usd(row.tvl_usd)})` : '2. TVL Scale', f.tvl_scale_mult.toFixed(2) + 'x', f.tvl_scale_mult >= 1 ? 'pos' : 'neg')}
        ${fRow(full ? `3. EB Sector Multiple (${esc(row.category)})` : '3. Sector Mult', f.sector_mult.toFixed(2) + 'x', f.sector_mult >= 1 ? 'pos' : 'neg')}
        ${fRow(full ? `4. Chain Footprint (${row.chains.length} chain${row.chains.length === 1 ? '' : 's'})` : `4. Chains (${row.chains.length})`, f.chain_footprint_mult.toFixed(2) + 'x')}
        ${full ? fRow(`5. Stage-1 Odds (TVL + 7dΔ + ${row.months_live ? row.months_live + 'm' : 'n/a'} Age + Sec)`, Math.round(f.launch_odds_mult * 100) + '%', 'pos') : ''}
      </div>
      ${full ? `<div class="section-label" style="margin-top:6px">Strict 2-Fold Blind Held-Out Ablation (Kept vs Dropped)</div>${renderFullAblation()}` : `<div class="section-label">Multi-Tier Costed Farm Plan ($1k / $10k / $50k)</div>${renderTierCards(row)}<div class="step-preview"><b class="cy">Action:</b> ${esc(row.farm_steps[0])}<br><b class="am">Skip:</b> ${esc(row.farm_steps[4])}</div>`}
    </div>`;

    const right = `<div>
      <div class="section-label" style="margin-top:0">Costed Multi-Tier Unit Economics ($1k / $10k / $50k · 5% Pool)</div>${renderTierCards(row)}
      <div class="section-label">5-Step Costed Actionable Playbook</div><ol class="step-list">${row.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <div class="section-label">Nearest Tokenized Peers (Snapshot Ground Truth)</div>
      <table class="peers-table"><thead><tr><th>Peer</th><th>Sector</th><th class="right">TVL</th><th class="right">MCap</th><th class="right">Mult</th></tr></thead>
      <tbody>${row.comparables.map((c) => `<tr>${td(`<b>${esc(c.name)}</b> <span class="mu">${esc(c.symbol || '')}</span>`)}${td(esc(c.category))}${rTd(usd(c.tvl_usd))}${rTd(usd(c.mcap_usd))}${rTd(c.mcap_tvl_ratio.toFixed(2) + 'x')}</tr>`).join('')}</tbody></table>
    </div>`;

    return full ? `<div class="detail-full-grid"><div class="panel">${left}</div><div class="panel">${right}</div></div>` : `<aside class="inspector">${left}</aside>`;
  }

  function renderAudit() {
    const m = DATA.model, a = DATA.filter_audit, fn = (l, v, c = '') => `<div class="funnel-row"><span>${l}</span><span class="num ${c}">${v}</span></div>`;
    return `<div class="audit-grid"><div class="panel"><div class="panel-head"><h3 class="panel-title">Strict 2-Fold Blind Held-Out Ablation (${m.stage1_universe_size} Census / ${m.stage2_ref_size} Peers)</h3><span class="panel-sub">Zero Leakage · Kept vs Dropped</span></div>${renderFullAblation()}</div>
    <div class="panel"><div class="panel-head"><h3 class="panel-title">Audited Pre-Token Universe Funnel</h3><span class="panel-sub">Zero wrappers or live-token derivatives</span></div>
      ${fn('Total DefiLlama snapshot protocols', `<b>${a.total_protocols}</b>`)}${fn('Excluded: live token recorded (gecko_id / symbol)', '-' + a.excluded_live_token, 'neg')}
      ${fn('Excluded: CEX / Bridge / Liquid Staking / Wrapper', '-' + a.excluded_category, 'neg')}${fn('Excluded: versioned deployment (V2, V3, 2.0)', '-' + a.excluded_versioned, 'neg')}
      ${fn('Excluded: wrapper word or parent brand sibling', '-' + (a.excluded_wrapper_word + a.excluded_cex_prefix + a.excluded_parent_brand), 'neg')}
      <div class="funnel-row" style="background:var(--emerald-dim);border-radius:6px;border:0;margin-top:4px"><b>Retained Clean Radar (${a.retained_watchlist} Watchlist + ${a.retained_early_discovery} Early)</b><b class="num pos">${a.retained_total}</b></div>
    </div></div>
    <div class="panel"><div class="panel-head"><h3 class="panel-title">Separated Live-Token Reference Universe</h3><span class="panel-sub">Excluded from pre-token board; calibrates odds &amp; sector multiples</span></div>
      <table class="radar-table"><thead><tr><th>Protocol</th><th>Ticker</th><th>Category</th><th class="right">TVL</th><th class="right">Observed MCap</th><th class="right">MCap / TVL</th></tr></thead>
      <tbody>${DATA.tokenized_peers_sample.slice(0, 8).map((p) => `<tr>${td(`<b>${esc(p.name)}</b>`)}${td(pill('', esc(p.symbol || 'TOKEN')))}${td(esc(p.category))}${rTd(usd(p.tvl_usd))}${rTd(usd(p.mcap_usd))}${rTd(p.multiple.toFixed(2) + 'x')}</tr>`).join('')}</tbody></table>
    </div>`;
  }

  function render() {
    const flt = getFiltered();
    if (!flt.some((r) => r.slug === st.selectedSlug) && flt[0]) st.selectedSlug = flt[0].slug;
    const sel = DATA.rows.find((r) => r.slug === st.selectedSlug) || flt[0] || DATA.rows[0];
    const s1 = DATA.model.stage1_validation[3], s2k = DATA.model.stage2_ablation[2], a = DATA.filter_audit;
    const vc = DATA.rows.reduce((acc, r) => { acc[tOf(r).verdict]++; return acc; }, { FARM: 0, WATCH: 0, SKIP: 0 });
    const fTvl = flt.reduce((s, r) => s + r.tvl_usd, 0), fEv = flt.reduce((s, r) => s + r.implied_value_usd, 0);
    const vb = (l, v, c) => `<div class="v-badge"><span>${l}</span><span class="${c} num">${v}</span></div>`;
    const kc = (l, v, s, c = '') => `<div class="kpi-card"><div class="kpi-label">${l}</div><div class="kpi-val ${c}">${v}</div><div class="kpi-sub">${s}</div></div>`;

    const topBar = `<header class="topbar">
      <div class="brand"><div class="brand-mark">TR</div><div><h1>TOKEN RADAR <span class="cy">// PRE-TOKEN ALPHA</span></h1><div class="brand-sub">Snapshot ${esc(DATA.meta.as_of)} · ${DATA.meta.total_tracked_targets} Pre-Token Targets · E[MCap] × P(Token)</div></div></div>
      <div class="meta-pill-row">${pill('emerald', 'S1 Blind AUC ' + s1.cv_auc)}${pill('cyan', `S2 2-Fold R² +${s2k.cv2.r2} · LOO x${s2k.loo.med_factor.toFixed(2)}`)}</div>
      <nav class="nav-tabs" aria-label="Views">${[['board', 'Radar Board'], ['detail', 'Protocol Playbook'], ['model', 'Model & Audit']].map(([k, l]) => `<button class="tab-btn ${st.view === k ? 'active' : ''}" data-tab="${k}">${l}</button>`).join('')}</nav>
    </header>
    <div class="verify-strip">${vb('Watchlist', `${DATA.meta.watchlist_count}/${DATA.meta.watchlist_count} WL · ${a.retained_total} Targets`, 'ok')}${vb('Separation', `${a.excluded_live_token} Comps + ${a.total_protocols - a.retained_total - a.excluded_live_token} Wrappers`, 'cy')}${vb('Blind 2-Fold', `AUC ${s1.cv_auc} · R² +${s2k.cv2.r2} · LOO x${s2k.loo.med_factor.toFixed(2)}`, 'ok')}${vb('Farm Plans', `${a.retained_total}/${a.retained_total} Tiers · Live JS`, 'cy')}</div>`;

    let body = '';
    if (st.view === 'model') body = renderAudit();
    else if (st.view === 'detail') {
      body = `<div class="filter-bar" style="justify-content:space-between"><div style="display:flex;align-items:center;gap:8px"><span style="color:var(--text-2);font-weight:600">Inspect Protocol:</span><select id="detailSelect" class="select-input">${DATA.rows.map((r) => `<option value="${esc(r.slug)}" ${r.slug === sel.slug ? 'selected' : ''}>#${r.rank} ${esc(r.name)} (${usd(r.implied_value_usd)} · ${tOf(r).label} ${tOf(r).verdict} ${tOf(r).hr >= 0 ? '+' : ''}$${tOf(r).hr}/hr)</option>`).join('')}</select></div><button class="chip" data-tab="board">Back to Radar Board</button></div>${renderInspector(sel, true)}`;
    } else {
      const sa = (k) => (st.sortKey === k ? (st.sortDir === 'asc' ? ' ▲' : ' ▼') : '');
      const topEv = [...flt].sort((a, b) => b.implied_value_usd - a.implied_value_usd)[0];
      const bestHr = [...flt].sort((a, b) => tOf(b).hr - tOf(a).hr)[0];
      body = `<section class="kpi-grid">
        ${kc('Active Targets', `${flt.length} <span class="mu" style="font-size:11px">/ ${DATA.meta.total_tracked_targets}</span>`, `${flt.filter((r) => r.on_watchlist).length} Watchlist · ${flt.filter((r) => !r.on_watchlist).length} Early`, 'num')}
        ${kc('Filtered TVL', usd(fTvl), `Total ${usd(DATA.meta.total_pretoken_tvl_usd)}`, 'num')}
        ${kc('Expected Launch Value', usd(fEv), 'EV = E[MCap] × P(Token)', 'num cy')}
        ${kc('Top EV Protocol', esc(topEv ? topEv.name : '—'), topEv ? `${usd(topEv.implied_value_usd)} (${Math.round(topEv.launch_odds * 100)}% odds)` : '')}
        ${kc(`Best $/hr (${tLbl()} Tier)`, esc(bestHr ? bestHr.name : '—'), bestHr ? `${tOf(bestHr).hr >= 0 ? '+' : ''}$${tOf(bestHr).hr}/hr (${tOf(bestHr).apr}% APR)` : '', 'pos')}
      </section>
      <section class="charts-row">
        <div class="panel"><div class="panel-head"><h3 class="panel-title">Log-Scale TVL vs. Expected Launch Value</h3><span class="panel-sub">Click dot · Large = Watchlist ($50M+)</span></div>${renderScatter(flt)}</div>
        <div class="panel"><div class="panel-head"><h3 class="panel-title">Term Selection &amp; Blind Held-Out Ablation (Kept vs Dropped)</h3><span class="panel-sub">Zero-leakage 2-fold CV</span></div>${renderBoardAblation()}</div>
      </section>
      <section class="filter-bar">
        <input id="searchInput" class="search-input" type="search" placeholder="Search protocol, sector, chain..." value="${esc(st.search)}">
        <div class="chip-group">${['k1', 'k10', 'k50'].map((k) => `<button class="chip ${st.capTier === k ? 'tier-active' : ''}" data-cap="${k}">${k === 'k1' ? '$1k' : k === 'k10' ? '$10k' : '$50k'}</button>`).join('')}</div>
        <div class="chip-group">${['all', 'FARM', 'WATCH', 'SKIP'].map((v) => `<button class="chip ${st.verdict === v ? 'active' : ''}" data-verdict="${v}">${v === 'all' ? 'All (' + DATA.rows.length + ')' : v + ' (' + vc[v] + ')'}</button>`).join('')}</div>
        <div class="chip-group"><button class="chip ${st.tier === 'watchlist' ? 'active' : ''}" data-tier="watchlist">WL (${DATA.meta.watchlist_count})</button><button class="chip ${st.tier === 'early' ? 'active' : ''}" data-tier="early">Early (${DATA.meta.early_discovery_count})</button></div>
        <select id="sectorSelect" class="select-input"><option value="all">All Sectors</option>${Object.entries(ENG.SECTOR_LABELS).slice(0, 4).map(([k, l]) => `<option value="${k}" ${st.sector === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <select id="chainSelect" class="select-input"><option value="all">All Chains</option>${DATA.meta.top_chains.map((c) => `<option value="${esc(c.chain)}" ${st.chain === c.chain ? 'selected' : ''}>${esc(c.chain)} (${c.count})</option>`).join('')}</select>
        <button class="chip ${st.momentum === 'positive' ? 'active' : ''}" id="momToggle">7d&gt;0%</button><button class="reset-btn" id="resetFilters">Reset</button>
      </section>
      <section class="workspace-split">
        <div class="table-wrap"><div class="table-scroll"><table class="radar-table">
          <thead><tr><th data-sort="rank">#${sa('rank')}</th><th data-sort="name">Protocol${sa('name')}</th><th data-sort="category">Sector${sa('category')}</th><th class="right" data-sort="tvl_usd">TVL${sa('tvl_usd')}</th><th class="right" data-sort="change_7d">7d Δ${sa('change_7d')}</th><th class="right" data-sort="months_live">Age${sa('months_live')}</th><th class="right" data-sort="launch_odds">Odds${sa('launch_odds')}</th><th class="right" data-sort="implied_value_usd">Expected EV${sa('implied_value_usd')}</th><th class="right" data-sort="hourly_ev">$/hr (${tLbl()})${sa('hourly_ev')}</th></tr></thead>
          <tbody>${flt.map((r) => { const t = tOf(r); return `<tr data-slug="${esc(r.slug)}" class="${r.slug === sel.slug ? 'selected' : ''}">${td(r.rank, 'num')}${td(`<div class="proto-name">${r.on_watchlist ? '<span class="wl-dot"></span>' : ''}${esc(r.name)}</div><div class="proto-meta">${esc(r.primary_chain)}${r.chains.length > 1 ? ` +${r.chains.length - 1}` : ''}</div>`)}${td(pill('', esc(r.category)))}${rTd(usd(r.tvl_usd))}${rTd(pct(r.change_7d), dCls(r.change_7d))}${rTd(r.months_live ? r.months_live + 'm' : 'n/a')}${rTd(Math.round(r.launch_odds * 100) + '%')}${rTd(`<b>${usd(r.implied_value_usd)}</b>`)}${rTd(pill(vCls(t.verdict), `${t.verdict} ${t.hr >= 0 ? '+' : ''}$${t.hr}`))}</tr>`; }).join('')}</tbody>
        </table></div></div>
        ${renderInspector(sel, false)}
      </section>`;
    }

    root.innerHTML = `${topBar}${body}<footer class="disclaimer"><span>Live browser engine (dashboard/model.js) on ${esc(DATA.meta.as_of)} snapshot · ${esc(DATA.model.range_honesty)}</span><span class="num">Zero-network offline artifact</span></footer>`;

    root.querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => { st.view = el.getAttribute('data-tab'); render(); }));
    root.querySelectorAll('[data-cap]').forEach((el) => el.addEventListener('click', () => { st.capTier = el.getAttribute('data-cap'); render(); }));
    const openFull = root.querySelector('#openFullDetailBtn');
    if (openFull) openFull.addEventListener('click', () => { st.view = 'detail'; render(); });
    const detailSel = root.querySelector('#detailSelect');
    if (detailSel) detailSel.addEventListener('change', (e) => { st.selectedSlug = e.target.value; render(); });
    const searchEl = root.querySelector('#searchInput');
    if (searchEl) searchEl.addEventListener('input', (e) => { st.search = e.target.value; render(); const a = root.querySelector('#searchInput'); if (a) { a.focus(); a.setSelectionRange(a.value.length, a.value.length); } });
    root.querySelectorAll('[data-verdict]').forEach((el) => el.addEventListener('click', () => { st.verdict = el.getAttribute('data-verdict'); render(); }));
    root.querySelectorAll('[data-tier]').forEach((el) => el.addEventListener('click', () => { const t = el.getAttribute('data-tier'); st.tier = st.tier === t ? 'all' : t; render(); }));
    const secSel = root.querySelector('#sectorSelect');
    if (secSel) secSel.addEventListener('change', (e) => { st.sector = e.target.value; render(); });
    const chSel = root.querySelector('#chainSelect');
    if (chSel) chSel.addEventListener('change', (e) => { st.chain = e.target.value; render(); });
    const momBtn = root.querySelector('#momToggle');
    if (momBtn) momBtn.addEventListener('click', () => { st.momentum = st.momentum === 'positive' ? 'all' : 'positive'; render(); });
    const rstBtn = root.querySelector('#resetFilters');
    if (rstBtn) rstBtn.addEventListener('click', () => { st.search = ''; st.tier = 'all'; st.verdict = 'all'; st.sector = 'all'; st.chain = 'all'; st.momentum = 'all'; st.sortKey = 'rank'; st.sortDir = 'asc'; render(); });
    root.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => { const k = th.getAttribute('data-sort'); if (st.sortKey === k) st.sortDir = st.sortDir === 'asc' ? 'desc' : 'asc'; else { st.sortKey = k; st.sortDir = ['rank', 'name', 'category'].includes(k) ? 'asc' : 'desc'; } render(); }));
    root.querySelectorAll('tr[data-slug], .scatter-dot[data-slug]').forEach((el) => el.addEventListener('click', () => { st.selectedSlug = el.getAttribute('data-slug'); render(); }));
  }

  render();
})();
