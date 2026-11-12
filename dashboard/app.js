/* Plant siting dashboard.
 *
 * Everything here is built at runtime from the CSVs the Python scripts write,
 * so changing data never needs a rebuild: re-run update.py and reload.
 *   - each plant CSV row becomes a Plant object carrying every column
 *   - enrichment CSVs (transmission, NASA POWER resource) are merged in by Plant ID
 *   - county / state grid-mix CSVs are joined on state + county
 *   - truck_routes.csv carries WKT line geometry
 * Serve the repo folder over HTTP (python -m http.server) — browsers block
 * fetch() from file:// pages.
 */
"use strict";

// ---------------------------------------------------------------- config ----
const FILES = {
  retired: "retired_plants_truck_proximity.csv",
  idle: "idle_fossil_plants.csv",
  coal: "coal_plants_truck_proximity.csv",
  retiredTx: "retired_plants_transmission.csv",
  idleTx: "idle_plants_transmission.csv",
  coalTx: "coal_plants_transmission.csv",
  resource: "site_resource.csv",
  countyMix: "county_grid_mix.csv",
  stateMix: "state_grid_mix.csv",
  trucks: "truck_routes.csv",
};

// Plant CSVs -> Plant objects. `build` maps a row to the shared fields; every
// raw column is kept on the object as well.
const PLANT_SOURCES = [
  { file: FILES.retired, build: r => ({ category: "retired", mw: r.coal_mw, fuel: "coal", year: r.retired_yr }) },
  { file: FILES.idle, build: r => ({ category: "idle", mw: r.idle_fossil_mw, fuel: r.main_fuel, year: r.planned_retirement_yr }) },
  { file: FILES.coal, build: r => ({
      category: { "No retirement date": "none", "Retiring by 2030": "by2030", "Retiring 2031+": "after2030" }[r.status] ?? "none",
      mw: r.coal_mw, fuel: "coal", year: r.first_ret }) },
];
// Extra columns joined by Plant ID (existing columns are never overwritten).
const ENRICH = [FILES.retiredTx, FILES.idleTx, FILES.coalTx, FILES.resource];

const CATEGORIES = [
  { id: "retired", label: "Retired coal (2015+)", color: "--s1" },
  { id: "idle", label: "Idle coal / gas / oil", color: "--s2" },
  { id: "by2030", label: "Coal, retiring by 2030", color: "--s3" },
  { id: "after2030", label: "Coal, retiring 2031+", color: "--s4", darkText: true },
  { id: "none", label: "Coal, no retirement date", color: "--neutral" },
];
const CAT = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));
const FUELS = ["coal", "gas", "oil"];
const IDLE_STATUS = { OS: "Out of service (not returning next year)", OA: "Out of service (returning next year)", SB: "Standby / backup" };

const MIX = [
  { id: "coal", label: "Coal", color: "--s1" }, { id: "gas", label: "Gas", color: "--s2" },
  { id: "oil", label: "Oil", color: "--s3" }, { id: "nuclear", label: "Nuclear", color: "--s4" },
  { id: "hydro", label: "Hydro", color: "--s5" }, { id: "wind", label: "Wind", color: "--s6" },
  { id: "solar", label: "Solar", color: "--s7" }, { id: "storage", label: "Storage", color: "--s8" },
  { id: "other", label: "Geothermal / bio / other", color: "--neutral", cols: ["geothermal", "bio_other"] },
];

const num = (d = 0) => v => v == null ? null : v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
// Every column the UI can show, sort on, filter on or color by.
const FIELDS = {
  name:     { label: "Plant", get: p => p.plant, text: true },
  category: { label: "Type", get: p => CAT[p.category].label, text: true },
  state:    { label: "State", get: p => p.state, text: true },
  county:   { label: "County", get: p => p.county, text: true },
  fuel:     { label: "Fuel", get: p => p.fuel, text: true },
  mw:       { label: "Capacity (MW)", get: p => p.mw, fmt: num(0) },
  year:     { label: "Retired / planned", get: p => p.year, fmt: v => v == null ? null : String(Math.round(v)) },
  dist:     { label: "Freight route (mi)", get: p => p.mi_to_freight_net, fmt: num(1), lowerBetter: true },
  trucks:   { label: "Max trucks/day ≤10 mi", get: p => p.max_trucks_day_10mi, fmt: num(0) },
  // queried with no line found -> 0 kV; never queried -> null (no data)
  kv:       { label: "Max kV ≤1 mi", get: p => p.max_kv ?? (p.n_lines_1mi === 0 ? 0 : null), fmt: v => v === 0 ? "none" : num(0)(v) },
  ghi:      { label: "Solar GHI (kWh/m²/day)", get: p => p.ghi_kwh_m2_day, fmt: num(2) },
  dni:      { label: "Solar DNI (kWh/m²/day)", get: p => p.dni_kwh_m2_day, fmt: num(2) },
  wind100:  { label: "Wind 100 m est. (m/s)", get: p => p.wind_100m_ms_est, fmt: num(1) },
  wind50:   { label: "Wind 50 m (m/s)", get: p => p.wind_50m_ms, fmt: num(1) },
  temp:     { label: "Mean temp (°C)", get: p => p.temp_c, fmt: num(1) },
  cRenew:   { label: "County renewable %", get: p => p.countyMix?.renewable_pct, fmt: num(0) },
  cFossil:  { label: "County fossil %", get: p => p.countyMix?.fossil_pct, fmt: num(0) },
  sRenew:   { label: "State renewable %", get: p => p.stateMix?.renewable_pct, fmt: num(0) },
  score:    { label: "Suitability score", get: p => p.score, fmt: num(0) },
};
const TABLE_COLS = ["name", "category", "state", "county", "fuel", "mw", "year", "dist", "trucks", "kv", "ghi", "wind100", "cRenew", "score"];
const SORTABLE = ["score", "mw", "ghi", "dni", "wind100", "trucks", "dist", "kv", "cRenew", "sRenew", "year", "name", "state"];
const COLOR_BY = [["category", "Plant type"], ["score", "Suitability score"], ["ghi", "Solar GHI"], ["wind100", "Wind speed (100 m est.)"],
                  ["trucks", "Truck traffic nearby"], ["cRenew", "County renewable share"]];

