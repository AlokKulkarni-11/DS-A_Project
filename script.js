
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = (v, d = 1) => v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(d);

const STEPS = ['Upload', 'Map columns', 'Check data', 'Weights', 'Results'];

const ROLES = [
  {key:'supplier', label:'Supplier / vendor', req:true, re:/vendor|supplier/i, exclude:/inco|term|country|address|contact|site/i,
   prefer:['vendor','supplier','vendor name','supplier name'],
   help:'The company you buy from. Every unique value in this column becomes one supplier on the scorecard.'},
  {key:'scheduled', label:'Promised delivery date', req:true, re:/scheduled|promised|due date|expected/i, exclude:/sent|recorded|created|invoice/i,
   prefer:['scheduled delivery date','promised delivery date','due date'],
   help:'The date the supplier was supposed to deliver. Delay = actual date minus this date.'},
  {key:'delivered', label:'Actual delivery date', req:true, re:/delivered|actual delivery|received/i, exclude:/recorded|sent|invoice/i,
   prefer:['delivered to client date','actual delivery date','delivered date'],
   help:'The date the delivery actually arrived. Used for on-time rate and delay.'},
  {key:'price', label:'Unit price', req:false, re:/unit price/i,
   prefer:['unit price'],
   help:'Optional. Enables the price-index cost metric (price compared to the median for the same product).'},
  {key:'product', label:'Product group / category', req:false, re:/product group|category|product/i, exclude:/code|id|description/i,
   prefer:['product group','category','product category'],
   help:'Optional. Keeps price comparisons fair: a cheap item is not a good deal just because it is a cheap product.'},
  {key:'freight', label:'Freight (shipping) cost', req:false, re:/freight/i, exclude:/term|mode/i,
   prefer:['freight cost (usd)','freight cost'],
   help:'Optional. With line item value, enables the freight-ratio cost metric.'},
  {key:'value', label:'Line item value (order total)', req:false, re:/line item value|order value|total value/i,
   prefer:['line item value'],
   help:'Optional. Total value of the order line. Needed for the freight ratio.'},
];

const METRICS = [
  {key:'pidx', pillar:'cost', lower:true, label:'Price index', help:'Average unit price ÷ median price for the same product. Below 1.0 = cheaper than typical.'},
  {key:'fr', pillar:'cost', lower:true, label:'Freight ratio', help:'Freight cost ÷ order value. Shows how much shipping eats into the price.'},
  {key:'onTime', pillar:'reliability', lower:false, label:'On-time rate', help:'Share of deliveries that arrived on or before the promised date.'},
  {key:'avgDelay', pillar:'reliability', lower:true, label:'Avg delay (days)', help:'Average of actual minus promised days. Negative means early.'},
  {key:'delayStd', pillar:'resilience', lower:true, label:'Delay spread', help:'Standard deviation of delay. Lower = more predictable.'},
  {key:'monthStd', pillar:'resilience', lower:true, label:'Monthly consistency', help:'Spread of on-time rate across months. Lower = performance holds up over time.'},
];

const PRESETS = {
  'Equal': {cost:1, reliability:1, resilience:1},
  'Cost-first': {cost:3, reliability:1, resilience:1},
  'Reliability-first': {cost:1, reliability:3, resilience:1},
  'Resilience-first': {cost:1, reliability:1, resilience:3},
};

const S = {step:1, rows:[], headers:[], map:{}, clean:null, weights:{...PRESETS.Equal}, minShip:20, result:null};

// ---------- helpers ----------
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sum = a => a.reduce((x, y) => x + y, 0);
const std = a => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(mean(a.map(x => (x - m) ** 2))); };
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
    // 1. exact match against known good column names (case/whitespace-insensitive)
    if (r.prefer) {
      found = headers.find(h => !used.has(h) && r.prefer.includes(h.trim().toLowerCase()));
    }
    // 2. fallback: regex match, skipping obviously-wrong columns, shortest header wins (most specific)
    if (!found) {
      const candidates = headers.filter(h => !used.has(h) && r.re.test(h) && !(r.exclude && r.exclude.test(h)));
      candidates.sort((a, b) => a.length - b.length);
      found = candidates[0];
    }
    if (found) { map[r.key] = found; used.add(found); }
  }
  return map;
}

