// =====================================================================
// Supplier Selection Scorecard - Core Application Logic
// Walchand College of Engineering, Sangli - FinTech Data Science & Analytics
// =====================================================================

const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (v, d = 1) => v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d);

const STEPS = [
  { label: 'Upload CSV', icon: '📁' },
  { label: 'Map Columns', icon: '🔗' },
  { label: 'Data Audit', icon: '🧹' },
  { label: 'Weights & Criteria', icon: '⚖️' },
  { label: 'Executive Scorecard', icon: '🏆' }
];

const ROLES = [
  {key:'supplier', label:'Supplier / Vendor', req:true, re:/vendor|supplier/i, exclude:/inco|term|country|address|contact|site/i,
   prefer:['vendor','supplier','vendor name','supplier name'],
   help:'The company you buy from. Each unique entry represents one evaluated supplier.'},
  {key:'scheduled', label:'Promised Delivery Date', req:true, re:/scheduled|promised|due date|expected/i, exclude:/sent|recorded|created|invoice/i,
   prefer:['scheduled delivery date','promised delivery date','due date'],
   help:'The date the supplier committed to deliver. Delay = Actual minus Promised Date.'},
  {key:'delivered', label:'Actual Delivery Date', req:true, re:/delivered|actual delivery|received/i, exclude:/recorded|sent|invoice/i,
   prefer:['delivered to client date','actual delivery date','delivered date'],
   help:'The date goods actually arrived at destination. Used for on-time and delay calculations.'},
  {key:'price', label:'Unit Price', req:false, re:/unit price/i,
   prefer:['unit price'],
   help:'Optional. Enables like-for-like price index (benchmarked against product category median).'},
  {key:'product', label:'Product Group / Category', req:false, re:/product group|category|product/i, exclude:/code|id|description/i,
   prefer:['product group','category','product category'],
   help:'Optional. Keeps price comparison fair: compares medicines with medicines, test kits with test kits.'},
  {key:'freight', label:'Freight (Shipping) Cost', req:false, re:/freight/i, exclude:/term|mode/i,
   prefer:['freight cost (usd)','freight cost'],
   help:'Optional. Evaluates shipping overhead as a fraction of order purchase value.'},
  {key:'value', label:'Line Item Value (Order Total)', req:false, re:/line item value|order value|total value/i,
   prefer:['line item value'],
   help:'Optional. Total monetary value of the order line, needed for freight ratio calculation.'},
];

const METRICS = [
  {key:'pidx', pillar:'cost', lower:true, label:'Price Index', help:'Average unit price ÷ median price for the same product group. Below 1.0 = cheaper than typical.'},
  {key:'fr', pillar:'cost', lower:true, label:'Freight Ratio', help:'Freight cost ÷ order value. Shows how much shipping eats into purchase price.'},
  {key:'onTime', pillar:'reliability', lower:false, label:'On-Time Rate', help:'Share of deliveries arriving on or before promised delivery date.'},
  {key:'avgDelay', pillar:'reliability', lower:true, label:'Average Delay (days)', help:'Mean delay across shipments. Negative values indicate early arrival.'},
  {key:'delayStd', pillar:'resilience', lower:true, label:'Delay Spread (σ)', help:'Standard deviation of delivery delays. Lower = predictable & consistent.'},
  {key:'monthStd', pillar:'resilience', lower:true, label:'Monthly Consistency', help:'Standard deviation of monthly on-time rates. Lower = performance holds up across seasons.'},
];

const PRESETS = {
  'Equal (1:1:1)': {cost:1, reliability:1, resilience:1},
  'Cost-first (3:1:1)': {cost:3, reliability:1, resilience:1},
  'Reliability-first (1:3:1)': {cost:1, reliability:3, resilience:1},
  'Resilience-first (1:1:3)': {cost:1, reliability:1, resilience:3},
};

const S = {
  step: 1,
  rows: [],
  headers: [],
  map: {},
  clean: null,
  weights: {cost: 1, reliability: 1, resilience: 1},
  minShip: 20,
  result: null,
  activeTab: 'table', // 'table', 'charts', 'fintech', 'optimizer', 'baseline'
  weightMode: 'sliders', // 'sliders', 'ahp'
  ahp: { cr: 0, cost_rel: 0.5, cost_res: 0.5, rel_res: 1.0 },
  finParams: { demand: 50000, holdingRate: 20, serviceLevel: 95 },
  optParams: { orderVolume: 100000, minReliability: 96, maxShare: 40 },
  searchQuery: '',
  sortCol: 'composite',
  sortAsc: false,
  selectedSupplier: null,
  currentDatasetName: ''
};

// ---------- Math & Parsing Helpers ----------
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sum = a => a.reduce((x, y) => x + y, 0);
const std = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const MON = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

function toNum(v) {
  if (typeof v === 'number') return v;
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

function parseDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[-\/ ](\d{2,4})$/);
  if (m && MON[m[2].toLowerCase()] !== undefined) {
    let y = +m[3]; if (y < 100) y += y <= 50 ? 2000 : 1900;
    return new Date(Date.UTC(y, MON[m[2].toLowerCase()], +m[1]));
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    let y = +m[3]; if (y < 100) y += y <= 50 ? 2000 : 1900;
    return new Date(Date.UTC(y, +m[2] - 1, +m[1]));
  }
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

function autoMap(headers) {
  const map = {}, used = new Set();
  for (const r of ROLES) {
    let found = null;
    if (r.prefer) {
      found = headers.find(h => !used.has(h) && r.prefer.includes(h.trim().toLowerCase()));
    }
    if (!found) {
      const candidates = headers.filter(h => !used.has(h) && r.re.test(h) && !(r.exclude && r.exclude.test(h)));
      candidates.sort((a, b) => a.length - b.length);
      found = candidates[0];
    }
    if (found) { map[r.key] = found; used.add(found); }
  }
  return map;
}

// ---------- Pipeline ----------
function buildClean() {
  const m = S.map, rows = [], drop = {supplier:0, date:0};
  let badPrice = 0, badFreight = 0, badValue = 0;
  for (const r of S.rows) {
    const supplier = String(r[m.supplier] ?? '').trim();
    if (!supplier) { drop.supplier++; continue; }
    const s = parseDate(r[m.scheduled]), d = parseDate(r[m.delivered]);
    if (!s || !d) { drop.date++; continue; }
    const rec = {
      supplier,
      delay: (d - s) / 864e5,
      month: s.getUTCFullYear() * 12 + s.getUTCMonth(),
      product: m.product ? String(r[m.product] ?? '').trim() : 'ALL',
      price: null,
      freight: null,
      value: null
    };
    if (m.price) { rec.price = toNum(r[m.price]); if (rec.price == null) badPrice++; }
    if (m.freight) { rec.freight = toNum(r[m.freight]); if (rec.freight == null) badFreight++; }
    if (m.value) { rec.value = toNum(r[m.value]); if (rec.value == null) badValue++; }
    rows.push(rec);
  }
  return {rows, drop, badPrice, badFreight, badValue, total: S.rows.length};
}

function supplierMetrics(rows, minShip) {
  const medProd = {}, byProd = {};
  if (S.map.price) {
    for (const r of rows) if (r.price != null && r.price > 0) (byProd[r.product] ??= []).push(r.price);
    for (const p in byProd) medProd[p] = median(byProd[p]);
  }
  const groups = {};
  for (const r of rows) (groups[r.supplier] ??= []).push(r);
  const out = [], excluded = [];
  for (const [name, rs] of Object.entries(groups)) {
    if (rs.length < minShip) { excluded.push(name); continue; }
    const delays = rs.map(r => r.delay);
    const byMonth = {};
    for (const r of rs) (byMonth[r.month] ??= []).push(r.delay <= 0 ? 1 : 0);
    const monthRates = Object.values(byMonth).filter(a => a.length >= 3).map(mean);
    const idx = S.map.price ? rs.filter(r => r.price != null && medProd[r.product]).map(r => r.price / medProd[r.product]) : [];
    const both = S.map.freight && S.map.value ? rs.filter(r => r.freight != null && r.value > 0) : [];
    const rawPrices = rs.filter(r => r.price != null).map(r => r.price);
    out.push({
      name,
      n: rs.length,
      onTime: rs.filter(r => r.delay <= 0).length / rs.length,
      avgDelay: mean(delays),
      delayStd: std(delays),
      monthStd: monthRates.length > 1 ? std(monthRates) : null,
      pidx: idx.length ? mean(idx) : null,
      fr: both.length && sum(both.map(r => r.value)) > 0 ? sum(both.map(r => r.freight)) / sum(both.map(r => r.value)) : null,
      rawPrice: rawPrices.length ? mean(rawPrices) : null,
    });
  }
  return {out, excluded};
}

