// Shared app state and navigation. Views read S and re-render when notified.
import { getAllSeries, masterDays, regionById, customRegion } from '../core/data.js';
import { fetchClimate } from '../core/live.js';
import { todayDay } from '../core/dates.js';

export const S = {
  catalog: null,
  library: [],
  filter: null,          // null = all four factors, or one factor id
  layer: 'map',          // 'map' or 'sat'
  region: null,          // selected study area or custom point
  series: null,          // { factorId: series } for the selected area
  days: [],              // acquisition days for the selected area
  startDay: null, endDay: null,
  climate: null, climateState: 'idle',   // idle | loading | done
  chat: [],
  compare: { a: null, b: null, factor: 'water', span: 'all', mode: 'pct' },
};

const subscribers = [];
export function subscribe(fn) { subscribers.push(fn); }
export function notify(what) { for (const fn of subscribers) fn(what); }

export function currentRoute() {
  const p = location.hash.replace(/^#\/?/, '').split('/');
  return { view: p[0] || 'explore', arg: p[1] || null };
}
export function go(route) {
  if (location.hash === '#/' + route) notify('route');
  else location.hash = '#/' + route;
}

function nearestIndex(days, target) {
  let best = 0;
  for (let i = 1; i < days.length; i++) if (Math.abs(days[i] - target) < Math.abs(days[best] - target)) best = i;
  return best;
}

/** Start day for "the last N days" snapped to a real acquisition. */
export function presetStart(spanDays) {
  if (!S.days.length) return todayDay() - 7 - spanDays;
  const last = S.days[S.days.length - 1];
  if (spanDays == null || last - S.days[0] <= spanDays) return S.days[0];
  const i = nearestIndex(S.days, last - spanDays);
  return S.days[Math.min(i, S.days.length - 2)];
}

function save() {
  try {
    localStorage.setItem('metris:state', JSON.stringify({
      regionId: S.region ? S.region.id : null,
      custom: S.region && S.region.custom ? S.region.center : null,
      startDay: S.startDay, endDay: S.endDay,
    }));
  } catch { /* remembering the last area is optional */ }
}

export async function selectRegion(region, range) {
  S.region = region;
  S.series = await getAllSeries(region);
  S.days = masterDays(S.series);
  if (S.days.length) {
    S.endDay = S.days[S.days.length - 1];
    S.startDay = presetStart(730);
    if (range && S.days.includes(range.startDay) && S.days.includes(range.endDay) && range.startDay < range.endDay) {
      S.startDay = range.startDay; S.endDay = range.endDay;
    }
  } else {
    S.endDay = todayDay() - 7;
    S.startDay = S.endDay - 365;
  }
  S.chat = [];
  S.climate = null;
  save();
  notify('region');
  loadClimate();
}

export async function loadClimate() {
  const region = S.region;
  if (!region) return;
  S.climateState = 'loading';
  notify('climate');
  const c = await fetchClimate(region.center[0], region.center[1]);
  if (S.region !== region) return;
  S.climate = c;
  S.climateState = 'done';
  notify('climate');
}

export function setRange(startDay, endDay) {
  S.startDay = startDay; S.endDay = endDay;
  save();
  notify('range');
}

export function setFilter(id) {
  S.filter = S.filter === id ? null : id;
  notify('filter');
}

export async function restore() {
  try {
    const saved = JSON.parse(localStorage.getItem('metris:state') || 'null');
    if (!saved || !saved.regionId) return;
    const region = saved.regionId === 'custom' && saved.custom
      ? customRegion(saved.custom[0], saved.custom[1]) : regionById(saved.regionId);
    if (region) await selectRegion(region, saved);
  } catch { /* start fresh */ }
}
