/**
 * Rating page (owner request 2026-10-14): one item at a time — its setup
 * buttons put exactly that move/dial/render mode on the stage window, a
 * text box takes the owner's own words. Items come from
 * public/judge-items.json (edit + reload). Notes persist in localStorage
 * and are appended to sessions/judge-<date>.jsonl through the existing
 * /session/append route (the live path's one allowed write).
 */

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

let armed = false;
async function arm() {
  await post('/browser-modules/load', { id: 'creature' });
  await new Promise((r) => setTimeout(r, 800));
  await osc('/creature/entryConf', 0);
  await post('/browser-modules/trigger', { id: 'creature' });
  armed = true;
  $('stage-status').textContent = 'creature started';
}

async function applySetup(item, s, btn) {
  if (s.copy) {
    try { await navigator.clipboard.writeText(s.copy); } catch { /* no clipboard */ }
    $('save-status').textContent = `copied — paste in a terminal: ${s.copy}`;
    return;
  }
  if (!armed) await arm();
  const params = { ...BASE, ...s.params };
  for (const [k, v] of Object.entries(params)) await osc(`/creature/${k}`, v);
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

$('open-stage').onclick = () => {
  window.open(STAGE, 'vj-stage');
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
