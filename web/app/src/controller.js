/**
 * Controller window — pad grid + MIDI + mapping editor + module list.
 *
 * Lives on a different screen from the rendering window. Sends actions over
 * HTTP to the Node controller (port 3000), which broadcasts to all connected
 * rendering windows. Never draws visuals.
 */

import './style.css';
import { createPadController } from './core/pads.js';
import {
  createMappingEngine,
  loadMappingFromStorage,
  saveMappingToStorage,
  DEFAULT_MAPPING,
} from './core/mapping.js';
import { createWs } from './core/ws.js';

// ─── DOM ───────────────────────────────────────────────────────────────────
const els = {
  wsStatus:      document.getElementById('ws-status'),
  padGrid:       document.getElementById('pad-grid'),
  modulesList:   document.getElementById('modules-list'),
  mappingEditor: document.getElementById('mapping-editor'),
  btnMappingSave: document.getElementById('btn-mapping-save'),
  btnMappingReset: document.getElementById('btn-mapping-reset'),
  mappingStatus: document.getElementById('mapping-status'),
  btnPresetPrev: document.getElementById('btn-preset-prev'),
  btnPresetNext: document.getElementById('btn-preset-next'),
  renderStatus:  document.getElementById('render-status'),
  btnBg:         document.getElementById('btn-bg'),
  btnFg:         document.getElementById('btn-fg'),
  devicePick:    document.getElementById('device-pick'),
  levelBar:      document.getElementById('level-bar'),
  presetName:    document.getElementById('preset-name'),
  btnMood:       document.getElementById('btn-mood'),
  btnForceChange: document.getElementById('btn-force-change'),
  complexitySlider: document.getElementById('complexity-slider'),
  complexityVal: document.getElementById('complexity-val'),
  moodStatus:    document.getElementById('mood-status'),
  moodCurrent:   document.getElementById('mood-current'),
  moodFeatures:  document.getElementById('mood-features'),
  moodLog:       document.getElementById('mood-log'),
};

// ─── Pad grid render ──────────────────────────────────────────────────────
// Visual layout: top row = pads 12-15 (keys 1234), bottom = 0-3 (zxcv).
const PAD_VISUAL_ORDER = [12,13,14,15, 8,9,10,11, 4,5,6,7, 0,1,2,3];
const PAD_KEY_LABELS   = ['Z','X','C','V', 'A','S','D','F', 'Q','W','E','R', '1','2','3','4'];

function actionSummary(entry) {
  if (!entry) return '';
  if (entry.trigger !== undefined) {
    const id = typeof entry.trigger === 'string' ? entry.trigger : entry.trigger.id;
    return `▶ ${id}`;
  }
  if (entry.toggle !== undefined)     return `⇄ ${entry.toggle}`;
  if (entry.load   !== undefined)     return `+ ${entry.load}`;
  if (entry.unload !== undefined)     return `− ${entry.unload}`;
  if (entry['preset-next'])           return '⏭ preset';
  if (entry['preset-prev'])           return '⏮ preset';
  if (entry.osc)                      return `osc ${entry.osc.address}`;
  return '?';
}

function renderPadGrid(mapping) {
  if (!els.padGrid) return;
  const padMap = mapping?.pads ?? {};
  els.padGrid.innerHTML = PAD_VISUAL_ORDER.map(idx => {
    const m = padMap[String(idx)];
    const cls = `pad ${m ? 'has-mapping' : ''}`;
    return `
      <div class="${cls}" data-pad-idx="${idx}">
        <div class="pad-stack">
          <span class="pad-action">${m ? actionSummary(m) : '(empty)'}</span>
          <span class="pad-label">${PAD_KEY_LABELS[idx]}</span>
        </div>
      </div>`;
  }).join('');
}

function flashPad(idx) {
  const el = els.padGrid?.querySelector(`[data-pad-idx="${idx}"]`);
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 140);
}

// ─── Mapping engine ────────────────────────────────────────────────────────
// Boot order: server persisted mapping → localStorage cache → built-in default.
// The server-fetch runs async; until it resolves we render with the localStorage
// (or default) so the UI is interactive immediately.
const initialMapping = loadMappingFromStorage();
const engine = createMappingEngine({ mapping: initialMapping });
engine.on((ev) => {
  if (ev.kind === 'pad' && !ev.mapped) {
    console.log(`[controller] pad ${ev.idx} pressed but not mapped`);
  }
  // Operator actions (pad triggers, toggles, preset next/prev, OSC) go into
  // the session record so replay can see what the human did between picks.
  sessionLog({ type: 'action', ...ev });
});

renderPadGrid(initialMapping);
els.mappingEditor.value = JSON.stringify(initialMapping, null, 2);

let lastServerMapping = null;          // last mapping we know the server has

