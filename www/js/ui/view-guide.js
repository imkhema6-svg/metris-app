// Guide: how to use the app, what the colours and labels mean, where data comes from.
import { FACTORS, STATUS_LABEL } from '../core/factors.js';
import { EVIDENCE_LABEL } from '../core/interpret.js';
import { h, clear, icon } from './dom.js';
import { S } from './state.js';
import { statusBadge, provenanceBadge, libraryList } from './parts.js';

export function legendContent() {
  return h('div', { class: 'stack' },
    h('h3', { text: 'Factor colours' }),
    h('ul', { class: 'legend-list' }, FACTORS.map((f) => h('li', { style: `--f:${f.color}` },
      h('span', { class: 'f-icon' }, icon(f.id, 16)), h('div', null, h('strong', { text: f.name }), h('p', { class: 'muted small', text: `${f.metric}, in ${f.unit}` }))))),
    h('h3', { text: 'Data status' }),
    h('ul', { class: 'legend-list plain' },
      h('li', null, statusBadge('full'), h('p', { class: 'muted small', text: 'Regular acquisitions across the whole period.' })),
      h('li', null, statusBadge('limited'), h('p', { class: 'muted small', text: 'Sparse or noisy acquisitions. Numbers are indicative only.' })),
      h('li', null, statusBadge('unavailable'), h('p', { class: 'muted small', text: 'Nothing processed. The app shows no number rather than a guess.' }))),
    h('h3', { text: 'Where a number comes from' }),
    h('ul', { class: 'legend-list plain' },
      h('li', null, provenanceBadge('observed'), h('p', { class: 'muted small', text: 'Results processed from satellite acquisitions and loaded into the app.' })),
      h('li', null, provenanceBadge('simulated'), h('p', { class: 'muted small', text: 'Placeholder values that show how the app works until real results are loaded. They do not describe the real place.' })),
      h('li', null, provenanceBadge('live'), h('p', { class: 'muted small', text: 'Weather-model reanalysis fetched live for the location. Real, but modelled on a coarse grid.' }))),
    h('h3', { text: 'How sure a cause is' }),
    h('ul', { class: 'legend-list plain' }, Object.entries(EVIDENCE_LABEL).map(([k, v]) => h('li', null, h('span', { class: `tag ev-${k}`, text: v }),
      h('p', { class: 'muted small', text: {
        supported: 'A dataset in the app agrees with this explanation.',
        'not-supported': 'A dataset in the app argues against it.',
        context: 'Typical for this kind of place, but not checked here.',
        untested: 'Plausible, but nothing in the app can check it.',
      }[k] })))));
}

export function initGuide(el) {
  const steps = [
    ['Explore', 'Choose a country, then a study area. Or tap any point on the map for its weather and soil record.'],
    ['Pick dates', 'In Area, drag Start and End. Only dates with a real satellite pass can be chosen.'],
    ['Read the change', 'Each factor shows how much changed, when the extremes were, and how reliable the data is.'],
    ['Check causes and outlook', 'Open "What may be causing it" and "Outlook". Every cause shows whether data supports it.'],
    ['Ask or compare', 'Use Ask for plain-language questions, and Compare to set two areas side by side.'],
  ];
  const general = S.library.filter((x) => x.factor === 'general');
  clear(el).append(h('div', { class: 'stack pad' },
    h('p', { class: 'lede', text: 'METRIS turns radar satellite observations into answers: what changed, where, when, why, and what it may lead to.' }),
    h('section', { class: 'card' }, h('h2', { text: 'Using the app' }),
      h('ol', { class: 'steps' }, steps.map(([t, d]) => h('li', null, h('strong', { text: t }), h('p', { class: 'muted', text: d }))))),
    h('section', { class: 'card' }, h('h2', { text: 'Reading the screen' }), legendContent()),
    h('section', { class: 'card' }, h('h2', { text: 'What is real in this version' }),
      h('ul', { class: 'bullets' },
        h('li', { text: 'Rainfall, temperature and soil moisture are real, fetched live for any location (ERA5 and ERA5-Land reanalysis via Open-Meteo).' }),
        h('li', { text: 'Satellite imagery on the map is real (NASA GIBS).' }),
        h('li', { text: 'The four radar factors for the three study areas are simulated placeholders, labelled "Simulated demo data", until processed NISAR results are loaded.' })),
      h('p', { class: 'muted small', text: 'To load real results, convert a table of dates and values with tools/add_observed_data.py (see README). The factor then shows "Processed satellite data".' })),
    h('section', { class: 'card' }, h('h2', { text: 'How the radar sees each factor' }),
      h('dl', { class: 'methods' }, FACTORS.map((f) => h('div', { style: `--f:${f.color}` }, h('dt', null, h('span', { class: 'f-icon' }, icon(f.id, 16)), f.name), h('dd', { class: 'muted', text: f.method })))),
      h('p', { class: 'muted small', text: 'NISAR is a NASA and ISRO radar satellite. Radar works through cloud and at night, which is why it suits flood, forest and ground-motion monitoring.' })),
    general.length ? h('section', { class: 'card' }, h('h2', { text: 'References and data sources' }), libraryList(general),
      h('p', { class: 'muted small', text: 'Base map © OpenStreetMap contributors. Imagery: NASA Global Imagery Browse Services. Weather: Open-Meteo, ERA5 (Copernicus Climate Change Service).' })) : null));
}
