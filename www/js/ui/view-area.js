// Screen 3: the area analysis dashboard.
import { FACTORS, fmtValue, fmtPct } from '../core/factors.js';
import { countryById } from '../core/data.js';
import { fmtDay, parts, monthShort, toDay } from '../core/dates.js';
import { sliceSeries, summarize, forecast } from '../core/analytics.js';
import { interpret, EVIDENCE_LABEL } from '../core/interpret.js';
import { climateWindow, monthlyRain, describeRain, describeTemp } from '../core/live.js';
import { h, s, clear, icon } from './dom.js';
import { S, go, setRange, setFilter, presetStart, loadClimate } from './state.js';
import { lineChart, barChart } from './charts.js';
import { statusBadge, provenanceBadge, factorChips, libraryList } from './parts.js';

let root, headEl, periodEl, bodyEl, shownRegion = null;

export function initArea(el) {
  root = el;
  root.append(headEl = h('div', { class: 'stack pad' }), periodEl = h('div', { class: 'pad-x' }), bodyEl = h('div', { class: 'stack pad' }));
}

const coord = (lat, lon) => `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}`;

function renderHead() {
  clear(headEl);
  const r = S.region;
  const country = r.country ? countryById(r.country) : null;
  const facts = h('dl', { class: 'facts' });
  const add = (k, v) => facts.append(h('div', null, h('dt', { text: k }), h('dd', { text: v })));
  if (country) add('Country', country.name);
  add('Coordinates', coord(r.center[0], r.center[1]));
  if (S.days.length) {
    add('Analysis period available', `${fmtDay(S.days[0])} to ${fmtDay(S.days[S.days.length - 1])}`);
    add('Last data update', fmtDay(S.days[S.days.length - 1]));
  } else add('Radar analysis', 'None stored for this point');
  headEl.append(h('section', { class: 'card' },
    h('p', { class: 'muted', text: r.summary }), facts,
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'btn', text: 'Ask a question', onclick: () => go('assistant') }),
      !r.custom ? h('button', { type: 'button', class: 'btn ghost', text: 'Compare', onclick: () => { S.compare.a = r.id; go('compare'); } }) : null)));
}

// ---- period: every tick is one satellite pass; only real passes can be chosen ----
function passStrip(i0, i1) {
  const days = S.days, W = 360, H = 46, pad = 6;
  const X = (d) => pad + ((d - days[0]) / (days[days.length - 1] - days[0])) * (W - 2 * pad);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pass-strip', role: 'img',
    'aria-label': `${days.length} acquisition dates; ${i1 - i0 + 1} selected` });
  svg.append(s('rect', { x: X(days[i0]) - 3, y: 2, width: X(days[i1]) - X(days[i0]) + 6, height: 22, rx: 4, fill: '#e4e9e6' }));
  days.forEach((d, i) => {
    const on = i >= i0 && i <= i1;
    svg.append(s('line', { x1: X(d), x2: X(d), y1: on ? 5 : 9, y2: on ? 21 : 17, stroke: on ? '#14212b' : '#aab4ae', 'stroke-width': on ? 1.6 : 1.2, 'stroke-linecap': 'round' }));
  });
  for (let y = parts(days[0]).y + 1; y <= parts(days[days.length - 1]).y; y++) {
    const d = toDay(`${y}-01-01`);
    svg.append(s('line', { x1: X(d), x2: X(d), y1: 27, y2: 32, stroke: '#7a8690', 'stroke-width': 1 }));
    svg.append(s('text', { x: X(d), y: 44, 'text-anchor': 'middle', class: 'tick' }, String(y)));
  }
  return svg;
}

