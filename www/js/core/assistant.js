// Location-aware assistant. It answers only from what is stored for the
// selected area and dates: the factor time series, the statistics computed from
// them, and the live climate record. It never invents numbers. When the data
// cannot answer a question it says so and explains what is missing.
import { FACTORS, FACTOR_BY_ID, STATUS_LABEL, fmtValue, fmtPct } from './factors.js';
import { fmtDay, fmtMonth, parts, MONTH_NAMES, toDay } from './dates.js';
import { sliceSeries, summarize, forecast, matchSeries, pearson, describeCorrelation, toPercentChange } from './analytics.js';
import { interpret, EVIDENCE_LABEL } from './interpret.js';
import { climateWindow, describeRain, describeTemp } from './live.js';

const FACTOR_WORDS = {
  water: ['water', 'flood', 'inundat', 'river', 'lake', 'lagoon', 'wetland'],
  deform: ['deform', 'subsid', 'sink', 'sank', 'uplift', 'ground', 'land motion', 'land surface', 'displacement', 'insar'],
  veg: ['vegetat', 'forest', 'deforest', 'canopy', 'tree', 'ecosystem', 'green', 'mangrove', 'plant'],
  soil: ['soil', 'moisture', 'agricult', 'crop', 'farm', 'irrigat'],
};

const INTENTS = [
  ['help', /^(hi|hello|hey|help)\b|what can you|how do (i|you)|who are you/],
  ['compare', /\bcompar|\bversus\b|\bvs\b|differ(ence|ent) (between|from)|than in\b/],
  ['data', /\bsource|\bavailab|reliab|accura|\breal\b|simulat|trust|where does|how (is|was|are) .*(measur|calculat)|uncertain|which data|what data/],
  ['forecast', /predict|forecast|future|\bnext\b|will\b|expect|outlook|project|going to|continue/],
  ['cause', /\bwhy\b|cause|driver|reason|because|due to|explain|behind/],
  ['impact', /impact|consequen|effect|\brisk|matter|danger|implication|what does (it|this) mean|threat/],
  ['extreme', /\bwhen\b|peak|highest|lowest|maxim|minim|worst|largest|smallest/],
  ['climate', /\brain|weather|temperature|climate|drought|precipitation|\bhot|\bdry\b|\bwet\b/],
  ['overview', /summar|overview|what (has |have )?(changed|happened)|what is (happening|going on)|tell me about|describe|status|situation/],
];

const PROVENANCE_TEXT = {
  simulated: 'simulated demo data',
  observed: 'processed satellite results loaded into the app',
  none: 'no data',
};

function detectFactors(q) {
  return FACTORS.filter((f) => FACTOR_WORDS[f.id].some((w) => q.includes(w))).map((f) => f.id);
}

function detectIntent(q) {
  for (const [name, re] of INTENTS) if (re.test(q)) return name;
  return null;
}

function detectDate(q) {
  const years = [...q.matchAll(/\b(19|20)\d\d\b/g)].map((m) => +m[0]);
  let month = null;
  MONTH_NAMES.forEach((name, i) => {
    if (new RegExp(`\\b(${name}|${name.slice(0, 3)})\\b`).test(q) && !(name === 'may' && /\bmay (i|we|be|have|not)\b/.test(q))) month = i;
  });
  return { years, month };
}

function noiseBand(series) {
  return series.sigma != null ? 1.96 * Math.SQRT2 * series.sigma : null;
}

function changeSentence(f, series, startDay, endDay) {
  if (series.status === 'unavailable') return `${f.name}: unavailable. ${series.reason || ''}`.trim();
  const sm = summarize(sliceSeries(series, startDay, endDay));
  if (!sm.ok) return `${f.name}: only ${sm.n} acquisition${sm.n === 1 ? '' : 's'} in the selected dates, which is not enough to measure a change. Widen the date range.`;
  const band = noiseBand(series);
  const bandTxt = band != null ? `, ± ${fmtValue(band, f)} measurement noise` : '';
  const span = `from ${fmtValue(sm.first, f)} on ${fmtDay(sm.firstDay)} to ${fmtValue(sm.last, f)} on ${fmtDay(sm.lastDay)}`;
  const lim = series.status === 'limited' ? ' Limited data, so treat this as indicative.' : '';
  if (!sm.changeIsReal) {
    return `${f.name}: no clear change in ${f.metric.toLowerCase()} (${span}; the ${fmtValue(sm.net, f, { sign: true })} difference is within the noise${bandTxt}; ${sm.n} acquisitions).${lim}`;
  }
  const pct = f.id !== 'deform' && sm.pct != null ? ` (${fmtPct(sm.pct)})` : '';
  return `${f.name}: ${f.subject.toLowerCase()} ${sm.net > 0 ? f.up : f.down} by ${fmtValue(Math.abs(sm.net), f)}${pct}, ${span} (${sm.n} acquisitions${bandTxt}).${lim}`;
}

