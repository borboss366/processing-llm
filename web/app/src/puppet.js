/**
 * Puppet page (brief 13.2 Task 3, per 12.7): one surface to drive the
 * creature by hand — cast & state (shape incl. approved audience spool,
 * enter/exit, behavior force), the move rig (relocated from the
 * controller), auto-enumerated live param controls, clock-tier badge,
 * the visual-offset calibration slider (mirrors the bench), and a
 * snapshot button (clipboard + session stream).
 *
 * Widgets shared with the bench via core/bench-widgets.js.
 */

import { createWs } from './core/ws.js';
import { spark, phaseWheel, ribbonStrip, tierColor } from './core/bench-widgets.js';

const $ = (id) => document.getElementById(id);
const osc = (address, value) => fetch('/osc', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ address, value }),
}).catch(() => {});
const post = (p, body) => fetch(p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
}).catch(() => {});

const STATE_COLORS = { idle: '#39415e', walk: '#2c7a4b', groove: '#7a2c6b', hop: '#7a6b2c' };
const MOVE_COLORS = { groove: '#ff5d7e', 'tstep-placeholder': '#4dd9e8', 'armwave-placeholder': '#ffd24d' };

let B = null;                 // latest bench-state
let creatureMod = null;       // creature row from render-state.modules
const ribbon = [];
const speedHist = [];
let keyPhases = [], keyMove = null;
let forcedBehavior = 'auto';

// ── cast & state ──────────────────────────────────────────────────────────
(async () => {
  const sel = $('shape-sel');
  try {
    const j = await (await fetch('/shapes-list')).json();
    for (const sh of j.shapes ?? []) {
      const o = document.createElement('option');
      o.value = o.textContent = sh;
      sel.appendChild(o);
    }
  } catch { /* server offline */ }
  try {
    const q = await (await fetch('/submit-api/api/queue')).json();
    for (const id of q.approved ?? []) {
      const o = document.createElement('option');
      o.value = `audience:${id}`;
      o.textContent = `audience: ${id}`;
      sel.appendChild(o);
    }
  } catch { /* submission service not running — fine */ }
})();

$('shape-sel').addEventListener('change', () => osc('/creature/shape', $('shape-sel').value));
$('btn-enter').addEventListener('click', async () => {
  await post('/browser-modules/load', { id: 'creature' });
  await post('/browser-modules/enable', { id: 'creature', enabled: true });
  if ($('shape-sel').value) await osc('/creature/shape', $('shape-sel').value);
  await post('/browser-modules/trigger', { id: 'creature' });
});
$('btn-exit').addEventListener('click', () =>
  post('/browser-modules/exit', { id: 'creature' }));   // through the normal fade (12.7)

for (const b of ['auto', 'idle', 'walk', 'groove', 'hop']) {
  const btn = document.createElement('button');
  btn.textContent = b;
  btn.addEventListener('click', () => {
    forcedBehavior = b;
    osc('/creature/behavior', b);
    [...$('beh-btns').children].forEach((x) => x.classList.toggle('on', x.textContent === b));
  });
  if (b === 'auto') btn.classList.add('on');
  $('beh-btns').appendChild(btn);
}

// ── move rig (relocated from the controller) ─────────────────────────────
{
  const nameSel = $('mv-name'), manualBtn = $('mv-manual'),
        scrub = $('mv-scrub'), phaseEl = $('mv-phase'), playBtn = $('mv-play');
  let isManual = false;
  (async () => {
    try {
      const j = await (await fetch('/moves-list')).json();
      for (const m of j.moves ?? []) {
        const o = document.createElement('option');
        o.value = o.textContent = m;
        nameSel.appendChild(o);
      }
    } catch { /* offline */ }
  })();
  nameSel.addEventListener('change', () => osc('/creature/move', nameSel.value || 'none'));
  const setManual = (on) => {
    isManual = on;
    manualBtn.classList.toggle('on', on);
    manualBtn.textContent = on ? 'Manual (scrubbing)' : 'Manual';
    scrub.disabled = playBtn.disabled = !on;
    osc('/creature/clockMode', on ? 'manual' : 'live');
    if (!on) phaseEl.textContent = '—';
  };
  manualBtn.addEventListener('click', () => setManual(!isManual));
  playBtn.addEventListener('click', () => setManual(false));
  let queued = null, timer = null;
  scrub.addEventListener('input', () => {
    phaseEl.textContent = Number(scrub.value).toFixed(3);
    queued = Number(scrub.value);
    timer ??= setTimeout(() => {
      timer = null;
      if (queued !== null) osc('/creature/phaseScrub', queued);
      queued = null;
    }, 33);
  });
}

// ── visual offset (mirrors the bench slider) ─────────────────────────────
let visSynced = false;
$('vis-off').addEventListener('input', () => {
  $('vis-off-val').textContent = $('vis-off').value;
  ws.send({ type: 'set-visual-offset', ms: Number($('vis-off').value) });
});

