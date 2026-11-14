// Map screen, built on Leaflet. Leaflet is loaded from www/vendor/leaflet when
// it has been bundled (npm run vendor) and from a CDN otherwise. If neither
// can be reached (no internet), the app carries on with the list of areas.
import { FACTORS } from '../core/factors.js';
import { fromDay, todayDay } from '../core/dates.js';
import { h } from './dom.js';

const LOCAL = 'vendor/leaflet/';
const CDN = 'https://unpkg.com/leaflet@1.9.4/dist/';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.onload = resolve; el.onerror = () => { el.remove(); reject(new Error(src)); };
    document.head.append(el);
  });
}
function loadCss(href) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('link');
    el.rel = 'stylesheet'; el.href = href; el.onload = resolve; el.onerror = () => { el.remove(); reject(new Error(href)); };
    document.head.append(el);
  });
}

export async function loadLeaflet() {
  if (window.L) return window.L;
  for (const base of [LOCAL, CDN]) {
    try {
      await Promise.all([loadCss(base + 'leaflet.css'), loadScript(base + 'leaflet.js')]);
      if (window.L) return window.L;
    } catch { /* try the next source */ }
  }
  return null;
}

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function pinHtml(region, filter) {
  const dots = FACTORS.filter((f) => !filter || filter === f.id).map((f) => {
    const st = (region.factors[f.id] || {}).status || 'unavailable';
    return `<i class="pin-dot ${st}" style="--f:${f.color}"></i>`;
  }).join('');
  return `<span class="pin-body"><span class="pin-dots">${dots}</span><span class="pin-name">${esc(region.name)}</span></span>`;
}

/**
 * @param {HTMLElement} el
 * @param {{catalog, onRegion(region), onCountry(country), onPick(lat, lon)}} opts
 */
export function createMap(L, el, opts) {
  const { catalog } = opts;
  const map = L.map(el, { zoomControl: false, worldCopyJump: true, minZoom: 1, maxZoom: 12, attributionControl: true })
    .setView([14, 40], 2);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const street = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 12, attribution: '© OpenStreetMap contributors',
  });
  let sat = null, layerKey = 'map';
  const makeSat = (dateStr) => {
    const im = catalog.imagery;
    return L.tileLayer(
      `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${im.layer}/default/${dateStr}/${im.matrixSet}/{z}/{y}/{x}.${im.format}`,
      { maxNativeZoom: im.maxZoom, maxZoom: 12, attribution: `Imagery: ${im.label}, ${dateStr}` });
  };
  street.addTo(map);

  const countryLayer = L.layerGroup().addTo(map);
  const regionLayer = L.layerGroup();
  let filter = null;

  for (const c of catalog.countries) {
    const b = L.latLngBounds(c.bounds);
    const n = catalog.regions.filter((r) => r.country === c.id).length;
    L.marker(b.getCenter(), {
      icon: L.divIcon({ className: 'pin country-pin', html: `<span class="pin-body"><span class="pin-name">${esc(c.name)}</span><span class="pin-count">${n}</span></span>`, iconSize: null }),
      title: c.name, keyboard: true,
    }).on('click', () => opts.onCountry(c)).addTo(countryLayer);
  }
  const regionMarkers = catalog.regions.map((r) => {
    const mk = L.marker(r.center, { icon: L.divIcon({ className: 'pin region-pin', html: pinHtml(r, filter), iconSize: null }), title: r.name, keyboard: true });
    mk.on('click', () => opts.onRegion(r));
    mk.addTo(regionLayer);
    return { r, mk };
  });

  let pickMarker = null;
  map.on('click', (e) => {
    const ll = e.latlng.wrap();
    const lat = +ll.lat.toFixed(3), lon = +ll.lng.toFixed(3);
    const box = h('div', { class: 'pick-popup' },
      h('p', { text: `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}` }),
      h('button', { class: 'btn small', type: 'button', text: 'Check this point', onclick: () => { map.closePopup(); opts.onPick(lat, lon); } }));
    L.popup({ closeButton: false, offset: [0, -2] }).setLatLng(e.latlng).setContent(box).openOn(map);
  });

  return {
    showWorld() {
      map.removeLayer(regionLayer); countryLayer.addTo(map);
      map.setView([14, 40], 2);
    },
    showCountry(country) {
      map.removeLayer(countryLayer); regionLayer.addTo(map);
      map.fitBounds(country.bounds, { padding: [16, 16] });
    },
    showPoint(lat, lon) {
      if (pickMarker) map.removeLayer(pickMarker);
      pickMarker = L.circleMarker([lat, lon], { radius: 7, color: '#14212b', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }).addTo(map);
    },
    setFilter(f) {
      filter = f;
      for (const { r, mk } of regionMarkers) mk.setIcon(L.divIcon({ className: 'pin region-pin', html: pinHtml(r, filter), iconSize: null }));
    },
    /** layer: 'map' | 'sat'. day: which date of imagery to show. */
    setLayer(layer, day) {
      // imagery for the last two days is often still incomplete
      const dateStr = fromDay(Math.min(day || todayDay(), todayDay() - 2));
      const key = layer === 'sat' ? `sat:${dateStr}` : 'map';
      if (key === layerKey) return;
      layerKey = key;
      if (sat) { map.removeLayer(sat); sat = null; }
      if (layer === 'sat') {
        map.removeLayer(street);
        sat = makeSat(dateStr).addTo(map);
      } else street.addTo(map);
    },
    resize() { map.invalidateSize(); },
  };
}
