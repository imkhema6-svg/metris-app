// Scientific interpretation: turns a measured change into candidate causes
// and expected impacts. Every cause carries an evidence level so the app never
// presents a guess as a finding:
//   supported      - a loaded dataset agrees with this explanation
//   not-supported  - a loaded dataset argues against it
//   context        - consistent with what is known about this kind of place
//   untested       - plausible, but no dataset in the app can check it
import { FACTOR_BY_ID, fmtValue, fmtPct } from './factors.js';
import { describeRain } from './live.js';

export const EVIDENCE_LABEL = {
  supported: 'Supported by data',
  'not-supported': 'Not supported by data',
  context: 'Fits the setting',
  untested: 'Not tested',
};

function direction(factorId, summary) {
  if (!summary.ok) return 'unknown';
  if (!summary.changeIsReal) return 'flat';
  if (factorId === 'deform' && Math.abs(summary.net) < 3) return 'flat';
  if (factorId !== 'deform' && summary.pct != null && Math.abs(summary.pct) < 1) return 'flat';
  return summary.net > 0 ? 'up' : 'down';
}

function rainDriver(clim, wantsWet, wetText, dryText) {
  if (!clim || clim.rainPct == null) {
    return { text: wantsWet ? wetText : dryText, evidence: 'untested', basis: 'Rainfall data for this window is not loaded.' };
  }
  const pct = Math.round(clim.rainPct);
  const basis = `Rainfall in this window was ${pct}% of normal for these dates (${describeRain(clim.rainPct)}; ERA5 reanalysis, normal = ${clim.recordFromYear} to present).`;
  const wet = clim.rainPct >= 115, dry = clim.rainPct <= 85;
  if (wantsWet) return { text: wetText, evidence: wet ? 'supported' : dry ? 'not-supported' : 'untested', basis };
  return { text: dryText, evidence: dry ? 'supported' : wet ? 'not-supported' : 'untested', basis };
}

const has = (region, tag) => (region.setting || []).includes(tag);

/**
 * @returns {{ direction, headline, drivers[], impacts[], caveats[] }}
 */