// ── auto-enumerated param controls ───────────────────────────────────────
const OWNED = new Set(['shape', 'behavior', 'move', 'clockMode', 'phaseScrub']);
let builtKeys = '';
function buildParams(mod) {
  const keys = Object.keys(mod.defaults ?? {}).filter((k) => !OWNED.has(k)).sort();
  const sig = keys.join(',');
  const host = $('params');
  if (sig !== builtKeys) {
    builtKeys = sig;
    host.innerHTML = '';
    for (const k of keys) {
      const def = mod.defaults[k];
      const row = document.createElement('div');
      row.className = 'param';
      if (typeof def === 'number') {
        const isHue = /^hue/i.test(k);
        const max = isHue ? 360 : def === 0 ? 1 : Math.abs(def) * 3;
        const step = isHue ? 1 : max / 100;
        const v0 = mod.params?.[k] ?? def;
        row.innerHTML = `<span class="name" title="${k}">${k}</span>
          <input type="range" data-k="${k}" min="${def < 0 && !isHue ? -max : 0}" max="${max}" step="${step}" value="${v0}">
          ${isHue ? `<span class="swatch" data-s="${k}" style="width:16px;height:16px;border-radius:4px;background:hsl(${v0},85%,62%)"></span>` : ''}
          <span class="val" data-v="${k}">${v0}</span>`;
      } else {
        row.innerHTML = `<span class="name" title="${k}">${k}</span>
          <input type="text" data-k="${k}" value="${mod.params?.[k] ?? def}">`;
      }
      host.appendChild(row);
    }
    host.addEventListener('input', (e) => {
      const k = e.target.dataset?.k;
      if (!k) return;
      const v = e.target.type === 'range' ? Number(e.target.value) : e.target.value;
      const vs = host.querySelector(`[data-v="${k}"]`);
      if (vs) vs.textContent = typeof v === 'number' ? String(+v.toFixed(3)) : v;
      const sw = host.querySelector(`[data-s="${k}"]`);
      if (sw) sw.style.background = `hsl(${v},85%,62%)`;
      osc(`/creature/${k}`, v);
    });
  } else {
    // refresh displayed values for controls the user isn't touching
    for (const k of keys) {
      const inp = host.querySelector(`[data-k="${k}"]`);
      const vs = host.querySelector(`[data-v="${k}"]`);
      if (inp && document.activeElement !== inp && mod.params && k in mod.params) {
        inp.value = mod.params[k];
        if (vs) vs.textContent = String(mod.params[k]);
      }
    }
  }
}

// ── snapshot ─────────────────────────────────────────────────────────────
$('btn-snap').addEventListener('click', async () => {
  const snap = {
    t: new Date().toISOString(),
    shape: creatureMod?.params?.shape ?? $('shape-sel').value,
    behavior: forcedBehavior,
    move: creatureMod?.params?.move ?? '',
    clockMode: creatureMod?.params?.clockMode ?? 'live',
    clockTier: B?.tier ?? 'pll',
    visualBeatOffsetMs: Number($('vis-off').value),
    params: creatureMod?.params ?? {},
  };
  const text = JSON.stringify(snap, null, 2);
  try { await navigator.clipboard.writeText(text); } catch { /* headless */ }
  ws.send({ type: 'puppet-snapshot', snapshot: snap });
  $('snap-status').textContent = 'copied + logged ✓';
  setTimeout(() => { $('snap-status').textContent = ''; }, 2500);
});

// ── live feed ────────────────────────────────────────────────────────────
const ws = createWs({
  url: `ws://${location.host}/ws`,
  onMessage(msg) {
    if (msg.type === 'bench-state') {
      B = msg;
      $('tier').textContent = (msg.tier ?? 'pll').toUpperCase();
      $('tier').style.color = tierColor(msg.tier);
      if (!visSynced && typeof msg.visualOffsetMs === 'number') {
        $('vis-off').value = String(msg.visualOffsetMs);
        $('vis-off-val').textContent = String(msg.visualOffsetMs);
        visSynced = true;
      }
      const c = msg.creature;
      if (c) {
        $('cState').textContent = c.st;
        $('cMove').textContent = c.move ?? '(procedural)';
        const last = ribbon.at(-1);
        if (!last || last[1] !== c.st || last[2] !== c.move) ribbon.push([msg.t, c.st, c.move]);
        while (ribbon.length && ribbon[0][0] < Date.now() - 61_000) ribbon.shift();
        if (c.move && c.move !== keyMove) {
          keyMove = c.move;
          fetch(`/moves/${c.move}.json`).then((r) => r.json())
            .then((j) => { keyPhases = (j.keys ?? []).map((k) => k.phase); })
            .catch(() => { keyPhases = []; });
        }
        phaseWheel($('wheel'), c.loopPhase ?? 0, keyPhases);
        ribbonStrip($('ribbon'), ribbon, { stateColors: STATE_COLORS, moveColors: MOVE_COLORS });
        speedHist.push([msg.t, c.jointSpeed ?? 0, c.spikesFlagged ?? 0]);
        while (speedHist.length && speedHist[0][0] < Date.now() - 60_000) speedHist.shift();
        spark($('speed'), speedHist.map((h) => [h[0], h[1]]),
          { min: 0, max: Math.max(1, ...speedHist.map((h) => h[1])), color: '#5ee89a' });
        $('spikes').textContent = String(c.spikesFlagged ?? 0);
      }
    } else if (msg.type === 'render-state') {
      const mod = (msg.modules ?? []).find((m) => m.id === 'creature');
      if (mod) { creatureMod = mod; buildParams(mod); }
    }
  },
});
