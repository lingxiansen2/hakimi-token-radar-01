(() => {
  const DATA = window.__TOKEN_RADAR_DATA__;
  const root = document.getElementById('app');
  if (!DATA || !root) {
    if (root) root.textContent = 'Missing offline radar dataset (../data.js).';
    return;
  }

  const SECTOR_COLORS = {
    trading: '#38bdf8',
    credit_rwa: '#10b981',
    yield_alloc: '#a78bfa',
    infra: '#f59e0b',
    other: '#94a3b8',
  };

  const params = new URLSearchParams(window.location.search);
  const state = {
    view: params.get('view') || 'board', // 'board' | 'detail' | 'model'
    search: params.get('q') || '',
    tier: params.get('tier') || 'all', // 'all' | 'watchlist' | 'early'
    sector: params.get('sector') || 'all',
    chain: params.get('chain') || 'all',
    momentum: params.get('momentum') || 'all', // 'all' | 'positive'
    sortKey: params.get('sort') || 'rank',
    sortDir: params.get('dir') || 'asc',
    selectedSlug: params.get('slug') || '',
  };

  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const fmtUsd = (n) => {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
    return `$${Math.round(n)}`;
  };

  const fmtPct = (v) => {
    if (v === null || v === undefined) return '—';
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(1)}%`;
  };

  function getFilteredRows() {
    const q = state.search.trim().toLowerCase();
    const list = DATA.rows.filter((r) => {
      if (state.tier === 'watchlist' && !r.on_watchlist) return false;
      if (state.tier === 'early' && r.on_watchlist) return false;
      if (state.sector !== 'all' && r.sector_group !== state.sector) return false;
      if (state.chain !== 'all' && !r.chains.includes(state.chain)) return false;
      if (state.momentum === 'positive' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (q) {
        const hay = `${r.name} ${r.slug} ${r.category} ${r.chains.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const dir = state.sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let va = a[state.sortKey];
      let vb = b[state.sortKey];
      if (state.sortKey === 'change_7d') {
        va = va === null ? -9999 : va;
        vb = vb === null ? -9999 : vb;
      }
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return ((va ?? 0) - (vb ?? 0)) * dir || a.rank - b.rank;
    });
    return list;
  }

  function renderScatterSvg(rows) {
    const W = 680;
    const H = 215;
    const pad = { l: 54, r: 18, t: 14, b: 28 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;

    const minX = 6.6; // ~4M TVL
    const maxX = 9.6; // ~4B TVL
    const minY = 6.0; // 1M
    const maxY = 8.0; // 100M
    const sx = (tvl) => pad.l + ((Math.max(minX, Math.min(maxX, Math.log10(Math.max(1, tvl)))) - minX) / (maxX - minX)) * iw;
    const sy = (val) => pad.t + ih - ((Math.max(minY, Math.min(maxY, Math.log10(Math.max(1, val)))) - minY) / (maxY - minY)) * ih;

    const gridX = [7, 8, 9].map((e) => ({ x: pad.l + ((e - minX) / (maxX - minX)) * iw, lbl: e === 7 ? '$10M' : e === 8 ? '$100M' : '$1B' }));
    const gridY = [6.3, 7, 7.7].map((e) => ({ y: pad.t + ih - ((e - minY) / (maxY - minY)) * ih, lbl: e < 6.5 ? '$2M' : e === 7 ? '$10M' : '$50M' }));

    const dots = rows
      .map((r) => {
        const cx = sx(r.tvl_usd).toFixed(1);
        const cy = sy(r.implied_value_usd).toFixed(1);
        const col = SECTOR_COLORS[r.sector_group] || '#94a3b8';
        const sel = r.slug === state.selectedSlug;
        const rad = sel ? 6.2 : r.on_watchlist ? 4.3 : 3.0;
        const stroke = sel ? '#ffffff' : r.on_watchlist ? '#0b0f14' : 'none';
        const op = sel ? 1 : r.on_watchlist ? 0.92 : 0.65;
        return `<circle class="scatter-dot" data-slug="${esc(r.slug)}" cx="${cx}" cy="${cy}" r="${rad}" fill="${col}" fill-opacity="${op}" stroke="${stroke}" stroke-width="${sel ? 2 : 1}" style="cursor:pointer"></circle>`;
      })
      .join('');

    const labeled = rows.slice(0, 10);
    const placedBoxes = [];
    const labels = labeled
      .map((r) => {
        const px = sx(r.tvl_usd);
        const py = sy(r.implied_value_usd);
        const text = r.name.length > 16 ? r.name.slice(0, 15) + '…' : r.name;
        const w = text.length * 6.2 + 8;
        const h = 13;
        const candidates = [
          [px + 8, py - 6],
          [px - 8 - w, py - 6],
          [px + 8, py + 12],
          [px - 8 - w, py + 12],
        ];
        for (const [cx, cy] of candidates) {
          const x0 = Math.max(pad.l + 2, Math.min(W - pad.r - w - 2, cx));
          const y0 = Math.max(pad.t + 10, Math.min(H - pad.b - 4, cy));
          const box = { x1: x0 - 3, y1: y0 - h, x2: x0 + w + 3, y2: y0 + 3 };
          const overlaps = placedBoxes.some((b) => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2));
          if (!overlaps) {
            placedBoxes.push(box);
            return `<text x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" fill="#dbe6f5" font-size="10" font-weight="600">${esc(text)}</text>`;
          }
        }
        return '';
      })
      .join('');

    return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="TVL vs Implied Launch MCap">
      ${gridX.map((g) => `<line x1="${g.x}" y1="${pad.t}" x2="${g.x}" y2="${H - pad.b}" stroke="#1f2a3c" stroke-dasharray="3 3"/><text x="${g.x}" y="${H - 9}" fill="#687a94" font-size="10" text-anchor="middle">${g.lbl} TVL</text>`).join('')}
      ${gridY.map((g) => `<line x1="${pad.l}" y1="${g.y}" x2="${W - pad.r}" y2="${g.y}" stroke="#1f2a3c" stroke-dasharray="3 3"/><text x="${pad.l - 6}" y="${g.y + 3}" fill="#687a94" font-size="10" text-anchor="end">${g.lbl}</text>`).join('')}
      ${dots}
      ${labels}
    </svg>`;
  }

  function renderSectorBars() {
    const sectors = DATA.model.sector_multiples;
    const maxMult = Math.max(...sectors.map((s) => s.median_mcap_tvl), 0.5);
    return sectors
      .map((s) => {
        const pct = Math.max(8, Math.round((s.median_mcap_tvl / maxMult) * 100));
        const col = SECTOR_COLORS[s.group] || '#94a3b8';
        return `<div style="margin-bottom:9px">
          <div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:3px">
            <span><span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${col};margin-right:6px"></span>${esc(s.label)} <span style="color:var(--muted)">(${s.count} peers)</span></span>
            <span class="num" style="font-weight:700">${s.median_mcap_tvl.toFixed(2)}x MCap/TVL</span>
          </div>
          <div style="height:7px;background:var(--bg);border-radius:4px;overflow:hidden;border:1px solid var(--border)">
            <div style="width:${pct}%;height:100%;background:${col}"></div>
          </div>
        </div>`;
      })
      .join('');
  }

  function renderInspector(row, fullMode = false) {
    if (!row) return '<div class="inspector">No protocol matches active filters.</div>';
    const lo = Math.log10(Math.max(1e5, row.band_p10_usd));
    const hi = Math.log10(Math.max(1e6, row.band_p90_usd));
    const span = Math.max(0.2, hi - lo);
    const pct = (v) => Math.max(0, Math.min(100, ((Math.log10(Math.max(1e5, v)) - lo) / span) * 100));
    const p25 = pct(row.band_p25_usd);
    const p75 = pct(row.band_p75_usd);
    const p50 = pct(row.implied_value_usd);

    const f = row.factors;
    const wrapClass = fullMode ? 'detail-full-grid' : '';
    const leftBlock = `
      <div>
        <div class="detail-header">
          <div>
            <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
              <span class="pill cyan num">#${row.rank}</span>
              <h2 class="detail-title">${esc(row.name)}</h2>
              <span class="pill ${row.on_watchlist ? 'emerald' : 'amber'}">${esc(row.tier)}</span>
            </div>
            <div style="color:var(--text-2);font-size:11.5px;margin-top:4px">
              ${esc(row.category)} · ${row.chains.slice(0, 4).map(esc).join(', ')}${row.chains.length > 4 ? ` +${row.chains.length - 4}` : ''} · Records no token on DefiLlama
            </div>
          </div>
          ${!fullMode ? `<button class="chip" id="openFullDetailBtn">Full Playbook</button>` : ''}
        </div>

        <div class="detail-metrics">
          <div class="mini-box">
            <div class="lbl">Implied Launch</div>
            <div class="val num" style="color:var(--cyan)">${fmtUsd(row.implied_value_usd)}</div>
          </div>
          <div class="mini-box">
            <div class="lbl">Protocol TVL</div>
            <div class="val num">${fmtUsd(row.tvl_usd)}</div>
          </div>
          <div class="mini-box">
            <div class="lbl">7d TVL / Track</div>
            <div class="val num ${row.change_7d > 0 ? 'pos' : row.change_7d < 0 ? 'neg' : ''}">${fmtPct(row.change_7d)} <span style="color:var(--muted);font-size:11px">/ ${row.months_live ? row.months_live + 'm' : 'n/a'}</span></div>
          </div>
        </div>

        <div class="section-label">Empirical Valuation Band (OOF Residual Quantiles)</div>
        <div class="band-bar">
          <div class="band-labels num">
            <span>P10: ${fmtUsd(row.band_p10_usd)}</span>
            <span>P25: ${fmtUsd(row.band_p25_usd)}</span>
            <span style="color:var(--emerald);font-weight:700">Med: ${fmtUsd(row.implied_value_usd)}</span>
            <span>P75: ${fmtUsd(row.band_p75_usd)}</span>
            <span>P90: ${fmtUsd(row.band_p90_usd)}</span>
          </div>
          <div class="band-track">
            <div class="band-outer" style="left:0%;width:100%"></div>
            <div class="band-inner" style="left:${p25.toFixed(1)}%;width:${Math.max(4, p75 - p25).toFixed(1)}%"></div>
            <div class="band-median" style="left:${p50.toFixed(1)}%"></div>
          </div>
        </div>

        <div class="section-label">Factor Decomposition Waterfall</div>
        <div class="factor-list">
          <div class="factor-row"><span>1. Reference Pool Anchor</span><span class="num">${fmtUsd(f.base_anchor_usd)}</span></div>
          <div class="factor-row"><span>2. TVL Scale Elasticity (${fmtUsd(row.tvl_usd)})</span><span class="num ${f.tvl_scale_mult >= 1 ? 'pos' : 'neg'}">${f.tvl_scale_mult.toFixed(2)}x</span></div>
          <div class="factor-row"><span>3. EB Sector Multiple (${esc(row.category)})</span><span class="num ${f.sector_mult >= 1 ? 'pos' : 'neg'}">${f.sector_mult.toFixed(2)}x</span></div>
          <div class="factor-row"><span>4. Chain Footprint (${row.chains.length} chain${row.chains.length === 1 ? '' : 's'})</span><span class="num">${f.chain_footprint_mult.toFixed(2)}x</span></div>
        </div>
      </div>
    `;

    const rightBlock = `
      <div>
        <div class="section-label" style="margin-top:${fullMode ? '0' : '12px'}">Actionable Farming Playbook</div>
        <div class="farm-meta">
          <div class="mini-box"><div class="lbl">Est. Gas Budget</div><div style="font-size:11.5px;margin-top:2px">${esc(row.est_gas_cost)}</div></div>
          <div class="mini-box"><div class="lbl">Cadence &amp; Horizon</div><div style="font-size:11.5px;margin-top:2px">${esc(row.time_commitment)}</div></div>
        </div>
        <ol class="step-list">
          ${row.farm_steps.map((st) => `<li>${esc(st)}</li>`).join('')}
        </ol>
        <div style="margin-top:6px;font-size:11px;color:var(--amber)">Risk check: ${esc(row.risk_note)}</div>

        <div class="section-label">Nearest Tokenized Peers (Snapshot Ground Truth)</div>
        <table class="peers-table">
          <thead><tr><th>Peer</th><th>Sector</th><th class="right">TVL</th><th class="right">MCap</th><th class="right">Mult</th></tr></thead>
          <tbody>
            ${row.comparables
              .map(
                (c) => `<tr>
                  <td><b>${esc(c.name)}</b> <span style="color:var(--muted)">${esc(c.symbol || '')}</span></td>
                  <td style="color:var(--text-2)">${esc(c.category)}</td>
                  <td class="right num">${fmtUsd(c.tvl_usd)}</td>
                  <td class="right num">${fmtUsd(c.mcap_usd)}</td>
                  <td class="right num">${c.mcap_tvl_ratio.toFixed(2)}x</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;

    if (fullMode) {
      return `<div class="${wrapClass}"><div class="panel">${leftBlock}</div><div class="panel">${rightBlock}</div></div>`;
    }
    return `<aside class="inspector">${leftBlock}${rightBlock}</aside>`;
  }

  function renderModelAuditView() {
    const m = DATA.model;
    const a = DATA.filter_audit;
    return `
      <div class="audit-grid">
        <div class="panel">
          <div class="panel-head">
            <h3 class="panel-title">Two-Split Blind Held-Out Validation &amp; Feature Ablation</h3>
            <span class="panel-sub">Fit on ${m.reference_pool_size} DeFi tokenized peers · Temporal cutoff ${esc(m.temporal_cutoff_date)}</span>
          </div>
          <table class="radar-table">
            <thead>
              <tr>
                <th>Model Stage</th>
                <th>Decision</th>
                <th class="right">Split A MAE</th>
                <th class="right">Split A MedAPE</th>
                <th class="right">Split A Rho</th>
                <th class="right">Split B MedAPE</th>
                <th class="right">Split B Rho</th>
              </tr>
            </thead>
            <tbody>
              ${m.ablation
                .map((s) => {
                  const badge = s.status === 'kept' ? 'emerald' : s.status === 'baseline' ? 'cyan' : 'rose';
                  return `<tr>
                    <td><b>${esc(s.label)}</b><div class="proto-meta">${esc(s.reason)}</div></td>
                    <td><span class="pill ${badge}">${esc(s.status.toUpperCase())}</span></td>
                    <td class="right num">${s.split_a_cv.mae_log10.toFixed(3)}</td>
                    <td class="right num">${s.split_a_cv.medape_pct.toFixed(1)}%</td>
                    <td class="right num">${s.split_a_cv.spearman_rho.toFixed(3)}</td>
                    <td class="right num">${s.split_b_temporal.medape_pct.toFixed(1)}%</td>
                    <td class="right num">${s.split_b_temporal.spearman_rho.toFixed(3)}</td>
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>

        <div class="panel">
          <div class="panel-head">
            <h3 class="panel-title">Audited Pre-Token Universe Funnel</h3>
            <span class="panel-sub">Zero wrappers, CEXs, or live-token derivatives</span>
          </div>
          <div class="funnel-row"><span>Total DefiLlama snapshot protocols</span><b class="num">${a.total_protocols}</b></div>
          <div class="funnel-row"><span>Excluded: live token recorded (gecko_id / symbol)</span><span class="num neg">-${a.excluded_live_token}</span></div>
          <div class="funnel-row"><span>Excluded: CEX / Bridge / Liquid Staking / Wrapper cat.</span><span class="num neg">-${a.excluded_category}</span></div>
          <div class="funnel-row"><span>Excluded: versioned sub-deployment (V2, V3, 2.0)</span><span class="num neg">-${a.excluded_versioned}</span></div>
          <div class="funnel-row"><span>Excluded: wrapper/staked keyword or parent brand</span><span class="num neg">-${a.excluded_wrapper_word + a.excluded_cex_prefix + a.excluded_parent_brand}</span></div>
          <div class="funnel-row" style="background:var(--emerald-dim);border-radius:6px;border:0;margin-top:6px">
            <b>Retained Clean Pre-Token Radar (${a.retained_watchlist} Watchlist + ${a.retained_early_discovery} Early)</b>
            <b class="num pos">${a.retained_total}</b>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head">
          <h3 class="panel-title">Separated Live-Token Reference Universe (Top Trading Peers by MCap)</h3>
          <span class="panel-sub">Strictly excluded from pre-token rankings; used solely to calibrate multiples</span>
        </div>
        <table class="radar-table">
          <thead><tr><th>Protocol</th><th>Ticker</th><th>Category</th><th class="right">TVL</th><th class="right">Observed MCap</th><th class="right">MCap / TVL</th></tr></thead>
          <tbody>
            ${DATA.tokenized_peers_sample
              .slice(0, 12)
              .map(
                (p) => `<tr>
                  <td><b>${esc(p.name)}</b></td>
                  <td><span class="pill">${esc(p.symbol || 'TOKEN')}</span></td>
                  <td>${esc(p.category)}</td>
                  <td class="right num">${fmtUsd(p.tvl_usd)}</td>
                  <td class="right num">${fmtUsd(p.mcap_usd)}</td>
                  <td class="right num">${p.multiple.toFixed(2)}x</td>
                </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function render() {
    const filtered = getFilteredRows();
    if (!filtered.some((r) => r.slug === state.selectedSlug) && filtered[0]) {
      state.selectedSlug = filtered[0].slug;
    }
    const selected = DATA.rows.find((r) => r.slug === state.selectedSlug) || filtered[0] || DATA.rows[0];
    const selAb = DATA.model.ablation[1];
    const filteredTvl = filtered.reduce((s, r) => s + r.tvl_usd, 0);
    const filteredFdv = filtered.reduce((s, r) => s + r.implied_value_usd, 0);

    const topBar = `
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark">TR</div>
          <div>
            <h1>TOKEN RADAR <span style="color:var(--cyan)">// PRE-TOKEN ALPHA</span></h1>
            <div class="brand-sub">Snapshot ${esc(DATA.meta.as_of)} · ${DATA.meta.total_tracked_targets} Pre-Token Targets · ${DATA.filter_audit.excluded_live_token} Live Tokens Separated</div>
          </div>
        </div>
        <div class="meta-pill-row">
          <span class="pill emerald">Split A (5-Fold): MedAPE ${selAb.split_a_cv.medape_pct}% · ρ ${selAb.split_a_cv.spearman_rho}</span>
          <span class="pill cyan">Split B (Temporal): MedAPE ${selAb.split_b_temporal.medape_pct}% · ρ ${selAb.split_b_temporal.spearman_rho}</span>
        </div>
        <nav class="nav-tabs" aria-label="Views">
          <button class="tab-btn ${state.view === 'board' ? 'active' : ''}" data-tab="board">Radar Board</button>
          <button class="tab-btn ${state.view === 'detail' ? 'active' : ''}" data-tab="detail">Protocol Playbook</button>
          <button class="tab-btn ${state.view === 'model' ? 'active' : ''}" data-tab="model">Model &amp; Audit</button>
        </nav>
      </header>
    `;

    let bodyHtml = '';
    if (state.view === 'model') {
      bodyHtml = renderModelAuditView();
    } else if (state.view === 'detail') {
      bodyHtml = `
        <div class="filter-bar" style="justify-content:space-between">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="color:var(--text-2);font-weight:600">Inspect Protocol:</span>
            <select id="detailSelect" class="select-input">
              ${DATA.rows.map((r) => `<option value="${esc(r.slug)}" ${r.slug === selected.slug ? 'selected' : ''}>#${r.rank} ${esc(r.name)} (${fmtUsd(r.implied_value_usd)})</option>`).join('')}
            </select>
          </div>
          <button class="chip" data-tab="board">Back to Radar Board</button>
        </div>
        ${renderInspector(selected, true)}
      `;
    } else {
      const sortArrow = (key) => (state.sortKey === key ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '');
      bodyHtml = `
        <section class="kpi-grid">
          <div class="kpi-card">
            <div class="kpi-label">Active Radar Targets</div>
            <div class="kpi-val num">${filtered.length} <span style="font-size:12px;color:var(--muted)">/ ${DATA.meta.total_tracked_targets}</span></div>
            <div class="kpi-sub">${filtered.filter((r) => r.on_watchlist).length} Watchlist · ${filtered.filter((r) => !r.on_watchlist).length} Early</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Addressable TVL (Filtered)</div>
            <div class="kpi-val num">${fmtUsd(filteredTvl)}</div>
            <div class="kpi-sub">Total Radar TVL ${fmtUsd(DATA.meta.total_pretoken_tvl_usd)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Aggregate Implied MCap</div>
            <div class="kpi-val num" style="color:var(--cyan)">${fmtUsd(filteredFdv)}</div>
            <div class="kpi-sub">Huber-Ridge Empirical Fit</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Top Opportunity</div>
            <div class="kpi-val" style="font-size:15px">${esc(filtered[0] ? filtered[0].name : '—')}</div>
            <div class="kpi-sub num">${filtered[0] ? fmtUsd(filtered[0].implied_value_usd) + ' est.' : ''}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Pre-Token Filter Purity</div>
            <div class="kpi-val num" style="color:var(--emerald)">100%</div>
            <div class="kpi-sub">${DATA.filter_audit.excluded_live_token} live + ${DATA.filter_audit.excluded_category + DATA.filter_audit.excluded_versioned + DATA.filter_audit.excluded_wrapper_word + DATA.filter_audit.excluded_parent_brand} wrappers dropped</div>
          </div>
        </section>

        <section class="charts-row">
          <div class="panel">
            <div class="panel-head">
              <h3 class="panel-title">Log-Scale TVL vs. Implied Launch Valuation</h3>
              <span class="panel-sub">Click any node to inspect · Large dots = Watchlist ($50M+ floor)</span>
            </div>
            ${renderScatterSvg(filtered)}
          </div>
          <div class="panel">
            <div class="panel-head">
              <h3 class="panel-title">Empirical Sector Valuation Multiples</h3>
              <span class="panel-sub">Median observed MCap / TVL across ${DATA.model.reference_pool_size} DeFi peers</span>
            </div>
            ${renderSectorBars()}
          </div>
        </section>

        <section class="filter-bar">
          <input id="searchInput" class="search-input" type="search" placeholder="Search protocol, slug, category, chain..." value="${esc(state.search)}">
          <div class="chip-group">
            <button class="chip ${state.tier === 'all' ? 'active' : ''}" data-tier="all">All (${DATA.rows.length})</button>
            <button class="chip ${state.tier === 'watchlist' ? 'active' : ''}" data-tier="watchlist">Watchlist (${DATA.meta.watchlist_count})</button>
            <button class="chip ${state.tier === 'early' ? 'active' : ''}" data-tier="early">Early Discovery (${DATA.meta.early_discovery_count})</button>
          </div>
          <select id="sectorSelect" class="select-input">
            <option value="all" ${state.sector === 'all' ? 'selected' : ''}>All Sectors</option>
            <option value="trading" ${state.sector === 'trading' ? 'selected' : ''}>Trading &amp; Perps</option>
            <option value="credit_rwa" ${state.sector === 'credit_rwa' ? 'selected' : ''}>Credit, CDP &amp; RWA</option>
            <option value="yield_alloc" ${state.sector === 'yield_alloc' ? 'selected' : ''}>Yield &amp; Curators</option>
            <option value="infra" ${state.sector === 'infra' ? 'selected' : ''}>Infra, AI &amp; Chains</option>
          </select>
          <select id="chainSelect" class="select-input">
            <option value="all" ${state.chain === 'all' ? 'selected' : ''}>All Chains</option>
            ${DATA.meta.top_chains.map((c) => `<option value="${esc(c.chain)}" ${state.chain === c.chain ? 'selected' : ''}>${esc(c.chain)} (${c.count})</option>`).join('')}
          </select>
          <button class="chip ${state.momentum === 'positive' ? 'active' : ''}" id="momToggle">7d Growth &gt; 0%</button>
          <button class="reset-btn" id="resetFilters">Reset</button>
        </section>

        <section class="workspace-split">
          <div class="table-wrap">
            <div class="table-scroll">
              <table class="radar-table">
                <thead>
                  <tr>
                    <th data-sort="rank">#${sortArrow('rank')}</th>
                    <th data-sort="name">Protocol${sortArrow('name')}</th>
                    <th data-sort="category">Sector${sortArrow('category')}</th>
                    <th class="right" data-sort="tvl_usd">TVL${sortArrow('tvl_usd')}</th>
                    <th class="right" data-sort="change_7d">7d Δ${sortArrow('change_7d')}</th>
                    <th class="right" data-sort="implied_value_usd">Implied MCap${sortArrow('implied_value_usd')}</th>
                    <th class="right" data-sort="radar_score">Priority${sortArrow('radar_score')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${filtered
                    .map(
                      (r) => `<tr data-slug="${esc(r.slug)}" class="${r.slug === selected.slug ? 'selected' : ''}">
                        <td class="num">${r.rank}</td>
                        <td>
                          <div class="proto-name">${r.on_watchlist ? '<span class="wl-dot" title="Watchlist"></span>' : ''}${esc(r.name)}</div>
                          <div class="proto-meta">${esc(r.primary_chain)}${r.chains.length > 1 ? ` +${r.chains.length - 1}` : ''} · ${r.months_live ? r.months_live + 'm live' : 'new'}</div>
                        </td>
                        <td><span class="pill">${esc(r.category)}</span></td>
                        <td class="right num">${fmtUsd(r.tvl_usd)}</td>
                        <td class="right num ${r.change_7d > 0 ? 'pos' : r.change_7d < 0 ? 'neg' : ''}">${fmtPct(r.change_7d)}</td>
                        <td class="right num" style="font-weight:700;color:var(--cyan)">${fmtUsd(r.implied_value_usd)}</td>
                        <td class="right num"><span class="pill ${r.radar_score >= 70 ? 'emerald' : ''}">${r.radar_score}</span></td>
                      </tr>`,
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </div>
          ${renderInspector(selected, false)}
        </section>
      `;
    }

    root.innerHTML = `${topBar}${bodyHtml}<footer class="disclaimer"><span>Implied valuations are empirical Huber-Ridge estimates calibrated on ${DATA.model.reference_pool_size} DeFi peers in ${esc(DATA.meta.as_of)} snapshot; DefiLlama absence of ticker is not proof no token exists.</span><span class="num">Zero-network offline artifact</span></footer>`;

    // Bind events
    root.querySelectorAll('[data-tab]').forEach((el) =>
      el.addEventListener('click', () => {
        state.view = el.getAttribute('data-tab');
        render();
      }),
    );
    const openFull = root.querySelector('#openFullDetailBtn');
    if (openFull) openFull.addEventListener('click', () => { state.view = 'detail'; render(); });

    const detailSel = root.querySelector('#detailSelect');
    if (detailSel) detailSel.addEventListener('change', (e) => { state.selectedSlug = e.target.value; render(); });

    const searchEl = root.querySelector('#searchInput');
    if (searchEl) {
      searchEl.addEventListener('input', (e) => {
        state.search = e.target.value;
        render();
        const again = root.querySelector('#searchInput');
        if (again) {
          again.focus();
          again.setSelectionRange(again.value.length, again.value.length);
        }
      });
    }

    root.querySelectorAll('[data-tier]').forEach((el) =>
      el.addEventListener('click', () => { state.tier = el.getAttribute('data-tier'); render(); }),
    );
    const secSel = root.querySelector('#sectorSelect');
    if (secSel) secSel.addEventListener('change', (e) => { state.sector = e.target.value; render(); });
    const chSel = root.querySelector('#chainSelect');
    if (chSel) chSel.addEventListener('change', (e) => { state.chain = e.target.value; render(); });
    const momBtn = root.querySelector('#momToggle');
    if (momBtn) momBtn.addEventListener('click', () => { state.momentum = state.momentum === 'positive' ? 'all' : 'positive'; render(); });
    const rstBtn = root.querySelector('#resetFilters');
    if (rstBtn) {
      rstBtn.addEventListener('click', () => {
        state.search = '';
        state.tier = 'all';
        state.sector = 'all';
        state.chain = 'all';
        state.momentum = 'all';
        state.sortKey = 'rank';
        state.sortDir = 'asc';
        render();
      });
    }

    root.querySelectorAll('th[data-sort]').forEach((th) =>
      th.addEventListener('click', () => {
        const key = th.getAttribute('data-sort');
        if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
        else {
          state.sortKey = key;
          state.sortDir = key === 'rank' || key === 'name' || key === 'category' ? 'asc' : 'desc';
        }
        render();
      }),
    );

    root.querySelectorAll('tr[data-slug], .scatter-dot[data-slug]').forEach((el) =>
      el.addEventListener('click', () => {
        state.selectedSlug = el.getAttribute('data-slug');
        render();
      }),
    );
  }

  window.__RADAR_SET_STATE__ = (patch) => {
    Object.assign(state, patch);
    render();
  };

  render();
})();
