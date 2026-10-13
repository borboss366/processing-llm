/**
 * Rating page (owner request 2026-10-14): one item at a time — its setup
 * buttons put exactly that move/dial/render mode on the stage window, a
 * text box takes the owner's own words. Items come from
 * public/judge-items.json (edit + reload). Notes persist in localStorage
 * and are appended to sessions/judge-<date>.jsonl through the existing
 * /session/append route (the live path's one allowed write).
 */

import { createWs } from './core/ws.js';

const $ = (id) => document.getElementById(id);
const post = (p, body) => fetch(p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const osc = (address, value) => post('/osc', { address, value }).catch(() => {});
const SESSION = `judge-${new Date().toISOString().slice(0, 10)}`;
const STORE = 'judge-notes-v1';

let ITEMS = [], BASE = {}, STAGE = '/', cur = 0;
const notes = (() => { try { return JSON.parse(localStorage.getItem(STORE) ?? '{}'); } catch { return {}; } })();
const saveLocal = () => { try { localStorage.setItem(STORE, JSON.stringify(notes)); } catch { /* private mode */ } };

let armed = false, arming = null;
async function arm() {
  arming ??= armOnce().finally(() => { arming = null; });
  return arming;
}
async function armOnce() {
  await post('/browser-modules/load', { id: 'creature' });
  await new Promise((r) => setTimeout(r, 800));
  await osc('/creature/entryConf', 0);
  await post('/browser-modules/trigger', { id: 'creature' });
  armed = true;
  $('stage-status').textContent = 'creature started';
}

// the setup currently meant to be on stage — re-applied if the stage drifts
// (a reloaded stage tab starts in rotation; the owner saw "it just iterates")
let want = null, driftSince = 0;

// the LATEST press wins: each call takes a generation number; a slower
// earlier call (still arming) stops before sending its params
let gen = 0;
async function applySetup(item, s, btn) {
  const my = ++gen;
  if (s.copy) {
    try { await navigator.clipboard.writeText(s.copy); } catch { /* no clipboard */ }
    $('save-status').textContent = `copied — paste in a terminal: ${s.copy}`;
    return;
  }
  want = { item, s, params: { ...BASE, ...s.params } };
  if (!armed) await arm();
  if (my !== gen) return;
  for (const [k, v] of Object.entries(want.params)) {
    if (my !== gen) return;
    await osc(`/creature/${k}`, v);
  }
  driftSince = 0;
  [...$('setups').children].forEach((b) => b.classList.toggle('on', b === btn));
  const n = (notes[item.id] ??= { verdict: null, text: '', setups: [] });
  if (!n.setups.includes(s.label)) n.setups.push(s.label);
  saveLocal();
  $('stage-status').textContent = `on stage: ${s.label}`;
}

function markOf(id) {
  const n = notes[id];
  if (!n) return '';
  return n.verdict === 'yes' ? '✓' : n.verdict === 'no' ? '✗' : n.verdict === 'partly' ? '~' : n.text ? '…' : '';
}

function renderNav() {
  const host = $('items');
  host.innerHTML = '';
  ITEMS.forEach((it, i) => {
    const b = document.createElement('button');
    b.className = 'item' + (i === cur ? ' on' : '');
    b.innerHTML = `<span class="mark">${markOf(it.id)}</span>${it.title}`;
    b.onclick = () => { cur = i; render(); };
    host.appendChild(b);
  });
}

function render() {
  const it = ITEMS[cur];
  if (!it) return;
  $('gate').textContent = it.gate;
  $('title').textContent = it.title;
  $('look').textContent = it.look;
  $('question').textContent = it.question;
  const host = $('setups');
  host.innerHTML = '';
  for (const s of it.setups) {
    const b = document.createElement('button');
    b.textContent = s.label;
    b.onclick = () => applySetup(it, s, b);
    host.appendChild(b);
  }
  const n = notes[it.id] ?? { verdict: null, text: '' };
  $('text').value = n.text ?? '';
  [...$('verdict').children].forEach((b) => b.classList.toggle('on', b.dataset.v === n.verdict));
  $('verdict').style.display = it.id === '6-explain-it' ? 'none' : 'flex';   // a paragraph, not a verdict
  $('save-status').textContent = '';
  renderNav();
  // selecting an item puts its first setup on stage — never a leftover
  const first = it.setups.find((x) => x.params);
  if (first && document.visibilityState === 'visible') applySetup(it, first, host.children[it.setups.indexOf(first)]);
}

// save: localStorage immediately, session log debounced (one line per pause)
let logTimer = null;
function persist() {
  const it = ITEMS[cur];
  const n = (notes[it.id] ??= { verdict: null, text: '', setups: [] });
  n.text = $('text').value;
  n.t = new Date().toISOString();
  saveLocal();
  renderNav();
  clearTimeout(logTimer);
  logTimer = setTimeout(async () => {
    try {
      await post('/session/append', { session: SESSION, event: { t: Date.now(), type: 'judge-note', id: it.id, gate: it.gate, ...n } });
      $('save-status').textContent = `saved · sessions/${SESSION}.jsonl`;
    } catch { $('save-status').textContent = 'saved in this browser (server unreachable)'; }
  }, 900);
}
$('text').addEventListener('input', persist);
$('verdict').addEventListener('click', (e) => {
  const v = e.target.dataset?.v;
  if (!v) return;
  const it = ITEMS[cur];
  const n = (notes[it.id] ??= { verdict: null, text: '', setups: [] });
  n.verdict = n.verdict === v ? null : v;
  render();
  persist();
});

// open ONCE: re-opening a named window navigates (= reloads) it, which
// resets the stage to rotation — a second press only focuses it
let stageWin = null;
$('open-stage').onclick = () => {
  if (stageWin && !stageWin.closed) { stageWin.focus(); $('stage-status').textContent = 'stage window already open (focused)'; return; }
  stageWin = window.open(STAGE, 'vj-stage');
  $('stage-status').textContent = 'stage window opened — press play there';
};
$('arm').onclick = () => arm();

$('copy-all').onclick = async () => {
  const md = ITEMS.map((it) => {
    const n = notes[it.id];
    if (!n) return null;
    return `### ${it.title}\n*${it.gate}* — verdict: **${n.verdict ?? '—'}** (looked at: ${(n.setups ?? []).join(', ') || '—'})\n\n${n.text || '_no text_'}\n`;
  }).filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(md); $('save-status').textContent = 'all notes copied as Markdown'; }
  catch { $('save-status').textContent = 'clipboard unavailable'; }
};