function renderPeriod() {
  clear(periodEl);
  const days = S.days;
  const card = h('section', { class: 'card period' }, h('h2', { text: 'Dates' }));
  periodEl.append(card);
  const presets = (pairs, apply) => h('div', { class: 'presets' }, pairs.map(([label, span]) =>
    h('button', { type: 'button', class: 'btn small ghost', text: label, onclick: () => apply(span) })));

  if (!days.length) {
    const readout = h('p', { class: 'period-readout', text: `${fmtDay(S.startDay)} to ${fmtDay(S.endDay)}` });
    card.append(readout, presets([['3 months', 91], ['1 year', 365], ['3 years', 1096]], (span) => setRange(S.endDay - span, S.endDay)),
      h('p', { class: 'hint', text: 'Climate records run up to about a week before today.' }));
    return;
  }
  let i0 = Math.max(0, days.indexOf(S.startDay)), i1 = days.indexOf(S.endDay);
  if (i1 < 0) i1 = days.length - 1;
  const readout = h('p', { class: 'period-readout' });
  const stripHost = h('div');
  const mk = (label, value) => h('input', { type: 'range', min: 0, max: days.length - 1, step: 1, value, 'aria-label': label });
  const a = mk('Start date', i0), b = mk('End date', i1);
  const paint = () => {
    readout.textContent = `${fmtDay(days[i0])} to ${fmtDay(days[i1])}`;
    readout.append(h('span', { class: 'muted', text: `${i1 - i0 + 1} of ${days.length} satellite passes` }));
    clear(stripHost).append(passStrip(i0, i1));
    a.value = i0; b.value = i1;
  };
  a.addEventListener('input', () => { i0 = Math.min(+a.value, days.length - 2); if (i1 <= i0) i1 = i0 + 1; paint(); });
  b.addEventListener('input', () => { i1 = Math.max(+b.value, 1); if (i0 >= i1) i0 = i1 - 1; paint(); });
  const commit = () => setRange(days[i0], days[i1]);
  a.addEventListener('change', commit); b.addEventListener('change', commit);
  paint();
  card.append(readout, stripHost,
    h('label', { class: 'slider' }, h('span', { text: 'Start' }), a),
    h('label', { class: 'slider' }, h('span', { text: 'End' }), b),
    presets([['6 months', 183], ['1 year', 365], ['2 years', 730], ['All', null]], (span) => {
      i1 = days.length - 1; i0 = days.indexOf(presetStart(span)); paint(); commit();
    }),
    h('p', { class: 'hint', text: 'Each tick is a satellite pass with usable data. Only those dates can be selected.' }));
}

function evidenceTag(level) {
  return h('span', { class: `tag ev-${level}`, text: EVIDENCE_LABEL[level] });
}

function fold(title, open, ...content) {
  return h('details', { class: 'fold', open }, h('summary', { text: title }), h('div', { class: 'fold-body' }, content));
}