// Threshold sliders. dir "min" keeps plants >= value, "max" keeps <= value.
const RANGES = [
  { f: "mw", dir: "min", label: "Min capacity (MW)", step: 10, init: 20 },
  { f: "dist", dir: "max", label: "Max distance to freight route (mi)", step: 0.5 },
  { f: "trucks", dir: "min", label: "Min trucks/day within 10 mi", step: 250 },
  { f: "kv", dir: "min", label: "Min transmission kV within 1 mi", step: 5 },
  { f: "ghi", dir: "min", label: "Min solar GHI (kWh/m²/day)", step: 0.05 },
  { f: "wind100", dir: "min", label: "Min wind 100 m (m/s)", step: 0.1 },
  { f: "cRenew", dir: "min", label: "Min county renewable %", step: 1 },
];

// Suitability components: percentile rank of each field, weighted.
const WEIGHTS = [
  { f: "ghi", label: "Solar resource", init: 1 },
  { f: "wind100", label: "Wind resource", init: 1 },
  { f: "trucks", label: "Truck traffic", init: 1 },
  { f: "dist", label: "Freight-route proximity", init: 1 },
  { f: "kv", label: "Transmission voltage", init: 1 },
  { f: "mw", label: "Site capacity", init: 0 },
];

const TRUCK_BINS = [
  { id: "t1", label: "1,000–2,500", min: 1000, max: 2500, w: 1, o: 0.35, on: true },
  { id: "t2", label: "2,500–5,000", min: 2500, max: 5000, w: 2, o: 0.5, on: true },
  { id: "t3", label: "5,000+", min: 5000, max: Infinity, w: 3.2, o: 0.65, on: true },
];

// ----------------------------------------------------------------- state ----
const state = {
  plants: [], filtered: [], selected: null,
  search: "", cats: new Set(CATEGORIES.map(c => c.id)), fuels: new Set(FUELS), stateCode: "",
  ranges: {}, weights: Object.fromEntries(WEIGHTS.map(w => [w.f, w.init])),
  sortField: "score", sortDir: -1, colorBy: "category", typeMetric: "count",
};
const $ = s => document.querySelector(s);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const show = (f, p) => { const v = FIELDS[f].get(p); return v == null || v === "" ? null : FIELDS[f].fmt ? FIELDS[f].fmt(v) : v; };
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const isNum = v => typeof v === "number" && Number.isFinite(v);

// ------------------------------------------------------------- data load ----
function loadCSV(path, optional = false) {
  return new Promise((resolve, reject) => Papa.parse(path, {
    download: true, header: true, dynamicTyping: true, skipEmptyLines: true,
    complete: r => resolve(r.data),
    error: e => optional ? resolve([]) : reject(new Error(`${path}: ${e.message || e}`)),
  }));
}

class Plant {
  constructor(row, shared) {
    Object.assign(this, row, shared);
    this.id = row["Plant ID"];
    this.uid = `${shared.category}-${this.id}`;
  }
  merge(row) { for (const [k, v] of Object.entries(row)) if (!(k in this) || this[k] == null) this[k] = v; }
}

async function loadAll() {
  const plantRows = await Promise.all(PLANT_SOURCES.map(s => loadCSV(s.file)));
  const [enrich, countyMix, stateMix, trucks] = await Promise.all([
    Promise.all(ENRICH.map(f => loadCSV(f, true))),
    loadCSV(FILES.countyMix, true), loadCSV(FILES.stateMix, true), loadCSV(FILES.trucks, true),
  ]);

  const plants = [];
  PLANT_SOURCES.forEach((src, i) => {
    for (const row of plantRows[i]) if (row["Plant ID"] != null) plants.push(new Plant(row, src.build(row)));
  });
  // A coal plant whose units are all idle is shown once, as idle.
  const idleIds = new Set(plants.filter(p => p.category === "idle").map(p => p.id));
  const out = plants.filter(p => p.category === "idle" || p.category === "retired" || !idleIds.has(p.id));

  const byId = new Map();
  for (const p of out) (byId.get(p.id) ?? byId.set(p.id, []).get(p.id)).push(p);
  for (const rows of enrich) for (const r of rows) for (const p of byId.get(r["Plant ID"]) ?? []) p.merge(r);

  const cIdx = new Map(countyMix.map(r => [`${r.state}|${r.county}`, r]));
  const sIdx = new Map(stateMix.map(r => [r.state, r]));
  for (const p of out) { p.countyMix = cIdx.get(`${p.state}|${p.county}`) ?? null; p.stateMix = sIdx.get(p.state) ?? null; }
  return { plants: out, trucks };
}