function sourceLine(f, series) {
  if (series.status === 'unavailable') return `${f.name}: no data stored for this area.`;
  return `${f.name}: ${PROVENANCE_TEXT[series.provenance]}, ${series.days.length} acquisitions from ${fmtDay(series.days[0])} to ${fmtDay(series.days[series.days.length - 1])}${series.sensor ? `, sensor: ${series.sensor}` : ''}.`;
}

const CLIMATE_SOURCE = 'Rainfall, temperature and soil moisture: ERA5 and ERA5-Land reanalysis from the Open-Meteo historical weather API (modelled values, not NISAR measurements).';

function confidenceFor(seriesList, { climateOnly = false } = {}) {
  if (climateOnly) return { level: 'medium', text: 'Medium: reanalysis is a weather model constrained by observations, reliable for regional patterns but not for a single field.' };
  const used = seriesList.filter((s) => s.status !== 'unavailable');
  if (!used.length) return { level: 'none', text: 'No answer possible from stored data.' };
  if (used.some((s) => s.provenance === 'simulated')) return { level: 'demo', text: 'Demonstration only: the values are simulated, so the numbers show how the app works and do not describe the real place.' };
  if (used.some((s) => s.status === 'limited')) return { level: 'low', text: 'Low: at least one factor has limited data.' };
  return { level: 'high', text: 'High: based on fully available processed acquisitions.' };
}

function reply(paragraphs, sources, confidence) {
  return { paragraphs: paragraphs.filter(Boolean), sources, confidence };
}

function otherRegionMentioned(q, ctx) {
  return ctx.regions.find((r) => r.id !== ctx.region.id &&
    (q.includes(r.name.toLowerCase()) || r.name.toLowerCase().split(/[ ,]+/).some((w) => w.length > 4 && q.includes(w))));
}

/**
 * @param {string} question
 * @param {{region, startDay, endDay, series, climate, regions, loadSeries}} ctx
 */
