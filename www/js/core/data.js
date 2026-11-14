// Data layer: loads the catalogue of study areas and returns a time series for
// any (area, factor) pair. A factor's series comes from one of two places:
//   source "demo"  -> simulated values generated here (clearly labelled in the UI)
//   source "file"  -> your own processed results, a JSON file in www/data/observed/
// Everything downstream (charts, statistics, assistant) only sees the series.
import { toDay, fromDay, decimalYear, parts } from './dates.js';
import { FACTORS, FACTOR_BY_ID } from './factors.js';

let catalog = null;
let fetcher = defaultFetchJson;   // how JSON files are read (replaced in the self-test)
const seriesCache = new Map();

export async function loadCatalog(fetchJson = defaultFetchJson) {
  fetcher = fetchJson;
  catalog = await fetchJson('data/catalog.json');
  seriesCache.clear();
  return catalog;
}

export function getCatalog() { return catalog; }

async function defaultFetchJson(path) {
  const r = await fetch(path, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Could not load ${path} (${r.status})`);
  return r.json();
}

export function regionById(id) {
  return catalog.regions.find((r) => r.id === id) || null;
}

export function countryById(id) {
  return catalog.countries.find((c) => c.id === id) || null;
}

/** A point the user tapped on the map: no radar analysis, live climate only. */
export function customRegion(lat, lon) {
  const factors = {};
  for (const f of FACTORS) {
    factors[f.id] = {
      status: 'unavailable', source: 'none',
      reason: 'No processed radar analysis exists for this location yet.',
    };
  }
  return {
    id: 'custom', custom: true, name: 'Selected point', country: null,
    center: [lat, lon], setting: [], factors,
    summary: 'A point you picked on the map. Radar analyses exist only for the study areas; rainfall, temperature and soil moisture are available everywhere.',
  };
}

// ---------- deterministic random numbers (so demo data never changes) ----------
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng) {
  const u = Math.max(rng(), 1e-9), v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Acquisition dates for an area: one pass every `repeatDays`, with a few
 * passes missing, as happens with real satellites.
 */
export function acquisitionDays(region) {
  const { start, end, repeatDays } = catalog.timeline;
  const first = toDay(start), last = toDay(end);
  const rng = mulberry32(hashString('passes:' + region.id));
  const days = [];
  for (let d = first; d <= last; d += repeatDays) {
    const missing = rng() < 0.06;
    if (!missing || d === first || d + repeatDays > last) days.push(d);
  }
  return days;
}

function simulate(region, factorId, cfg) {
  const p = cfg.demo;
  const rng = mulberry32(hashString(`${region.id}:${factorId}`));
  let days = acquisitionDays(region);
  if (cfg.status === 'limited') days = days.filter((_, i) => i % 3 === 0);
  const t0 = decimalYear(days[0]);
  const noise = p.noise * (cfg.status === 'limited' ? 1.5 : 1);
  let values = days.map((d) => {
    const t = decimalYear(d) - t0;
    const season = Math.cos(2 * Math.PI * ((parts(d).doy / 365.25) - ((p.peakMonth + 0.5) / 12)));
    let v = p.base + p.trend * t + p.amp * season;
    for (const e of p.events || []) {
      const dt = d - toDay(e.date);
      if (dt >= 0) v += e.mag * Math.exp(-dt / e.decayDays);
    }
    for (const s of p.steps || []) if (d >= toDay(s.date)) v += s.mag;
    v += noise * gaussian(rng);
    if (p.min != null) v = Math.max(p.min, v);
    if (p.max != null) v = Math.min(p.max, v);
    return v;
  });
  if (p.zeroAtStart) { const v0 = values[0]; values = values.map((v) => v - v0); }
  return { days, values, sigma: noise };
}

async function loadObserved(cfg, fetchJson) {
  const raw = await fetchJson(cfg.file);
  if (!Array.isArray(raw.dates) || !Array.isArray(raw.values) || raw.dates.length !== raw.values.length) {
    throw new Error(`${cfg.file}: "dates" and "values" must be lists of the same length`);
  }
  const rows = raw.dates.map((d, i) => ({ day: toDay(d), v: Number(raw.values[i]) }))
    .filter((r) => Number.isFinite(r.v) && Number.isFinite(r.day))
    .sort((a, b) => a.day - b.day);
  return {
    days: rows.map((r) => r.day), values: rows.map((r) => r.v),
    sigma: Number.isFinite(raw.sigma) ? raw.sigma : null,
    sensor: raw.sensor || 'Not stated', product: raw.product || null,
  };
}

/**
 * Time series for one factor of one area.
 * Returns { factorId, status, reason, provenance, sensor, days[], values[], sigma }.
 * provenance is 'simulated', 'observed' or 'none'.
 */
export async function getSeries(region, factorId, fetchJson = fetcher) {
  const key = `${region.id}:${factorId}`;
  if (!region.custom && seriesCache.has(key)) return seriesCache.get(key);
  const cfg = region.factors[factorId] || { status: 'unavailable', source: 'none' };
  const factor = FACTOR_BY_ID[factorId];
  let out = {
    factorId, status: cfg.status, reason: cfg.reason || null, provenance: 'none',
    sensor: null, unit: factor.unit, days: [], values: [], sigma: null,
  };
  if (cfg.status !== 'unavailable') {
    try {
      if (cfg.source === 'file') {
        const o = await loadObserved(cfg, fetchJson);
        out = { ...out, ...o, provenance: 'observed' };
      } else if (cfg.source === 'demo') {
        const s = simulate(region, factorId, cfg);
        out = { ...out, ...s, provenance: 'simulated', sensor: 'Simulated, 12-day repeat like NISAR' };
      }
    } catch (err) {
      out.status = 'unavailable';
      out.reason = `The data file for this factor could not be read (${err.message}).`;
    }
    if (out.status !== 'unavailable' && out.days.length < 2) {
      out.status = 'unavailable';
      out.reason = 'Fewer than two acquisitions are stored for this factor.';
      out.provenance = 'none';
    }
  }
  if (!region.custom) seriesCache.set(key, out);
  return out;
}

export async function getAllSeries(region) {
  const entries = await Promise.all(FACTORS.map(async (f) => [f.id, await getSeries(region, f.id)]));
  return Object.fromEntries(entries);
}

/** Every date on which at least one factor has an acquisition for this area. */
export function masterDays(seriesByFactor) {
  const set = new Set();
  for (const s of Object.values(seriesByFactor)) for (const d of s.days) set.add(d);
  return [...set].sort((a, b) => a - b);
}

export { fromDay };