// --------------------------------------------------------------- scoring ----
function computeScores() {
  const ranks = {};
  for (const { f } of WEIGHTS) {
    const vals = state.plants.map(p => FIELDS[f].get(p)).filter(isNum).sort((a, b) => a - b);
    ranks[f] = v => {
      if (!isNum(v) || vals.length < 2) return null;
      let lo = 0, hi = vals.length;               // count of values < v
      while (lo < hi) { const m = (lo + hi) >> 1; vals[m] < v ? lo = m + 1 : hi = m; }
      let r = lo; while (r < vals.length && vals[r] === v) r++;
      const pct = ((lo + r - 1) / 2) / (vals.length - 1);   // mid-rank for ties
      return FIELDS[f].lowerBetter ? 1 - pct : pct;
    };
  }
  for (const p of state.plants) {
    // A factor with no data counts as the worst rank (0), so missing data can
    // never lift a plant above one that was measured.
    let sum = 0, wsum = 0;
    p.scoreMissing = [];
    for (const { f, label } of WEIGHTS) {
      const w = state.weights[f];
      if (!w) continue;
      const r = ranks[f](FIELDS[f].get(p));
      if (r == null) p.scoreMissing.push(label.toLowerCase());
      sum += w * (r ?? 0); wsum += w;
    }
    p.score = wsum ? Math.round(100 * sum / wsum) : null;
  }
}

// ------------------------------------------------------------- filtering ----
function applyFilters() {
  const q = state.search.trim().toLowerCase();
  state.filtered = state.plants.filter(p => {
    if (!state.cats.has(p.category) || !state.fuels.has(p.fuel)) return false;
    if (state.stateCode && p.state !== state.stateCode) return false;
    if (q && ![p.plant, p.owner, p.county, p.state, p.nearest_freight_rte].some(s => s && String(s).toLowerCase().includes(q))) return false;
    for (const r of RANGES) {
      const cur = state.ranges[r.f];
      if (!cur || !cur.active) continue;
      const v = FIELDS[r.f].get(p);
      if (!isNum(v)) return false;
      if (r.dir === "min" ? v < cur.value : v > cur.value) return false;
    }
    return true;
  });
  const f = FIELDS[state.sortField], d = state.sortDir;
  state.filtered.sort((a, b) => {
    const x = f.get(a), y = f.get(b);
    if (x == null || x === "") return 1;
    if (y == null || y === "") return -1;
    return (f.text ? String(x).localeCompare(String(y)) : x - y) * d;
  });
}

// ------------------------------------------------------------------- map ----
let map, baseLayer, plantLayer;
const truckLayers = {};
const markers = new Map();

function initMap(trucks) {
  map = L.map("map", { preferCanvas: true, minZoom: 3, zoomSnap: 0.5 }).fitBounds([[24.5, -124.8], [49.4, -66.9]]);
  setBasemap();
  const renderer = L.canvas({ padding: 0.5 });
  const groups = Object.fromEntries(TRUCK_BINS.map(b => [b.id, []]));
  for (const t of trucks) {
    if (!t.wkt) continue;
    const bin = TRUCK_BINS.find(b => t.trucks_day >= b.min && t.trucks_day < b.max);
    if (!bin) continue;
    groups[bin.id].push(L.polyline(parseWKT(t.wkt), { renderer, color: css("--truck"), weight: bin.w, opacity: bin.o, interactive: true })
      .bindTooltip(`${esc(t.route) || "Route"} · ${t.trucks_day.toLocaleString()} trucks/day`, { sticky: true }));
  }
  for (const b of TRUCK_BINS) { truckLayers[b.id] = L.layerGroup(groups[b.id]); if (b.on) truckLayers[b.id].addTo(map); }
  plantLayer = L.layerGroup().addTo(map);
}

