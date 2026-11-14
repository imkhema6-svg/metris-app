// Small dependency-free SVG charts: line (with optional projection band),
// monthly bars and scatter. Each chart has a touch/hover readout and a
// "show as table" view so no value depends on colour or on hovering.
import { h, s, clear } from './dom.js';
import { fmtDay, monthShort, parts, toDay } from '../core/dates.js';

const W = 360;
const INK = '#14212b', MUTED = '#5b6772', GRID = '#e3e8e4', SURFACE = '#ffffff';

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const raw = (max - min) / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((st) => st >= raw) || 10 * pow;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return { lo, hi, ticks, step };
}

function tickText(v, step) {
  let dec = 0;
  while (dec < 4 && Math.abs(step * 10 ** dec - Math.round(step * 10 ** dec)) > 1e-9) dec++;
  if (Math.abs(v) >= 10000) return `${(v / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })}K`;
  return v.toLocaleString('en-GB', { minimumFractionDigits: dec, maximumFractionDigits: dec }).replace('-', '−');
}

function monthTicks(d0, d1) {
  const a = parts(d0), b = parts(d1);
  const nMonths = (b.y - a.y) * 12 + (b.m - a.m) + 1;
  const step = [1, 2, 3, 6, 12].find((st) => nMonths / st <= 5) || 12;
  const out = [];
  for (let k = a.y * 12 + a.m; k <= b.y * 12 + b.m; k++) {
    if (k % step) continue;
    const y = Math.floor(k / 12), m = k % 12;
    const day = toDay(`${y}-${String(m + 1).padStart(2, '0')}-01`);
    if (day < d0 || day > d1) continue;
    out.push({ day, label: step === 12 ? String(y) : `${monthShort(m)} ${String(y).slice(2)}` });
  }
  return out;
}