// Pull the persisted mapping right after boot. If absent, leave the cached
// (or default) one alone.
fetch('/mappings').then(r => r.json()).then((res) => {
  if (res?.ok && res.mapping) {
    applyMappingObject(res.mapping, { fromServer: true });
  }
}).catch(() => {});

function applyMappingObject(mapping, { fromServer = false } = {}) {
  if (!mapping || typeof mapping !== 'object' || !mapping.pads) return;
  try { engine.setMapping(mapping); } catch (e) { console.warn(e); return; }
  saveMappingToStorage(mapping);
  renderPadGrid(mapping);
  els.mappingEditor.value = JSON.stringify(mapping, null, 2);
  if (fromServer) {
    lastServerMapping = mapping;
    els.mappingStatus.textContent = `synced from server · ${Object.keys(mapping.pads).length} pad(s)`;
    els.mappingStatus.style.color = '#0ff';
  }
}

// ─── Pad controller (keyboard) + click on the visual grid ─────────────────
createPadController({
  onPadPress(idx, vel, source) {
    flashPad(idx);
    engine.onPadPress(idx, vel, source);
  },
});

els.padGrid?.addEventListener('click', (e) => {
  const padEl = e.target.closest('.pad');
  if (!padEl) return;
  const idx = Number(padEl.dataset.padIdx);
  if (Number.isNaN(idx)) return;
  flashPad(idx);
  engine.onPadPress(idx, 1.0, 'click');
});

// ─── Mapping editor ────────────────────────────────────────────────────────
async function applyMappingFromEditor() {
  const text = els.mappingEditor.value;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    els.mappingStatus.textContent = `invalid JSON: ${e.message}`;
    els.mappingStatus.style.color = '#ff3d7f';
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.pads) {
    els.mappingStatus.textContent = 'mapping must have a "pads" object';
    els.mappingStatus.style.color = '#ff3d7f';
    return false;
  }
  try {
    engine.setMapping(parsed);
    saveMappingToStorage(parsed);
    renderPadGrid(parsed);
  } catch (e) {
    els.mappingStatus.textContent = `error: ${e.message}`;
    els.mappingStatus.style.color = '#ff3d7f';
    return false;
  }
  // Push to server. The server broadcasts mapping-update to all controllers.
  try {
    const r = await fetch('/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parsed),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    lastServerMapping = parsed;
    els.mappingStatus.textContent = `saved to server · ${Object.keys(parsed.pads).length} pad(s)`;
    els.mappingStatus.style.color = '#3dff7f';
  } catch (e) {
    els.mappingStatus.textContent = `saved locally · server offline (${e.message})`;
    els.mappingStatus.style.color = '#ff8c2a';
  }
  return true;
}

els.btnMappingSave?.addEventListener('click', applyMappingFromEditor);
els.btnMappingReset?.addEventListener('click', () => {
  els.mappingEditor.value = JSON.stringify(DEFAULT_MAPPING, null, 2);
  applyMappingFromEditor();
});

// ─── Render-output panel ───────────────────────────────────────────────────
// Bg/Fg/Device/Preset all live in this controller window. Commands go to the
// render window over WS via the server's browser-to-browser relay; state
// flows back via render-state broadcasts.
let renderState = {
  bgOn: true, fgOn: true, devices: [], currentDeviceId: null,
  // legacy aggregates
  level: 0, bass: 0, mid: 0, treble: 0, centroid: 0, beatsPerSec: 0,
  // wide feature set (added in A+B for richer mood classification)
  bands: null, rolloff: 0, flatness: 0, crest: 0, flux: 0, bpm: 0,
  preset: null, audioReady: false,
};
// Rolling buffer of recent render-state samples — used to compute window
// statistics (mean / max / variance / dynamic range) for mood classification
// instead of relying on the single instantaneous reading at poll time.
const featureBuffer = [];        // {t, level, bass, mid, treble, centroid, beatsPerSec, bands, rolloff, flatness, crest, flux, bpm}
const FEATURE_WINDOW_MS = 8000;
let lastDeviceListHash = '';
let userPickingDevice = false;       // suppress refresh while dropdown is open

els.btnPresetPrev?.addEventListener('click', () => engine.dispatchAction({ 'preset-prev': true }));
els.btnPresetNext?.addEventListener('click', () => engine.dispatchAction({ 'preset-next': true }));

els.btnBg?.addEventListener('click', () => {
  const next = !renderState.bgOn;
  ws.send({ type: 'set-bg', on: next });
  // optimistic toggle so the UI feels responsive even before state echoes back
  renderState.bgOn = next;
  applyRenderStateUi();
});
els.btnFg?.addEventListener('click', () => {
  const next = !renderState.fgOn;
  ws.send({ type: 'set-fg', on: next });
  renderState.fgOn = next;
  applyRenderStateUi();
});
els.devicePick?.addEventListener('change', () => {
  const id = els.devicePick.value;
  if (!id) return;
  ws.send({ type: 'set-device', deviceId: id });
  renderState.currentDeviceId = id;
});
els.devicePick?.addEventListener('focus',  () => { userPickingDevice = true;  });
els.devicePick?.addEventListener('blur',   () => { userPickingDevice = false; });