function setBasemap() {
  const dark = isDark();
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = L.tileLayer(`https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${dark ? "Dark" : "Light"}_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    { maxZoom: 16, attribution: "Basemap © Esri, HERE, Garmin, © OpenStreetMap contributors" }).addTo(map);
  baseLayer.bringToBack();
}

// WKT LINESTRING / MULTILINESTRING -> Leaflet lat/lng arrays
function parseWKT(w) {
  return (w.match(/\([^()]+\)/g) || []).map(part => part.slice(1, -1).split(",").map(pt => {
    const [x, y] = pt.trim().split(/\s+/).map(Number);
    return [y, x];
  }));
}

const radius = mw => Math.max(3.5, Math.sqrt(mw || 0) / 3);

function colorScale() {
  if (state.colorBy === "category") return { color: p => css(CAT[p.category].color) };
  const f = FIELDS[state.colorBy];
  const vals = state.plants.map(p => f.get(p)).filter(isNum).sort((a, b) => a - b);
  const q = [0.2, 0.4, 0.6, 0.8].map(t => vals[Math.floor(t * (vals.length - 1))]);
  const steps = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5"].map(css);
  const better = v => f.lowerBetter ? -v : v;
  return {
    steps, q, f, min: vals[0], max: vals[vals.length - 1],
    color: p => {
      const v = f.get(p);
      if (!isNum(v)) return css("--neutral");
      let i = q.filter(t => v > t).length;
      return steps[f.lowerBetter ? 4 - i : i] ?? steps[0];
    },
  };
}

function renderMap() {
  plantLayer.clearLayers(); markers.clear();
  const scale = colorScale();
  const surface = css("--surface");
  [...state.filtered].sort((a, b) => b.mw - a.mw).forEach(p => {
    if (!isNum(p.lat) || !isNum(p.lon)) return;
    const m = L.circleMarker([p.lat, p.lon], {
      radius: radius(p.mw), color: surface, weight: 1.5, fillColor: scale.color(p), fillOpacity: 0.9,
    }).bindTooltip(`<b>${esc(p.plant)}</b><br>${esc(CAT[p.category].label)} · ${show("mw", p) ?? "—"} MW`)
      .on("click", () => select(p, false));
    m.addTo(plantLayer); markers.set(p.uid, m);
  });
  highlightMarker();
  renderLegend(scale);
}

function highlightMarker() {
  for (const [uid, m] of markers) {
    const sel = state.selected?.uid === uid;
    m.setStyle({ color: sel ? css("--ink") : css("--surface"), weight: sel ? 3 : 1.5 });
    if (sel) m.bringToFront();
  }
}

function renderLegend(scale) {
  const el = $("#map-legend");
  if (state.colorBy === "category") {
    el.innerHTML = `<div class="field-label">Plant type · size ∝ MW</div>` + CATEGORIES.filter(c => state.cats.has(c.id))
      .map(c => `<div class="item"><span class="dot" style="background:${css(c.color)}"></span>${c.label}</div>`).join("");
  } else {
    const f = scale.f;
    const steps = f.lowerBetter ? [...scale.steps].reverse() : scale.steps;
    el.innerHTML = `<div class="field-label">${f.label}</div>
      <div class="ramp">${steps.map(s => `<span style="background:${s}"></span>`).join("")}</div>
      <div class="ends"><span>${f.fmt(f.lowerBetter ? scale.max : scale.min)}</span>
      <span>${f.fmt(f.lowerBetter ? scale.min : scale.max)}</span></div>
      <div class="item" style="margin-top:4px"><span class="dot" style="background:${css("--neutral")}"></span>No data</div>
      <div class="note" style="margin:2px 0 0">Darker = ${f.lowerBetter ? "closer" : "higher"} · quintiles of all plants</div>`;
  }
}

// ---------------------------------------------------------------- charts ----
Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
Chart.defaults.font.size = 12;
const charts = {};

function chartTheme() {
  Chart.defaults.color = css("--ink-2");
  Chart.defaults.borderColor = css("--grid");
}
function axes(horizontal, valueTitle) {
  const val = { grid: { color: css("--grid") }, border: { display: false }, beginAtZero: true,
    ticks: { color: css("--muted") }, title: valueTitle ? { display: true, text: valueTitle, color: css("--muted") } : undefined };
  const cat = { grid: { display: false }, border: { color: css("--axis") }, ticks: { color: css("--ink-2"), autoSkip: false } };
  return horizontal ? { x: val, y: cat } : { x: cat, y: val };
}
const tooltip = { backgroundColor: () => css("--surface"), titleColor: () => css("--ink"), bodyColor: () => css("--ink-2"),
  borderColor: () => css("--axis"), borderWidth: 1, padding: 8, boxPadding: 4 };

function upsert(id, config) {
  if (charts[id]) { charts[id].data = config.data; charts[id].options = config.options; charts[id].update("none"); return; }
  charts[id] = new Chart(document.getElementById(id), config);
}

function barConfig(labels, values, colors, { horizontal = true, title, onClick, fmt = v => v.toLocaleString("en-US", { maximumFractionDigits: 0 }) } = {}) {
  return {
    type: "bar",
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderRadius: 4, borderSkipped: false, maxBarThickness: 26, categoryPercentage: 0.8 }] },
    options: {
      indexAxis: horizontal ? "y" : "x", maintainAspectRatio: false, animation: false,
      scales: axes(horizontal, title),
      plugins: { legend: { display: false }, tooltip: { ...tooltip, callbacks: { label: c => " " + fmt(c.raw) + (title ? " " + title : "") } } },
      onClick: onClick ? (e, els) => els.length && onClick(els[0].index) : undefined,
      onHover: (e, els) => { e.native.target.style.cursor = onClick && els.length ? "pointer" : "default"; },
    },
  };
}

function renderCharts() {
  chartTheme();
  const P = state.filtered;
  const sum = (arr, f) => arr.reduce((s, p) => s + (isNum(f(p)) ? f(p) : 0), 0);

  // plants by type
  const cats = CATEGORIES.filter(c => state.cats.has(c.id));
  const mwMode = state.typeMetric === "mw";
  upsert("c-type", barConfig(cats.map(c => c.label),
    cats.map(c => { const g = P.filter(p => p.category === c.id); return mwMode ? sum(g, p => p.mw) : g.length; }),
    cats.map(c => css(c.color)),
    { title: mwMode ? "MW" : "plants", onClick: i => { state.cats = new Set([cats[i].id]); syncChecks(); update(); } }));

  // by fuel
  const fuels = FUELS.filter(f => state.fuels.has(f));
  upsert("c-fuel", barConfig(fuels.map(f => f[0].toUpperCase() + f.slice(1)), fuels.map(f => sum(P.filter(p => p.fuel === f), p => p.mw)),
    css("--s1"), { title: "MW" }));

  // top states
  const byState = {};
  for (const p of P) byState[p.state] = (byState[p.state] || 0) + (p.mw || 0);
  const top = Object.entries(byState).sort((a, b) => b[1] - a[1]).slice(0, 12);
  upsert("c-state", barConfig(top.map(t => t[0]), top.map(t => t[1]), css("--s1"),
    { title: "MW", onClick: i => { state.stateCode = top[i][0]; $("#f-state").value = state.stateCode; update(); } }));

  // solar vs wind scatter
  const pts = P.filter(p => isNum(p.ghi_kwh_m2_day) && isNum(p.wind_100m_ms_est));
  const sel = state.selected;
  upsert("c-scatter", {
    type: "scatter",
    data: { datasets: [
      { data: pts.map(p => ({ x: p.ghi_kwh_m2_day, y: p.wind_100m_ms_est, p })), backgroundColor: css("--s1") + "b3",
        borderColor: css("--surface"), borderWidth: 1, pointRadius: 4, pointHoverRadius: 6, pointHitRadius: 6 },
      ...(sel && isNum(sel.ghi_kwh_m2_day) ? [{ data: [{ x: sel.ghi_kwh_m2_day, y: sel.wind_100m_ms_est, p: sel }],
        backgroundColor: css("--ink"), borderColor: css("--surface"), borderWidth: 2, pointRadius: 7 }] : []),
    ] },
    options: {
      maintainAspectRatio: false, animation: false,
      scales: {
        x: { title: { display: true, text: "Solar GHI (kWh/m²/day)", color: css("--muted") }, grid: { color: css("--grid") }, border: { color: css("--axis") } },
        y: { title: { display: true, text: "Wind 100 m est. (m/s)", color: css("--muted") }, grid: { color: css("--grid") }, border: { display: false } },
      },
      plugins: { legend: { display: false }, tooltip: { ...tooltip, callbacks: {
        title: c => c[0].raw.p.plant, label: c => ` ${c.raw.x.toFixed(2)} kWh/m²/day · ${c.raw.y.toFixed(1)} m/s · ${c.raw.p.state}` } } },
      onClick: (e, els, chart) => els.length && select(chart.data.datasets[els[0].datasetIndex].data[els[0].index].p, true),
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; },
    },
  });

  // score histogram
  const bins = Array.from({ length: 10 }, (_, i) => i * 10);
  const counts = bins.map(b => P.filter(p => isNum(p.score) && p.score >= b && (b === 90 ? p.score <= 100 : p.score < b + 10)).length);
  upsert("c-score", barConfig(bins.map(b => `${b}–${b + (b === 90 ? 10 : 9)}`), counts, css("--s1"), { horizontal: false, title: "plants" }));

  renderMixSummary(P);
}

function mixParts(row) {
  if (!row) return null;
  return MIX.map(m => ({ ...m, mw: (m.cols || [m.id]).reduce((s, c) => s + (row[`mw_${c}`] || 0), 0) }));
}
function mixBar(parts, total) {
  return `<div class="mixbar" role="img" aria-label="${parts.filter(p => p.mw > 0).map(p => `${p.label} ${(100 * p.mw / total).toFixed(0)}%`).join(", ")}">` +
    parts.filter(p => p.mw > 0).map(p => `<span style="flex:${p.mw};background:${css(p.color)}" title="${p.label}: ${(100 * p.mw / total).toFixed(1)}% (${Math.round(p.mw).toLocaleString()} MW)"></span>`).join("") + "</div>";
}
function mixLegend(parts, total) {
  return `<div class="mixlegend">${parts.filter(p => p.mw > 0).map(p => `<span><i style="background:${css(p.color)}"></i>${p.label} ${(100 * p.mw / total).toFixed(0)}%</span>`).join("")}</div>`;
}

function renderMixSummary(P) {
  const withMix = P.filter(p => p.countyMix);
  const el = $("#mix-summary");
  if (!withMix.length) { el.innerHTML = `<p class="note">No county grid-mix data for these plants.</p>`; return; }
  // average of each county's percentage shares (each plant's county counts once per plant)
  const parts = MIX.map(m => ({ ...m, mw: withMix.reduce((s, p) => s + (m.cols || [m.id]).reduce((t, c) => t + (p.countyMix[`pct_${c}`] || 0), 0), 0) / withMix.length }));
  const total = parts.reduce((s, p) => s + p.mw, 0);
  el.innerHTML = mixBar(parts, total) + `<table>${parts.filter(p => p.mw > 0.05).sort((a, b) => b.mw - a.mw)
    .map(p => `<tr><td><span class="mixlegend"><span><i style="background:${css(p.color)}"></i>${p.label}</span></span></td><td>${p.mw.toFixed(1)}%</td></tr>`).join("")}</table>
    <p class="note">${withMix.length} of ${P.length} plants have county data.</p>`;
}

// ----------------------------------------------------------------- table ----
function renderTable() {
  const thead = $("#table thead"), tbody = $("#table tbody");
  thead.innerHTML = "<tr>" + TABLE_COLS.map(c => {
    const f = FIELDS[c], on = state.sortField === c;
    return `<th data-f="${c}" class="${f.text ? "" : "num"} ${on ? "sorted" : ""}" aria-sort="${on ? (state.sortDir > 0 ? "ascending" : "descending") : "none"}">${f.label}${on ? (state.sortDir > 0 ? " ↑" : " ↓") : ""}</th>`;
  }).join("") + "</tr>";
  tbody.innerHTML = state.filtered.map(p => `<tr data-uid="${p.uid}" class="${state.selected?.uid === p.uid ? "sel" : ""}">` + TABLE_COLS.map(c => {
    const v = show(c, p), f = FIELDS[c];
    if (c === "category") return `<td><span class="dot" style="display:inline-block;vertical-align:-1px;margin-right:6px;background:${css(CAT[p.category].color)}"></span>${esc(v)}</td>`;
    return `<td class="${c === "name" ? "name" : f.text ? "" : "num"}">${v == null ? '<span class="na">—</span>' : esc(v)}</td>`;
  }).join("") + "</tr>").join("");
  $("#table-title").textContent = `Plants (${state.filtered.length.toLocaleString()})`;
}

// ---------------------------------------------------------------- detail ----
function select(p, pan) {
  state.selected = p;
  renderDetail();
  highlightMarker();
  document.querySelectorAll("#table tbody tr").forEach(tr => tr.classList.toggle("sel", tr.dataset.uid === p.uid));
  renderCharts();
  if (pan && isNum(p.lat)) map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 8), { duration: 0.6 });
}

function renderDetail() {
  const p = state.selected, el = $("#detail");
  if (!p) return;
  const c = CAT[p.category];
  const row = (k, v) => v == null || v === "" ? "" : `<tr><td>${k}</td><td>${v}</td></tr>`;
  const kv = rows => `<table class="kv">${rows.join("")}</table>`;
  const mixBlock = (title, mix) => {
    const parts = mixParts(mix);
    if (!parts) return `<h4>${title}</h4><p class="note">No operating generators listed here in EIA-860M.</p>`;
    return `<h4>${title} · ${Math.round(mix.total_mw).toLocaleString()} MW, ${mix.n_plants} plants</h4>${mixBar(parts, mix.total_mw)}${mixLegend(parts, mix.total_mw)}`;
  };
  const raw = Object.entries(p).filter(([k, v]) => !["countyMix", "stateMix", "uid", "scoreMissing"].includes(k) && v != null && v !== "")
    .map(([k, v]) => row(esc(k), esc(typeof v === "number" ? +v.toFixed(4) : v))).join("");

  el.innerHTML = `
    <h3>${esc(p.plant)}</h3>
    <div class="sub">${esc(p.county ?? "")}${p.county ? " County, " : ""}${esc(p.state)} · ${esc(p.owner ?? "")}</div>
    <span class="tag ${c.darkText ? "dark-text" : ""}" style="background:${css(c.color)}">${c.label}</span>
    ${isNum(p.score) ? `<span class="tag" style="background:${css("--ink-2")};color:${css("--surface")}">Score ${p.score}</span>` : ""}
    <h4>Plant</h4>${kv([
      row(p.category === "idle" ? "Idle fossil capacity" : "Coal capacity", show("mw", p) + " MW"),
      row("Main fuel", p.fuel),
      row("Idle status", IDLE_STATUS[p.main_status]),
      row("Units", p.n_idle_units ?? p.n_units),
      row(p.category === "retired" ? "Retired" : "First planned retirement", show("year", p) ?? (p.category === "retired" ? null : "None announced")),
      row("Score note", p.scoreMissing?.length ? `No data for ${p.scoreMissing.join(", ")}, counted as worst` : null),
      row("Other operating MW (non-fossil)", p.other_operating_mw ? show("mw", { mw: p.other_operating_mw }) : null),
    ])}
    <h4>Solar &amp; wind (NASA POWER, 2001–2025 mean)</h4>${kv([
      row("Solar GHI", show("ghi", p) && show("ghi", p) + " kWh/m²/day"),
      row("Solar DNI", show("dni", p) && show("dni", p) + " kWh/m²/day"),
      row("Clearness index", p.clearness_index),
      row("Wind 50 m", show("wind50", p) && show("wind50", p) + " m/s"),
      row("Wind 100 m (est.)", show("wind100", p) && show("wind100", p) + " m/s"),
      row("Mean air temp", show("temp", p) && show("temp", p) + " °C"),
    ]) || `<p class="note">No data.</p>`}
    <h4>Grid &amp; freight access</h4>${kv([
      row("Transmission ≤1 mi", p.n_lines_1mi == null ? "Not queried" : p.n_lines_1mi ? `up to ${show("kv", p)} kV (${p.n_lines_1mi} segments)` : "None mapped"),
      row("Voltages", p.voltages_kv),
      row("Nearest freight route", p.mi_to_freight_net == null ? null : `${esc(p.nearest_freight_rte ?? "—")} (${show("dist", p)} mi)`),
      row("Busiest segment ≤10 mi", p.max_trucks_day_10mi == null ? null : p.max_trucks_day_10mi ? show("trucks", p) + " trucks/day" : "None ≥1,000/day"),
    ])}
    ${mixBlock(`${esc(p.county ?? "County")} County capacity mix`, p.countyMix)}
    ${mixBlock(`${esc(p.state)} statewide capacity mix`, p.stateMix)}
    <details class="raw"><summary>All CSV fields</summary><table class="kv">${raw}</table></details>`;
  el.scrollTop = 0;
}

// --------------------------------------------------------------- sidebar ----
function buildSidebar() {
  const count = (k, v) => state.plants.filter(p => p[k] === v).length;
  $("#f-category").innerHTML = CATEGORIES.map(c => `<label><input type="checkbox" data-cat="${c.id}" checked>
    <span class="dot" style="background:${css(c.color)}"></span>${c.label}<span class="n">${count("category", c.id)}</span></label>`).join("");
  $("#f-fuel").innerHTML = FUELS.map(f => `<label><input type="checkbox" data-fuel="${f}" checked>${f[0].toUpperCase() + f.slice(1)}<span class="n">${count("fuel", f)}</span></label>`).join("");
  const states = [...new Set(state.plants.map(p => p.state))].filter(Boolean).sort();
  $("#f-state").insertAdjacentHTML("beforeend", states.map(s => `<option>${s}</option>`).join(""));

  $("#f-ranges").innerHTML = RANGES.map(r => {
    const vals = state.plants.map(p => FIELDS[r.f].get(p)).filter(isNum);
    r.min = Math.floor(Math.min(...vals) / r.step) * r.step;
    r.max = Math.ceil(Math.max(...vals) / r.step) * r.step;
    r.off = r.dir === "min" ? r.min : r.max;
    const v = r.init ?? r.off;
    state.ranges[r.f] = { value: v, active: v !== r.off };
    return `<div class="range" data-f="${r.f}"><div class="top"><span>${r.label}</span><span class="val"></span></div>
      <input type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${v}" aria-label="${r.label}"></div>`;
  }).join("");
  RANGES.forEach(r => paintRange(r));

  $("#weights").innerHTML = WEIGHTS.map(w => `<div class="range" data-w="${w.f}"><div class="top"><span>${w.label}</span><span class="val">${w.init}</span></div>
    <input type="range" min="0" max="5" step="1" value="${w.init}" aria-label="${w.label} weight"></div>`).join("");

  $("#sort-field").innerHTML = SORTABLE.map(f => `<option value="${f}">${FIELDS[f].label}</option>`).join("");
  $("#color-by").innerHTML = COLOR_BY.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
  $("#f-trucks").innerHTML = TRUCK_BINS.map(b => `<label><input type="checkbox" data-truck="${b.id}" ${b.on ? "checked" : ""}>
    <span class="line-sw" style="height:${b.w + 1}px;opacity:${b.o + 0.25}"></span>${b.label}</label>`).join("");
  syncSort();
}

