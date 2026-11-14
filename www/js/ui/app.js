// App entry point: loads the catalogue, builds the five screens and switches
// between them. Screens are addressed by the URL hash so the phone's back
// button works: #/explore, #/explore/EG, #/area, #/compare, #/assistant, #/guide
import { loadCatalog } from '../core/data.js';
import { h, clear, icon } from './dom.js';
import { S, subscribe, notify, currentRoute, go, restore } from './state.js';
import { initExplore, renderExplore } from './view-explore.js';
import { initArea, renderArea, areaTitle } from './view-area.js';
import { initCompare, renderCompare } from './view-compare.js';
import { initAssistant, renderAssistant } from './view-assistant.js';
import { initGuide, legendContent } from './view-guide.js';

const $ = (id) => document.getElementById(id);

// each screen: tab label, title, and which state changes should redraw it
const VIEWS = {
  explore: { tab: 'Explore', title: () => 'METRIS', on: ['route', 'filter', 'layer'], render: renderExplore },
  area: { tab: 'Area', title: areaTitle, on: ['route', 'region', 'range', 'filter', 'climate'], render: renderArea },
  compare: { tab: 'Compare', title: () => 'Compare areas', on: ['route'], render: renderCompare },
  assistant: { tab: 'Ask', title: () => 'Ask', on: ['route', 'region', 'range'], render: renderAssistant },
  guide: { tab: 'Guide', title: () => 'Guide', on: ['route'], render: () => {} },
};

function openLegend() {
  clear($('legend-body')).append(legendContent());
  const dlg = $('legend');
  if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
}

function buildTabs() {
  $('tabs').append(...Object.entries(VIEWS).map(([name, v]) =>
    h('button', { type: 'button', 'data-view': name, onclick: () => go(name) }, icon(name), h('span', { text: v.tab }))));
}

function render(what) {
  let { view } = currentRoute();
  if (!VIEWS[view]) view = 'explore';
  for (const name of Object.keys(VIEWS)) $('view-' + name).hidden = name !== view;
  for (const b of $('tabs').children) {
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  }
  $('title').textContent = VIEWS[view].title();
  document.title = view === 'explore' ? 'METRIS' : `${VIEWS[view].title()} · METRIS`;
  if (VIEWS[view].on.includes(what)) VIEWS[view].render(what);
  if (what === 'route') window.scrollTo(0, 0);
}

async function boot() {
  try {
    S.catalog = await loadCatalog();
  } catch (err) {
    $('boot').textContent = `METRIS could not load its data catalogue (${err.message}). Start the app with "npm start" rather than opening index.html directly.`;
    return;
  }
  try {
    const r = await fetch('data/library.json', { cache: 'no-cache' });
    S.library = (await r.json()).items || [];
  } catch { S.library = []; }

  buildTabs();
  initExplore($('view-explore'), openLegend);
  initArea($('view-area'));
  initCompare($('view-compare'));
  initAssistant($('view-assistant'));
  initGuide($('view-guide'));
  $('legend-close').addEventListener('click', () => $('legend').close());
  $('legend').addEventListener('click', (e) => { if (e.target === $('legend')) $('legend').close(); });

  await restore();
  $('boot').remove();
  subscribe(render);
  window.addEventListener('hashchange', () => notify('route'));
  render('route');
}

boot();
