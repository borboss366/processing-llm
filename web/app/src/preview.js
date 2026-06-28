import p5 from 'p5';
import './style.css';
import { createAudio }       from './core/audio.js';
import { createButterchurn } from './core/butterchurn.js';
import { createRegistry }    from './core/registry.js';
import { createWs }          from './core/ws.js';

// ─── DOM refs ─────────────────────────────────────────────────────────────
const els = {
  bg:            document.getElementById('bg'),
  btnStart:      document.getElementById('btn-start'),
  btnBg:         document.getElementById('btn-bg'),
  btnFg:         document.getElementById('btn-fg'),
  btnPrev:       document.getElementById('btn-prev'),
  btnNext:       document.getElementById('btn-next'),
  btnPromote:    document.getElementById('btn-promote'),
  cueControls:   document.getElementById('cue-controls'),
  devicePick:    document.getElementById('device-pick'),
  status:        document.getElementById('status'),
  presetName:    document.getElementById('preset-name'),
  wsStatus:      document.getElementById('ws-status'),
  levelBar:      document.getElementById('level-bar'),
  modeSelector:  document.getElementById('mode-selector'),
  modeInfo:      document.getElementById('mode-info'),
  modulesList:   document.getElementById('modules-list'),
};

// ─── State ────────────────────────────────────────────────────────────────
const audio   = createAudio();
let visualizer = null;
let registry   = null;
let p5Instance = null;
let bgOn = true, fgOn = true;

// Preview-mode-aware: read initial mode from URL hash, default sandbox
const VALID_MODES = ['sandbox', 'inspector', 'cue'];
let mode = (new URLSearchParams(location.search).get('mode')) || 'sandbox';
if (!VALID_MODES.includes(mode)) mode = 'sandbox';

// Inspector-mode: state mirrored from main via WS (read-only)
const mirrored = {
  modules: [],
  presetName: '—',
};

