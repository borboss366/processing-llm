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
let renderState = { bgOn: true, fgOn: true, devices: [], currentDeviceId: null, level: 0, bass: 0, mid: 0, treble: 0, centroid: 0, beatsPerSec: 0, preset: null, audioReady: false };
// Rolling buffer of recent render-state samples — used to compute window
// statistics (mean / max / variance / dynamic range) for mood classification
// instead of relying on the single instantaneous reading at poll time.
const featureBuffer = [];        // {t, level, bass, mid, treble, centroid, beatsPerSec}
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
        preset:         msg.preset,
        audioReady:     msg.audioReady,
        devices:        msg.devices ?? [],
        currentDeviceId: msg.currentDeviceId,
        modules:        msg.modules ?? [],
      };
      // push into the rolling sample buffer
      const now = performance.now();
      featureBuffer.push({
        t: now,
        level: renderState.level, bass: renderState.bass, mid: renderState.mid, treble: renderState.treble,
        centroid: renderState.centroid, beatsPerSec: renderState.beatsPerSec,
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

// ─── Auto-Mood ────────────────────────────────────────────────────────────
// Every 5s while on: sample render-state band features, send to /mood/classify
// (qwen2.5:0.5b), apply the mood palette → equalizer OSC colors + render-window
// tint overlay + preset-next to vary the background.
// `filter` is applied to the Butterchurn canvas — hue-rotate spins the entire
// preset palette around the color wheel, saturate/brightness shape its intensity.
const MOOD_PALETTES = {
  hype:    { eqLow: '#ff3d00', eqHigh: '#ffee00', tint: '#ff5500', tintOpacity: 0.18,
             filter: 'hue-rotate(-20deg) saturate(1.4) brightness(1.1) contrast(1.1)' },
  mellow:  { eqLow: '#1e88e5', eqHigh: '#26a69a', tint: '#1976d2', tintOpacity: 0.15,
             filter: 'hue-rotate(180deg) saturate(0.9) brightness(1.0)' },
  dark:    { eqLow: '#6a1b9a', eqHigh: '#311b92', tint: '#1a0033', tintOpacity: 0.25,
             filter: 'hue-rotate(240deg) saturate(1.5) brightness(0.6) contrast(1.2)' },
  dreamy:  { eqLow: '#ec407a', eqHigh: '#7e57c2', tint: '#d81b60', tintOpacity: 0.18,
             filter: 'hue-rotate(290deg) saturate(1.2) brightness(1.05)' },
  punchy:  { eqLow: '#ff6f00', eqHigh: '#ffd600', tint: '#ff9800', tintOpacity: 0.20,
             filter: 'hue-rotate(30deg) saturate(1.5) brightness(1.1) contrast(1.15)' },
  chill:   { eqLow: '#00acc1', eqHigh: '#aed581', tint: '#00838f', tintOpacity: 0.15,
             filter: 'hue-rotate(140deg) saturate(0.7) brightness(0.95)' },
};

let moodTimer       = null;
let moodActive      = false;
let lastMood        = null;          // last APPLIED mood (palette is currently this)
let candidateMood   = null;          // mood proposed by last classify
let candidateStreak = 0;             // how many polls in a row it has held
const HYSTERESIS_POLLS = 2;          // need this many consecutive same-mood reads to commit

function appendMoodLog(mood, rule, line) {
  if (!els.moodLog) return;
  if (els.moodLog.querySelector('.status')) els.moodLog.innerHTML = '';
  const same = mood === lastMood;
  const ts = new Date().toLocaleTimeString();
  const row = document.createElement('div');
  row.className = `log-row${same ? ' same' : ''}`;
  row.innerHTML =
    `${ts}  <span class="mood-tag">${mood.padEnd(7)}</span>  ` +
    `<span class="rule-tag">${(rule ?? '?').padEnd(34)}</span>  ${line}`;
  els.moodLog.appendChild(row);
  // keep only the last 8
  while (els.moodLog.children.length > 8) els.moodLog.removeChild(els.moodLog.firstChild);
  els.moodLog.scrollTop = els.moodLog.scrollHeight;
}

function flagMoodLogCommit() {
  const last = els.moodLog?.lastElementChild;
  if (last) last.classList.add('commit');
}

// Recent peak that persists across polls — rises instantly, decays ~5% per
// poll (~half-life ≈ 13 polls ≈ 100s at 8s interval). Prevents brief quiet
// passages in a song from losing the gain calibration the rest of the track
// needs.
let recentGlobalPeak = 0;

function computeWindowStats() {
  if (!featureBuffer.length) return null;
  const keys = ['level', 'bass', 'mid', 'treble', 'centroid', 'beatsPerSec'];
  const sums = {}, maxes = {}, mins = {}, sumSq = {};
  for (const k of keys) { sums[k] = 0; maxes[k] = -Infinity; mins[k] = Infinity; sumSq[k] = 0; }
  for (const s of featureBuffer) {
    for (const k of keys) {
      const v = s[k] ?? 0;
      sums[k]  += v;
      sumSq[k] += v * v;
      if (v > maxes[k]) maxes[k] = v;
      if (v < mins[k])  mins[k]  = v;
    }
  }
  const n = featureBuffer.length;
  const out = { samples: n };
  for (const k of keys) {
    const mean = sums[k] / n;
    out[`mean_${k}`] = mean;
    out[`max_${k}`]  = maxes[k];
    out[`min_${k}`]  = mins[k];
    out[`var_${k}`]  = Math.max(0, sumSq[k] / n - mean * mean);
  }

  // Raw window peak — max across ALL energy bands. Using only max_level
  // (which is bins 4-64, i.e. mid-range) under-reports sub-bass-heavy music
  // because the bass band lives in bins 0-4 and isn't in level at all.
  // Take the max across level/bass/mid/treble so sub-bass DJ sets aren't
  // mistakenly classified as silent.
  const rawWindowPeak = Math.max(out.max_level, out.max_bass, out.max_mid, out.max_treble);
  recentGlobalPeak = Math.max(recentGlobalPeak * 0.95, rawWindowPeak);

  // Auto-gain: scale energy features against the recent global peak (sticky)
  // rather than the just-this-window peak. Floor at 0.05 (very quiet but
  // non-silent) so we don't blow up on dead input.
  const peak = Math.max(0.05, recentGlobalPeak);
  for (const k of ['level', 'bass', 'mid', 'treble']) {
    out[`mean_${k}`] = Math.min(1, out[`mean_${k}`] / peak);
    out[`max_${k}`]  = Math.min(1, out[`max_${k}`]  / peak);
    out[`min_${k}`]  = Math.min(1, out[`min_${k}`]  / peak);
  }
  out.dynRange    = Math.max(0, out.max_level - out.min_level);
  out.rawPeak     = rawWindowPeak;       // true peak this window — for silence detection
  out.gainDivisor = peak;                // what we actually divided by
  return out;
}

async function classifyMoodOnce() {
  const stats = computeWindowStats();
  if (!stats) { els.moodStatus.textContent = 'no audio samples yet — start the render window'; return; }
  els.moodStatus.textContent = `sampling… (${stats.samples} frames over ${(FEATURE_WINDOW_MS / 1000).toFixed(0)}s)`;
  try {
    const t0 = performance.now();
    const r = await fetch('/mood/classify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(stats),
    });
    const json = await r.json();
    const ms = Math.round(performance.now() - t0);
    if (!json.ok) { els.moodStatus.textContent = `error: ${json.error ?? 'unknown'}`; return; }

    // Diagnostic: dump features + verdict to both console AND inline UI block
    // so the operator can see why a rule fired without opening DevTools.
    const f = (n) => (typeof n === 'number' ? n.toFixed(2) : String(n));
    const line =
      `lvl ${f(stats.mean_level)} bass ${f(stats.mean_bass)} mid ${f(stats.mean_mid)} ` +
      `tre ${f(stats.mean_treble)} bri ${f(stats.mean_centroid)} bps ${f(stats.mean_beatsPerSec)} ` +
      `dyn ${f(stats.dynRange)} · rawPk ${f(stats.rawPeak)} gain÷${f(stats.gainDivisor)}`;
    console.log(`[mood] → ${json.mood}  | ${line} · ${json.rule ?? '?'}`, { stats, response: json });
    appendMoodLog(json.mood, json.rule, line);

    const mood = json.mood;
    // hysteresis: count consecutive same-mood reads before committing
    if (mood === candidateMood) candidateStreak++;
    else { candidateMood = mood; candidateStreak = 1; }

    const committing = candidateStreak >= HYSTERESIS_POLLS && mood !== lastMood;
    els.moodStatus.textContent = committing
      ? `${ms}ms · committing → ${mood}`
      : `${ms}ms · ${mood} (${candidateStreak}/${HYSTERESIS_POLLS}${mood === lastMood ? ' · same as current' : ''})`;

    if (committing) {
      lastMood = mood;
      els.moodCurrent.textContent = mood;
      flagMoodLogCommit();
      applyMoodPalette(mood);
    }
  } catch (e) {
    els.moodStatus.textContent = `fetch failed: ${e.message}`;
  }
}

async function applyMoodPalette(mood) {
  const p = MOOD_PALETTES[mood];
  if (!p) return;
  // Equalizer colors via OSC
  engine.dispatchAction({ osc: { address: '/eq/colorLow',  value: p.eqLow  } });
  engine.dispatchAction({ osc: { address: '/eq/colorHigh', value: p.eqHigh } });
  // CSS filter + tint overlay (both via WS relay)
  ws.send({ type: 'set-filter', filter: p.filter });
  ws.send({ type: 'set-tint',   color: p.tint, opacity: p.tintOpacity });

  // Pick a mood-matching preset via the LLM, fall back to preset-next if the
  // descriptions endpoint isn't populated yet.
  try {
    const r = await fetch('/mood/pick-preset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mood }),
    });
    const j = await r.json();
    if (j.ok && j.preset) {
      ws.send({ type: 'load-preset-by-name', name: j.preset, blendSec: 1.8 });
      if (els.moodStatus) {
        const cur = els.moodStatus.textContent ?? '';
        els.moodStatus.textContent = `${cur} · preset → ${j.preset.slice(0, 40)}`;
      }
      return;
    }
  } catch (e) {
    console.warn('[mood] pick-preset failed', e);
  }
  // fallback: just cycle
  engine.dispatchAction({ 'preset-next': true });
}