function paintRange(r) {
  const el = document.querySelector(`.range[data-f="${r.f}"]`), cur = state.ranges[r.f];
  el.classList.toggle("active", cur.active);
  el.querySelector(".val").textContent = cur.active ? `${r.dir === "min" ? "≥" : "≤"} ${FIELDS[r.f].fmt(cur.value)}` : "any";
}
function syncChecks() {
  document.querySelectorAll("[data-cat]").forEach(i => i.checked = state.cats.has(i.dataset.cat));
  document.querySelectorAll("[data-fuel]").forEach(i => i.checked = state.fuels.has(i.dataset.fuel));
}
function syncSort() {
  $("#sort-field").value = SORTABLE.includes(state.sortField) ? state.sortField : "";
  $("#sort-dir").textContent = state.sortDir > 0 ? "↑" : "↓";
}

function wireEvents() {
  let t;
  $("#search").addEventListener("input", e => { clearTimeout(t); t = setTimeout(() => { state.search = e.target.value; update(); }, 150); });
  $("#f-category").addEventListener("change", e => { e.target.checked ? state.cats.add(e.target.dataset.cat) : state.cats.delete(e.target.dataset.cat); update(); });
  $("#f-fuel").addEventListener("change", e => { e.target.checked ? state.fuels.add(e.target.dataset.fuel) : state.fuels.delete(e.target.dataset.fuel); update(); });
  $("#f-state").addEventListener("change", e => { state.stateCode = e.target.value; update(); });
  $("#f-ranges").addEventListener("input", e => {
    const f = e.target.closest(".range").dataset.f, r = RANGES.find(x => x.f === f), v = +e.target.value;
    state.ranges[f] = { value: v, active: v !== r.off };
    paintRange(r); update();
  });
  $("#weights").addEventListener("input", e => {
    const box = e.target.closest(".range"); state.weights[box.dataset.w] = +e.target.value;
    box.querySelector(".val").textContent = e.target.value;
    computeScores(); update();
  });
  $("#sort-field").addEventListener("change", e => {
    state.sortField = e.target.value; state.sortDir = FIELDS[state.sortField].text || FIELDS[state.sortField].lowerBetter ? 1 : -1; syncSort(); update();
  });
  $("#sort-dir").addEventListener("click", () => { state.sortDir *= -1; syncSort(); update(); });
  $("#color-by").addEventListener("change", e => { state.colorBy = e.target.value; renderMap(); });
  $("#f-trucks").addEventListener("change", e => { const l = truckLayers[e.target.dataset.truck]; e.target.checked ? l.addTo(map) : map.removeLayer(l); });
  $("#type-metric").addEventListener("click", e => {
    if (!e.target.dataset.v) return;
    state.typeMetric = e.target.dataset.v;
    $("#type-metric").querySelectorAll("button").forEach(b => b.classList.toggle("on", b === e.target));
    renderCharts();
  });
  $("#table thead").addEventListener("click", e => {
    const f = e.target.closest("th")?.dataset.f; if (!f) return;
    if (state.sortField === f) state.sortDir *= -1;
    else { state.sortField = f; state.sortDir = FIELDS[f].text || FIELDS[f].lowerBetter ? 1 : -1; }
    syncSort(); update();
  });
  $("#table tbody").addEventListener("click", e => {
    const uid = e.target.closest("tr")?.dataset.uid; const p = state.plants.find(x => x.uid === uid);
    if (p) select(p, true);
  });
  $("#export").addEventListener("click", exportCSV);
  $("#reset").addEventListener("click", reset);
  $("#theme-toggle").addEventListener("click", toggleTheme);
  $("#sidebar-toggle").addEventListener("click", () => {
    const open = $("#sidebar").classList.toggle("open");
    $("#sidebar-toggle").setAttribute("aria-expanded", open);
  });
}

