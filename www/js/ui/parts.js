// Small UI pieces shared by several screens.
import { FACTORS, STATUS_LABEL } from '../core/factors.js';
import { h, icon } from './dom.js';

export function statusBadge(status) {
  return h('span', { class: `badge status ${status}` }, h('i', { class: `dot ${status}` }), STATUS_LABEL[status]);
}

const PROVENANCE = {
  simulated: ['Simulated demo data', 'simulated'],
  observed: ['Processed satellite data', 'observed'],
  live: ['Live reanalysis data', 'live'],
};
export function provenanceBadge(kind) {
  const p = PROVENANCE[kind];
  return p ? h('span', { class: `badge prov ${p[1]}`, text: p[0] }) : null;
}

/**
 * Four factor chips. Tapping one isolates that factor; tapping it again shows all.
 * selected: null (all) or a factor id. With required=true exactly one is always selected.
 */
export function factorChips(selected, onPick, { required = false, label = 'Show factor' } = {}) {
  return h('div', { class: 'chips', role: 'group', 'aria-label': label }, FACTORS.map((f) => {
    const on = selected === f.id, dim = selected && !on;
    return h('button', {
      type: 'button', class: `chip${on ? ' on' : ''}${dim ? ' dim' : ''}`, style: `--f:${f.color}`,
      'aria-pressed': String(on), onclick: () => { if (!(required && on)) onPick(f.id); },
    }, h('span', { class: 'chip-icon' }, icon(f.id, 15)), f.short);
  }));
}

export function segmented(options, value, onPick, label) {
  return h('div', { class: 'segmented', role: 'group', 'aria-label': label }, options.map(([v, text]) =>
    h('button', { type: 'button', class: v === value ? 'on' : '', 'aria-pressed': String(v === value), onclick: () => onPick(v), text })));
}

export function libraryList(items) {
  const KIND = { article: 'Article', video: 'Video', training: 'Training', paper: 'Paper', data: 'Data' };
  return h('ul', { class: 'library' }, items.map((it) => h('li', null,
    h('a', { href: it.url, target: '_blank', rel: 'noopener' }, it.title),
    h('span', { class: 'lib-meta', text: `${KIND[it.kind] || 'Link'}, ${it.source}` }))));
}