function tooltipBox(host) {
  const tip = h('div', { class: 'chart-tip', hidden: true, role: 'status' });
  host.append(tip);
  return {
    show(xFrac, rows, title) {
      clear(tip);
      tip.append(h('div', { class: 'chart-tip-title', text: title }));
      for (const r of rows) {
        tip.append(h('div', { class: 'chart-tip-row' },
          r.color ? h('span', { class: 'key', style: `background:${r.color}` }) : null,
          h('strong', { text: r.value }), r.name ? h('span', { text: ' ' + r.name }) : null));
      }
      tip.hidden = false;
      const hw = host.clientWidth, tw = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(hw - tw, xFrac * hw - tw / 2))}px`;
    },
    hide() { tip.hidden = true; },
  };
}

function tableView(host, columns, rows) {
  const table = h('table', { class: 'data-table' },
    h('thead', null, h('tr', null, columns.map((c) => h('th', { scope: 'col', text: c })))),
    h('tbody', null, rows.map((r) => h('tr', null, r.map((c) => h('td', { text: c }))))));
  host.append(h('details', { class: 'chart-table' }, h('summary', { text: 'Show values as a table' }), h('div', { class: 'table-scroll' }, table)));
}

function legend(host, series) {
  host.append(h('div', { class: 'chart-legend' }, series.map((se) =>
    h('span', { class: 'legend-item' }, h('span', { class: 'key', style: `background:${se.color}` }), se.name))));
}

function attachPointer(svg, onMove, onLeave, count) {
  let idx = -1;
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    idx = onMove(((e.clientX - r.left) / r.width) * W);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { idx = -1; onLeave(); });
  svg.addEventListener('blur', () => { idx = -1; onLeave(); });
  svg.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    idx = Math.max(0, Math.min(count() - 1, idx + (e.key === 'ArrowRight' ? 1 : -1)));
    onMove(null, idx);
  });
}

/**
 * Line chart over time.
 * o.series: [{ name, color, days[], values[] }]
 * o.projection: { days[], values[], lo[], hi[], color }   (optional, dashed with band)
 * o.fmt(v): value formatter for readout and table;  o.label: accessible name
 */
export function lineChart(host, o) {
  clear(host);
  host.classList.add('chart');
  const H = o.height || 190, m = { l: 44, r: 14, t: 14, b: 24 };
  const allDays = o.series.flatMap((se) => se.days).concat(o.projection ? o.projection.days : []);
  const allVals = o.series.flatMap((se) => se.values)
    .concat(o.projection ? [...o.projection.lo, ...o.projection.hi] : []);
  if (!allDays.length) { host.append(h('p', { class: 'empty', text: 'No acquisitions to plot.' })); return; }
  const d0 = Math.min(...allDays), d1 = Math.max(...allDays);
  let vMin = Math.min(...allVals), vMax = Math.max(...allVals);
  if (o.includeZero) { vMin = Math.min(vMin, 0); vMax = Math.max(vMax, 0); }
  const pad = (vMax - vMin) * 0.08 || Math.abs(vMax) * 0.05 || 1;
  const y = niceTicks(vMin - pad, vMax + pad, 4);
  const X = (d) => m.l + ((d - d0) / Math.max(1, d1 - d0)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - y.lo) / (y.hi - y.lo)) * (H - m.t - m.b);

  if (o.series.length > 1) legend(host, o.series);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.label || 'Line chart', tabindex: 0, class: 'chart-svg' });
  for (const t of y.ticks) {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: t === 0 && y.lo < 0 ? '#9aa5ac' : GRID, 'stroke-width': 1 }));
    svg.append(s('text', { x: m.l - 6, y: Y(t) + 3.5, 'text-anchor': 'end', class: 'tick' }, tickText(t, y.step)));
  }
  for (const t of monthTicks(d0, d1)) {
    svg.append(s('line', { x1: X(t.day), x2: X(t.day), y1: H - m.b, y2: H - m.b + 4, stroke: '#9aa5ac', 'stroke-width': 1 }));
    svg.append(s('text', { x: X(t.day), y: H - 6, 'text-anchor': 'middle', class: 'tick' }, t.label));
  }
  if (o.projection) {
    const p = o.projection, last = o.series[0];
    const jd = last.days[last.days.length - 1], jv = last.values[last.values.length - 1];
    const up = [[jd, jv], ...p.days.map((d, i) => [d, p.hi[i]])], dn = [[jd, jv], ...p.days.map((d, i) => [d, p.lo[i]])].reverse();
    svg.append(s('path', { d: 'M' + [...up, ...dn].map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join('L') + 'Z', fill: p.color, opacity: 0.14 }));
    svg.append(s('path', { d: 'M' + [[jd, jv], ...p.days.map((d, i) => [d, p.values[i]])].map(([d, v]) => `${X(d).toFixed(1)},${Y(v).toFixed(1)}`).join('L'),
      fill: 'none', stroke: p.color, 'stroke-width': 2, 'stroke-dasharray': '2 5', 'stroke-linecap': 'round' }));
  }
  for (const se of o.series) {
    if (!se.days.length) continue;
    svg.append(s('path', { d: 'M' + se.days.map((d, i) => `${X(d).toFixed(1)},${Y(se.values[i]).toFixed(1)}`).join('L'),
      fill: 'none', stroke: se.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const li = se.days.length - 1;
    svg.append(s('circle', { cx: X(se.days[li]), cy: Y(se.values[li]), r: 4, fill: se.color, stroke: SURFACE, 'stroke-width': 2 }));
  }
  const cross = s('line', { y1: m.t, y2: H - m.b, stroke: INK, 'stroke-width': 1, visibility: 'hidden' });
  const dots = o.series.map((se) => s('circle', { r: 4.5, fill: se.color, stroke: SURFACE, 'stroke-width': 2, visibility: 'hidden' }));
  svg.append(cross, ...dots);
  host.append(svg);

  const tip = tooltipBox(host);
  const xs = [...new Set(allDays)].sort((a, b) => a - b);
  const valueAt = (se, day) => {
    let best = -1, bd = 7;
    for (let i = 0; i < se.days.length; i++) { const dd = Math.abs(se.days[i] - day); if (dd < bd) { bd = dd; best = i; } }
    return best < 0 ? null : se.values[best];
  };
  attachPointer(svg, (px, forced) => {
    let i = forced;
    if (i == null) {
      const day = d0 + ((px - m.l) / (W - m.l - m.r)) * (d1 - d0);
      i = 0;
      for (let k = 1; k < xs.length; k++) if (Math.abs(xs[k] - day) < Math.abs(xs[i] - day)) i = k;
    }
    const day = xs[i];
    cross.setAttribute('x1', X(day)); cross.setAttribute('x2', X(day)); cross.setAttribute('visibility', 'visible');
    const rows = [];
    o.series.forEach((se, k) => {
      const v = valueAt(se, day);
      if (v == null) { dots[k].setAttribute('visibility', 'hidden'); return; }
      dots[k].setAttribute('cx', X(day)); dots[k].setAttribute('cy', Y(v)); dots[k].setAttribute('visibility', 'visible');
      rows.push({ color: se.color, value: o.fmt(v), name: o.series.length > 1 ? se.name : '' });
    });
    if (o.projection) {
      const pi = o.projection.days.indexOf(day);
      if (pi >= 0) rows.push({ color: o.projection.color, value: o.fmt(o.projection.values[pi]), name: `projected (${o.fmt(o.projection.lo[pi])} to ${o.fmt(o.projection.hi[pi])})` });
    }
    tip.show(X(day) / W, rows, fmtDay(day));
    return i;
  }, () => { cross.setAttribute('visibility', 'hidden'); dots.forEach((d) => d.setAttribute('visibility', 'hidden')); tip.hide(); }, () => xs.length);

  const cols = ['Date', ...o.series.map((se) => (o.series.length > 1 ? se.name : o.valueHeading || 'Value'))];
  const rows = xs.filter((d) => !o.projection || !o.projection.days.includes(d)).map((d) => [fmtDay(d), ...o.series.map((se) => { const v = valueAt(se, d); return v == null ? '' : o.fmt(v); })]);
  if (o.projection) o.projection.days.forEach((d, i) => rows.push([`${fmtDay(d)} (projected)`, `${o.fmt(o.projection.values[i])} (${o.fmt(o.projection.lo[i])} to ${o.fmt(o.projection.hi[i])})`]));
  tableView(host, cols, rows);
}

/** Vertical bars, one per item: o.bars = [{ label, tick, value }] */
export function barChart(host, o) {
  clear(host);
  host.classList.add('chart');
  if (!o.bars.length) { host.append(h('p', { class: 'empty', text: 'Nothing to plot.' })); return; }
  const H = o.height || 150, m = { l: 44, r: 8, t: 10, b: 24 };
  const y = niceTicks(0, Math.max(1, ...o.bars.map((b) => b.value)), 3);
  const slot = (W - m.l - m.r) / o.bars.length, bw = Math.max(2, Math.min(24, slot - 2));
  const Y = (v) => H - m.b - (v / y.hi) * (H - m.t - m.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.label || 'Bar chart', tabindex: 0, class: 'chart-svg' });
  for (const t of y.ticks) {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: GRID, 'stroke-width': 1 }));
    svg.append(s('text', { x: m.l - 6, y: Y(t) + 3.5, 'text-anchor': 'end', class: 'tick' }, tickText(t, y.step)));
  }
  const every = Math.ceil(o.bars.length / 6);
  const rects = o.bars.map((b, i) => {
    const x = m.l + i * slot + (slot - bw) / 2, top = Y(b.value), r = Math.min(4, bw / 2, (H - m.b - top));
    const d = `M${x},${H - m.b}V${top + r}Q${x},${top} ${x + r},${top}H${x + bw - r}Q${x + bw},${top} ${x + bw},${top + r}V${H - m.b}Z`;
    const el = s('path', { d, fill: o.color });
    svg.append(el);
    if (i % every === 0) svg.append(s('text', { x: x + bw / 2, y: H - 6, 'text-anchor': 'middle', class: 'tick' }, b.tick));
    return el;
  });
  host.append(svg);
  const tip = tooltipBox(host);
  attachPointer(svg, (px, forced) => {
    const i = forced != null ? forced : Math.max(0, Math.min(o.bars.length - 1, Math.floor((px - m.l) / slot)));
    rects.forEach((r, k) => r.setAttribute('opacity', k === i ? 1 : 0.45));
    tip.show((m.l + (i + 0.5) * slot) / W, [{ value: o.fmt(o.bars[i].value) }], o.bars[i].label);
    return i;
  }, () => { rects.forEach((r) => r.setAttribute('opacity', 1)); tip.hide(); }, () => o.bars.length);
  tableView(host, [o.categoryHeading || 'Month', o.valueHeading || 'Value'], o.bars.map((b) => [b.label, o.fmt(b.value)]));
}

/** Scatter of paired values: o.points = [{ x, y, day }] with optional o.fit = { slope, intercept } */
export function scatterChart(host, o) {
  clear(host);
  host.classList.add('chart');
  if (o.points.length < 3) { host.append(h('p', { class: 'empty', text: 'Fewer than three matching dates, so there is nothing to correlate.' })); return; }
  const H = 250, m = { l: 48, r: 12, t: 12, b: 40 };
  const xt = niceTicks(Math.min(...o.points.map((p) => p.x)), Math.max(...o.points.map((p) => p.x)), 4);
  const yt = niceTicks(Math.min(...o.points.map((p) => p.y)), Math.max(...o.points.map((p) => p.y)), 4);
  const X = (v) => m.l + ((v - xt.lo) / (xt.hi - xt.lo)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((v - yt.lo) / (yt.hi - yt.lo)) * (H - m.t - m.b);
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': o.label || 'Scatter chart', tabindex: 0, class: 'chart-svg' });
  for (const t of yt.ticks) {
    svg.append(s('line', { x1: m.l, x2: W - m.r, y1: Y(t), y2: Y(t), stroke: GRID, 'stroke-width': 1 }));
    svg.append(s('text', { x: m.l - 6, y: Y(t) + 3.5, 'text-anchor': 'end', class: 'tick' }, tickText(t, yt.step)));
  }
  for (const t of xt.ticks) {
    svg.append(s('line', { x1: X(t), x2: X(t), y1: m.t, y2: H - m.b, stroke: GRID, 'stroke-width': 1 }));
    svg.append(s('text', { x: X(t), y: H - m.b + 14, 'text-anchor': 'middle', class: 'tick' }, tickText(t, xt.step)));
  }
  svg.append(s('text', { x: (m.l + W - m.r) / 2, y: H - 6, 'text-anchor': 'middle', class: 'axis-label' }, o.xLabel));
  svg.append(s('text', { x: 12, y: (m.t + H - m.b) / 2, 'text-anchor': 'middle', class: 'axis-label', transform: `rotate(-90 12 ${(m.t + H - m.b) / 2})` }, o.yLabel));
  if (o.fit) {
    const clip = (v) => Math.max(yt.lo, Math.min(yt.hi, v));
    svg.append(s('line', { x1: X(xt.lo), y1: Y(clip(o.fit.intercept + o.fit.slope * xt.lo)), x2: X(xt.hi), y2: Y(clip(o.fit.intercept + o.fit.slope * xt.hi)), stroke: MUTED, 'stroke-width': 1.5 }));
  }
  const marks = o.points.map((p) => { const c = s('circle', { cx: X(p.x), cy: Y(p.y), r: 4, fill: o.color, stroke: SURFACE, 'stroke-width': 2 }); svg.append(c); return c; });
  host.append(svg);
  const tip = tooltipBox(host);
  let lastY = 0;
  svg.addEventListener('pointermove', (e) => { const r = svg.getBoundingClientRect(); lastY = ((e.clientY - r.top) / r.height) * H; }, true);
  svg.addEventListener('pointerdown', (e) => { const r = svg.getBoundingClientRect(); lastY = ((e.clientY - r.top) / r.height) * H; }, true);
  attachPointer(svg, (px, forced) => {
    let i = forced;
    if (i == null) {
      i = 0; let best = Infinity;
      o.points.forEach((p, k) => { const dd = (X(p.x) - px) ** 2 + (Y(p.y) - lastY) ** 2; if (dd < best) { best = dd; i = k; } });
    }
    marks.forEach((c, k) => c.setAttribute('r', k === i ? 6 : 4));
    const p = o.points[i];
    tip.show(X(p.x) / W, [{ value: o.fmt(p.x), name: o.xName }, { value: o.fmt(p.y), name: o.yName }], fmtDay(p.day));
    return i;
  }, () => { marks.forEach((c) => c.setAttribute('r', 4)); tip.hide(); }, () => o.points.length);
  tableView(host, ['Date', o.xName, o.yName], o.points.map((p) => [fmtDay(p.day), o.fmt(p.x), o.fmt(p.y)]));
}