let renderUiTimer = null;
function scheduleRenderUiUpdate() {
  if (renderUiTimer) return;
  renderUiTimer = setTimeout(() => {
    renderUiTimer = null;
    applyRenderStateUi();
    if (els.moodFeatures) {
      const f = (n) => n.toFixed(2).padStart(4, ' ');
      const bps = renderState.beatsPerSec.toFixed(1);
      els.moodFeatures.textContent =
        `level ${f(renderState.level)} · bass ${f(renderState.bass)} · mid ${f(renderState.mid)} · treble ${f(renderState.treble)} · bright ${f(renderState.centroid)} · ${bps} bps`;
    }
  }, 250);
}

function applyRenderStateUi() {
  els.btnBg.classList.toggle('on', renderState.bgOn);
  els.btnFg.classList.toggle('on', renderState.fgOn);
  els.levelBar.style.width = (renderState.level * 100).toFixed(0) + '%';
  els.presetName.textContent = renderState.preset ?? '—';

  // Refresh device list only when its structure changes (otherwise we'd
  // clobber the user's mid-selection).
  const hash = renderState.devices.map(d => `${d.deviceId}:${d.label}`).join('|');
  if (!userPickingDevice && hash !== lastDeviceListHash) {
    lastDeviceListHash = hash;
    els.devicePick.innerHTML = renderState.devices
      .map(d => `<option value="${d.deviceId}">${d.label}</option>`).join('') || '<option>—</option>';
    els.devicePick.disabled = renderState.devices.length === 0;
    if (renderState.currentDeviceId) els.devicePick.value = renderState.currentDeviceId;
  }

  els.renderStatus.textContent = renderState.audioReady
    ? `● render output live · ${renderState.modules?.length ?? 0} module(s) loaded`
    : '○ click "Start" on the render window to begin';
}
applyRenderStateUi();

// ─── Modules pane — per-module JSON editor + trigger / apply OSC ──────────
//
// Sources of truth — two streams merge here:
//   - module-load / module-unload / module-enable  (over WS)
//     → which modules exist + on/off state. Available immediately, no Start needed.
//   - render-state.modules (over WS, 10 Hz)
//     → enriches each row with defaults, params, lifecycle, activeInstances.
//     Until render-state arrives, the row still works with an empty textarea.
//
// Each row has:
//   - id + prefix + kind + state badge
//   - JSON textarea (pre-filled with defaults once they arrive)
//   - Trigger ▶ (only for triggerable/multi-instance) — fires with parsed args
//   - Apply OSC — POSTs each key/value as /<prefix>/<key>
//   - Reset — reverts textarea to last-known defaults
//   - on/off · ×
//
// Per-row textarea content lives in a Map so 250ms re-renders don't clobber typing.
const mirroredModules = new Map();   // id -> { enabled, defaults?, params?, interfaces?, lifecycle?, activeInstances?, prefix? }
const moduleEditor    = new Map();   // id -> { text, status }
let modulesStructHash = '';

function ensureEditor(id, defaults) {
  let e = moduleEditor.get(id);
  if (!e) {
    e = { text: JSON.stringify(defaults ?? {}, null, 2), status: '' };
    moduleEditor.set(id, e);
  } else if (e.text === '{}' && defaults && Object.keys(defaults).length) {
    // Hydrate the textarea once real defaults arrive from render-state.
    e.text = JSON.stringify(defaults, null, 2);
  }
  return e;
}

function moduleKind(m) {
  const i = m.interfaces ?? [];
  if (i.includes('multi-instance')) return 'multi-instance';
  return i.includes('triggerable') ? 'triggerable' : 'permanent';
}
function moduleBadge(m) {
  const i = m.interfaces ?? [];
  if (i.includes('multi-instance')) return `× ${m.activeInstances ?? 0}`;
  if (!i.includes('triggerable'))   return '●';
  const s = m.lifecycle?.state ?? 'active';
  return s === 'idle' ? '○' : s[0].toUpperCase() + s.slice(1);
}
function isTriggerKind(m) {
  const i = m.interfaces ?? [];
  return i.includes('triggerable') || i.includes('multi-instance');
}

