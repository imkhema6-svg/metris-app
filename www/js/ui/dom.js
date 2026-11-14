// Tiny DOM helpers. Text always goes in through textContent, never innerHTML,
// so names coming from data files cannot inject markup.
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

const SVG_NS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

const ICON_PATHS = {
  explore: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.8 2.6 4 5.6 4 9s-1.2 6.4-4 9c-2.8-2.6-4-5.6-4-9s1.2-6.4 4-9z',
  area: 'M4 20V4M4 20h16M7.5 15.5l3.5-4 3 2.5 5-6.5',
  compare: 'M7 4v16M17 4v16M3.5 8L7 4l3.5 4M13.5 16L17 20l3.5-4',
  assistant: 'M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4.5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  guide: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.6v.2',
  back: 'M14.5 5.5L8 12l6.5 6.5',
  send: 'M5 12h13M12.5 6l6 6-6 6',
  water: 'M12 3.5c3.2 3.9 5.5 6.8 5.5 9.8a5.5 5.5 0 0 1-11 0c0-3 2.3-5.9 5.5-9.8z',
  deform: 'M3 8h18M12 10.5v9M8 16l4 4 4-4',
  veg: 'M5 19c0-8 5-13 14-14 0 9-5 14-14 14zM5 19l8-8',
  soil: 'M3 18h18M3 14h18M12 11V4M8.5 7.5L12 4l3.5 3.5',
};

export function icon(name, size = 22) {
  return s('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
  s('path', { d: ICON_PATHS[name] }));
}