function scoreAll(list, w) {
  const avail = METRICS.filter(m => list.some(s => s[m.key] != null));
  const stats = {};
  for (const m of avail) {
    const v = list.map(s => s[m.key]).filter(x => x != null);
    stats[m.key] = {min: Math.min(...v), max: Math.max(...v)};
  }
  const norm = (m, x) => {
    const {min, max} = stats[m.key];
    if (max === min) return 100;
    const t = (x - min) / (max - min);
    return (m.lower ? 1 - t : t) * 100;
  };
  return list.map(s => {
    const pillars = {}, rawNorm = {};
    for (const m of avail) {
      if (s[m.key] != null) rawNorm[m.key] = norm(m, s[m.key]);
    }
    for (const p of ['cost', 'reliability', 'resilience']) {
      const ns = avail.filter(m => m.pillar === p && s[m.key] != null).map(m => norm(m, s[m.key]));
      pillars[p] = ns.length ? mean(ns) : null;
    }
    let num = 0, den = 0;
    for (const p in pillars) if (pillars[p] != null && w[p] > 0) { num += w[p] * pillars[p]; den += w[p]; }
    return {...s, pillars, rawNorm, composite: den ? num / den : null};
  }).sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));
}

// ---------- AHP & TOPSIS Algorithms ----------
function computeAHPWeights() {
  const c_r = S.ahp.cost_rel;
  const c_s = S.ahp.cost_res;
  const r_s = S.ahp.rel_res;
  const A = [
    [1.0, c_r, c_s],
    [1.0 / c_r, 1.0, r_s],
    [1.0 / c_s, 1.0 / r_s, 1.0]
  ];
  const gm = A.map(row => Math.cbrt(row[0] * row[1] * row[2]));
  const sumGm = sum(gm);
  const w = {
    cost: gm[0] / sumGm,
    reliability: gm[1] / sumGm,
    resilience: gm[2] / sumGm
  };
  const Aw = [
    A[0][0]*w.cost + A[0][1]*w.reliability + A[0][2]*w.resilience,
    A[1][0]*w.cost + A[1][1]*w.reliability + A[1][2]*w.resilience,
    A[2][0]*w.cost + A[2][1]*w.reliability + A[2][2]*w.resilience
  ];
  const lambdaMax = (Aw[0]/w.cost + Aw[1]/w.reliability + Aw[2]/w.resilience) / 3;
  const ci = (lambdaMax - 3) / 2;
  S.ahp.cr = Math.max(0, ci / 0.58);
  return w;
}

function computeTOPSIS(list, weights) {
  const complete = list.filter(s => s.pidx != null && s.fr != null && s.onTime != null && s.avgDelay != null && s.delayStd != null && s.monthStd != null);
  if (!complete.length) return {};
  const keys = ['pidx', 'fr', 'onTime', 'avgDelay', 'delayStd', 'monthStd'];
  const isBenefit = [false, false, true, false, false, false];
  const wVec = [
    weights.cost / 2, weights.cost / 2,
    weights.reliability / 2, weights.reliability / 2,
    weights.resilience / 2, weights.resilience / 2
  ];
  const denom = keys.map(k => Math.sqrt(sum(complete.map(s => s[k] * s[k]))));
  const V = complete.map(s => keys.map((k, j) => (s[k] / (denom[j] || 1)) * wVec[j]));
  const idealBest = keys.map((k, j) => isBenefit[j] ? Math.max(...V.map(v => v[j])) : Math.min(...V.map(v => v[j])));
  const idealWorst = keys.map((k, j) => isBenefit[j] ? Math.min(...V.map(v => v[j])) : Math.max(...V.map(v => v[j])));
  const topsisScores = {};
  complete.forEach((s, i) => {
    const dPlus = Math.sqrt(sum(keys.map((k, j) => (V[i][j] - idealBest[j]) ** 2)));
    const dMinus = Math.sqrt(sum(keys.map((k, j) => (V[i][j] - idealWorst[j]) ** 2)));
    const score = dMinus / (dPlus + dMinus);
    topsisScores[s.name] = score * 100;
  });
  return topsisScores;
}

// ---------- FinTech Safety Stock Risk Model (Chapter 9) ----------
function computeFintechRisk(scored) {
  const p = S.finParams;
  const dailyDemand = p.demand / 365.0;
  const z = p.serviceLevel >= 99 ? 2.33 : (p.serviceLevel >= 95 ? 1.65 : 1.28);
  const hRate = p.holdingRate / 100.0;
  return scored.map(s => {
    const basePrice = s.rawPrice != null && s.rawPrice > 0 ? s.rawPrice : 1.50;
    const effStd = Math.max(s.delayStd ?? 1.0, 0.5);
    const ssUnits = Math.round(z * effStd * dailyDemand);
    const capitalLocked = ssUnits * basePrice;
    const annualHoldingCost = capitalLocked * hRate;
    const holdingCostPerUnit = annualHoldingCost / p.demand;
    const freightPerUnit = basePrice * (s.fr ?? 0.10);
    const trueLandedCost = basePrice + freightPerUnit + holdingCostPerUnit;
    return {
      ...s,
      basePrice,
      ssUnits,
      capitalLocked,
      annualHoldingCost,
      holdingCostPerUnit,
      freightPerUnit,
      trueLandedCost
    };
  });
}

// ---------- What-If Sourcing Order Allocation Optimizer ----------
function solveOrderAllocation(scored) {
  const opt = S.optParams;
  const total = opt.orderVolume;
  const targetRel = opt.minReliability / 100.0;
  const cap = (opt.maxShare / 100.0) * total;
  const pool = scored.slice(0, 10).map(s => ({
    name: s.name,
    onTime: s.onTime,
    cost: s.pidx ?? 1.0,
    composite: s.composite
  }));
  pool.sort((a, b) => a.cost - b.cost);
  let rem = total;
  const alloc = pool.map(s => {
    const take = Math.min(cap, rem);
    rem -= take;
    return {...s, units: take};
  });
  let curRel = sum(alloc.map(a => a.units * a.onTime)) / total;
  if (curRel < targetRel) {
    alloc.sort((a, b) => b.onTime - a.onTime);
    let r2 = total;
    alloc.forEach(a => {
      const take = Math.min(cap, r2);
      r2 -= take;
      a.units = take;
    });
    curRel = sum(alloc.map(a => a.units * a.onTime)) / total;
  }
  const result = alloc.filter(a => a.units > 0).map(a => ({
    name: a.name,
    units: Math.round(a.units),
    pct: (a.units / total) * 100.0,
    onTime: a.onTime,
    cost: a.cost
  }));
  const blendedRel = sum(result.map(r => r.units * r.onTime)) / total;
  const blendedCost = sum(result.map(r => r.units * r.cost)) / total;
  return {allocations: result, blendedRel, blendedCost, total};
}

function runAll() {
  const {out, excluded} = supplierMetrics(S.clean.rows, S.minShip);
  let currentWeights = S.weights;
  if (S.weightMode === 'ahp') {
    currentWeights = computeAHPWeights();
  }
  const scored = scoreAll(out, currentWeights);
  scored.forEach((s, idx) => s.rank = idx + 1);
  const topsisScores = computeTOPSIS(out, currentWeights);
  scored.forEach(s => {
    if (topsisScores[s.name] != null) s.topsisScore = topsisScores[s.name];
  });
  const scenarios = {};
  for (const [name, w] of Object.entries(PRESETS)) {
    scenarios[name] = {};
    scoreAll(out, w).forEach((s, i) => scenarios[name][s.name] = i + 1);
  }
  const priceOnly = out.filter(s => s.pidx != null || s.rawPrice != null)
    .sort((a, b) => (a.pidx ?? a.rawPrice) - (b.pidx ?? b.rawPrice));
  const fintechData = computeFintechRisk(scored);
  const allocation = solveOrderAllocation(scored);
  S.result = {
    scored,
    excluded,
    scenarios,
    priceOnly,
    fintechData,
    allocation,
    avail: METRICS.filter(m => out.some(s => s[m.key] != null))
  };
}

// ---------- UI Rendering ----------
function renderSteps() {
  $('#steps').innerHTML = STEPS.map((s, i) => {
    const n = i + 1;
    const disabled = (n > 1 && !S.rows.length) || (n > 2 && !S.map.supplier) || (n > 4 && !S.clean) ? 'disabled' : '';
    const isActive = S.step === n;
    const isCompleted = S.step > n;
    return `
      <button class="step-item ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}" ${disabled} onclick="goto(${n})">
        <span class="step-counter">${isCompleted ? '✓ ' : s.icon + ' '}STEP 0${n}</span>
        <span class="step-name">${s.label}</span>
      </button>
    `;
  }).join('');
}