function refreshModulesList() {
  if (!els.modulesList) return;
  const list = [...mirroredModules.entries()].map(([id, m]) => ({ id, ...m }));
  for (const m of list) ensureEditor(m.id, m.defaults);

  // Structural hash: rebuild markup only when ids / interfaces / enabled change.
  // Lifecycle state + activeInstances are updated in-place to avoid teardown.
  const hash = list.map(m => `${m.id}:${(m.interfaces ?? []).join(',')}:${m.enabled ? 1 : 0}`).join('|');
  if (hash !== modulesStructHash) {
    modulesStructHash = hash;
    if (!list.length) {
      els.modulesList.innerHTML = '<div class="status">no modules loaded — POST /browser-modules/load to add one</div>';
      return;
    }
    els.modulesList.innerHTML = list.map((m) => {
      const e = moduleEditor.get(m.id);
      const showTrigger = isTriggerKind(m);
      return `
        <div class="module-row module-test-row ${m.enabled ? '' : 'disabled'}" data-mod-row="${m.id}">
          <div class="module-header">
            <div class="module-id">
              <strong>${m.id}</strong>
              <span class="status" style="font-size:0.65rem;">/${m.prefix ?? '?'}/  ·  ${moduleKind(m)}  ·  <span class="mod-state-badge">${moduleBadge(m)}</span></span>
            </div>
            <div class="row" style="gap:4px;">
              <button class="mod-btn" data-act="toggle" data-id="${m.id}">${m.enabled ? 'on' : 'off'}</button>
              <button class="mod-btn" data-act="unload" data-id="${m.id}">×</button>
            </div>
          </div>
          <textarea class="module-json" data-mod-json="${m.id}" spellcheck="false">${e.text.replace(/</g, '&lt;')}</textarea>
          <div class="row" style="gap:4px;">
            ${showTrigger ? `<button class="mod-btn mod-trigger" data-act="trigger" data-id="${m.id}">Trigger ▶</button>` : ''}
            <button class="mod-btn" data-act="apply-osc" data-id="${m.id}">Apply OSC</button>
            <button class="mod-btn" data-act="reset"     data-id="${m.id}">Reset</button>
            <span class="mod-status" data-mod-status="${m.id}" style="font-size:0.65rem; color:#888;">${e.status}</span>
          </div>
        </div>`;
    }).join('');
    return;
  }

  // Structure stable — refresh in-place: state badge, toggle text, hydrate
  // textarea if defaults just arrived for a row that opened empty.
  for (const m of list) {
    const badge = els.modulesList.querySelector(`[data-mod-row="${m.id}"] .mod-state-badge`);
    if (badge) badge.textContent = moduleBadge(m);
    const tog = els.modulesList.querySelector(`[data-mod-row="${m.id}"] [data-act="toggle"]`);
    if (tog && tog.textContent !== (m.enabled ? 'on' : 'off')) tog.textContent = m.enabled ? 'on' : 'off';
    const ta = els.modulesList.querySelector(`[data-mod-json="${m.id}"]`);
    const e  = moduleEditor.get(m.id);
    if (ta && e && document.activeElement !== ta && ta.value !== e.text) ta.value = e.text;
  }
}
setInterval(refreshModulesList, 250);

// Preserve textarea content across re-renders
els.modulesList?.addEventListener('input', (e) => {
  const ta = e.target.closest('.module-json');
  if (!ta) return;
  const ed = moduleEditor.get(ta.dataset.modJson);
  if (ed) ed.text = ta.value;
});

function setModStatus(id, text, color = '#888') {
  const e = moduleEditor.get(id);
  if (e) e.status = text;
  const el = els.modulesList.querySelector(`[data-mod-status="${id}"]`);
  if (el) { el.textContent = text; el.style.color = color; }
}

async function applyOscFromJson(id, prefix, parsed) {
  const entries = Object.entries(parsed ?? {});
  if (!entries.length) { setModStatus(id, 'nothing to apply', '#ff8c2a'); return; }
  let ok = 0;
  for (const [k, v] of entries) {
    try {
      await engine.dispatchAction({ osc: { address: `/${prefix}/${k}`, value: v } });
      ok++;
    } catch (err) { console.warn('[osc]', k, err); }
  }
  setModStatus(id, `applied ${ok}/${entries.length} OSC`, ok === entries.length ? '#3dff7f' : '#ff8c2a');
}

els.modulesList?.addEventListener('click', async (e) => {
  const btn = e.target.closest('.mod-btn');
  if (!btn) return;
  const { act, id } = btn.dataset;
  const m   = mirroredModules.get(id);
  const ed  = moduleEditor.get(id);
  if (!m || !ed) return;

  if (act === 'toggle')  { engine.dispatchAction({ toggle: id }); return; }
  if (act === 'unload')  { engine.dispatchAction({ unload: id }); moduleEditor.delete(id); return; }
  if (act === 'reset')   {
    ed.text = JSON.stringify(m.defaults ?? {}, null, 2);
    const ta = els.modulesList.querySelector(`[data-mod-json="${id}"]`);
    if (ta) ta.value = ed.text;
    setModStatus(id, 'reset to defaults', '#0ff');
    return;
  }

  let parsed;
  try { parsed = ed.text.trim() ? JSON.parse(ed.text) : {}; }
  catch (err) { setModStatus(id, `invalid JSON: ${err.message}`, '#ff3d7f'); return; }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    setModStatus(id, 'JSON must be an object', '#ff3d7f');
    return;
  }

  if (act === 'trigger') {
    try {
      await engine.dispatchAction({ trigger: id, args: parsed });
      setModStatus(id, 'triggered', '#3dff7f');
    } catch (err) { setModStatus(id, `trigger failed: ${err.message}`, '#ff3d7f'); }
    return;
  }
  if (act === 'apply-osc') {
    await applyOscFromJson(id, m.prefix ?? id, parsed);
    return;
  }
});

