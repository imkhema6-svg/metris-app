// Change metrics, trend, projection and correlation. Pure functions, no UI.
import { decimalYear } from './dates.js';

/** Keep only the acquisitions between two days (inclusive). */
export function sliceSeries(series, startDay, endDay) {
  const days = [], values = [];
  for (let i = 0; i < series.days.length; i++) {
    const d = series.days[i];
    if (d >= startDay && d <= endDay) { days.push(d); values.push(series.values[i]); }
  }
  return { ...series, days, values };
}

/** Ordinary least squares for y = X·b. Returns coefficients or null if singular. */
function solveLeastSquares(X, y) {
  const n = X.length, p = X[0].length;
  const A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      A[j][p] += X[i][j] * y[i];
      for (let k = 0; k < p; k++) A[j][k] += X[i][j] * X[i][k];
    }
  }
  for (let c = 0; c < p; c++) {
    let piv = c;
    for (let r = c + 1; r < p; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-12) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < p; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[p] / row[i]);
}

/** Straight-line trend. slope is per year. */
export function linearTrend(days, values) {
  const n = days.length;
  if (n < 3) return null;
  const t = days.map(decimalYear);
  const tm = t.reduce((a, b) => a + b, 0) / n;
  const ym = values.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (t[i] - tm) * (values[i] - ym);
    sxx += (t[i] - tm) ** 2;
    syy += (values[i] - ym) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept: ym - slope * tm, r2, n };
}

/**
 * Summary of a windowed series: first and last values, net change, extremes.
 * `changeIsReal` says whether the net change is larger than the measurement noise.
 */
export function summarize(slice) {
  const n = slice.days.length;
  if (n < 2) return { ok: false, n };
  const first = slice.values[0], last = slice.values[n - 1];
  let iMax = 0, iMin = 0;
  for (let i = 1; i < n; i++) {
    if (slice.values[i] > slice.values[iMax]) iMax = i;
    if (slice.values[i] < slice.values[iMin]) iMin = i;
  }
  const net = last - first;
  const pct = Math.abs(first) > 1e-9 ? (net / Math.abs(first)) * 100 : null;
  const spanDays = slice.days[n - 1] - slice.days[0];
  const trend = linearTrend(slice.days, slice.values);
  const noise = slice.sigma != null ? slice.sigma : 0;
  return {
    ok: true, n, first, last, net, pct, spanDays,
    firstDay: slice.days[0], lastDay: slice.days[n - 1],
    max: slice.values[iMax], maxDay: slice.days[iMax],
    min: slice.values[iMin], minDay: slice.days[iMin],
    mean: slice.values.reduce((a, b) => a + b, 0) / n,
    ratePerYear: trend ? trend.slope : null, r2: trend ? trend.r2 : null,
    changeIsReal: Math.abs(net) > 2 * Math.SQRT2 * noise,
    // A window that is not close to a whole number of years mixes the seasonal
    // cycle into the net change.
    wholeYears: spanDays >= 320 && Math.abs(((spanDays + 182) % 365) - 182) <= 45,
  };
}

/**
 * Statistical projection: straight-line trend, plus one yearly cycle when there
 * is enough history. This extends the past; it is not a physical model.
 */
export function forecast(series, { steps = 8, stepDays = 12 } = {}) {
  const n = series.days.length;
  if (n < 12) return { ok: false, reason: `Only ${n} acquisitions are stored; at least 12 are needed for a projection.` };
  const span = series.days[n - 1] - series.days[0];
  if (span < 180) return { ok: false, reason: 'The record is shorter than six months, too short for a projection.' };
  const seasonal = span >= 540 && n >= 30;
  const t0 = decimalYear(series.days[0]);
  const row = (day) => {
    const t = decimalYear(day) - t0;
    return seasonal ? [1, t, Math.sin(2 * Math.PI * t), Math.cos(2 * Math.PI * t)] : [1, t];
  };
  const X = series.days.map(row);
  const b = solveLeastSquares(X, series.values);
  if (!b) return { ok: false, reason: 'The record does not vary enough to fit a trend.' };
  const predict = (day) => row(day).reduce((s, x, i) => s + x * b[i], 0);
  const p = b.length;
  let sse = 0, sst = 0;
  const ym = series.values.reduce((a, c) => a + c, 0) / n;
  for (let i = 0; i < n; i++) {
    sse += (series.values[i] - predict(series.days[i])) ** 2;
    sst += (series.values[i] - ym) ** 2;
  }
  const sigma = Math.sqrt(sse / Math.max(1, n - p));
  const r2 = sst === 0 ? 0 : 1 - sse / sst;
  const tAll = series.days.map((d) => decimalYear(d) - t0);
  const tm = tAll.reduce((a, c) => a + c, 0) / n;
  const sxx = tAll.reduce((a, c) => a + (c - tm) ** 2, 0);
  const lastDay = series.days[n - 1];
  const points = [];
  for (let k = 1; k <= steps; k++) {
    const day = lastDay + k * stepDays;
    const t = decimalYear(day) - t0;
    const half = 1.96 * sigma * Math.sqrt(1 + 1 / n + ((t - tm) ** 2) / sxx);
    const v = predict(day);
    points.push({ day, value: v, lo: v - half, hi: v + half });
  }
  return {
    ok: true, seasonal, points, sigma, r2, slopePerYear: b[1],
    fitted: series.days.map(predict),
    confidence: r2 >= 0.8 ? 'high' : r2 >= 0.5 ? 'medium' : 'low',
    method: seasonal ? 'trend plus yearly cycle' : 'straight-line trend',
  };
}

/** Pair up two series on (nearly) the same dates. */
export function matchSeries(a, b, toleranceDays = 6) {
  const pairs = [];
  let j = 0;
  for (let i = 0; i < a.days.length; i++) {
    while (j < b.days.length - 1 && Math.abs(b.days[j + 1] - a.days[i]) <= Math.abs(b.days[j] - a.days[i])) j++;
    if (j < b.days.length && Math.abs(b.days[j] - a.days[i]) <= toleranceDays) {
      pairs.push({ day: a.days[i], a: a.values[i], b: b.values[j] });
    }
  }
  return pairs;
}

export function pearson(xs, ys) {
  const n = xs.length;
  if (n < 3) return null;
  const xm = xs.reduce((a, c) => a + c, 0) / n, ym = ys.reduce((a, c) => a + c, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - xm) * (ys[i] - ym); sxx += (xs[i] - xm) ** 2; syy += (ys[i] - ym) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function describeCorrelation(r) {
  if (r == null) return 'not enough matching dates';
  const a = Math.abs(r);
  const strength = a >= 0.7 ? 'strong' : a >= 0.4 ? 'moderate' : a >= 0.2 ? 'weak' : 'no clear';
  if (a < 0.2) return 'no clear relationship';
  return `${strength} ${r > 0 ? 'positive' : 'negative'} relationship`;
}

/** Convert values to percent change from the first value (for fair comparison). */
export function toPercentChange(slice) {
  const base = slice.values[0];
  if (slice.values.length === 0 || Math.abs(base) < 1e-9) return null;
  return { ...slice, values: slice.values.map((v) => ((v - base) / Math.abs(base)) * 100) };
}

/** Change from the first value in the series' own unit (used when the base is zero). */
export function toAbsoluteChange(slice) {
  const base = slice.values[0];
  return { ...slice, values: slice.values.map((v) => v - base) };
}
