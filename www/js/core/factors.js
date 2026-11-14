// The four environmental factors METRIS tracks. Colours are fixed per factor
// everywhere in the app (map, cards, charts) and were checked for
// colour-blind separation and 3:1 contrast on white.
export const FACTORS = [
  {
    id: 'water',
    name: 'Water dynamics',
    short: 'Water',
    color: '#2a78d6',
    metric: 'Surface water extent',
    subject: 'Surface water extent',
    unit: 'km²',
    decimals: 0,
    up: 'expanded', down: 'contracted',
    upNoun: 'expansion', downNoun: 'contraction',
    method: 'Radar backscatter intensity. Calm open water reflects the radar signal away from the sensor and looks dark, so water can be masked and its area added up for each acquisition.',
  },
  {
    id: 'deform',
    name: 'Land surface deformation',
    short: 'Land motion',
    color: '#d95926',
    metric: 'Ground level relative to the first acquisition',
    subject: 'The ground',
    unit: 'mm',
    decimals: 1,
    up: 'rose', down: 'sank',
    upNoun: 'uplift', downNoun: 'subsidence',
    method: 'Interferometric SAR (InSAR). The phase difference between two aligned radar acquisitions gives ground displacement to centimetre or millimetre precision.',
  },
  {
    id: 'veg',
    name: 'Ecosystem and vegetation',
    short: 'Vegetation',
    color: '#199e70',
    metric: 'Vegetated area',
    subject: 'Vegetated area',
    unit: 'km²',
    decimals: 0,
    up: 'grew', down: 'shrank',
    upNoun: 'vegetation gain', downNoun: 'vegetation loss',
    method: 'Multi-polarisation radar response (HH and HV) describes canopy structure; optical imagery (Sentinel-2, Landsat) is used to confirm the classification.',
  },
  {
    id: 'soil',
    name: 'Agriculture and soil moisture',
    short: 'Soil',
    color: '#c98500',
    metric: 'Surface soil moisture',
    subject: 'The topsoil',
    unit: 'm³/m³',
    decimals: 3,
    up: 'became wetter', down: 'became drier',
    upNoun: 'wetting', downNoun: 'drying',
    method: 'Radar response to surface roughness and water content, combined with weather data to separate the soil moisture signal from vegetation density.',
  },
];

export const FACTOR_BY_ID = Object.fromEntries(FACTORS.map((f) => [f.id, f]));

export const STATUS_LABEL = {
  full: 'Fully available',
  limited: 'Limited data',
  unavailable: 'Unavailable',
};

/** Format a number with the factor's unit, e.g. '-42 km²' or '+3.5 mm'. */
export function fmtValue(v, factor, { sign = false } = {}) {
  if (v == null || Number.isNaN(v)) return 'no value';
  const abs = Math.abs(v).toLocaleString('en-GB', {
    minimumFractionDigits: factor.decimals, maximumFractionDigits: factor.decimals,
  });
  const s = v < 0 ? '−' : (sign && v > 0 ? '+' : '');
  return `${s}${abs} ${factor.unit}`;
}

export function fmtPct(v, { sign = true } = {}) {
  if (v == null || !Number.isFinite(v)) return '';
  const s = v < 0 ? '−' : (sign && v > 0 ? '+' : '');
  return `${s}${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)}%`;
}