function factorCard(f, clim) {
  const se = S.series[f.id];
  const card = h('article', { class: 'card factor', style: `--f:${f.color}` },
    h('header', { class: 'factor-head' }, h('span', { class: 'f-icon' }, icon(f.id, 18)), h('h3', { text: f.name })),
    h('div', { class: 'badges' }, statusBadge(se.status), se.status !== 'unavailable' ? provenanceBadge(se.provenance) : null));
  if (se.status === 'unavailable') {
    card.append(h('p', { class: 'empty', text: se.reason || 'No data is stored for this factor.' }));
    return card;
  }
  const sl = sliceSeries(se, S.startDay, S.endDay);
  const sm = summarize(sl);
  if (!sm.ok) {
    card.append(h('p', { class: 'empty', text: `Only ${sm.n} acquisition${sm.n === 1 ? '' : 's'} between these dates. Widen the dates to measure a change.` }));
    return card;
  }
  const it = interpret(f.id, sm, S.region, se, clim);
  const fc = forecast(se);
  const fmt = (v) => fmtValue(v, f);

  card.append(
    h('p', { class: 'stat-label', text: `Net change, ${fmtDay(sm.firstDay)} to ${fmtDay(sm.lastDay)}` }),
    h('p', { class: 'stat' }, fmtValue(sm.net, f, { sign: true }),
      f.id !== 'deform' && sm.pct != null ? h('span', { class: 'stat-sub', text: fmtPct(sm.pct) }) : null),
    h('p', { class: 'headline', text: it.headline }));

  const chartHost = h('div');
  card.append(h('p', { class: 'chart-title', text: `${f.metric} (${f.unit})` }), chartHost);
  lineChart(chartHost, { series: [{ name: f.metric, color: f.color, days: sl.days, values: sl.values }], fmt, includeZero: f.id === 'deform', label: `${f.metric} over time`, valueHeading: f.metric });

  const facts = h('dl', { class: 'facts' });
  const add = (k, v) => facts.append(h('div', null, h('dt', { text: k }), h('dd', { text: v })));
  add('Highest', `${fmt(sm.max)} on ${fmtDay(sm.maxDay)}`);
  add('Lowest', `${fmt(sm.min)} on ${fmtDay(sm.minDay)}`);
  if (fc.ok) add(fc.seasonal ? 'Underlying trend, seasons removed' : 'Underlying trend', `${fmtValue(fc.slopePerYear, f, { sign: true })} per year (whole record)`);
  add('Acquisitions in these dates', String(sm.n));
  card.append(facts);

  for (const c of it.caveats) card.append(h('p', { class: 'caveat', text: c }));

  if (it.drivers.length) {
    card.append(fold('What may be causing it', true,
      h('ul', { class: 'drivers' }, it.drivers.map((d) => h('li', null, h('p', { class: 'driver-text', text: d.text }), evidenceTag(d.evidence), h('p', { class: 'muted small', text: d.basis }))))));
  }
  if (it.impacts.length) {
    card.append(fold('What it could lead to', false,
      h('ul', { class: 'bullets' }, it.impacts.map((t) => h('li', { text: t }))),
      h('p', { class: 'muted small', text: 'General consequences of this kind of change. The app does not measure the impacts themselves.' })));
  }

  // outlook
  const outlook = [];
  if (fc.ok) {
    const last = fc.points[fc.points.length - 1];
    outlook.push(h('p', { text: `If the past pattern continues, ${f.metric.toLowerCase()} would be about ${fmt(last.value)} by ${fmtDay(last.day)}, likely between ${fmt(last.lo)} and ${fmt(last.hi)}.` }));
    const host = h('div');
    outlook.push(host);
    const recent = sliceSeries(se, se.days[se.days.length - 1] - 365, se.days[se.days.length - 1]);
    lineChart(host, {
      series: [{ name: f.metric, color: f.color, days: recent.days, values: recent.values }], fmt, height: 170,
      projection: { days: fc.points.map((p) => p.day), values: fc.points.map((p) => p.value), lo: fc.points.map((p) => p.lo), hi: fc.points.map((p) => p.hi), color: f.color },
      label: `${f.metric}: last year and projection`, valueHeading: f.metric,
    });
    outlook.push(h('p', { class: 'muted small', text: `Dotted line and shaded band: statistical projection (${fc.method}, fit quality ${fc.confidence}, R² ${fc.r2.toFixed(2)}). It extends the stored record and cannot foresee new events.` }));
  } else outlook.push(h('p', { class: 'empty', text: `No projection. ${fc.reason}` }));
  card.append(fold('Outlook, next three months', false, outlook));

  card.append(fold('How this is measured', false,
    h('p', { text: f.method }),
    h('p', { class: 'muted small', text: `Source: ${se.provenance === 'simulated' ? 'simulated demo values' : 'processed results loaded into the app'}. Sensor: ${se.sensor || 'not stated'}.` })));

  const lib = S.library.filter((x) => x.factor === f.id);
  if (lib.length) card.append(fold('Learn more from NASA', false, libraryList(lib)));
  return card;
}