// ─── Sizing ───────────────────────────────────────────────────────────────
function fitCanvas() {
  els.bg.width  = window.innerWidth;
  els.bg.height = window.innerHeight;
  if (visualizer) visualizer.setSize(window.innerWidth, window.innerHeight);
  if (p5Instance) p5Instance.resizeCanvas(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', fitCanvas);

// ─── p5 instance ─────────────────────────────────────────────────────────
function startP5() {
  p5Instance = new p5((p) => {
    p.setup = () => {
      const cnv = p.createCanvas(window.innerWidth, window.innerHeight);
      cnv.parent('fg-container');
    };
    p.draw = () => {
      p.clear();
      if (!fgOn) return;
      if (registry) registry.drawAll();
      // Inspector overlay: FFT bars + module list
      if (mode === 'inspector') drawInspectorOverlay(p);
    };
  });
  registry = createRegistry({ p: p5Instance, audio });
}

function drawInspectorOverlay(p) {
  // small FFT graph in top-right
  const w = 300, h = 80;
  const x = p.width - w - 20, y = 20;
  p.noFill();
  p.stroke(255, 61, 127, 200);
  p.strokeWeight(1);
  p.rect(x, y, w, h);
  if (audio.analyser) {
    const bins = audio.freqBins;
    p.beginShape();
    const step = w / 64;
    for (let i = 0; i < 64; i++) {
      const v = Math.max(0, Math.min(1, (bins[i] + 80) / 80));
      p.vertex(x + i * step, y + h - v * h);
    }
    p.endShape();
  }
  // beat indicator
  p.noStroke();
  p.fill(audio.state.onBeat ? p.color(255, 61, 127) : p.color(50));
  p.ellipse(x + 10, y + h + 12, 8, 8);
  p.fill(200);
  p.textSize(10);
  p.text('beat', x + 20, y + h + 15);
}

// ─── Audio + Butterchurn boot ─────────────────────────────────────────────
async function startAudio() {
  try {
    els.status.textContent = 'requesting mic…';
    await audio.start();

    await refreshDeviceList();
    els.devicePick.disabled = false;

    fitCanvas();
    visualizer = createButterchurn(els.bg, {
      audioCtx:    audio.audioCtx,
      mediaSource: audio.mediaSource,
    });
    els.presetName.textContent = '▶ ' + visualizer.currentName;

    if (!p5Instance) startP5();
    requestAnimationFrame(renderLoop);

    els.btnStart.disabled = true;
    els.btnStart.textContent = '✓ Audio Live';
    els.status.textContent = `audio live · ${mode} mode`;
  } catch (err) {
    els.status.textContent = 'audio error: ' + err.message;
    console.error(err);
  }
}

async function refreshDeviceList() {
  const inputs = await audio.listDevices();
  els.devicePick.innerHTML = inputs
    .map((d) => `<option value="${d.deviceId}">${d.label || '(unnamed input)'}</option>`)
    .join('');
  const bh = inputs.find((d) => /blackhole/i.test(d.label));
  if (bh) els.devicePick.value = bh.deviceId;
}

// ─── Render loop ──────────────────────────────────────────────────────────
function renderLoop() {
  requestAnimationFrame(renderLoop);
  const a = audio.tick();
  els.levelBar.style.width = (a.smoothedLevel * 100).toFixed(1) + '%';
  if (bgOn && visualizer) visualizer.render();
  refreshModulesList();
}

// ─── Modules list panel ───────────────────────────────────────────────────
// Structure-aware refresh — only rebuild markup when the list changes,
// otherwise just update the lifecycle-state indicator in place. Stops the
// row rebuild from eating the click event mid-stride.
let prevModulesHash = '';

function lcIndicator(m) {
  const ifaces = m.interfaces ?? [];
  if (ifaces.includes('multi-instance')) return `× ${m.activeInstances ?? 0}`;
  if (!ifaces.includes('triggerable')) return '●';
  const state = m.lifecycle?.state ?? 'active';
  return state === 'idle' ? '○' : state[0].toUpperCase() + state.slice(1);
}

function kindLabel(m) {
  const ifaces = m.interfaces ?? [];
  if (ifaces.includes('multi-instance')) return 'multi-instance';
  return ifaces.includes('triggerable') ? 'triggerable' : 'permanent';
}

function refreshModulesList() {
  if (!registry) return;
  const now = performance.now();
  if (now - (refreshModulesList._last ?? 0) < 200) return;
  refreshModulesList._last = now;

  const list = mode === 'inspector' ? mirrored.modules : registry.list();
  const hash = list.map(m => `${m.id}:${(m.interfaces ?? []).join(',')}:${m.enabled ? 1 : 0}`).join('|') + ':' + mode;

  if (hash !== prevModulesHash) {
    prevModulesHash = hash;
    if (!list.length) {
      els.modulesList.innerHTML = '<div class="status">no modules loaded</div>';
      return;
    }
    els.modulesList.innerHTML = list.map((m) => {
      const ifaces = m.interfaces ?? [];
      const triggerable = ifaces.includes('triggerable') || ifaces.includes('multi-instance');
      return `
        <div class="module-row ${m.enabled ? '' : 'disabled'}" data-row-id="${m.id}">
          <div style="flex:1;display:flex;flex-direction:column;gap:2px;">
            <span>${m.id} <span style="color:#444">·  /${m.prefix}/</span></span>
            <span style="font-size:0.6rem;color:#666">${kindLabel(m)} · <span class="lc-indicator">${lcIndicator(m)}</span></span>
          </div>
          ${triggerable && mode !== 'inspector' ? `<button class="trigger-btn" data-id="${m.id}">Trigger ▶</button>` : ''}
        </div>`;
    }).join('');
    return;
  }

  // structure stable — refresh indicator text only
  for (const m of list) {
    const ind = els.modulesList.querySelector(`[data-row-id="${m.id}"] .lc-indicator`);
    if (ind) ind.textContent = lcIndicator(m);
  }
}

// click handler for trigger buttons (delegated)
els.modulesList?.addEventListener('click', (e) => {
  const btn = e.target.closest('.trigger-btn');
  if (!btn || !registry) return;
  registry.fireTrigger(btn.dataset.id);
});

// ─── Mode switching ───────────────────────────────────────────────────────
function setMode(newMode) {
  if (!VALID_MODES.includes(newMode)) return;
  mode = newMode;
  document.title = `VJ · Preview · ${mode}`;
  for (const btn of els.modeSelector.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  }
  els.cueControls.style.display = mode === 'cue' ? 'flex' : 'none';
  const blurb = {
    sandbox:   'mode: sandbox — independent audio + modules. Generate, preview, discard.',
    inspector: 'mode: inspector — mirroring main\'s state read-only. FFT + module list overlays.',
    cue:       'mode: cue — own state, "Promote to Main" sends modules + preset to the live output.',
  };
  els.modeInfo.textContent = blurb[mode];
  history.replaceState(null, '', `?mode=${mode}`);
}
setMode(mode);

els.modeSelector.addEventListener('click', (e) => {
  const m = e.target.dataset.mode;
  if (m) setMode(m);
});

// ─── UI wiring ────────────────────────────────────────────────────────────
els.btnStart.onclick = startAudio;
els.btnBg.onclick = () => { bgOn = !bgOn; els.btnBg.classList.toggle('on', bgOn); els.bg.classList.toggle('layer-off', !bgOn); };
els.btnFg.onclick = () => { fgOn = !fgOn; els.btnFg.classList.toggle('on', fgOn); };
els.btnNext.onclick = () => { if (visualizer) { visualizer.next(); els.presetName.textContent = '▶ ' + visualizer.currentName; } };
els.btnPrev.onclick = () => { if (visualizer) { visualizer.prev(); els.presetName.textContent = '▶ ' + visualizer.currentName; } };
els.btnPromote.onclick = () => {
  if (mode !== 'cue') return;
  if (!ws.alive) { els.status.textContent = 'controller not connected'; return; }
  // Push every currently-loaded module ID + the current preset to main
  if (registry) for (const m of registry.list()) ws.send({ type: 'module-load', id: m.id });
  if (visualizer) ws.send({ type: 'preset-load', name: visualizer.currentName });
  els.status.textContent = 'promoted ' + registry.size + ' module(s) + preset to main';
};
els.devicePick.addEventListener('change', async () => {
  const id = els.devicePick.value;
  if (!id) return;
  const newSource = await audio.switchDevice(id);
  if (newSource && visualizer) visualizer.reconnect(newSource);
});

// ─── WebSocket: receive broadcasts, send promote actions ──────────────────
const ws = createWs({
  url: `ws://${location.host}/ws`,
  onMessage(msg) {
    // Sandbox/Cue: ignore main's module events (they should NOT affect preview)
    // Inspector: shadow main's modules and preset state
    if (mode === 'inspector') {
      if (msg.type === 'module-load')   mirrored.modules.push({ id: msg.id, prefix: msg.id, enabled: true });
      if (msg.type === 'module-unload') mirrored.modules = mirrored.modules.filter((m) => m.id !== msg.id);
      if (msg.type === 'module-enable') {
        const m = mirrored.modules.find((m) => m.id === msg.id);
        if (m) m.enabled = msg.enabled;
      }
      if (msg.type === 'preset-load')   mirrored.presetName = msg.name;
    }
  },
});

setInterval(() => {
  els.wsStatus.textContent = ws.alive ? '● controller connected' : '○ controller offline';
}, 1000);