// ─── WS bridge — receive state updates from the server ────────────────────
const ws = createWs({
  url: `ws://${location.host}/ws`,
  onMessage(msg) {
    if (msg.type === 'module-load') {
      if (!mirroredModules.has(msg.id)) mirroredModules.set(msg.id, { enabled: true });
      engine.setEnabled(msg.id, true);
    } else if (msg.type === 'module-unload') {
      mirroredModules.delete(msg.id);
    } else if (msg.type === 'module-enable') {
      const m = mirroredModules.get(msg.id) ?? {};
      m.enabled = !!msg.enabled;
      mirroredModules.set(msg.id, m);
      engine.setEnabled(msg.id, !!msg.enabled);
    } else if (msg.type === 'render-state') {
      renderState = {
        bgOn:           msg.bgOn,
        fgOn:           msg.fgOn,
        level:          msg.level       ?? 0,
        bass:           msg.bass        ?? 0,
        mid:            msg.mid         ?? 0,
        treble:         msg.treble      ?? 0,
        centroid:       msg.centroid    ?? 0,
        beatsPerSec:    msg.beatsPerSec ?? 0,
        bands:          msg.bands       ?? null,
        rolloff:        msg.rolloff     ?? 0,
        flatness:       msg.flatness    ?? 0,
        crest:          msg.crest       ?? 0,
        flux:           msg.flux        ?? 0,
        bpm:            msg.bpm         ?? 0,
        preset:         msg.preset,
        audioReady:     msg.audioReady,
        devices:        msg.devices ?? [],
        currentDeviceId: msg.currentDeviceId,
        modules:        msg.modules ?? [],
      };
      // push into the rolling sample buffer (every feature we'll compute stats over)
      const now = performance.now();
      featureBuffer.push({
        t: now,
        level: renderState.level, bass: renderState.bass, mid: renderState.mid, treble: renderState.treble,
        centroid: renderState.centroid, beatsPerSec: renderState.beatsPerSec,
        bands: renderState.bands, rolloff: renderState.rolloff, flatness: renderState.flatness,
        crest: renderState.crest, flux: renderState.flux, bpm: renderState.bpm,
      });
      while (featureBuffer.length && now - featureBuffer[0].t > FEATURE_WINDOW_MS) featureBuffer.shift();
      // Enrich mirroredModules with defaults/params/lifecycle so the JSON
      // test pane can show real values. Render is the only place that knows
      // each module's defaults (loaded via dynamic import there).
      for (const rm of renderState.modules) {
        const existing = mirroredModules.get(rm.id) ?? {};
        mirroredModules.set(rm.id, {
          ...existing,
          enabled:         rm.enabled,
          prefix:          rm.prefix,
          interfaces:      rm.interfaces,
          defaults:        rm.defaults  ?? existing.defaults,
          params:          rm.params    ?? existing.params,
          lifecycle:       rm.lifecycle ?? existing.lifecycle,
          activeInstances: rm.activeInstances ?? existing.activeInstances,
        });
      }
      // throttle to ~4 Hz — render broadcasts at 10 Hz and updating the UI
      // every frame was causing visible flicker on the level bar + text
      scheduleRenderUiUpdate();
    } else if (msg.type === 'mapping-update') {
      // Server pushed a mapping — apply unless it's exactly the one we just
      // wrote (avoid clobbering whatever the user is mid-typing).
      const same = lastServerMapping &&
        JSON.stringify(lastServerMapping) === JSON.stringify(msg.mapping);
      if (!same) applyMappingObject(msg.mapping, { fromServer: true });
    }
  },
});

// Initial state on boot — also fetch enabled-state map to seed toggles correctly.
fetch('/browser-modules/enabled-state').then(r => r.json()).then((state) => {
  for (const [id, enabled] of Object.entries(state)) engine.setEnabled(id, !!enabled);
}).catch(() => {});

setInterval(() => {
  els.wsStatus.textContent = ws.alive ? '● controller connected' : '○ controller offline';
}, 1000);