export function interpret(factorId, summary, region, series, clim) {
  const f = FACTOR_BY_ID[factorId];
  const dir = direction(factorId, summary);
  const drivers = [], impacts = [], caveats = [];
  let headline;

  if (dir === 'unknown') {
    return { direction: dir, headline: 'Not enough acquisitions in this window to describe a change.', drivers, impacts, caveats };
  }
  const netTxt = fmtValue(summary.net, f, { sign: true });
  const pctTxt = factorId !== 'deform' && summary.pct != null ? ` (${fmtPct(summary.pct)})` : '';
  if (dir === 'flat') {
    headline = `No clear change: the difference between the first and last acquisition (${netTxt}) is within the measurement noise.`;
  } else {
    headline = `${f.subject} ${dir === 'up' ? f.up : f.down} by ${fmtValue(Math.abs(summary.net), f)}${pctTxt} between the first and last acquisition in this window.`;
  }

  if (!summary.wholeYears && factorId !== 'deform') {
    caveats.push('This window does not cover whole years, so part of the change is the normal seasonal cycle. Pick the same month for start and end to see the underlying change.');
  }
  if (series.status === 'limited') caveats.push(`Limited data: ${series.reason || 'few acquisitions are available'} Treat the numbers as indicative.`);
  if (series.provenance === 'simulated') caveats.push('These values are simulated demo data, so the causes below show how the reasoning works rather than what happened on the ground.');

  if (dir === 'flat') return { direction: dir, headline, drivers, impacts, caveats };

  if (factorId === 'water') {
    if (dir === 'up') {
      drivers.push(rainDriver(clim, true, 'Heavier rainfall than usual filled rivers, wetlands and low ground.', ''));
      if (has(region, 'monsoon')) drivers.push({ text: 'Monsoon river flooding from the upstream catchment.', evidence: 'context', basis: 'This area floods seasonally; no river-gauge dataset is loaded to measure it.' });
      if (has(region, 'coastal')) drivers.push({ text: 'Storm surge or high tides pushing water inland.', evidence: 'untested', basis: 'No tide or sea-level dataset is loaded.' });
      if (has(region, 'agriculture')) drivers.push({ text: 'Irrigation, rice paddies or aquaculture ponds being flooded.', evidence: 'untested', basis: 'No land-use dataset is loaded.' });
      impacts.push('Flooded homes, roads and farmland; displacement where water reaches settlements.',
        'Crop damage in the short term, with possible soil and groundwater recharge afterwards.',
        'Higher risk of water-borne disease while standing water remains.');
    } else {
      drivers.push(rainDriver(clim, false, '', 'Less rainfall than usual reduced river flow and standing water.'));
      if (clim && clim.tempAnomaly > 0.5) drivers.push({ text: 'Higher evaporation in warmer conditions.', evidence: 'supported', basis: `Mean temperature was ${clim.tempAnomaly.toFixed(1)} °C above normal for these dates (ERA5).` });
      if (has(region, 'delta') || has(region, 'urban')) drivers.push({ text: 'Drainage or land reclamation converting lagoons and wetlands to farmland or built-up land.', evidence: 'context', basis: 'Common in densely settled deltas; no land-use dataset is loaded to confirm it.' });
      drivers.push({ text: 'Water abstraction or upstream dams holding back flow.', evidence: 'untested', basis: 'No river-flow dataset is loaded.' });
      impacts.push('Less water for irrigation, fisheries and wetlands habitat.',
        'Saltier remaining water in coastal lagoons.',
        'Pressure on groundwater as users switch source.');
    }
  } else if (factorId === 'deform') {
    if (dir === 'down') {
      if (has(region, 'delta')) drivers.push({ text: 'Natural compaction of young delta sediments.', evidence: 'context', basis: 'River deltas compact under their own weight; this sets a background sinking rate.' });
      drivers.push({ text: 'Groundwater pumping lowering the water table so the ground compacts.', evidence: 'untested', basis: 'No well or groundwater dataset is loaded.' });
      if (has(region, 'urban')) drivers.push({ text: 'Weight of new buildings and infrastructure on soft ground.', evidence: 'context', basis: 'The area includes fast-growing cities; no building dataset is loaded to locate it.' });
      impacts.push('Higher relative sea level and flood risk on low coasts.',
        'Cracking and tilting of buildings, roads, pipes and canals where sinking is uneven.',
        'Saltwater moving further inland into soil and aquifers.');
    } else {
      drivers.push({ text: 'Ground rebound as groundwater levels recover.', evidence: 'untested', basis: 'No groundwater dataset is loaded.' });
      drivers.push({ text: 'Swelling of clay soils when wet.', evidence: clim && clim.rainPct >= 115 ? 'supported' : 'untested', basis: clim && clim.rainPct != null ? `Rainfall was ${Math.round(clim.rainPct)}% of normal in this window (ERA5).` : 'Rainfall data is not loaded.' });
      drivers.push({ text: 'A measurement artefact from moisture in the atmosphere delaying the radar signal.', evidence: 'untested', basis: 'Check that the same pattern appears in independent image pairs.' });
      impacts.push('Usually little direct hazard, but uneven uplift can still strain structures.');
    }
  } else if (factorId === 'veg') {
    if (dir === 'down') {
      drivers.push(rainDriver(clim, false, '', 'Drought stress from below-normal rainfall.'));
      if (has(region, 'forest')) drivers.push({ text: 'Forest clearing for pasture, crops or roads.', evidence: 'context', basis: 'This is a forest frontier; step-like drops in the dry season are typical of clearing. Confirm with optical imagery.' });
      if (has(region, 'urban')) drivers.push({ text: 'Farmland and green space converted to built-up land.', evidence: 'context', basis: 'The area includes fast-growing cities; no land-use dataset is loaded to confirm it.' });
      if (has(region, 'agriculture')) drivers.push({ text: 'Harvest or fallow period in the cropping calendar.', evidence: summary.wholeYears ? 'untested' : 'context', basis: summary.wholeYears ? 'The window covers whole years, so the crop cycle should largely cancel out.' : 'The window ends in a different season than it starts.' });
      impacts.push('Loss of habitat and biodiversity.',
        'More erosion and soil degradation on exposed ground.',
        'Carbon released from cleared vegetation; hotter, drier local conditions.');
    } else {
      drivers.push(rainDriver(clim, true, 'Wetter conditions than usual supporting growth.', ''));
      if (has(region, 'agriculture')) drivers.push({ text: 'Crop growth or expanded irrigation.', evidence: summary.wholeYears ? 'untested' : 'context', basis: summary.wholeYears ? 'No crop or irrigation dataset is loaded.' : 'The window ends in a different season than it starts.' });
      drivers.push({ text: 'Regrowth on previously cleared or abandoned land.', evidence: 'untested', basis: 'No land-use history is loaded.' });
      impacts.push('More carbon stored and better soil protection.',
        'Higher water use by plants where irrigation expanded.');
    }
  } else if (factorId === 'soil') {
    if (dir === 'down') {
      drivers.push(rainDriver(clim, false, '', 'Below-normal rainfall.'));
      if (clim && clim.tempAnomaly > 0.5) drivers.push({ text: 'Stronger evaporation in warmer conditions.', evidence: 'supported', basis: `Mean temperature was ${clim.tempAnomaly.toFixed(1)} °C above normal for these dates (ERA5).` });
      if (has(region, 'agriculture')) drivers.push({ text: 'Reduced irrigation or a change of crop.', evidence: 'untested', basis: 'No irrigation dataset is loaded.' });
      impacts.push('Crop stress and lower yields if dryness persists through the growing season.',
        'Higher irrigation demand and pumping.',
        'Greater risk of dust, erosion and fire in dry vegetation.');
    } else {
      drivers.push(rainDriver(clim, true, 'Above-normal rainfall.', ''));
      if (has(region, 'agriculture')) drivers.push({ text: 'Irrigation or flooded fields.', evidence: 'untested', basis: 'No irrigation dataset is loaded.' });
      impacts.push('Better conditions for planting and crop growth.',
        'Saturated soil sheds more rain as runoff, raising flood potential.');
    }
    if (clim && clim.soil) {
      const dSoil = clim.soil.last - clim.soil.first;
      const agrees = Math.sign(dSoil) === Math.sign(summary.net) && Math.abs(dSoil) > 0.01;
      drivers.push({
        text: 'Independent check against reanalysis soil moisture.',
        evidence: agrees ? 'supported' : 'not-supported',
        basis: `ERA5-Land top-layer soil moisture went from ${clim.soil.first.toFixed(3)} to ${clim.soil.last.toFixed(3)} m³/m³ (first and last ${clim.soil.k} days of the window), which ${agrees ? 'agrees with' : 'does not match'} the direction of the radar-based change.`,
      });
    }
  }
  return { direction: dir, headline, drivers: drivers.filter((d) => d.text), impacts, caveats };
}
