// Screen 5: compare two study areas on the same factor and dates.
import { FACTOR_BY_ID, STATUS_LABEL, fmtValue, fmtPct } from '../core/factors.js';
import { getAllSeries, regionById } from '../core/data.js';
import { fmtDay } from '../core/dates.js';
import { sliceSeries, summarize, forecast, matchSeries, pearson, describeCorrelation, toPercentChange, toAbsoluteChange, linearTrend } from '../core/analytics.js';
import { h, clear } from './dom.js';
import { S } from './state.js';
import { lineChart, scatterChart } from './charts.js';
import { factorChips, segmented } from './parts.js';

const COLOR_A = '#6250d6', COLOR_B = '#e34948';
let root, controls, out, token = 0;

export function initCompare(el) {
  root = el;
  root.append(controls = h('div', { class: 'stack pad' }), out = h('div', { class: 'stack pad-x' }));
}

function regionSelect(label, value, onPick) {
  const sel = h('select', { 'aria-label': label, onchange: (e) => onPick(e.target.value) },
    S.catalog.regions.map((r) => h('option', { value: r.id, selected: r.id === value, text: r.name })));
  return h('label', { class: 'field' }, h('span', { text: label }), sel);
}

export async function renderCompare() {
  const C = S.compare, regs = S.catalog.regions;
  if (!C.a || !regionById(C.a)) C.a = S.region && !S.region.custom ? S.region.id : regs[0].id;
  if (!C.b || !regionById(C.b) || C.b === C.a) C.b = (regs.find((r) => r.id !== C.a) || regs[0]).id;
  const f = FACTOR_BY_ID[C.factor];
  const rerun = () => renderCompare();

  clear(controls).append(
    h('p', { class: 'lede', text: 'Put two study areas side by side: the same factor, over the same dates.' }),
    h('div', { class: 'card stack' },
      h('div', { class: 'two' },
        regionSelect('First area', C.a, (v) => { C.a = v; if (C.b === v) C.b = null; rerun(); }),
        regionSelect('Second area', C.b, (v) => { C.b = v; if (C.a === v) C.a = null; rerun(); })),
      factorChips(C.factor, (id) => { C.factor = id; rerun(); }, { required: true, label: 'Factor to compare' }),
      segmented([['all', 'All dates'], ['730', 'Last 2 years'], ['365', 'Last year']], C.span, (v) => { C.span = v; rerun(); }, 'Dates'),
      f.id !== 'deform' ? segmented([['pct', 'Change since start (%)'], ['raw', 'Actual values']], C.mode, (v) => { C.mode = v; rerun(); }, 'Values shown') : null));

  const mine = ++token;
  const ra = regionById(C.a), rb = regionById(C.b);
  const [allA, allB] = await Promise.all([getAllSeries(ra), getAllSeries(rb)]);
  if (mine !== token) return;
  const a = allA[f.id], b = allB[f.id];
  clear(out);

  const missing = [[ra, a], [rb, b]].filter(([, se]) => se.status === 'unavailable');
  if (missing.length) {
    out.append(h('section', { class: 'card' }, h('h3', { text: 'Cannot compare this factor' }),
      missing.map(([r, se]) => h('p', { class: 'empty', text: `${f.name} is unavailable for ${r.name}. ${se.reason || ''}` })),
      h('p', { class: 'muted small', text: 'Choose another factor or another pair of areas.' })));
    return;
  }
  const end = Math.min(a.days[a.days.length - 1], b.days[b.days.length - 1]);
  let start = Math.max(a.days[0], b.days[0]);
  if (C.span !== 'all') start = Math.max(start, end - Number(C.span));
  const sa = sliceSeries(a, start, end), sb = sliceSeries(b, start, end);
  const ma = summarize(sa), mb = summarize(sb);
  if (!ma.ok || !mb.ok) {
    out.append(h('section', { class: 'card' }, h('p', { class: 'empty', text: 'Too few acquisitions in these dates to compare. Choose a longer period.' })));
    return;
  }
  const usePct = f.id !== 'deform' && C.mode === 'pct';
  const pa = usePct ? toPercentChange(sa) : (f.id === 'deform' ? toAbsoluteChange(sa) : sa);
  const pb = usePct ? toPercentChange(sb) : (f.id === 'deform' ? toAbsoluteChange(sb) : sb);
  const fmt = usePct ? (v) => fmtPct(v) || '0%' : (v) => fmtValue(v, f);
  const unitLabel = usePct ? 'change since start, %' : (f.id === 'deform' ? 'change since start, mm' : f.unit);

  // side-by-side numbers
  const fa = forecast(a), fb = forecast(b);
  const trend = (fc, se) => (fc.ok ? `${fmtValue(fc.slopePerYear, f, { sign: true })}/yr` : (() => { const t = linearTrend(se.days, se.values); return t ? `${fmtValue(t.slope, f, { sign: true })}/yr` : 'n/a'; })());
  const net = (m) => (f.id === 'deform' || m.pct == null ? fmtValue(m.net, f, { sign: true }) : `${fmtPct(m.pct)} (${fmtValue(m.net, f, { sign: true })})`);
  const prov = (se) => (se.provenance === 'simulated' ? 'Simulated demo' : 'Processed satellite');
  const rows = [
    ['Net change', net(ma), net(mb)],
    ['Underlying trend', trend(fa, a), trend(fb, b)],
    ['Acquisitions', String(ma.n), String(mb.n)],
    ['Data status', STATUS_LABEL[a.status], STATUS_LABEL[b.status]],
    ['Data type', prov(a), prov(b)],
  ];
  out.append(h('section', { class: 'card' },
    h('h3', { text: `${f.name}, ${fmtDay(start)} to ${fmtDay(end)}` }),
    h('div', { class: 'table-scroll' }, h('table', { class: 'data-table compare-table' },
      h('thead', null, h('tr', null, h('th', { scope: 'col', text: '' }),
        h('th', { scope: 'col' }, h('span', { class: 'key', style: `background:${COLOR_A}` }), ra.name),
        h('th', { scope: 'col' }, h('span', { class: 'key', style: `background:${COLOR_B}` }), rb.name))),
      h('tbody', null, rows.map((r) => h('tr', null, h('th', { scope: 'row', text: r[0] }), h('td', { text: r[1] }), h('td', { text: r[2] }))))))));

  // how each area evolved
  const lineHost = h('div');
  out.append(h('section', { class: 'card' }, h('h3', { text: 'How each area changed over time' }),
    h('p', { class: 'chart-title', text: `${f.metric} (${unitLabel})` }), lineHost,
    usePct ? h('p', { class: 'muted small', text: 'Shown as percent change from each area\'s first value, so areas of different size can share one scale.' }) : null));
  lineChart(lineHost, {
    series: [{ name: ra.name, color: COLOR_A, days: pa.days, values: pa.values }, { name: rb.name, color: COLOR_B, days: pb.days, values: pb.values }],
    fmt, includeZero: usePct || f.id === 'deform', label: `${f.metric} in ${ra.name} and ${rb.name}`,
  });

  // do they move together
  const pairs = matchSeries(pa, pb);
  const xs = pairs.map((p) => p.a), ys = pairs.map((p) => p.b);
  const r = pearson(xs, ys);
  let fit = null;
  if (r != null) {
    const xm = xs.reduce((s2, v) => s2 + v, 0) / xs.length, ym = ys.reduce((s2, v) => s2 + v, 0) / ys.length;
    const sxx = xs.reduce((s2, v) => s2 + (v - xm) ** 2, 0), sxy = xs.reduce((s2, v, i) => s2 + (v - xm) * (ys[i] - ym), 0);
    fit = { slope: sxy / sxx, intercept: ym - (sxy / sxx) * xm };
  }
  const scHost = h('div');
  out.append(h('section', { class: 'card' }, h('h3', { text: 'Do the two areas move together?' }),
    h('p', { text: r == null ? 'There are not enough matching dates to tell.' : `Across ${pairs.length} matching dates there is a ${describeCorrelation(r)} (r = ${r.toFixed(2).replace('-', '−')}).` }),
    scHost,
    h('p', { class: 'muted small', text: 'Each dot is one date on which both areas were observed. A shared seasonal cycle can produce a high correlation by itself; it does not show that one area influences the other.' })));
  scatterChart(scHost, {
    points: pairs.map((p) => ({ x: p.a, y: p.b, day: p.day })), color: '#5b6772', fit, fmt,
    xLabel: `${ra.name} (${unitLabel})`, yLabel: `${rb.name} (${unitLabel})`, xName: ra.name, yName: rb.name,
    label: `${ra.name} against ${rb.name}`,
  });

  const notes = [];
  if (a.status === 'limited') notes.push(`${ra.name} has limited data: ${a.reason || 'few acquisitions.'}`);
  if (b.status === 'limited') notes.push(`${rb.name} has limited data: ${b.reason || 'few acquisitions.'}`);
  if (Math.abs(ma.n - mb.n) > Math.max(ma.n, mb.n) * 0.3) notes.push(`The areas have very different numbers of acquisitions (${ma.n} and ${mb.n}), so the correlation rests on the sparser one.`);
  if (a.provenance === 'simulated' || b.provenance === 'simulated') notes.push('At least one side is simulated demo data, so this comparison shows how the tool works, not a real finding.');
  notes.push('Areas differ in size, terrain and how often usable passes occur. Compare direction and timing with more confidence than exact amounts.');
  out.append(h('section', { class: 'card' }, h('h3', { text: 'Before drawing conclusions' }), h('ul', { class: 'bullets' }, notes.map((t) => h('li', { text: t })))));
}