function reset() {
  Object.assign(state, { search: "", cats: new Set(CATEGORIES.map(c => c.id)), fuels: new Set(FUELS), stateCode: "",
    weights: Object.fromEntries(WEIGHTS.map(w => [w.f, w.init])), sortField: "score", sortDir: -1 });
  $("#search").value = ""; $("#f-state").value = ""; syncChecks(); syncSort();
  for (const r of RANGES) {
    const v = r.init ?? r.off;
    state.ranges[r.f] = { value: v, active: v !== r.off };
    document.querySelector(`.range[data-f="${r.f}"] input`).value = v; paintRange(r);
  }
  document.querySelectorAll("#weights .range").forEach(b => {
    const v = state.weights[b.dataset.w]; b.querySelector("input").value = v; b.querySelector(".val").textContent = v;
  });
  computeScores(); update();
}

function exportCSV() {
  const rows = state.filtered.map(p => {
    const o = {};
    for (const [k, v] of Object.entries(p)) if (!["countyMix", "stateMix", "uid", "scoreMissing"].includes(k)) o[k] = v;
    o.county_renewable_pct = p.countyMix?.renewable_pct ?? null; o.county_fossil_pct = p.countyMix?.fossil_pct ?? null;
    o.state_renewable_pct = p.stateMix?.renewable_pct ?? null;
    return o;
  });
  const cols = [...new Set(rows.flatMap(Object.keys))];
  const blob = new Blob([Papa.unparse(rows, { columns: cols })], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "filtered_plants.csv" });
  a.click(); URL.revokeObjectURL(a.href);
}