// ---------- pipeline ----------
function buildClean() {
  const m = S.map, rows = [], drop = {supplier:0, date:0};
  let badPrice = 0, badFreight = 0, badValue = 0;
  for (const r of S.rows) {
    const supplier = String(r[m.supplier] ?? '').trim();
    if (!supplier) { drop.supplier++; continue; }
    const s = parseDate(r[m.scheduled]), d = parseDate(r[m.delivered]);
    if (!s || !d) { drop.date++; continue; }
    const rec = {supplier, delay: (d - s) / 864e5, month: s.getUTCFullYear() * 12 + s.getUTCMonth(),
                 product: m.product ? String(r[m.product] ?? '').trim() : 'ALL', price: null, freight: null, value: null};
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
    out.push({
      name, n: rs.length,
      onTime: rs.filter(r => r.delay <= 0).length / rs.length,
      avgDelay: mean(delays),
      delayStd: std(delays),
      monthStd: monthRates.length > 1 ? std(monthRates) : null,
      pidx: idx.length ? mean(idx) : null,
      fr: both.length && sum(both.map(r => r.value)) > 0 ? sum(both.map(r => r.freight)) / sum(both.map(r => r.value)) : null,
      rawPrice: S.map.price ? mean(rs.filter(r => r.price != null).map(r => r.price)) : null,
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
    const pillars = {};
    for (const p of ['cost', 'reliability', 'resilience']) {
      const ns = avail.filter(m => m.pillar === p && s[m.key] != null).map(m => norm(m, s[m.key]));
      pillars[p] = ns.length ? mean(ns) : null;
    }
    let num = 0, den = 0;
    for (const p in pillars) if (pillars[p] != null && w[p] > 0) { num += w[p] * pillars[p]; den += w[p]; }
    return {...s, pillars, composite: den ? num / den : null};
  }).sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1));
}

function runAll() {
  const {out, excluded} = supplierMetrics(S.clean.rows, S.minShip);
  const scored = scoreAll(out, S.weights);
  const scenarios = {};
  for (const [name, w] of Object.entries(PRESETS)) {
    scenarios[name] = {};
    scoreAll(out, w).forEach((s, i) => scenarios[name][s.name] = i + 1);
  }
  const priceOnly = out.filter(s => s.pidx != null || s.rawPrice != null)
    .sort((a, b) => (a.pidx ?? a.rawPrice) - (b.pidx ?? b.rawPrice));
  S.result = {scored, excluded, scenarios, priceOnly, avail: METRICS.filter(m => out.some(s => s[m.key] != null))};
}

// ---------- rendering ----------
function renderSteps() {
  $('#steps').innerHTML = STEPS.map((label, i) => {
    const n = i + 1;
    const disabled = (n > 1 && !S.rows.length) || (n > 2 && !S.map.supplier) || (n > 4 && !S.clean) ? 'disabled' : '';
    return `<button class="${S.step === n ? 'on' : ''}" ${disabled} onclick="goto(${n})"><span class="n">0${n}</span>${label}</button>`;
  }).join('');
}

function goto(n) { S.step = n; render(); }

function render() {
  renderSteps();
  const app = $('#app');
  const view = {1: viewUpload, 2: viewMap, 3: viewClean, 4: viewWeights, 5: viewResults}[S.step];
  app.innerHTML = view();
  bind();
}

function viewUpload() {
  return `
    <div class="panel">
      <h2>Upload your CSV</h2>
      <p class="small">One row per order, shipment, or delivery. Each row needs at least a supplier name and two dates.</p>
      <input type="file" id="file" accept=".csv,text/csv">
      ${S.rows.length ? `<p class="ok" style="margin-bottom:0">Loaded ${S.rows.length.toLocaleString()} rows across ${S.headers.length} columns.</p>` : ''}
      <div id="loadErr"></div>
    </div>
    <div class="note"><b>What to prepare</b>The file needs a header row. Dates can be in most common formats — 2-Jun-06, 2006-06-02, or 06/02/2006 all work. Text such as "Not Available" in a numeric column is fine; those values are skipped, not fatal.</div>`;
}