// ─── Director ─────────────────────────────────────────────────────────────
// Replaces the fixed-vocabulary mood classifier. Architecture:
//   1. Every 4s while running, compute window stats from the rolling feature
//      buffer (same as before).
//   2. Compare current profile to the ANCHOR profile (snapshot from the last
//      time the visuals changed). Compute a normalised Euclidean distance over
//      the most discriminative features (bands, brightness, BPM, dynamics).
//   3. When distance > CHANGE_THRESHOLD AND cooldown (MIN_CHANGE_INTERVAL_MS)
//      has elapsed since the last director call, fire /director.
//   4. /director (qwen3:8b) reads prev + current profiles + preset catalogue
//      and returns {description, preset, filter:{hue,sat,bright}}.
//   5. Apply preset (load-preset-by-name) + filter (set-filter). Update anchor.
//
// First poll after Start always fires unconditionally to set initial visuals.
// Force-Change button fires immediately, ignoring cooldown.

const CHANGE_THRESHOLD       = 0.16;     // 0..1 normalised distance to trigger
const MIN_CHANGE_INTERVAL_MS = 25_000;   // hard cooldown between director calls
const POLL_INTERVAL_MS       = 4_000;    // sample + compare every 4s
const RECENT_PRESET_KEEP     = 8;        // anti-repeat memory
const DIRECTOR_HISTORY_N     = 3;        // decisions the memory prompt sees
const CATALOGUE_WINDOW       = 60;       // presets per director prompt

let directorTimer    = null;
let directorActive   = false;
let anchorProfile    = null;             // last window stats snapshot when we updated visuals
let lastChangeMs     = 0;
let lastPreset       = null;             // last preset name we asked render to load
let recentPresetSlugs = [];              // sliding window of recent picks (for /director)
let directorHistory  = [];               // last N {profile, preset, filter} for the memory prompt

// ─── Session recording ────────────────────────────────────────────────────
// While Auto-Director runs, every director decision, hold tick, and operator
// action is appended (fire-and-forget) to sessions/<id>.jsonl on the server,
// for offline evaluation via `node tools/replay.mjs`.
let sessionId = null;

function sessionLog(event) {
  if (!sessionId) return;
  fetch('/session/append', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: sessionId, event: { t: Date.now(), ...event } }),
  }).catch(() => {});   // recording must never break the live path
}
const COMPLEXITY_LABELS = {
  1: '1 / minimalist',
  2: '2 / simple',
  3: '3 / balanced',
  4: '4 / busy',
  5: '5 / chaotic ok',
};
function getMaxComplexity() {
  return els.complexitySlider ? Number(els.complexitySlider.value) : 5;
}
els.complexitySlider?.addEventListener('input', () => {
  const v = getMaxComplexity();
  if (els.complexityVal) els.complexityVal.textContent = COMPLEXITY_LABELS[v] ?? String(v);
});

function appendMoodLog(headline, tag, line, kind = 'normal') {
  if (!els.moodLog) return;
  if (els.moodLog.querySelector('.status')) els.moodLog.innerHTML = '';
  const ts  = new Date().toLocaleTimeString();
  const row = document.createElement('div');
  const cls = kind === 'commit' ? 'commit' : (kind === 'same' ? 'same' : '');
  row.className = `log-row ${cls}`;
  row.innerHTML =
    `${ts}  <span class="mood-tag">${String(headline).padEnd(7).slice(0, 7)}</span>  ` +
    `<span class="rule-tag">${String(tag ?? '?').padEnd(34).slice(0, 34)}</span>  ${line}`;
  els.moodLog.appendChild(row);
  while (els.moodLog.children.length > 8) els.moodLog.removeChild(els.moodLog.firstChild);
  els.moodLog.scrollTop = els.moodLog.scrollHeight;
}

// Distance between two profile snapshots. Each feature contributes a squared
// delta; we average and sqrt for a [0,1]-ish scale. BPM and crest are weighted
// because tempo/punchiness shifts are the strongest "this is a different track"
// signal in a DJ set.
const DISTANCE_FEATURES = [
  ['mean_b_sub',      1.0],
  ['mean_b_kick',     1.0],
  ['mean_b_low',      1.0],
  ['mean_b_lowMid',   1.0],
  ['mean_b_mid',      1.0],
  ['mean_b_upperMid', 1.0],
  ['mean_b_presence', 1.0],
  ['mean_b_air',      1.0],
  ['mean_centroid',   1.5],
  ['mean_rolloff',    1.5],
  ['mean_flatness',   1.0],
  ['mean_crest',      1.0],
  ['mean_flux',       1.0],
  ['dynRange',        1.0],
];
function profileDistance(curr, anchor) {
  if (!anchor || !curr) return Infinity;
  let sumSq = 0, sumW = 0;
  for (const [k, w] of DISTANCE_FEATURES) {
    const d = (curr[k] ?? 0) - (anchor[k] ?? 0);
    sumSq += w * d * d;
    sumW  += w;
  }
  // BPM gets special normalisation (typical range 0..200, weight 3)
  const bpmDelta = ((curr.mean_bpm ?? 0) - (anchor.mean_bpm ?? 0)) / 200;
  sumSq += 3 * bpmDelta * bpmDelta;
  sumW  += 3;
  return Math.sqrt(sumSq / sumW);
}