// ------------------------------------------------------------------ KPIs ----
function renderKPIs() {
  const P = state.filtered;
  const med = f => { const v = P.map(p => FIELDS[f].get(p)).filter(isNum).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const gw = P.reduce((s, p) => s + (p.mw || 0), 0) / 1000;
  const hv = P.filter(p => p.max_kv >= 230 * 0.95).length;
  const k = [
    [P.length.toLocaleString(), "plants shown"],
    [gw.toFixed(1) + " GW", "capacity shown"],
    [hv.toLocaleString(), "with a 230 kV+ line ≤1 mi"],
    [med("ghi")?.toFixed(2) ?? "—", "median solar GHI (kWh/m²/day)"],
    [med("wind100")?.toFixed(1) ?? "—", "median wind 100 m (m/s)"],
  ];
  $("#kpis").innerHTML = k.map(([v, l]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`).join("");
}

// ----------------------------------------------------------------- theme ----
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
}
function toggleTheme() {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch (_) {}
  rethemed();
}
function rethemed() {
  setBasemap();
  for (const id in truckLayers) truckLayers[id].eachLayer(l => l.setStyle({ color: css("--truck") }));
  buildCategoryDots();
  renderMap(); renderCharts(); renderDetail();
}
function buildCategoryDots() {
  document.querySelectorAll("[data-cat]").forEach(i => i.parentElement.querySelector(".dot").style.background = css(CAT[i.dataset.cat].color));
}

// ------------------------------------------------------------------ main ----
function update() {
  applyFilters();
  if (state.selected && !state.filtered.includes(state.selected)) { /* keep detail open; just unhighlight in lists */ }
  renderKPIs(); renderMap(); renderCharts(); renderTable();
}

(async function main() {
  try { const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; } catch (_) {}
  const status = $("#status");
  if (location.protocol === "file:") {
    status.className = "status error";
    status.innerHTML = `Browsers block reading CSVs from a <code>file://</code> page. From the repo folder run <code>python -m http.server 8000</code> and open <a href="http://localhost:8000/">http://localhost:8000/</a>.`;
    return;
  }
  try {
    const { plants, trucks } = await loadAll();
    state.plants = plants;
    computeScores();
    buildSidebar();
    wireEvents();
    initMap(trucks);
    update();
    status.textContent = `${plants.length} plants and ${trucks.length.toLocaleString()} truck-route segments loaded from CSV.`;
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!document.documentElement.dataset.theme) rethemed(); });
  } catch (e) {
    status.className = "status error";
    status.textContent = "Couldn't load data: " + e.message + ". Run update.py to generate the CSVs.";
    console.error(e);
  }
})();
