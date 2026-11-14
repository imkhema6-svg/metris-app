// Screens 1 and 2: the global explorer and the country overview.
import { FACTORS } from '../core/factors.js';
import { countryById, customRegion } from '../core/data.js';
import { h, clear, icon } from './dom.js';
import { S, go, currentRoute, selectRegion, setFilter, notify } from './state.js';
import { loadLeaflet, createMap } from './map.js';
import { statusBadge, factorChips, segmented } from './parts.js';

let root, mapCtl = null, mapState = 'pending', listEl, chipsEl, layerEl, lastCountry;   // lastCountry stays undefined until the map is first shown

async function openRegion(region) {
  await selectRegion(region);
  go('area');
}

export function initExplore(el, openLegend) {
  root = el;
  const mapEl = h('div', { id: 'map', class: 'map' });
  chipsEl = h('div', { class: 'map-top' });
  layerEl = h('div', { class: 'map-tools' });
  const fallback = h('div', { class: 'map-fallback', hidden: true },
    h('p', { text: 'The map needs an internet connection the first time it opens. You can still choose a study area from the list below.' }));
  root.append(h('div', { class: 'map-wrap' }, mapEl, chipsEl, layerEl, fallback), listEl = h('div', { class: 'stack pad' }));

  loadLeaflet().then((L) => {
    if (!L) { mapState = 'failed'; fallback.hidden = false; return; }
    mapCtl = createMap(L, mapEl, {
      catalog: S.catalog,
      onRegion: openRegion,
      onCountry: (c) => go('explore/' + c.id),
      onPick: async (lat, lon) => { mapCtl.showPoint(lat, lon); await openRegion(customRegion(lat, lon)); },
    });
    mapState = 'ready';
    if (!root.hidden) renderExplore();
  });

  const tools = () => {
    clear(layerEl).append(
      segmented([['map', 'Map'], ['sat', 'Satellite']], S.layer, (v) => { S.layer = v; notify('layer'); }, 'Base map'),
      h('button', { type: 'button', class: 'btn small ghost', text: 'Legend', onclick: openLegend }));
  };
  tools();
  root._tools = tools;
}

function availabilityRows(region) {
  return h('ul', { class: 'avail' }, FACTORS.filter((f) => !S.filter || S.filter === f.id).map((f) => {
    const cfg = region.factors[f.id];
    return h('li', { style: `--f:${f.color}` },
      h('span', { class: 'f-icon' }, icon(f.id, 16)), h('span', { class: 'avail-name', text: f.short }), statusBadge(cfg.status));
  }));
}

export function renderExplore() {
  const { arg } = currentRoute();
  const country = arg ? countryById(arg) : null;
  clear(chipsEl).append(factorChips(S.filter, setFilter));
  root._tools();

  if (mapCtl) {
    mapCtl.setFilter(S.filter);
    mapCtl.setLayer(S.layer, S.region && S.endDay ? S.endDay : null);
    // the map may have been created while this screen was hidden, so measure it first
    mapCtl.resize();
    const key = country ? country.id : null;
    if (key !== lastCountry) { lastCountry = key; if (country) mapCtl.showCountry(country); else mapCtl.showWorld(); }
  }

  clear(listEl);
  if (!country) {
    listEl.append(h('h2', { text: 'Study areas' }),
      h('p', { class: 'lede', text: 'Radar analyses of water, land motion, vegetation and soil are available for these areas. Choose a country to see them.' }));
    listEl.append(h('div', { class: 'card list' }, S.catalog.countries.map((c) => {
      const n = S.catalog.regions.filter((r) => r.country === c.id).length;
      return h('button', { type: 'button', class: 'row', onclick: () => go('explore/' + c.id) },
        h('span', { class: 'row-main' }, h('strong', { text: c.name }), h('span', { class: 'muted', text: `${n} study area${n === 1 ? '' : 's'}` })),
        h('span', { class: 'chev' }, icon('back', 18)));
    })));
    listEl.append(h('p', { class: 'hint', text: mapState === 'failed'
      ? 'Rainfall, temperature and soil moisture for any other point become available once the map can load.'
      : 'Anywhere else on Earth: tap the map to check rainfall, temperature and soil moisture at that point.' }));
    return;
  }
  listEl.append(h('button', { type: 'button', class: 'backlink', onclick: () => go('explore') }, icon('back', 18), 'All countries'),
    h('h2', { text: country.name }));
  const regions = S.catalog.regions.filter((r) => r.country === country.id);
  for (const r of regions) {
    listEl.append(h('article', { class: 'card' },
      h('h3', { text: r.name }), h('p', { class: 'muted', text: r.summary }),
      h('p', { class: 'label', text: 'Data available' }), availabilityRows(r),
      h('button', { type: 'button', class: 'btn', text: 'Open analysis', onclick: () => openRegion(r) })));
  }
}