// Recent peak that persists across polls — rises instantly, decays ~5% per
// poll (~half-life ≈ 13 polls ≈ 100s at 8s interval). Prevents brief quiet
// passages in a song from losing the gain calibration the rest of the track
// needs.
let recentGlobalPeak = 0;

const BAND_NAMES = ['sub', 'kick', 'low', 'lowMid', 'mid', 'upperMid', 'presence', 'air'];

function computeWindowStats() {
  if (!featureBuffer.length) return null;
  // Energy-class features auto-gain to recent peak. Others stay absolute.
  const energyKeys = ['level', 'bass', 'mid', 'treble',
                      ...BAND_NAMES.map(b => 'b_' + b)];
  const otherKeys  = ['centroid', 'rolloff', 'flatness', 'crest', 'flux', 'bpm', 'beatsPerSec'];
  const allKeys    = [...energyKeys, ...otherKeys];

  const sums = {}, maxes = {}, mins = {}, sumSq = {};
  for (const k of allKeys) { sums[k] = 0; maxes[k] = -Infinity; mins[k] = Infinity; sumSq[k] = 0; }

  for (const s of featureBuffer) {
    // flatten s.bands.<name> into b_<name>
    for (const k of allKeys) {
      let v;
      if (k.startsWith('b_')) v = s.bands?.[k.slice(2)] ?? 0;
      else                     v = s[k] ?? 0;
      sums[k]  += v;
      sumSq[k] += v * v;
      if (v > maxes[k]) maxes[k] = v;
      if (v < mins[k])  mins[k]  = v;
    }
  }

  const n = featureBuffer.length;
  const out = { samples: n };
  for (const k of allKeys) {
    const mean = sums[k] / n;
    out[`mean_${k}`] = mean;
    out[`max_${k}`]  = maxes[k];
    out[`min_${k}`]  = mins[k];
  }

  // Raw window peak — max across ALL energy bands (both legacy + narrow).
  let rawWindowPeak = 0;
  for (const k of energyKeys) if (out[`max_${k}`] > rawWindowPeak) rawWindowPeak = out[`max_${k}`];
  recentGlobalPeak = Math.max(recentGlobalPeak * 0.95, rawWindowPeak);

  // Auto-gain: scale all energy features against the sticky recent peak.
  const peak = Math.max(0.05, recentGlobalPeak);
  for (const k of energyKeys) {
    out[`mean_${k}`] = Math.min(1, out[`mean_${k}`] / peak);
    out[`max_${k}`]  = Math.min(1, out[`max_${k}`]  / peak);
    out[`min_${k}`]  = Math.min(1, out[`min_${k}`]  / peak);
  }

  out.dynRange    = Math.max(0, out.max_level - out.min_level);
  out.rawPeak     = rawWindowPeak;
  out.gainDivisor = peak;
  return out;
}