export async function ask(question, ctx) {
  const q = ' ' + question.toLowerCase().replace(/[?!.,;:]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const qt = q.trim();
  if (!ctx.region) {
    return reply(['Choose an area first. Open Explore, pick a study area or tap any point on the map, then ask me about it.'], [], { level: 'none', text: 'No area selected.' });
  }
  const { region, startDay, endDay, series } = ctx;
  const period = `${fmtDay(startDay)} to ${fmtDay(endDay)}`;
  const where = region.custom ? `the selected point (${region.center[0].toFixed(2)}°, ${region.center[1].toFixed(2)}°)` : region.name;
  let factors = detectFactors(q);
  const intent = detectIntent(qt);
  const date = detectDate(q);
  const clim = climateWindow(ctx.climate, startDay, endDay);
  const available = FACTORS.filter((f) => series[f.id].status !== 'unavailable');
  const usedSeries = (ids) => ids.map((id) => series[id]);

  if (intent === 'help' && !factors.length) {
    return reply([
      `I answer questions about ${where} for ${period}, using only the analyses and climate records stored in the app.`,
      'Try: "What changed?", "Why did vegetation change?", "When was water extent highest?", "What is the outlook for land motion?", "Compare with Bengal Delta", or "How reliable is this data?"',
      'If the data cannot answer something, I will say so instead of guessing.',
    ], [], { level: 'none', text: 'No data needed for this answer.' });
  }

  // ---- questions about a year the record does not cover ----
  const allDays = available.flatMap((f) => series[f.id].days);
  if (date.years.length && allDays.length) {
    const minY = parts(Math.min(...allDays)).y, maxY = parts(Math.max(...allDays)).y;
    const outside = date.years.filter((y) => y < minY || y > maxY);
    if (outside.length && intent !== 'forecast') {
      return reply([
        `I can't answer for ${outside.join(' or ')}: the stored analyses for ${where} cover ${fmtDay(Math.min(...allDays))} to ${fmtDay(Math.max(...allDays))} only.`,
        'I would be guessing if I gave numbers outside that period, so I won\'t.',
      ], available.map((f) => sourceLine(f, series[f.id])), { level: 'none', text: 'Insufficient data for the requested period.' });
    }
  }

  // ---- data availability, sources, reliability ----
  if (intent === 'data') {
    const lines = FACTORS.filter((f) => !factors.length || factors.includes(f.id)).map((f) => {
      const s = series[f.id];
      if (s.status === 'unavailable') return `${f.name}: ${STATUS_LABEL[s.status]}. ${s.reason || ''}`;
      return `${f.name}: ${STATUS_LABEL[s.status]}, ${PROVENANCE_TEXT[s.provenance]}, ${s.days.length} acquisitions.${s.reason ? ' ' + s.reason : ''} Method: ${f.method}`;
    });
    const live = ctx.climate && ctx.climate.status === 'live'
      ? 'Live climate data is loaded: ' + CLIMATE_SOURCE
      : 'Live climate data is not loaded right now (no connection, or the service did not answer).';
    return reply([`Data stored for ${where}:`, ...lines, live], [], confidenceFor(FACTORS.map((f) => series[f.id])));
  }

  // ---- climate ----
  if (intent === 'climate' && !factors.filter((id) => id !== 'soil').length) {
    if (!clim) {
      return reply([`I have no climate record loaded for ${where} in ${period}, so I can't describe rainfall or temperature. Check the internet connection and reopen the area.`], [], { level: 'none', text: 'Insufficient data.' });
    }
    const p = [`Rainfall at ${where} from ${period} totalled ${Math.round(clim.rain)} mm, against a normal of ${Math.round(clim.rainNormal)} mm for the same dates` +
      (clim.rainPct != null ? ` (${Math.round(clim.rainPct)}% of normal, ${describeRain(clim.rainPct)}).` : '.'),
    `Mean temperature was ${clim.temp.toFixed(1)} °C, ${describeTemp(clim.tempAnomaly)}.`];
    if (clim.soil) p.push(`Top-layer soil moisture averaged ${clim.soil.mean.toFixed(3)} m³/m³, moving from ${clim.soil.first.toFixed(3)} to ${clim.soil.last.toFixed(3)} between the start and end of the window.`);
    p.push(`"Normal" is the average of ${clim.recordFromYear} to present for the same calendar days.`);
    return reply(p, [CLIMATE_SOURCE], confidenceFor([], { climateOnly: true }));
  }

  if (!available.length) {
    const p = [`No radar analysis is stored for ${where}, so I can't describe water, land motion, vegetation or soil changes there.`];
    if (clim) p.push(`I do have the climate record: rainfall was ${Math.round(clim.rain)} mm (${clim.rainPct != null ? Math.round(clim.rainPct) + '% of normal' : 'normal not defined'}) over ${period}. Ask me about rainfall or temperature.`);
    return reply(p, clim ? [CLIMATE_SOURCE] : [], { level: 'none', text: 'Insufficient data for radar-based factors.' });
  }

  // a factor was asked about but is unavailable
  const missing = factors.filter((id) => series[id].status === 'unavailable');
  if (missing.length && missing.length === factors.length) {
    return reply(missing.map((id) => `${FACTOR_BY_ID[id].name} is unavailable for ${where}. ${series[id].reason || ''} I won't estimate it from other areas.`),
      [], { level: 'none', text: 'Insufficient data.' });
  }
  factors = factors.filter((id) => series[id].status !== 'unavailable');

  // ---- value in a specific month ----
  if (date.month != null && date.years.length && intent !== 'forecast' && intent !== 'compare') {
    const y = date.years[0];
    const ids = factors.length ? factors : available.map((f) => f.id);
    const lines = ids.map((id) => {
      const f = FACTOR_BY_ID[id], s = series[id];
      const hits = s.days.map((d, i) => ({ d, v: s.values[i] })).filter((r) => { const p = parts(r.d); return p.y === y && p.m === date.month; });
      if (!hits.length) return `${f.name}: no acquisition in ${fmtMonth(toDay(`${y}-${String(date.month + 1).padStart(2, '0')}-15`))}, so I have no value for that month.`;
      return `${f.name}: ${hits.map((h) => `${fmtValue(h.v, f)} on ${fmtDay(h.d)}`).join('; ')}.`;
    });
    return reply([`Acquisitions at ${where} in ${fmtMonth(toDay(`${y}-${String(date.month + 1).padStart(2, '0')}-15`))}:`, ...lines],
      ids.map((id) => sourceLine(FACTOR_BY_ID[id], series[id])), confidenceFor(usedSeries(ids)));
  }

  // ---- compare with another area ----
  if (intent === 'compare') {
    const other = otherRegionMentioned(q, ctx);
    if (!other) {
      const names = ctx.regions.filter((r) => r.id !== region.id).map((r) => r.name).join(' or ');
      return reply([`Which area should I compare ${where} with? I have ${names}. For charts, open the Compare tab.`], [], { level: 'none', text: 'No data needed for this answer.' });
    }
    const otherSeries = await ctx.loadSeries(other);
    const ids = factors.length ? factors : FACTORS.map((f) => f.id);
    const used = [];
    const lines = ids.map((id) => {
      const f = FACTOR_BY_ID[id], a = series[id], b = otherSeries[id];
      if (a.status === 'unavailable' || b.status === 'unavailable') {
        const who = a.status === 'unavailable' ? where : other.name;
        return `${f.name}: can't compare, because it is unavailable for ${who}.`;
      }
      const sa = sliceSeries(a, startDay, endDay), sb = sliceSeries(b, startDay, endDay);
      const ma = summarize(sa), mb = summarize(sb);
      if (!ma.ok || !mb.ok) return `${f.name}: too few acquisitions in the selected dates to compare.`;
      used.push(a, b);
      const pa = toPercentChange(sa), pb = toPercentChange(sb);
      const pairs = matchSeries(pa || sa, pb || sb);
      const r = pearson(pairs.map((p) => p.a), pairs.map((p) => p.b));
      const show = (m) => (f.id === 'deform' || m.pct == null ? fmtValue(m.net, f, { sign: true }) : `${fmtPct(m.pct)} (${fmtValue(m.net, f, { sign: true })})`);
      const lim = a.status === 'limited' || b.status === 'limited' ? ' One side has limited data.' : '';
      return `${f.name}: ${where} ${show(ma)}, ${other.name} ${show(mb)}. Across ${pairs.length} matching dates the two move with a ${describeCorrelation(r)}${r != null ? ` (r = ${r.toFixed(2).replace('-', '−')})` : ''}.${lim}`;
    });
    return reply([`${where} compared with ${other.name}, ${period}:`, ...lines,
      'A shared seasonal cycle can produce a high correlation on its own; it does not show that one area drives the other.'],
    ids.flatMap((id) => [sourceLine(FACTOR_BY_ID[id], series[id]).replace(/^/, `${where} · `), sourceLine(FACTOR_BY_ID[id], otherSeries[id]).replace(/^/, `${other.name} · `)]),
    confidenceFor(used));
  }

  // ---- outlook ----
  if (intent === 'forecast') {
    const ids = factors.length ? factors : available.map((f) => f.id);
    const lines = ids.map((id) => {
      const f = FACTOR_BY_ID[id], s = series[id];
      const fc = forecast(s);
      if (!fc.ok) return `${f.name}: no projection. ${fc.reason}`;
      const last = fc.points[fc.points.length - 1];
      return `${f.name}: if the past pattern continues, ${f.metric.toLowerCase()} would be about ${fmtValue(last.value, f)} by ${fmtDay(last.day)} (likely range ${fmtValue(last.lo, f)} to ${fmtValue(last.hi, f)}). Underlying trend ${fmtValue(fc.slopePerYear, f, { sign: true })} per year; fit quality ${fc.confidence} (${fc.method}, R² ${fc.r2.toFixed(2)}).`;
    });
    return reply([`Outlook for ${where}, about three months past the latest acquisition:`, ...lines,
      'These are statistical projections of the stored record. They assume nothing new happens (no flood, policy change or dry spell that the past does not contain), and I can\'t project beyond about three months.'],
    ids.map((id) => sourceLine(FACTOR_BY_ID[id], series[id])), confidenceFor(usedSeries(ids)));
  }

  // ---- causes and impacts ----
  if (intent === 'cause' || intent === 'impact') {
    const ids = factors.length ? factors : available.map((f) => f.id);
    const out = [];
    for (const id of ids) {
      const f = FACTOR_BY_ID[id], s = series[id];
      const sm = summarize(sliceSeries(s, startDay, endDay));
      const it = interpret(id, sm, region, s, clim);
      out.push(`${f.name}. ${it.headline}`);
      if (intent === 'cause') {
        if (!it.drivers.length) out.push('There is no clear change to explain.');
        for (const d of it.drivers) out.push(`• ${d.text} [${EVIDENCE_LABEL[d.evidence]}] ${d.basis}`);
      } else {
        if (!it.impacts.length) out.push('With no clear change, no specific impacts follow.');
        for (const im of it.impacts) out.push(`• ${im}`);
      }
    }
    out.push(intent === 'cause'
      ? 'Only causes marked "Supported by data" were checked against a dataset in the app. The others are candidates to investigate, not findings.'
      : 'These are the consequences generally expected from this kind of change. The app does not measure the impacts themselves.');
    const src = ids.map((id) => sourceLine(FACTOR_BY_ID[id], series[id]));
    if (clim) src.push(CLIMATE_SOURCE);
    return reply([`${where}, ${period}:`, ...out], src, confidenceFor(usedSeries(ids)));
  }

  // ---- extremes ----
  if (intent === 'extreme') {
    const ids = factors.length ? factors : available.map((f) => f.id);
    const lines = ids.map((id) => {
      const f = FACTOR_BY_ID[id];
      const sm = summarize(sliceSeries(series[id], startDay, endDay));
      if (!sm.ok) return `${f.name}: too few acquisitions in the selected dates.`;
      return `${f.name}: highest ${fmtValue(sm.max, f)} on ${fmtDay(sm.maxDay)}, lowest ${fmtValue(sm.min, f)} on ${fmtDay(sm.minDay)}.`;
    });
    return reply([`Extremes at ${where}, ${period} (acquisition dates only, so a short-lived peak between passes can be missed):`, ...lines],
      ids.map((id) => sourceLine(FACTOR_BY_ID[id], series[id])), confidenceFor(usedSeries(ids)));
  }

  // ---- change summary: the default when a factor is named or an overview is asked ----
  if (factors.length || intent === 'overview') {
    const ids = factors.length ? factors : FACTORS.map((f) => f.id);
    const lines = ids.map((id) => changeSentence(FACTOR_BY_ID[id], series[id], startDay, endDay));
    const tail = [];
    if (clim && clim.rainPct != null) tail.push(`For context, rainfall was ${Math.round(clim.rainPct)}% of normal over the same dates.`);
    const used = ids.filter((id) => series[id].status !== 'unavailable');
    const src = used.map((id) => sourceLine(FACTOR_BY_ID[id], series[id]));
    if (tail.length) src.push(CLIMATE_SOURCE);
    return reply([`${where}, ${period}:`, ...lines, ...tail], src, confidenceFor(usedSeries(used)));
  }

  // ---- anything else ----
  return reply([
    `I can't answer that from the data stored for ${where}.`,
    'I can describe what changed in water, land motion, vegetation and soil moisture, when the extremes were, likely causes and impacts, the short-term outlook, rainfall and temperature, and how one area compares with another.',
  ], [], { level: 'none', text: 'Outside the stored data.' });
}

export const SUGGESTED_QUESTIONS = [
  'What changed here?',
  'Why did vegetation change?',
  'When was water extent highest?',
  'What is the outlook for land motion?',
  'How was the rainfall?',
  'How reliable is this data?',
];