function climateCard(clim) {
  const card = h('article', { class: 'card' }, h('header', { class: 'factor-head' }, h('h3', { text: 'Weather and soil context' })));
  if (S.climateState === 'loading') {
    card.append(h('p', { class: 'empty', text: 'Loading rainfall, temperature and soil moisture for this location…' }));
    return card;
  }
  const c = S.climate;
  if (!c || c.status !== 'live') {
    card.append(h('div', { class: 'badges' }, statusBadge('unavailable')),
      h('p', { class: 'empty', text: `Live weather data could not be loaded${c && c.error ? ` (${c.error})` : ''}. Check the internet connection, then try again.` }),
      h('button', { type: 'button', class: 'btn small', text: 'Try again', onclick: () => loadClimate() }));
    return card;
  }
  card.append(h('div', { class: 'badges' }, statusBadge('full'), provenanceBadge('live')));
  if (!clim) {
    card.append(h('p', { class: 'empty', text: 'The weather record does not cover these dates.' }));
    return card;
  }
  const tiles = h('div', { class: 'tiles' },
    h('div', { class: 'tile' }, h('p', { class: 'stat-label', text: 'Rainfall' }), h('p', { class: 'stat small', text: `${Math.round(clim.rain).toLocaleString('en-GB')} mm` }),
      h('p', { class: 'muted small', text: clim.rainPct != null ? `${Math.round(clim.rainPct)}% of normal, ${describeRain(clim.rainPct)}` : 'Too dry here for a meaningful normal' })),
    h('div', { class: 'tile' }, h('p', { class: 'stat-label', text: 'Mean temperature' }), h('p', { class: 'stat small', text: `${clim.temp.toFixed(1)} °C` }),
      h('p', { class: 'muted small', text: describeTemp(clim.tempAnomaly) })));
  card.append(tiles);

  const months = monthlyRain(c, S.startDay, S.endDay);
  const rainHost = h('div');
  card.append(h('p', { class: 'chart-title', text: 'Rainfall per month (mm)' }), rainHost);
  barChart(rainHost, {
    bars: months.map((m) => ({ label: `${monthShort(m.m)} ${m.y}`, tick: `${monthShort(m.m)} ${String(m.y).slice(2)}`, value: m.value })),
    color: '#5b7f95', fmt: (v) => `${v.toFixed(0)} mm`, label: 'Monthly rainfall', valueHeading: 'Rainfall',
  });

  if (c.soil) {
    const days = [], values = [];
    c.soil.days.forEach((d, i) => { if (d >= S.startDay && d <= S.endDay) { days.push(d); values.push(c.soil.values[i]); } });
    if (days.length > 2) {
      const host = h('div');
      card.append(h('p', { class: 'chart-title', text: 'Soil moisture, top 7 cm (m³/m³)' }), host);
      lineChart(host, { series: [{ name: 'Soil moisture', color: '#5b7f95', days, values }], fmt: (v) => `${v.toFixed(3)} m³/m³`, height: 160, label: 'Reanalysis soil moisture', valueHeading: 'Soil moisture' });
    }
  } else if (c.soilError) card.append(h('p', { class: 'muted small', text: `Soil moisture is unavailable here: ${c.soilError}` }));

  card.append(h('p', { class: 'muted small', text: `Normal means the average for the same calendar days, ${clim.recordFromYear} to present. Source: ERA5 and ERA5-Land reanalysis via Open-Meteo. These are modelled values on a grid of roughly 10 to 25 km, not NISAR measurements.` }));
  return card;
}

function renderBody() {
  clear(bodyEl);
  const clim = climateWindow(S.climate, S.startDay, S.endDay);
  if (!S.region.custom) {
    bodyEl.append(factorChips(S.filter, setFilter));
    for (const f of FACTORS) if (!S.filter || S.filter === f.id) bodyEl.append(factorCard(f, clim));
  }
  bodyEl.append(climateCard(clim));
}

/** what: which part of the state changed (region, range, filter, climate, route). */
export function renderArea(what) {
  if (!S.region) {
    shownRegion = null;
    clear(headEl); clear(periodEl); clear(bodyEl);
    headEl.append(h('section', { class: 'card' }, h('h2', { text: 'No area selected yet' }),
      h('p', { class: 'muted', text: 'Pick a study area, or tap any point on the map, and its analysis opens here.' }),
      h('button', { type: 'button', class: 'btn', text: 'Open Explore', onclick: () => go('explore') })));
    return;
  }
  if (shownRegion !== S.region || what === 'region') {
    shownRegion = S.region;
    renderHead(); renderPeriod();
    root.scrollIntoView({ block: 'start' });
  } else if (what === 'range' && !S.days.length) renderPeriod();
  renderBody();
}

export function areaTitle() { return S.region ? S.region.name : 'Area'; }