function goto(n) { S.step = n; render(); }
function setTab(t) { S.activeTab = t; render(); }

function render() {
  renderSteps();
  const app = $('#app');
  const view = {1: viewUpload, 2: viewMap, 3: viewClean, 4: viewWeights, 5: viewResults}[S.step];
  app.innerHTML = view();
  bind();
}

function viewUpload() {
  let previewTable = '';
  if (S.rows.length) {
    const headers = S.headers.slice(0, 7);
    const sampleRows = S.rows.slice(0, 3);
    previewTable = `
      <div style="margin-top:20px">
        <div style="font-weight:700;font-size:13px;color:var(--text-muted);margin-bottom:6px">Data Ingestion Preview (First 3 Rows):</div>
        <div class="table-responsive"><table>
          <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${sampleRows.map(r => `<tr>${headers.map(h => `<td>${esc(r[h] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="card-header-bar">
        <div>
          <h2 class="card-headline">Upload Historical Shipment Data</h2>
          <p class="card-subtext">Upload any purchase order, shipment, or ERP delivery CSV. Our multi-criteria model automatically evaluates suppliers on Cost Efficiency, Delivery Reliability, and Supply Chain Resilience.</p>
        </div>
      </div>

      <div class="dropzone-area" id="dropzoneBox">
        <span class="dropzone-glyph">📤</span>
        <div class="dropzone-title">Click to select a CSV file or drag & drop here</div>
        <div class="dropzone-hint">Supports CSV files with UTF-8 or Windows-1252 encodings, commas, or semicolons</div>
        <input type="file" id="file" accept=".csv,text/csv" style="display:none">
      </div>

      <div id="loadErr"></div>

      ${S.rows.length ? `
        <div class="callout-box">
          <b>✓ Dataset Loaded: ${esc(S.currentDatasetName || 'Active File')}</b>
          ${S.rows.length.toLocaleString()} total rows across ${S.headers.length} columns detected.
        </div>
        ${previewTable}
        <div class="btn-cluster">
          <button class="btn btn-primary" onclick="goto(2)">Proceed to Column Mapping →</button>
        </div>
      ` : ''}

      <div style="margin-top: 28px;">
        <div style="font-weight:700;font-size:14px;color:var(--text-sub);margin-bottom:12px">Or start immediately with benchmark test datasets:</div>
        <div class="dataset-picker-grid">
          <div class="dataset-card">
            <div>
              <div class="dataset-card-top">
                <span class="dataset-card-name">Benchmark USAID Dataset</span>
                <span class="badge-tag" style="background:var(--teal-50);color:var(--teal-600)">10,324 Records</span>
              </div>
              <p class="dataset-card-desc">The official SCMS global health delivery dataset from the report. Includes 73 vendors, freight costs, and 10 years of delivery history.</p>
            </div>
            <button class="btn btn-primary" id="loadBenchmarkBtn">⚡ Load Benchmark Dataset (10.3k rows)</button>
          </div>

          <div class="dataset-card">
            <div>
              <div class="dataset-card-top">
                <span class="dataset-card-name">Quick Test Dummy CSV</span>
                <span class="badge-tag" style="background:var(--indigo-50);color:var(--indigo-600)">190 Records</span>
              </div>
              <p class="dataset-card-desc">A clean, compact multi-category dataset with 6 distinct supplier archetypes (Ultra-Reliable, Cheap-but-Late, High-Freight, Balanced).</p>
            </div>
            <button class="btn btn-secondary" id="loadDummyBtn">🧪 Load Quick Test Dummy (190 rows)</button>
          </div>
        </div>
      </div>
    </div>

    <div class="callout-box">
      <b>Why this model matters:</b>
      Sorting suppliers strictly by lowest price creates a false economy. A vendor that is 5% cheaper but frequently late causes factory downtime, rush shipping, and costly inventory safety stock. This tool reveals the true risk-adjusted performance.
    </div>
  `;
}

function viewMap() {
  const rows = ROLES.map(r => {
    const usedElsewhere = new Set(Object.entries(S.map).filter(([k]) => k !== r.key).map(([, v]) => v));
    const opts = S.headers.filter(h => !usedElsewhere.has(h) || S.map[r.key] === h);
    const isDetected = S.map[r.key] ? true : false;
    return `
    <div class="mapping-item">
      <div class="mapping-title">
        ${r.label}${r.req ? '<span class="req-mark">*</span>' : ''}
        ${isDetected ? '<span class="badge-tag" style="padding:2px 8px;font-size:11px;background:var(--teal-50);color:var(--teal-600)">Auto-matched</span>' : ''}
      </div>
      <div>
        <select class="mapping-select" data-role="${r.key}">
          <option value="">— not mapped —</option>
          ${opts.map(h => `<option value="${esc(h)}" ${S.map[r.key] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}
        </select>
      </div>
      <div class="mapping-subhint">${r.help}</div>
    </div>`;
  }).join('');
  const missing = ROLES.filter(r => r.req && !S.map[r.key]).map(r => r.label);

  return `
    <div class="card">
      <div class="card-header-bar">
        <div>
          <h2 class="card-headline">Verify & Match Dataset Columns</h2>
          <p class="card-subtext">The auto-mapper has matched known column headers. Confirm mappings below or adjust dropdowns as needed.</p>
        </div>
      </div>

      <div class="mapping-list">
        ${rows}
      </div>

      ${missing.length ? `<div class="callout-box warn"><b>Required Columns Missing:</b> Please map the following required fields to proceed: ${missing.join(', ')}</div>` : ''}

      <div class="btn-cluster">
        <button class="btn btn-primary" id="mapNext" ${missing.length ? 'disabled' : ''}>Audit Cleaned Data →</button>
        <button class="btn btn-secondary" onclick="goto(1)">← Back to Upload</button>
      </div>
    </div>
  `;
}

function viewClean() {
  S.clean = buildClean();
  const c = S.clean;
  const counts = {};
  for (const r of c.rows) counts[r.supplier] = (counts[r.supplier] || 0) + 1;
  const nSup = Object.keys(counts).length;
  const eligible = Object.values(counts).filter(n => n >= S.minShip).length;
  const dropped = c.total - c.rows.length;
  const textIssues = [
    S.map.price && c.badPrice ? `${c.badPrice.toLocaleString()} unit prices are text/empty (treated safely as missing for price index)` : null,
    S.map.freight && c.badFreight ? `${c.badFreight.toLocaleString()} freight entries contain text like 'Freight Included' (treated as missing rather than zero)` : null,
    S.map.value && c.badValue ? `${c.badValue.toLocaleString()} line value entries are non-numeric` : null,
  ].filter(Boolean);

  return `
    <div class="card">
      <div class="card-header-bar">
        <div>
          <h2 class="card-headline">Data Quality & Cleaning Audit</h2>
          <p class="card-subtext">Automated cleaning pipeline has standardized date formats, coerced numbers, and isolated valid suppliers.</p>
        </div>
      </div>

      <div class="kpi-row">
        <div class="kpi-card">
          <div class="kpi-num">${c.total.toLocaleString()}</div>
          <div class="kpi-caption">Raw Orders in File</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num" style="color:var(--emerald-600)">${c.rows.length.toLocaleString()}</div>
          <div class="kpi-caption">Valid Clean Shipments</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num">${nSup}</div>
          <div class="kpi-caption">Unique Suppliers Found</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num" style="color:var(--teal-600)">${eligible}</div>
          <div class="kpi-caption">Qualified (≥${S.minShip} orders)</div>
        </div>
      </div>

      <div style="margin: 20px 0;">
        ${dropped ? `<div class="callout-box warn"><b>Row Filter Notice:</b> ${dropped} rows dropped due to missing vendor name (${c.drop.supplier}) or unreadable delivery dates (${c.drop.date}).</div>` : '<div class="callout-box"><b>✓ 100% Parsing Pass:</b> All records have valid supplier names and readable delivery dates.</div>'}
        ${textIssues.map(t => `<div style="font-size:13px;color:var(--text-muted);margin:6px 0">ℹ️ ${t}.</div>`).join('')}
      </div>

      <div class="btn-cluster">
        <button class="btn btn-primary" onclick="goto(4)">Configure Weights & Criteria →</button>
        <button class="btn btn-secondary" onclick="goto(2)">← Edit Column Mapping</button>
      </div>
    </div>
  `;
}

function viewWeights() {
  const labels = {cost:'Cost Efficiency', reliability:'Delivery Reliability', resilience:'Supply Chain Resilience'};
  const helps = {
    cost: 'Unit price compared to product category median, plus freight shipping overhead ratio.',
    reliability: 'On-time delivery percentage (OTIF) and average delivery delay in days.',
    resilience: 'Predictability (low delay spread σ) and month-to-month delivery consistency.',
  };

  const totalW = (S.weights.cost + S.weights.reliability + S.weights.resilience) || 1;
  const pct = p => Math.round((S.weights[p] / totalW) * 100);

  let modeContent = '';
  if (S.weightMode === 'sliders') {
    modeContent = `
      <div style="margin: 14px 0 20px;">
        <div style="font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:8px">Quick Strategic Presets:</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${Object.keys(PRESETS).map(n => `<button class="btn btn-secondary" onclick="preset('${n}')">${n}</button>`).join('')}
        </div>
      </div>

      <div class="slider-group">
        ${['cost','reliability','resilience'].map(p => `
          <div class="slider-row">
            <div>
              <div class="slider-title">${labels[p]}</div>
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px">${helps[p]}</div>
            </div>
            <input type="range" min="0" max="5" step="1" value="${S.weights[p]}" data-w="${p}">
            <div class="slider-val-box">${S.weights[p]}x <span style="font-size:11px;color:var(--text-muted)">(${pct(p)}%)</span></div>
          </div>
        `).join('')}
      </div>
    `;
  } else if (S.weightMode === 'ahp') {
    const ahpW = computeAHPWeights();
    const crOk = S.ahp.cr < 0.10;
    modeContent = `
      <div style="background:var(--bg-subtle);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:20px;margin:16px 0">
        <h4 style="margin:0 0 4px">Analytic Hierarchy Process (Saaty, 1980)</h4>
        <p style="margin:0 0 18px;font-size:13px;color:var(--text-muted)">Derives mathematical weights from pairwise comparison ratios via principal eigenvector matrix decomposition.</p>

        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:150px 1fr 180px;gap:14px;align-items:center;font-size:13px">
            <span style="text-align:right;font-weight:700">Cost Efficiency</span>
            <input type="range" min="0.2" max="5.0" step="0.1" value="${S.ahp.cost_rel}" id="ahp_c_r">
            <span>Reliability (Ratio: <b>${fmt(S.ahp.cost_rel, 2)}</b>)</span>
          </div>

          <div style="display:grid;grid-template-columns:150px 1fr 180px;gap:14px;align-items:center;font-size:13px">
            <span style="text-align:right;font-weight:700">Cost Efficiency</span>
            <input type="range" min="0.2" max="5.0" step="0.1" value="${S.ahp.cost_res}" id="ahp_c_s">
            <span>Resilience (Ratio: <b>${fmt(S.ahp.cost_res, 2)}</b>)</span>
          </div>

          <div style="display:grid;grid-template-columns:150px 1fr 180px;gap:14px;align-items:center;font-size:13px">
            <span style="text-align:right;font-weight:700">Reliability</span>
            <input type="range" min="0.2" max="5.0" step="0.1" value="${S.ahp.rel_res}" id="ahp_r_s">
            <span>Resilience (Ratio: <b>${fmt(S.ahp.rel_res, 2)}</b>)</span>
          </div>
        </div>

        <div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
          <div style="font-size:13.5px">
            Derived Weights: <b>Cost:</b> ${fmt(ahpW.cost*100, 1)}% | <b>Reliability:</b> ${fmt(ahpW.reliability*100, 1)}% | <b>Resilience:</b> ${fmt(ahpW.resilience*100, 1)}%
          </div>
          <span class="badge-tag" style="background:${crOk ? 'var(--emerald-50)' : 'var(--amber-50)'};color:${crOk ? 'var(--emerald-600)' : 'var(--amber-600)'}">
            Consistency Ratio (CR): ${fmt(S.ahp.cr, 3)} ${crOk ? '✓ (Consistent)' : '⚠ (Check judgments)'}
          </span>
        </div>
      </div>
    `;
  }

  return `
    <div class="card">
      <div class="card-header-bar">
        <div>
          <h2 class="card-headline">Configure Sourcing Pillars & Methodology</h2>
          <p class="card-subtext">Choose your multi-criteria weighting method. Sliders provide direct intuitive control; AHP provides academic pairwise rigor.</p>
        </div>
      </div>

      <div class="tab-segmented">
        <button class="tab-pill-btn ${S.weightMode==='sliders'?'active':''}" onclick="setWeightMode('sliders')">⚖️ Sliders & Strategic Presets</button>
        <button class="tab-pill-btn ${S.weightMode==='ahp'?'active':''}" onclick="setWeightMode('ahp')">📐 AHP Pairwise Comparison Matrix</button>
      </div>

      ${modeContent}

      <div style="margin-top:22px;max-width:340px">
        <label style="display:block;font-size:13px;font-weight:700;margin-bottom:6px">Minimum Shipments per Supplier</label>
        <input type="number" min="1" max="500" value="${S.minShip}" id="minShip" style="width:100%;padding:9px 12px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);font-family:var(--font-mono)">
        <div style="font-size:12px;color:var(--text-muted);margin-top:4px">Suppliers with fewer shipments sit out of rankings to avoid sample noise.</div>
      </div>

      <div class="btn-cluster">
        <button class="btn btn-primary" id="runBtn">Generate Executive Scorecard →</button>
        <button class="btn btn-secondary" onclick="goto(3)">← Back to Data Audit</button>
      </div>
    </div>
  `;
}

function setWeightMode(mode) {
  S.weightMode = mode;
  render();
}

// ---------- Results Views & Interactive Charts ----------
function viewResults() {
  runAll();
  const {scored, excluded, scenarios, priceOnly, fintechData, allocation, avail} = S.result;
  if (!scored.length) {
    return `
      <div class="card">
        <div class="callout-box warn"><b>No eligible suppliers:</b> No vendor has at least ${S.minShip} shipments. Please lower the minimum order threshold on Step 4.</div>
        <button class="btn btn-primary" onclick="goto(4)">Change Threshold on Step 4</button>
      </div>
    `;
  }

  let tabBody = '';
  if (S.activeTab === 'table') tabBody = renderScorecardTable(scored, avail, excluded);
  else if (S.activeTab === 'charts') tabBody = renderInteractiveCharts(scored, scenarios);
  else if (S.activeTab === 'fintech') tabBody = renderFintechView(fintechData);
  else if (S.activeTab === 'optimizer') tabBody = renderOptimizerView(allocation);
  else if (S.activeTab === 'baseline') tabBody = renderBaselineView(priceOnly, scored);

  const topVendor = scored[0];
  const fleetOnTime = mean(scored.map(s => s.onTime)) * 100;

  return `
    <div class="card">
      <div class="card-header-bar">
        <div>
          <h2 class="card-headline">SupplyRank Executive Scorecard</h2>
          <p class="card-subtext">Multi-criteria ranking for ${scored.length} qualified suppliers evaluated across cost, reliability, and resilience.</p>
        </div>
        <div style="display:flex;gap:10px">
          <button class="btn btn-secondary" onclick="exportCsv()">📥 Download CSV</button>
          <button class="btn btn-secondary" onclick="goto(4)">⚙️ Adjust Weights</button>
        </div>
      </div>

      <div class="kpi-row" style="margin-bottom:20px">
        <div class="kpi-card" style="border-left:4px solid var(--teal-600)">
          <div class="kpi-num" style="color:var(--teal-600)">${esc(topVendor.name.slice(0, 20))}</div>
          <div class="kpi-caption">#1 Top Recommended Partner (Score: ${fmt(topVendor.composite)})</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num">${fmt(fleetOnTime, 1)}%</div>
          <div class="kpi-caption">Fleet Average On-Time Rate</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-num">${scored.length}</div>
          <div class="kpi-caption">Suppliers Ranked</div>
        </div>
      </div>

      <div class="tab-segmented">
        <button class="tab-pill-btn ${S.activeTab==='table'?'active':''}" onclick="setTab('table')">🏆 Ranked Scorecard</button>
        <button class="tab-pill-btn ${S.activeTab==='charts'?'active':''}" onclick="setTab('charts')">📊 Visual Dashboard (Figures 5–8)</button>
        <button class="tab-pill-btn ${S.activeTab==='fintech'?'active':''}" onclick="setTab('fintech')">💰 FinTech Working Capital</button>
        <button class="tab-pill-btn ${S.activeTab==='optimizer'?'active':''}" onclick="setTab('optimizer')">⚖️ Sourcing Optimizer</button>
        <button class="tab-pill-btn ${S.activeTab==='baseline'?'active':''}" onclick="setTab('baseline')">🎯 Baseline Comparison (Table 9)</button>
      </div>

      ${tabBody}
    </div>
    ${S.selectedSupplier ? renderSupplierModal(S.selectedSupplier) : ''}
  `;
}

function handleSort(col) {
  if (S.sortCol === col) {
    S.sortAsc = !S.sortAsc;
  } else {
    S.sortCol = col;
    S.sortAsc = (col === 'rank' || col === 'avgDelay');
  }
  render();
}

function renderScorecardTable(scored, avail, excluded) {
  const maxC = Math.max(...scored.map(s => s.composite ?? 0), 1);
  let sorted = [...scored];
  if (S.sortCol) {
    sorted.sort((a, b) => {
      let va = a[S.sortCol] ?? (a.pillars ? a.pillars[S.sortCol] : null) ?? 0;
      let vb = b[S.sortCol] ?? (b.pillars ? b.pillars[S.sortCol] : null) ?? 0;
      return S.sortAsc ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
    });
  }

  const filtered = sorted.filter(s => s.name.toLowerCase().includes((S.searchQuery || '').toLowerCase()));

  const rows = filtered.map(s => {
    let rBadge = 'rank-plain';
    if (s.rank === 1) rBadge = 'rank-gold';
    else if (s.rank === 2) rBadge = 'rank-silver';
    else if (s.rank === 3) rBadge = 'rank-bronze';

    const onTimeGood = s.onTime >= 0.95;

    return `
      <tr class="row-interactive" onclick="inspectSupplier('${esc(s.name)}')">
        <td class="num"><span class="rank-badge-pill ${rBadge}">${s.rank}</span></td>
        <td>
          <div style="font-weight:700;color:var(--text-main)">${esc(s.name)}</div>
          <div style="font-size:11.5px;color:var(--text-muted)">${s.n} orders tracked</div>
        </td>
        <td class="num">
          <div class="progress-mini-bar"><div class="progress-mini-fill" style="width:${((s.composite ?? 0)/maxC)*100}%"></div></div>
          <b style="font-size:14px;color:var(--teal-600)">${fmt(s.composite)}</b>
        </td>
        <td class="num">${fmt(s.pillars.cost)}</td>
        <td class="num">${fmt(s.pillars.reliability)}</td>
        <td class="num">${fmt(s.pillars.resilience)}</td>
        <td class="num"><b style="color:${onTimeGood ? 'var(--emerald-600)' : 'var(--rose-600)'}">${fmt(s.onTime * 100, 1)}%</b></td>
        <td class="num">${fmt(s.avgDelay)} d</td>
        <td class="num">${s.topsisScore ? fmt(s.topsisScore) : '—'}</td>
        <td style="text-align:center"><button class="btn btn-secondary" style="padding:4px 10px;font-size:11px" onclick="event.stopPropagation();inspectSupplier('${esc(s.name)}')">Inspect 🔍</button></td>
      </tr>
    `;
  }).join('');

  const sortArrow = col => S.sortCol === col ? (S.sortAsc ? ' ↑' : ' ↓') : '';

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:12px">
      <input type="text" id="supplierSearch" placeholder="🔍 Search supplier name..." value="${esc(S.searchQuery || '')}" style="padding:8px 14px;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);font-family:var(--font-sans);min-width:260px;background:var(--bg-input);color:var(--text-main)">
      <div style="font-size:12.5px;color:var(--text-muted)">Click any row to open the complete Supplier Audit Inspector</div>
    </div>

    <div class="table-responsive"><table>
      <thead><tr>
        <th style="cursor:pointer" onclick="handleSort('rank')">Rank${sortArrow('rank')}</th>
        <th>Supplier</th>
        <th class="num" style="cursor:pointer" onclick="handleSort('composite')">Composite Score${sortArrow('composite')}</th>
        <th class="num" style="cursor:pointer" onclick="handleSort('cost')">Cost${sortArrow('cost')}</th>
        <th class="num" style="cursor:pointer" onclick="handleSort('reliability')">Reliability${sortArrow('reliability')}</th>
        <th class="num" style="cursor:pointer" onclick="handleSort('resilience')">Resilience${sortArrow('resilience')}</th>
        <th class="num" style="cursor:pointer" onclick="handleSort('onTime')">On-Time %${sortArrow('onTime')}</th>
        <th class="num" style="cursor:pointer" onclick="handleSort('avgDelay')">Avg Delay${sortArrow('avgDelay')}</th>
        <th class="num">TOPSIS</th>
        <th style="text-align:center">Action</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
}

// ---------- Figures 5, 6, 7, 8 SVG Charts ----------
function cleanShortName(s) {
  let c = s.replace(/\(.*?\)/g, '').trim();
  if (c.length > 25) c = c.slice(0, 23) + '...';
  return c;
}

function renderInteractiveCharts(scored, scenarios) {
  const svgFig5 = generateSVGCompositeBar(scored);
  const svgFig6 = generateSVGPillarBreakdown(scored.slice(0, 10));
  const svgFig7 = generateSVGBubbleChart(scored);
  const htmlFig8 = generateSensitivityHeatmap(scored.slice(0, 10), scenarios);

  return `
    <div class="chart-box">
      <h3 style="margin:0 0 4px;font-size:16px">Figure 5: Composite Score Ranking (All Vendors)</h3>
      <p style="margin:0 0 16px;font-size:13px;color:var(--text-muted)">Direct reproduction of Report Figure 5. Horizontal bar chart color-coded: Teal = Top 10 Leaders, Slate = Middle, Red = Bottom 5 Riskiest.</p>
      <div class="chart-svg-container">${svgFig5}</div>
      <div class="chart-legend-row">
        <span class="legend-chip"><span class="legend-box" style="background:#0D9488"></span> Top 10 Leaders</span>
        <span class="legend-chip"><span class="legend-box" style="background:#64748B"></span> Middle Tier</span>
        <span class="legend-chip"><span class="legend-box" style="background:#E11D48"></span> Bottom 5 High-Risk</span>
      </div>
    </div>

    <div class="chart-box">
      <h3 style="margin:0 0 4px;font-size:16px">Figure 6: Three-Pillar Breakdown of Top 10 Suppliers</h3>
      <p style="margin:0 0 16px;font-size:13px;color:var(--text-muted)">Cost Efficiency, Delivery Reliability, and Supply Chain Resilience breakdown for leaders.</p>
      <div class="chart-svg-container">${svgFig6}</div>
      <div class="chart-legend-row">
        <span class="legend-chip"><span class="legend-box" style="background:#F59E0B"></span> Cost Efficiency</span>
        <span class="legend-chip"><span class="legend-box" style="background:#0D9488"></span> Delivery Reliability</span>
        <span class="legend-chip"><span class="legend-box" style="background:#4F46E5"></span> Supply Chain Resilience</span>
      </div>
    </div>

    <div class="chart-box">
      <h3 style="margin:0 0 4px;font-size:16px">Figure 7: Price Index vs. Composite Score Trade-Off</h3>
      <p style="margin:0 0 16px;font-size:13px;color:var(--text-muted)">Bubble size is proportional to shipment volume. Reveals how cheap suppliers often fail on delivery execution.</p>
      <div class="chart-svg-container">${svgFig7}</div>
    </div>

    <div class="chart-box">
      <h3 style="margin:0 0 4px;font-size:16px">Figure 8: Sensitivity Analysis — Weight Scenario Stability</h3>
      <p style="margin:0 0 16px;font-size:13px;color:var(--text-muted)">Ranks under 4 strategic scenarios. Green = Top 3 (Safe recommendations), Red = Drops out of Top 8.</p>
      ${htmlFig8}
    </div>
  `;
}

function generateSVGCompositeBar(scored) {
  const n = scored.length;
  const barHeight = 22, gap = 6, padTop = 15, padLeft = 210, padRight = 50, padBottom = 25;
  const W = 800;
  const H = padTop + n * (barHeight + gap) + padBottom;
  const plotW = W - padLeft - padRight;

  let bars = '';
  scored.forEach((s, i) => {
    const y = padTop + i * (barHeight + gap);
    const score = s.composite ?? 0;
    const w = (score / 100) * plotW;
    let color = '#64748B';
    if (i < 10) color = '#0D9488';
    else if (i >= n - 5) color = '#E11D48';

    bars += `
      <text x="${padLeft - 12}" y="${y + 15}" font-size="11.5" fill="currentColor" text-anchor="end" font-weight="600">${cleanShortName(s.name)}</text>
      <rect x="${padLeft}" y="${y}" width="${w}" height="${barHeight}" rx="4" fill="${color}" opacity="0.9"></rect>
      <text x="${padLeft + w + 8}" y="${y + 15}" font-size="11" font-weight="700" fill="currentColor">${fmt(score)}</text>
    `;
  });

  let grid = '';
  for (let sc = 0; sc <= 100; sc += 20) {
    const gx = padLeft + (sc / 100) * plotW;
    grid += `
      <line x1="${gx}" y1="${padTop}" x2="${gx}" y2="${H - padBottom}" stroke="var(--border-subtle)" stroke-dasharray="3,3" />
      <text x="${gx}" y="${H - 8}" font-size="10" fill="var(--text-muted)" text-anchor="middle">${sc}</text>
    `;
  }
  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg-element">${grid}${bars}</svg>`;
}

function generateSVGPillarBreakdown(top10) {
  const W = 800, H = 270, padTop = 25, padLeft = 45, padRight = 20, padBottom = 55;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;
  const groupW = plotW / top10.length;
  const barW = (groupW - 14) / 3;

  let bars = '', labels = '', grid = '';
  for (let s = 0; s <= 100; s += 25) {
    const gy = padTop + plotH - (s / 100) * plotH;
    grid += `
      <line x1="${padLeft}" y1="${gy}" x2="${W - padRight}" y2="${gy}" stroke="var(--border-subtle)" stroke-dasharray="2,2"/>
      <text x="${padLeft - 8}" y="${gy + 4}" font-size="10" fill="var(--text-muted)" text-anchor="end">${s}</text>
    `;
  }

  top10.forEach((s, i) => {
    const gx = padLeft + i * groupW + 7;
    const cH = ((s.pillars.cost ?? 0) / 100) * plotH;
    const rH = ((s.pillars.reliability ?? 0) / 100) * plotH;
    const sH = ((s.pillars.resilience ?? 0) / 100) * plotH;

    bars += `
      <rect x="${gx}" y="${padTop + plotH - cH}" width="${barW}" height="${cH}" rx="2" fill="#F59E0B"></rect>
      <rect x="${gx + barW + 1}" y="${padTop + plotH - rH}" width="${barW}" height="${rH}" rx="2" fill="#0D9488"></rect>
      <rect x="${gx + 2*barW + 2}" y="${padTop + plotH - sH}" width="${barW}" height="${sH}" rx="2" fill="#4F46E5"></rect>
    `;
    labels += `
      <text x="${gx + groupW/2 - 7}" y="${H - padBottom + 16}" font-size="9.5" fill="currentColor" text-anchor="end" font-weight="600" transform="rotate(-30, ${gx + groupW/2 - 7}, ${H - padBottom + 16})">${cleanShortName(s.name)}</text>
    `;
  });
  return `<svg viewBox="0 0 ${W} ${H}" class="chart-svg-element">${grid}${bars}${labels}</svg>`;
}

function generateSVGBubbleChart(scored) {
  const W = 800, H = 320, padTop = 25, padLeft = 55, padRight = 40, padBottom = 45;
  const plotW = W - padLeft - padRight;
  const plotH = H - padTop - padBottom;
  const valid = scored.filter(s => s.pidx != null);
  const minLog = Math.log10(0.3), maxLog = Math.log10(30);
  const minScore = 35, maxScore = 90;

  const getX = p => padLeft + ((Math.log10(Math.max(0.3, p)) - minLog) / (maxLog - minLog)) * plotW;
  const getY = s => padTop + plotH - ((s - minScore) / (maxScore - minScore)) * plotH;

  const refX = getX(1.0);
  let grid = `
    <line x1="${refX}" y1="${padTop}" x2="${refX}" y2="${H - padBottom}" stroke="#D97706" stroke-dasharray="4,4" stroke-width="1.5" />
    <text x="${refX + 6}" y="${padTop + 14}" font-size="10" fill="#D97706" font-weight="700">Market Median Benchmark (1.0x)</text>
  `;

  for (let sc = 40; sc <= 90; sc += 10) {
    const gy = getY(sc);
    grid += `
      <line x1="${padLeft}" y1="${gy}" x2="${W - padRight}" y2="${gy}" stroke="var(--border-subtle)" stroke-dasharray="2,2"/>
      <text x="${padLeft - 8}" y="${gy + 4}" font-size="10" fill="var(--text-muted)" text-anchor="end">${sc}</text>
    `;
  }
  [0.4, 1.0, 2.0, 5.0, 10.0, 25.0].forEach(pv => {
    const gx = getX(pv);
    grid += `<text x="${gx}" y="${H - padBottom + 16}" font-size="10" fill="var(--text-muted)" text-anchor="middle">${pv}x</text>`;
  });

  let bubbles = '', labels = '';
  valid.forEach((s, i) => {
    const cx = getX(s.pidx);
    const cy = getY(s.composite ?? 50);
    const rad = Math.max(5, Math.min(22, Math.sqrt(s.n) * 0.7));
    let col = '#64748B';
    if (i < 10) col = '#0D9488';
    else if (i >= valid.length - 5) col = '#E11D48';

    bubbles += `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${col}" fill-opacity="0.8" stroke="var(--bg-card)" stroke-width="1.5"><title>${esc(s.name)}: Score ${fmt(s.composite)}, PriceIdx ${fmt(s.pidx, 2)}, Shipments ${s.n}</title></circle>`;

    const notable = ['micro labs', 'strides', 'aurobindo', 'cipla', 'shanghai', 'bristol', 'pharmacy direct', 'zenith', 'bargain'];
    if (notable.some(sub => s.name.toLowerCase().includes(sub))) {
      labels += `<text x="${cx + rad + 4}" y="${cy + 4}" font-size="9.5" font-weight="700" fill="currentColor">${cleanShortName(s.name)}</text>`;
    }
  });

  return `
    <svg viewBox="0 0 ${W} ${H}" class="chart-svg-element">
      ${grid}
      ${bubbles}
      ${labels}
      <text x="${W/2}" y="${H - 8}" font-size="11" fill="var(--text-muted)" text-anchor="middle">Price Index (Log Scale — Below 1.0x = Cheaper than Product Group Median)</text>
      <text x="14" y="${H/2}" font-size="11" fill="var(--text-muted)" text-anchor="middle" transform="rotate(-90, 14, ${H/2})">Composite Score</text>
    </svg>
  `;
}

function generateSensitivityHeatmap(top10, scenarios) {
  const rows = top10.map(s => {
    const scCells = Object.keys(PRESETS).map(p => {
      const r = scenarios[p][s.name];
      let bg = 'var(--bg-subtle)';
      let col = 'var(--text-main)';
      if (r <= 3) { bg = 'var(--emerald-50)'; col = 'var(--emerald-600)'; }
      else if (r > 8) { bg = 'var(--rose-50)'; col = 'var(--rose-600)'; }
      return `<td class="num"><span style="background:${bg};color:${col};padding:3px 10px;border-radius:var(--radius-sm);font-weight:800;font-family:var(--font-mono)">${r}</span></td>`;
    }).join('');
    return `<tr><td><b>${esc(s.name)}</b></td>${scCells}</tr>`;
  }).join('');

  return `
    <div class="table-responsive"><table>
      <thead><tr>
        <th>Top 10 Supplier</th>
        ${Object.keys(PRESETS).map(p => `<th class="num">${p}</th>`).join('')}
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
}

// ---------- FinTech View ----------
function renderFintechView(fintechData) {
  const p = S.finParams;
  const rows = fintechData.map(s => `
    <tr>
      <td class="num"><span class="rank-badge-pill rank-plain">${s.rank}</span></td>
      <td><b>${esc(s.name)}</b></td>
      <td class="num">${fmt(s.delayStd)} d</td>
      <td class="num">${s.ssUnits.toLocaleString()}</td>
      <td class="num">$${fmt(s.capitalLocked, 0)}</td>
      <td class="num">$${fmt(s.annualHoldingCost, 0)}</td>
      <td class="num">$${fmt(s.basePrice, 2)}</td>
      <td class="num" style="color:var(--rose-600)">+$${fmt(s.holdingCostPerUnit, 3)}</td>
      <td class="num"><b style="color:var(--teal-600)">$${fmt(s.trueLandedCost, 2)}</b></td>
    </tr>
  `).join('');

  return `
    <div class="card-subtext" style="margin-bottom:16px">Translates lead-time volatility into financial impact. High delivery delay spread forces procurement to hold extra safety stock, quietly raising the real landed cost.</div>
    
    <div class="kpi-row" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
      <div class="kpi-card">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;font-weight:600">Annual Demand (units)</label>
        <input type="number" id="finDemand" value="${p.demand}" min="1000" step="5000" style="width:100%;padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);font-family:var(--font-mono);background:var(--bg-input);color:var(--text-main)">
      </div>
      <div class="kpi-card">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;font-weight:600">Holding Cost Rate (%/yr)</label>
        <input type="number" id="finRate" value="${p.holdingRate}" min="5" max="50" style="width:100%;padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);font-family:var(--font-mono);background:var(--bg-input);color:var(--text-main)">
      </div>
      <div class="kpi-card">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;font-weight:600">Target Service Level (%)</label>
        <input type="number" id="finService" value="${p.serviceLevel}" min="80" max="99" style="width:100%;padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);font-family:var(--font-mono);background:var(--bg-input);color:var(--text-main)">
      </div>
    </div>

    <div class="table-responsive" style="margin-top:18px"><table>
      <thead><tr>
        <th>Rank</th>
        <th>Supplier</th>
        <th class="num">Delay Spread (σ)</th>
        <th class="num">Buffer Safety Stock</th>
        <th class="num">Capital Tied Up</th>
        <th class="num">Annual Carrying Cost</th>
        <th class="num">Sticker Price</th>
        <th class="num">Risk Penalty/Unit</th>
        <th class="num">True Landed Cost</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
}

// ---------- What-If Optimizer View ----------
function renderOptimizerView(allocation) {
  const opt = S.optParams;
  const colors = ['#0D9488', '#0284C7', '#D97706', '#4F46E5', '#E11D48', '#059669', '#64748B'];

  const barSegments = allocation.allocations.map((a, i) => `
    <div class="order-alloc-part" style="width:${a.pct}%;background:${colors[i % colors.length]}">
      ${cleanShortName(a.name)} (${fmt(a.pct, 0)}%)
    </div>
  `).join('');

  const rows = allocation.allocations.map((a, i) => `
    <tr>
      <td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${colors[i % colors.length]};margin-right:8px"></span> <b>${esc(a.name)}</b></td>
      <td class="num">${a.units.toLocaleString()}</td>
      <td class="num"><b>${fmt(a.pct, 1)}%</b></td>
      <td class="num">${fmt(a.onTime * 100, 1)}%</td>
      <td class="num">${fmt(a.cost, 2)}x</td>
    </tr>
  `).join('');

  return `
    <div class="card-subtext" style="margin-bottom:16px">Linear programming solver that distributes order quantity across top suppliers to minimize cost while guaranteeing target delivery reliability.</div>

    <div class="kpi-row" style="grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));">
      <div class="kpi-card">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;font-weight:600">Total Order Volume (units)</label>
        <input type="number" id="optVolume" value="${opt.orderVolume}" min="10000" step="10000" style="width:100%;padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);font-family:var(--font-mono);background:var(--bg-input);color:var(--text-main)">
      </div>
      <div class="kpi-card">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;font-weight:600">Min Target Reliability (%)</label>
        <input type="number" id="optRel" value="${opt.minReliability}" min="80" max="100" style="width:100%;padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);font-family:var(--font-mono);background:var(--bg-input);color:var(--text-main)">
      </div>
      <div class="kpi-card">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;font-weight:600">Max Single Vendor Cap (%)</label>
        <input type="number" id="optShare" value="${opt.maxShare}" min="20" max="100" style="width:100%;padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border-subtle);font-family:var(--font-mono);background:var(--bg-input);color:var(--text-main)">
      </div>
    </div>

    <div style="margin: 20px 0 10px;">
      <div style="font-size:13px;font-weight:700;color:var(--text-sub);margin-bottom:6px">Optimal Order Allocation Split:</div>
      <div class="order-alloc-stack">
        ${barSegments}
      </div>
    </div>

    <div class="kpi-row" style="margin: 18px 0;">
      <div class="kpi-card">
        <div class="kpi-num" style="color:var(--emerald-600)">${fmt(allocation.blendedRel * 100, 1)}%</div>
        <div class="kpi-caption">Blended On-Time Delivery Rate</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">${fmt(allocation.blendedCost, 2)}x</div>
        <div class="kpi-caption">Blended Price Index</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-num">${allocation.allocations.length}</div>
        <div class="kpi-caption">Diversified Suppliers</div>
      </div>
    </div>

    <div class="table-responsive"><table>
      <thead><tr>
        <th>Allocated Supplier</th>
        <th class="num">Order Units</th>
        <th class="num">Share %</th>
        <th class="num">Reliability Rate</th>
        <th class="num">Price Index</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
  `;
}

// ---------- Baseline View ----------
function renderBaselineView(priceOnly, scored) {
  const cheapest = priceOnly.slice(0, 6);
  const rows = cheapest.map((s, i) => {
    const scMatch = scored.find(x => x.name === s.name);
    const scRank = scMatch ? scMatch.rank : '—';
    return `
      <tr>
        <td class="num"><span class="rank-badge-pill rank-plain">#${i + 1}</span></td>
        <td><b>${esc(s.name)}</b></td>
        <td class="num">${fmt(s.pidx ?? s.rawPrice, 2)}x</td>
        <td class="num"><b style="color:${scRank <= 10 ? 'var(--emerald-600)' : 'var(--rose-600)'}">#${scRank}</b></td>
        <td class="num">${fmt(s.onTime * 100, 1)}%</td>
        <td class="num">${fmt(s.avgDelay)} d</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="card-subtext" style="margin-bottom:16px">Direct replication of Table 9 from the report. Illustrates how low sticker prices deceive buyers when delivery failure rates are omitted.</div>
    <div class="table-responsive"><table>
      <thead><tr>
        <th>Price Rank</th>
        <th>Supplier</th>
        <th class="num">Price Index</th>
        <th class="num">Scorecard Rank</th>
        <th class="num">On-Time Rate</th>
        <th class="num">Avg Delay</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="callout-box" style="margin-top:20px">
      <b>Key Finding from USAID Dataset:</b> Aurobindo Pharma and Cipla rank 5th and 6th cheapest on price alone, but plummet to 22nd and 24th out of 25 once reliability is factored in, because ~14% of shipments arrive late with 4–5 days average delay.
    </div>
  `;
}

// ---------- Supplier Drill-down Modal ----------
function inspectSupplier(name) {
  const s = S.result.scored.find(x => x.name === name);
  if (!s) return;
  S.selectedSupplier = s;
  render();
}

function closeSupplierModal() {
  S.selectedSupplier = null;
  render();
}

function renderSupplierModal(s) {
  return `
    <div class="modal-layer" onclick="if(event.target===this)closeSupplierModal()">
      <div class="modal-dialog">
        <div class="modal-header-row">
          <div>
            <h3 style="margin:0;font-size:19px;font-weight:800">${esc(s.name)}</h3>
            <span style="font-size:12.5px;color:var(--text-muted)">Supplier Detailed Audit & Risk Profile</span>
          </div>
          <button class="modal-close-btn" onclick="closeSupplierModal()">&times;</button>
        </div>

        <div class="kpi-row" style="grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));">
          <div class="kpi-card">
            <div class="kpi-num" style="color:var(--teal-600)">#${s.rank}</div>
            <div class="kpi-caption">Executive Rank</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-num">${fmt(s.composite)}</div>
            <div class="kpi-caption">Composite Score</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-num">${s.n}</div>
            <div class="kpi-caption">Total Orders</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-num" style="color:${s.onTime >= 0.95 ? 'var(--emerald-600)' : 'var(--rose-600)'}">${fmt(s.onTime*100, 1)}%</div>
            <div class="kpi-caption">On-Time Rate</div>
          </div>
        </div>

        <h4 style="margin:18px 0 8px;font-size:14px">Pillar Scores (0–100 Scale)</h4>
        <div class="table-responsive" style="margin-bottom:18px"><table>
          <tr><td><b>Cost Efficiency</b></td><td class="num"><b>${fmt(s.pillars.cost)}</b></td></tr>
          <tr><td><b>Delivery Reliability</b></td><td class="num"><b>${fmt(s.pillars.reliability)}</b></td></tr>
          <tr><td><b>Supply Chain Resilience</b></td><td class="num"><b>${fmt(s.pillars.resilience)}</b></td></tr>
        </table></div>

        <h4 style="margin:18px 0 8px;font-size:14px">Operational Metrics</h4>
        <div class="table-responsive"><table>
          <tr><td>Price Index (vs product group median)</td><td class="num">${s.pidx!=null ? fmt(s.pidx, 2) + 'x' : '—'}</td></tr>
          <tr><td>Freight Ratio (Freight Cost / Order Value)</td><td class="num">${s.fr!=null ? fmt(s.fr, 3) : '—'}</td></tr>
          <tr><td>Average Delivery Delay</td><td class="num">${fmt(s.avgDelay)} days</td></tr>
          <tr><td>Delay Spread (Standard Deviation σ)</td><td class="num">${fmt(s.delayStd)} days</td></tr>
          <tr><td>Monthly On-Time Rate Spread</td><td class="num">${s.monthStd!=null ? fmt(s.monthStd, 3) : '—'}</td></tr>
        </table></div>

        <div style="text-align:right;margin-top:22px">
          <button class="btn btn-primary" onclick="closeSupplierModal()">Close Inspector</button>
        </div>
      </div>
    </div>
  `;
}

function preset(name) { S.weights = {...PRESETS[name]}; render(); }

function exportCsv() {
  const r = S.result.scored;
  const head = ['rank','supplier','composite','cost','reliability','resilience','shipments','on_time_rate','avg_delay_days','price_index','freight_ratio'];
  const lines = r.map((s, i) => [i + 1, s.name, fmt(s.composite, 2), fmt(s.pillars.cost, 2), fmt(s.pillars.reliability, 2),
    fmt(s.pillars.resilience, 2), s.n, fmt(s.onTime, 4), fmt(s.avgDelay, 2), fmt(s.pidx, 3), fmt(s.fr, 3)].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([[head.join(','), ...lines].join('\n')], {type: 'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'supplyrank_results.csv'; a.click();
}

function isCsv(file) {
  const nameOk = /\.csv$/i.test(file.name);
  const typeOk = file.type === '' || /csv/i.test(file.type);
  return nameOk && typeOk;
}

async function loadDatasetUrl(url, displayName, defaultMinShip = 20) {
  const err = $('#loadErr');
  if (err) err.innerHTML = `<div class="callout-box">Loading ${displayName}...</div>`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    const parsed = Papa.parse(text, {header: true, skipEmptyLines: true});
    S.headers = parsed.meta.fields || [];
    S.rows = parsed.data;
    S.currentDatasetName = displayName;
    S.minShip = defaultMinShip;
    S.map = autoMap(S.headers);
    S.clean = null; S.result = null;
    S.step = 2; render();
  } catch (e) {
    if (err) err.innerHTML = `<div class="callout-box warn"><b>Could not fetch file:</b> Please select ${displayName} using the file upload box above.</div>`;
  }
}

function cycleTheme() {
  const order = ['mix', 'dark', 'light'];
  const current = document.documentElement.dataset.theme || 'mix';
  const next = order[(order.indexOf(current) + 1) % order.length];
  document.documentElement.dataset.theme = next;
  localStorage.setItem('theme', next);
  const lbl = $('#themeNameLabel');
  if (lbl) lbl.textContent = next.charAt(0).toUpperCase() + next.slice(1);
}

function bind() {
  const themeBtn = $('#themeToggleBtn');
  if (themeBtn) themeBtn.onclick = cycleTheme;

  const benchBtn = $('#loadBenchmarkBtn');
  if (benchBtn) benchBtn.onclick = () => loadDatasetUrl('sample-data.csv', 'USAID SCMS Delivery History (10.3k rows)', 20);

  const dummyBtn = $('#loadDummyBtn');
  if (dummyBtn) dummyBtn.onclick = () => loadDatasetUrl('dummy-suppliers.csv', 'Quick Test Dummy CSV (190 rows)', 15);

  const dropBox = $('#dropzoneBox');
  const fileInput = $('#file');
  if (dropBox && fileInput) {
    dropBox.onclick = () => fileInput.click();
    dropBox.ondragover = e => { e.preventDefault(); dropBox.classList.add('dragover'); };
    dropBox.ondragleave = () => { dropBox.classList.remove('dragover'); };
    dropBox.ondrop = e => {
      e.preventDefault();
      dropBox.classList.remove('dragover');
      if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    };
    fileInput.onchange = e => {
      if (e.target.files.length) handleFile(e.target.files[0]);
    };
  }

  async function handleFile(file) {
    const err = $('#loadErr');
    if (!file) return;
    if (!isCsv(file)) {
      if (err) err.innerHTML = `<div class="callout-box warn">"${esc(file.name)}" is not a CSV file. Please select a valid .csv file.</div>`;
      return;
    }
    if (err) err.innerHTML = '';
    const buf = await file.arrayBuffer();
    let text;
    try { text = new TextDecoder('utf-8', {fatal: true}).decode(buf); }
    catch { text = new TextDecoder('windows-1252').decode(buf); }
    const parsed = Papa.parse(text, {header: true, skipEmptyLines: true});
    S.headers = parsed.meta.fields || [];
    S.rows = parsed.data;
    S.currentDatasetName = file.name;
    S.minShip = S.rows.length < 500 ? 10 : 20;
    S.map = autoMap(S.headers);
    S.clean = null; S.result = null;
    S.step = 2; render();
  }

  document.querySelectorAll('select[data-role]').forEach(sel => sel.onchange = e => {
    const v = e.target.value;
    if (v) S.map[sel.dataset.role] = v; else delete S.map[sel.dataset.role];
    render();
  });

  const nx = $('#mapNext'); if (nx) nx.onclick = () => { S.clean = null; goto(3); };

  document.querySelectorAll('input[data-w]').forEach(inp => inp.oninput = e => {
    S.weights[inp.dataset.w] = +e.target.value;
    const totalW = (S.weights.cost + S.weights.reliability + S.weights.resilience) || 1;
    const pct = Math.round((S.weights[inp.dataset.w] / totalW) * 100);
    inp.parentElement.querySelector('.slider-val-box').innerHTML = `${e.target.value}x <span style="font-size:11px;color:var(--text-muted)">(${pct}%)</span>`;
  });

  // AHP inputs
  const acr = $('#ahp_c_r'); if (acr) acr.oninput = e => { S.ahp.cost_rel = +e.target.value; render(); };
  const acs = $('#ahp_c_s'); if (acs) acs.oninput = e => { S.ahp.cost_res = +e.target.value; render(); };
  const ars = $('#ahp_r_s'); if (ars) ars.oninput = e => { S.ahp.rel_res = +e.target.value; render(); };

  // FinTech inputs
  const fDem = $('#finDemand'); if (fDem) fDem.onchange = e => { S.finParams.demand = +e.target.value || 50000; render(); };
  const fRate = $('#finRate'); if (fRate) fRate.onchange = e => { S.finParams.holdingRate = +e.target.value || 20; render(); };
  const fServ = $('#finService'); if (fServ) fServ.onchange = e => { S.finParams.serviceLevel = +e.target.value || 95; render(); };

  // Optimizer inputs
  const oVol = $('#optVolume'); if (oVol) oVol.onchange = e => { S.optParams.orderVolume = +e.target.value || 100000; render(); };
  const oRel = $('#optRel'); if (oRel) oRel.onchange = e => { S.optParams.minReliability = +e.target.value || 96; render(); };
  const oShare = $('#optShare'); if (oShare) oShare.onchange = e => { S.optParams.maxShare = +e.target.value || 40; render(); };

  const searchInp = $('#supplierSearch');
  if (searchInp) searchInp.oninput = e => {
    S.searchQuery = e.target.value;
    const container = document.querySelector('.table-responsive');
    if (container && container.parentElement) {
      container.parentElement.innerHTML = renderScorecardTable(S.result.scored, S.result.avail, S.result.excluded);
      const newInp = $('#supplierSearch');
      if (newInp) {
        newInp.focus();
        newInp.setSelectionRange(newInp.value.length, newInp.value.length);
        newInp.oninput = searchInp.oninput;
      }
    }
  };

  const mi = $('#minShip'); if (mi) mi.onchange = e => { S.minShip = Math.max(1, +e.target.value || 1); };
  const rb = $('#runBtn'); if (rb) rb.onclick = () => {
    if (mi) S.minShip = Math.max(1, parseInt(mi.value, 10) || 1);
    goto(5);
  };
}

// Restore saved theme (default to mix)
const savedTheme = localStorage.getItem('theme') || 'mix';
document.documentElement.dataset.theme = savedTheme;
const themeLbl = $('#themeNameLabel');
if (themeLbl) themeLbl.textContent = savedTheme.charAt(0).toUpperCase() + savedTheme.slice(1);

render();