function viewMap() {
  const rows = ROLES.map(r => {
    const usedElsewhere = new Set(Object.entries(S.map).filter(([k]) => k !== r.key).map(([, v]) => v));
    const opts = S.headers.filter(h => !usedElsewhere.has(h) || S.map[r.key] === h);
    return `
    <div class="field">
      <label>${r.label}${r.req ? ' <span class="req">*</span>' : ''}</label>
      <select data-role="${r.key}">
        <option value="">— none —</option>
        ${opts.map(h => `<option value="${esc(h)}" ${S.map[r.key] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}
      </select>
      <div class="fhelp">${r.help}</div>
    </div>`;
  }).join('');
  const missing = ROLES.filter(r => r.req && !S.map[r.key]).map(r => r.label);
  return `
    <div class="panel">
      <h2>Map your columns</h2>
      <p class="small">Each column can only be assigned to one role — once picked here it drops out of the other dropdowns. We guessed the matches from column names; change any that are wrong.</p>
      ${rows}
      ${missing.length ? `<p class="err">Required but not set: ${missing.join(', ')}</p>` : ''}
      <button class="btn" id="mapNext" ${missing.length ? 'disabled' : ''}>Check data →</button>
    </div>`;
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
    S.map.price && c.badPrice ? `${c.badPrice} unit price values are not numbers (skipped for price index)` : null,
    S.map.freight && c.badFreight ? `${c.badFreight} freight values are not numbers (skipped for freight ratio)` : null,
    S.map.value && c.badValue ? `${c.badValue} line value entries are not numbers` : null,
  ].filter(Boolean);
  return `
    <div class="panel">
      <h2>Check the cleaned data</h2>
      <div class="stats">
        <div><b>${c.total.toLocaleString()}</b><span class="lbl">rows in file</span></div>
        <div><b>${c.rows.length.toLocaleString()}</b><span class="lbl">usable rows</span></div>
        <div><b>${nSup}</b><span class="lbl">suppliers found</span></div>
        <div><b>${eligible}</b><span class="lbl">meet ${S.minShip}-shipment minimum</span></div>
      </div>
      ${dropped ? `<p class="warn">${dropped} rows dropped: ${c.drop.supplier} missing a supplier, ${c.drop.date} with unreadable dates.</p>` : '<p class="ok">No rows dropped.</p>'}
      ${textIssues.map(t => `<p class="warn">${t}.</p>`).join('')}
      <p class="small">Numbers with commas or $ signs are read correctly. Non-numeric text is left blank instead of breaking the calculation.</p>
      <button class="btn" onclick="goto(4)">Set weights →</button>
    </div>
    <div class="note"><b>Why a minimum shipment count?</b>Suppliers with very few shipments get noisy scores — one late delivery can swing their rate a lot. Suppliers below the minimum sit out of the ranking. Change the minimum on the next step.</div>`;
}

function viewWeights() {
  const labels = {cost:'Cost efficiency', reliability:'Delivery reliability', resilience:'Resilience'};
  const helps = {
    cost: 'How cheap the supplier is relative to similar items, plus freight overhead.',
    reliability: 'How often the supplier delivers on the promised date, and how late it is on average.',
    resilience: 'How steady the supplier is: delay spread and consistency across months.',
  };
  const avail = METRICS.filter(m => S.clean.rows.length && m.key);
  const pillarAvail = p => METRICS.some(m => m.pillar === p && ((p === 'cost' && (S.map.price || (S.map.freight && S.map.value)))
    || (p !== 'cost')));
  return `
    <div class="panel">
      <h2>Set weights</h2>
      <div class="presets">
        ${Object.keys(PRESETS).map(n => `<button class="btn" onclick="preset('${n}')">${n}</button>`).join('')}
      </div>
      ${['cost','reliability','resilience'].map(p => `
        <div class="weightrow">
          <span class="wname">${labels[p]}${pillarAvail(p) ? '' : ' <span class="small">(no data)</span>'}</span>
          <input type="range" min="0" max="5" step="1" value="${S.weights[p]}" data-w="${p}">
          <span class="wval">${S.weights[p]}</span>
        </div>
        <div class="wsub">${helps[p]}</div>`).join('')}
      <div class="field" style="margin-top:10px">
        <label>Minimum shipments / supplier</label>
        <input type="number" min="1" max="500" value="${S.minShip}" id="minShip">
      </div>
      <button class="btn" id="runBtn">Calculate scorecard →</button>
    </div>
    <div class="note"><b>How weights work</b>Each pillar gets a 0–100 score. The composite is the weighted average of the pillars. A weight of 0 removes that pillar; weights are relative, so 2/2/2 and 1/1/1 give the same result. Try Cost-first and Reliability-first to see how the ranking shifts.</div>`;
}

function viewResults() {
  runAll();
  const {scored, excluded, scenarios, priceOnly, avail} = S.result;
  if (!scored.length) return `<div class="card"><p class="err">No suppliers meet the minimum of ${S.minShip || 1} shipments. Lower the minimum on the weights step.</p></div>`;
  const top = scored.slice(0, 10).map(s => s.name);
  const maxC = Math.max(...scored.map(s => s.composite ?? 0), 1);
  const rows = scored.map((s, i) => `
    <tr>
      <td class="num">${i + 1}</td>
      <td>${esc(s.name)}</td>
      <td class="num"><div class="bar" style="display:inline-block;width:70px;vertical-align:middle"><span style="width:${((s.composite ?? 0) / maxC) * 100}%"></span></div> <b>${fmt(s.composite)}</b></td>
      <td class="num">${fmt(s.pillars.cost)}</td>
      <td class="num">${fmt(s.pillars.reliability)}</td>
      <td class="num">${fmt(s.pillars.resilience)}</td>
      <td class="num">${s.n}</td>
      <td class="num">${fmt(s.onTime * 100, 1)}%</td>
      <td class="num">${fmt(s.avgDelay)}</td>
    </tr>`).join('');
  const sens = top.map(name => `
    <tr>
      <td>${esc(name)}</td>
      ${Object.keys(PRESETS).map(p => `<td class="num">${scenarios[p][name]}</td>`).join('')}
    </tr>`).join('');
  const base = priceOnly.slice(0, 5).map((s, i) => `<li>${esc(s.name)} <span class="small">(price index ${fmt(s.pidx ?? s.rawPrice, 2)})</span></li>`).join('');
  return `
    <div class="panel">
      <h2>Scorecard</h2>
      <p class="small">${scored.length} suppliers ranked. Metrics used: ${avail.map(m => m.label).join(', ')}. ${excluded.length ? `${excluded.length} suppliers excluded for having fewer than ${S.minShip} shipments.` : ''}</p>
      <div class="tablewrap"><table>
        <thead><tr><th>#</th><th>Supplier</th><th class="num">Score</th><th class="num">Cost</th><th class="num">Reliability</th><th class="num">Resilience</th><th class="num">Shipments</th><th class="num">On-time</th><th class="num">Avg delay (d)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="btnrow"><button class="btn alt" onclick="exportCsv()">Download CSV</button><button class="btn alt" onclick="goto(4)">Change weights</button></div>
    </div>

    <div class="panel">
      <h2>Sensitivity — does the ranking hold up?</h2>
      <p class="small">Rank of each current top-10 supplier under four weighting scenarios (1 = best).</p>
      <div class="tablewrap"><table>
        <thead><tr><th>Supplier</th>${Object.keys(PRESETS).map(p => `<th class="num">${p}</th>`).join('')}</tr></thead>
        <tbody>${sens}</tbody>
      </table></div>
    </div>

    <div class="panel">
      <h2>Baseline — rank by price only</h2>
      <p class="small">A naive procurement method, for comparison against the composite ranking above.</p>
      <ol>${base}</ol>
    </div>

    <div class="note"><b>How to read this</b>A high composite score means the supplier is strong across the pillars you weighted. If a supplier tops the price ranking but scores low on reliability, the composite will drop it. Use the sensitivity table to check your recommendation doesn't hinge on one particular weighting.</div>`;
}

function preset(name) { S.weights = {...PRESETS[name]}; render(); }

function exportCsv() {
  const r = S.result.scored;
  const head = ['rank','supplier','composite','cost','reliability','resilience','shipments','on_time_rate','avg_delay_days'];
  const lines = r.map((s, i) => [i + 1, s.name, fmt(s.composite, 2), fmt(s.pillars.cost, 2), fmt(s.pillars.reliability, 2),
    fmt(s.pillars.resilience, 2), s.n, fmt(s.onTime, 4), fmt(s.avgDelay, 2)].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
  const blob = new Blob([[head.join(','), ...lines].join('\n')], {type: 'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'supplier_scorecard.csv'; a.click();
}

function isCsv(file) {
  const nameOk = /\.csv$/i.test(file.name);
  const typeOk = file.type === '' || /csv/i.test(file.type);
  return nameOk && typeOk;
}

function bind() {
  const f = $('#file');
  if (f) f.onchange = async e => {
    const file = e.target.files[0];
    const err = $('#loadErr');
    if (!file) return;
    if (!isCsv(file)) {
      if (err) err.innerHTML = `<p class="err">"${esc(file.name)}" isn't a CSV file. Choose a file ending in .csv.</p>`;
      e.target.value = '';
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
    S.map = autoMap(S.headers);
    S.clean = null; S.result = null;
    S.step = 2; render();
  };
  document.querySelectorAll('select[data-role]').forEach(sel => sel.onchange = e => {
    const v = e.target.value;
    if (v) S.map[sel.dataset.role] = v; else delete S.map[sel.dataset.role];
    render();
  });
  const nx = $('#mapNext'); if (nx) nx.onclick = () => { S.clean = null; goto(3); };
  document.querySelectorAll('input[data-w]').forEach(inp => inp.oninput = e => {
    S.weights[inp.dataset.w] = +e.target.value;
    e.target.nextElementSibling.textContent = e.target.value;
  });
  const mi = $('#minShip'); if (mi) mi.onchange = e => { S.minShip = Math.max(1, +e.target.value || 1); };
  const rb = $('#runBtn'); if (rb) rb.onclick = () => {
    if (mi) S.minShip = Math.max(1, parseInt(mi.value, 10) || 1);
    goto(5);
  };
}

render();
