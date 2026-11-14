// Screen 4: the location-aware assistant.
import { ask, SUGGESTED_QUESTIONS } from '../core/assistant.js';
import { getAllSeries } from '../core/data.js';
import { fmtDay } from '../core/dates.js';
import { h, clear, icon } from './dom.js';
import { S, go } from './state.js';

let root, ctxEl, logEl, input, busy = false;

export function initAssistant(el) {
  root = el;
  input = h('input', { type: 'text', placeholder: 'Ask about this area', 'aria-label': 'Your question', autocomplete: 'off', enterkeyhint: 'send', maxlength: 300 });
  const form = h('form', { class: 'ask-form', onsubmit: (e) => { e.preventDefault(); send(input.value); } },
    input, h('button', { type: 'submit', class: 'btn icon-btn', 'aria-label': 'Send question' }, icon('send', 20)));
  root.append(ctxEl = h('div', { class: 'pad' }), logEl = h('div', { class: 'chat pad-x', 'aria-live': 'polite' }), form);
}

function botMessage(ans) {
  const el = h('div', { class: 'msg bot' });
  for (const p of ans.paragraphs) el.append(h('p', { text: p }));
  el.append(h('p', { class: `confidence c-${ans.confidence.level}` }, h('strong', { text: 'Confidence. ' }), ans.confidence.text));
  if (ans.sources.length) {
    el.append(h('details', { class: 'fold' }, h('summary', { text: `Sources (${ans.sources.length})` }),
      h('ul', { class: 'bullets small' }, ans.sources.map((t) => h('li', { text: t })))));
  }
  return el;
}

async function send(text) {
  const q = text.trim();
  if (!q || busy) return;
  busy = true;
  input.value = '';
  S.chat.push({ role: 'user', text: q });
  renderLog();
  try {
    const ans = await ask(q, {
      region: S.region, startDay: S.startDay, endDay: S.endDay, series: S.series,
      climate: S.climate, regions: S.catalog.regions, loadSeries: (r) => getAllSeries(r),
    });
    S.chat.push({ role: 'bot', ans });
  } catch (err) {
    S.chat.push({ role: 'bot', ans: { paragraphs: [`Something went wrong while reading the stored data (${err.message}). Try again.`], sources: [], confidence: { level: 'none', text: 'No answer.' } } });
  }
  busy = false;
  renderLog();
}

function renderLog() {
  clear(logEl);
  if (!S.chat.length) {
    logEl.append(h('p', { class: 'muted', text: 'Try one of these:' }),
      h('div', { class: 'suggest' }, SUGGESTED_QUESTIONS.map((q) => h('button', { type: 'button', class: 'btn small ghost', text: q, onclick: () => send(q) }))));
    return;
  }
  for (const m of S.chat) logEl.append(m.role === 'user' ? h('div', { class: 'msg user' }, h('p', { text: m.text })) : botMessage(m.ans));
  logEl.lastChild.scrollIntoView({ block: 'nearest' });
}

export function renderAssistant() {
  clear(ctxEl);
  if (!S.region) {
    ctxEl.append(h('section', { class: 'card' }, h('h2', { text: 'Choose an area first' }),
      h('p', { class: 'muted', text: 'The assistant answers from the data stored for one place and period. Pick a study area or a point on the map.' }),
      h('button', { type: 'button', class: 'btn', text: 'Open Explore', onclick: () => go('explore') })));
    clear(logEl);
    input.disabled = true;
    return;
  }
  input.disabled = false;
  ctxEl.append(h('section', { class: 'card context' },
    h('p', null, h('span', { class: 'muted', text: 'Answering about ' }), h('strong', { text: S.region.name })),
    h('p', { class: 'muted', text: `${fmtDay(S.startDay)} to ${fmtDay(S.endDay)}` }),
    h('p', { class: 'muted small', text: 'Answers use only the analyses and weather records stored for this place and period. When they cannot answer, the assistant says so.' }),
    h('button', { type: 'button', class: 'btn small ghost', text: 'Change area or dates', onclick: () => go('area') })));
  renderLog();
}