(async () => {
  const j = await (await fetch('/judge-items.json')).json();
  ITEMS = j.items; BASE = j.base ?? {}; STAGE = j.stage ?? '/';
  render();
})();

// live stage readout + reload guard. The guard watches the stage's forced
// `move` PARAM (render-state), not the move playing: a switch takes a bar
// or so to crossfade, and re-sending during it restarts the switch. A
// reloaded stage tab resets the param to '' → re-apply the chosen setup.
createWs({
  url: `ws://${location.host}/ws`,
  onMessage(msg) {
    if (msg.type === 'bench-state') {
      const c = msg.creature;
      $('live').textContent = `on stage now: ${c ? (c.move ?? '(procedural)') : '(no creature)'}`;
      return;
    }
    // only the VISIBLE judge page steers: commands reach every stage tab, so
    // two judge pages (or a background one) would fight over one stage
    if (msg.type !== 'render-state' || !want || document.visibilityState !== 'visible') return;
    const mod = (msg.modules ?? []).find((m) => m.id === 'creature');
    if (!mod) return;
    const forced = mod.params?.move ?? '';
    if (forced === (want.params.move ?? '')) { driftSince = 0; return; }
    driftSince ||= Date.now();
    if (Date.now() - driftSince > 1500) {
      driftSince = 0;
      $('stage-status').textContent = `stage was reset — re-applying "${want.s.label}"`;
      armed = true;   // the creature module is present; only params were lost
      applySetup(want.item, want.s, [...$('setups').children].find((b) => b.textContent === want.s.label) ?? null);
    }
  },
});
