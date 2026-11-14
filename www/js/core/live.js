// Live supporting data: real rainfall, temperature, evaporation and soil
// moisture for any point on Earth, from the Open-Meteo historical weather API
// (ERA5 / ERA5-Land reanalysis). No API key is needed for non-commercial use.
// These are modelled reanalysis values, not NISAR measurements, and the UI
// labels them that way.
import { toDay, fromDay, todayDay, parts } from './dates.js';

const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';
const CLIMATE_START = '2015-01-01';   // long record so "normal" is meaningful
const SOIL_START = '2024-01-01';      // hourly data is heavy, keep it short
const DELAY_DAYS = 7;                 // reanalysis lags the present by about 5 days

const memory = new Map();

function cacheKey(lat, lon) {
  return `metris:climate:${lat.toFixed(2)}:${lon.toFixed(2)}:${fromDay(todayDay())}`;
}

async function getJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) {
      let reason = `HTTP ${r.status}`;
      try { const j = await r.json(); if (j && j.reason) reason = j.reason; } catch { /* keep status */ }
      throw new Error(reason);
    }
    return await r.json();
  } finally { clearTimeout(timer); }
}

function cleanDaily(time, cols) {
  const out = { days: [] };
  for (const k of Object.keys(cols)) out[k] = [];
  for (let i = 0; i < time.length; i++) {
    if (Object.values(cols).some((arr) => arr[i] == null)) continue;
    out.days.push(toDay(time[i]));
    for (const k of Object.keys(cols)) out[k].push(cols[k][i]);
  }
  return out;
}

function hourlyToDailyMean(time, values) {
  const days = [], means = [];
  let cur = null, sum = 0, n = 0;
  for (let i = 0; i < time.length; i++) {
    if (values[i] == null) continue;
    const d = time[i].slice(0, 10);
    if (d !== cur) {
      if (n) { days.push(toDay(cur)); means.push(sum / n); }
      cur = d; sum = 0; n = 0;
    }
    sum += values[i]; n++;
  }
  if (n) { days.push(toDay(cur)); means.push(sum / n); }
  return { days, values: means };
}

/**
 * Fetch climate data for a point. Never throws: on failure returns
 * { status: 'unavailable', error }. Results are cached for the day.
 */
export async function fetchClimate(lat, lon) {
  const key = cacheKey(lat, lon);
  if (memory.has(key)) return memory.get(key);
  try {
    const stored = localStorage.getItem(key);
    if (stored) { const v = JSON.parse(stored); memory.set(key, v); return v; }
  } catch { /* storage may be unavailable; fetch instead */ }

  const end = fromDay(todayDay() - DELAY_DAYS);
  const base = `${ARCHIVE}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&timezone=UTC`;
  const out = { status: 'unavailable', lat, lon, fetchedDay: todayDay(), daily: null, soil: null, error: null, soilError: null };
  try {
    const j = await getJson(`${base}&start_date=${CLIMATE_START}&end_date=${end}` +
      '&daily=precipitation_sum,temperature_2m_mean,et0_fao_evapotranspiration');
    out.daily = cleanDaily(j.daily.time, {
      rain: j.daily.precipitation_sum,
      temp: j.daily.temperature_2m_mean,
      et0: j.daily.et0_fao_evapotranspiration,
    });
    out.status = out.daily.days.length ? 'live' : 'unavailable';
    if (!out.daily.days.length) out.error = 'The service returned no values for this point.';
  } catch (err) {
    out.error = err.name === 'AbortError' ? 'The weather service took too long to answer.' : String(err.message || err);
  }
  if (out.status === 'live') {
    try {
      const j = await getJson(`${base}&start_date=${SOIL_START}&end_date=${end}&hourly=soil_moisture_0_to_7cm`, 30000);
      const s = hourlyToDailyMean(j.hourly.time, j.hourly.soil_moisture_0_to_7cm);
      if (s.days.length) out.soil = s; else out.soilError = 'No soil moisture values for this point (open water or ice).';
    } catch (err) {
      out.soilError = String(err.message || err);
    }
    memory.set(key, out);
    try {
      // drop older cached days so storage does not grow
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith('metris:climate:') && k !== key) localStorage.removeItem(k);
      }
      localStorage.setItem(key, JSON.stringify(out));
    } catch { /* cache is a convenience only */ }
  }
  return out;
}

/**
 * Compare a date window with what is normal for the same calendar days
 * (average of every year on record).
 */
export function climateWindow(climate, startDay, endDay) {
  if (!climate || climate.status !== 'live') return null;
  const d = climate.daily;
  const sumByDoy = new Array(366).fill(0), tempByDoy = new Array(366).fill(0), cnt = new Array(366).fill(0);
  for (let i = 0; i < d.days.length; i++) {
    const doy = Math.min(365, parts(d.days[i]).doy);
    sumByDoy[doy] += d.rain[i]; tempByDoy[doy] += d.temp[i]; cnt[doy]++;
  }
  let rain = 0, rainNormal = 0, temp = 0, tempNormal = 0, n = 0;
  for (let i = 0; i < d.days.length; i++) {
    if (d.days[i] < startDay || d.days[i] > endDay) continue;
    const doy = Math.min(365, parts(d.days[i]).doy);
    rain += d.rain[i]; temp += d.temp[i];
    rainNormal += sumByDoy[doy] / cnt[doy]; tempNormal += tempByDoy[doy] / cnt[doy];
    n++;
  }
  const wanted = endDay - startDay + 1;
  if (n < Math.min(30, wanted * 0.5)) return null;
  const out = {
    days: n, coverage: n / wanted, rain, rainNormal,
    rainPct: rainNormal > 5 ? (rain / rainNormal) * 100 : null,
    temp: temp / n, tempAnomaly: (temp - tempNormal) / n,
    recordFromYear: parts(d.days[0]).y,
    soil: null,
  };
  if (climate.soil) {
    const sv = [];
    for (let i = 0; i < climate.soil.days.length; i++) {
      const day = climate.soil.days[i];
      if (day >= startDay && day <= endDay) sv.push(climate.soil.values[i]);
    }
    if (sv.length >= 20) {
      const k = Math.min(30, Math.floor(sv.length / 2));
      const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
      out.soil = { first: mean(sv.slice(0, k)), last: mean(sv.slice(-k)), mean: mean(sv), n: sv.length, k };
    }
  }
  return out;
}

/** Monthly rainfall totals inside a window, for the bar chart. */
export function monthlyRain(climate, startDay, endDay) {
  if (!climate || climate.status !== 'live') return [];
  const d = climate.daily, map = new Map();
  for (let i = 0; i < d.days.length; i++) {
    if (d.days[i] < startDay || d.days[i] > endDay) continue;
    const p = parts(d.days[i]);
    const key = p.y * 12 + p.m;
    map.set(key, (map.get(key) || 0) + d.rain[i]);
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0])
    .map(([k, v]) => ({ y: Math.floor(k / 12), m: k % 12, value: v }));
}

export function describeRain(pct) {
  if (pct == null) return 'too little rain normally falls here to judge';
  if (pct >= 130) return 'well above normal';
  if (pct >= 115) return 'above normal';
  if (pct > 85) return 'close to normal';
  if (pct > 70) return 'below normal';
  return 'well below normal';
}

export function describeTemp(anomaly) {
  if (Math.abs(anomaly) < 0.05) return 'the same as normal';
  return `${Math.abs(anomaly).toFixed(1)} °C ${anomaly > 0 ? 'above' : 'below'} normal`;
}