// Manual mood selector — clicks one of the mood swatches to apply the palette
// without auto-detection. Useful for verifying each palette looks right.
document.getElementById('mood-manual')?.addEventListener('click', (e) => {
  const btn = e.target.closest('.mood-btn');
  if (!btn) return;
  const mood = btn.dataset.mood;
  // turn off auto if it's running — manual takes over
  if (moodActive) els.btnMood?.click();
  // highlight active swatch
  document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (mood === '_off') {
    lastMood = null;
    els.moodCurrent.textContent = '—';
    els.moodStatus.textContent  = 'manual · off';
    ws.send({ type: 'set-tint',   color: 'transparent', opacity: 0 });
    ws.send({ type: 'set-filter', filter: 'none' });
    return;
  }
  lastMood        = mood;
  candidateMood   = mood;
  candidateStreak = HYSTERESIS_POLLS;          // skip the streak the next auto poll
  els.moodCurrent.textContent = mood;
  els.moodStatus.textContent  = `manual · ${mood}`;
  applyMoodPalette(mood);
});

els.btnMood?.addEventListener('click', () => {
  if (moodActive) {
    moodActive = false;
    if (moodTimer) clearInterval(moodTimer);
    moodTimer = null;
    els.btnMood.textContent = 'Start Auto-Mood';
    els.btnMood.classList.remove('on');
    els.moodStatus.textContent = 'stopped';
    // restore neutral palette
    ws.send({ type: 'set-tint', color: 'transparent', opacity: 0 });
    ws.send({ type: 'set-filter', filter: 'none' });
  } else {
    moodActive = true;
    els.btnMood.textContent = '■ Stop Auto-Mood';
    els.btnMood.classList.add('on');
    console.log('[mood] auto-mood started — polling every 8s (hysteresis=2)');
    classifyMoodOnce();
    // Poll every 8s; combined with HYSTERESIS_POLLS=2 this means a track
    // change in a DJ set needs to stabilise for ~16s before the visuals
    // commit to a new mood. Manual clicks always override instantly.
    moodTimer = setInterval(classifyMoodOnce, 8000);
  }
});