async function callDirector(stats, { force = false, reason = '' } = {}) {
  try {
    const t0 = performance.now();
    els.moodStatus.textContent = `director thinking…${force ? ' (forced)' : ''}`;
    const body = {
      current: stats,
      prev: anchorProfile,
      recent: recentPresetSlugs,           // anti-repeat
      max_complexity: getMaxComplexity(),  // operator-set ceiling
      history: directorHistory,            // last N picks for the memory prompt
      catalogue_window: CATALOGUE_WINDOW,
    };
    const r = await fetch('/director', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await r.json();
    const ms = Math.round(performance.now() - t0);
    if (!json.ok) {
      els.moodStatus.textContent = `director error: ${json.error ?? 'unknown'}`;
      console.warn('[director] error', json);
      sessionLog({ type: 'director-error', force, reason, error: json.error ?? 'unknown', ms });
      return;
    }
    sessionLog({
      type: 'director',
      force, reason,
      stats,                              // the feature window that fired this
      request: body,
      response: {
        raw:         json.raw,
        preset:      json.preset,
        preset_slug: json.preset_slug,
        description: json.description,
        filter:      json.filter,
        llm_ms:      json.ms,
      },
      ms,                                 // round-trip incl. HTTP
    });
    const presetShort = (json.preset ?? '?').slice(0, 50);
    const filter = json.filter ?? { hue: 0, sat: 1, bright: 1 };
    const filterStr = `hue-rotate(${filter.hue}deg) saturate(${filter.sat}) brightness(${filter.bright})`;
    const f = (n) => (typeof n === 'number' ? n.toFixed(2) : String(n));
    const bpm = (stats.mean_bpm ?? 0).toFixed(0);
    const line =
      `${force ? '[forced] ' : reason ? `[${reason}] ` : ''}` +
      `lvl ${f(stats.mean_level)} bri ${f(stats.mean_centroid)} bpm ${bpm} flux ${f(stats.mean_flux)} crest ${f(stats.mean_crest)} · ${ms}ms` +
      ` · ≤c${getMaxComplexity()} · ${filterStr}`;
    appendMoodLog('change', presetShort, line, 'commit');
    if (els.moodCurrent) els.moodCurrent.textContent = presetShort;
    els.moodStatus.textContent = `${ms}ms · ${json.description ?? presetShort}`;
    console.log(`[director] → ${json.preset}`, { description: json.description, filter, stats, response: json });

    // Apply visuals
    ws.send({ type: 'load-preset-by-name', name: json.preset, blendSec: 2.0 });
    ws.send({ type: 'set-filter', filter: filterStr });
    lastPreset    = json.preset;
    anchorProfile = stats;
    lastChangeMs  = performance.now();
    // Track recent slug — sliding window of N
    if (json.preset_slug) {
      recentPresetSlugs.push(json.preset_slug);
      if (recentPresetSlugs.length > RECENT_PRESET_KEEP) recentPresetSlugs.shift();
    }
    // Remember the decision for the memory prompt (last N, oldest first)
    directorHistory.push({ profile: stats, preset: json.preset, filter });
    if (directorHistory.length > DIRECTOR_HISTORY_N) directorHistory.shift();
  } catch (e) {
    els.moodStatus.textContent = `director fetch failed: ${e.message}`;
    console.warn('[director] fetch failed', e);
  }
}

async function directorTick() {
  const stats = computeWindowStats();
  if (!stats) { els.moodStatus.textContent = 'no audio samples yet — start the render window'; return; }

  // First poll after Start — set initial visuals unconditionally.
  if (!anchorProfile) {
    await callDirector(stats, { reason: 'initial' });
    return;
  }

  const dist = profileDistance(stats, anchorProfile);
  const sinceLast = performance.now() - lastChangeMs;
  const cooldownLeft = Math.max(0, MIN_CHANGE_INTERVAL_MS - sinceLast);

  // Lightweight idle log so the operator sees the system is actually checking.
  const f = (n) => (typeof n === 'number' ? n.toFixed(2) : String(n));
  const bpm = (stats.mean_bpm ?? 0).toFixed(0);
  const idleLine =
    `dist ${dist.toFixed(3)} (thr ${CHANGE_THRESHOLD}) · cd ${(cooldownLeft / 1000).toFixed(0)}s · ` +
    `lvl ${f(stats.mean_level)} bri ${f(stats.mean_centroid)} bpm ${bpm} pk ${f(stats.rawPeak)}`;

  if (dist > CHANGE_THRESHOLD && cooldownLeft === 0) {
    await callDirector(stats, { reason: `dist ${dist.toFixed(2)}` });
  } else {
    const why = dist <= CHANGE_THRESHOLD ? 'stable' : `cooldown ${(cooldownLeft / 1000).toFixed(0)}s`;
    appendMoodLog('hold', why, idleLine, 'same');
    els.moodStatus.textContent = `${why} · ${idleLine}`;
    sessionLog({ type: 'hold', why, dist, stats });
  }
}

els.btnMood?.addEventListener('click', () => {
  if (directorActive) {
    directorActive = false;
    if (directorTimer) clearInterval(directorTimer);
    directorTimer = null;
    els.btnMood.textContent = 'Start Auto-Director';
    els.btnMood.classList.remove('on');
    els.moodStatus.textContent = 'stopped';
    ws.send({ type: 'set-filter', filter: 'none' });
    anchorProfile = null;
    lastChangeMs  = 0;
    sessionLog({ type: 'session-stop' });
    sessionId = null;
    directorHistory = [];
  } else {
    directorActive = true;
    els.btnMood.textContent = '■ Stop Auto-Director';
    els.btnMood.classList.add('on');
    sessionId = new Date().toISOString().replace(/[:.]/g, '-');
    sessionLog({
      type: 'session-start',
      config: {
        pollMs: POLL_INTERVAL_MS, threshold: CHANGE_THRESHOLD,
        cooldownMs: MIN_CHANGE_INTERVAL_MS, recentKeep: RECENT_PRESET_KEEP,
        historyN: DIRECTOR_HISTORY_N, catalogueWindow: CATALOGUE_WINDOW,
      },
    });
    console.log(`[director] started — session ${sessionId}, sampling every ${POLL_INTERVAL_MS/1000}s, change threshold ${CHANGE_THRESHOLD}, cooldown ${MIN_CHANGE_INTERVAL_MS/1000}s`);
    directorTick();
    directorTimer = setInterval(directorTick, POLL_INTERVAL_MS);
  }
});

// Force-Change button — fires director immediately, ignoring cooldown.
els.btnForceChange?.addEventListener('click', async () => {
  const stats = computeWindowStats();
  if (!stats) { els.moodStatus.textContent = 'no audio samples yet'; return; }
  await callDirector(stats, { force: true });
});
