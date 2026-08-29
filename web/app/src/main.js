/**
 * Render window — full-screen output, no controls.
 *
 * The user clicks once to grant mic permission; the overlay then vanishes
 * forever and this window is just two stacked canvases (Butterchurn bg + p5 fg).
 *
 * All control comes from the companion controller window (controller.html)
 * via WebSocket. This window:
 *   - broadcasts state (audio level, current preset, layer toggles, device list)
 *     so the controller's read-only displays stay in sync
 *   - listens for commands: set-bg, set-fg, set-device, preset-next, preset-prev,
 *     module-load/unload/enable, trigger
 */

import p5 from 'p5';
import './style.css';
import { createAudio }       from './core/audio.js';
import { createButterchurn } from './core/butterchurn.js';
import { createCompositor }  from './core/compositor.js';
import { createRegistry }    from './core/registry.js';
import { createWs }          from './core/ws.js';

// ─── DOM ───────────────────────────────────────────────────────────────────
const els = {
  bg:           document.getElementById('bg'),
  fgContainer:  document.getElementById('fg-container'),
  startOverlay: document.getElementById('start-overlay'),
  btnStart:     document.getElementById('btn-start'),
  tintOverlay:  document.getElementById('tint-overlay'),
};

// ─── State ────────────────────────────────────────────────────────────────
const audio   = createAudio();
try {
  audio.state.visualBeatOffsetMs = Number(localStorage.getItem('visualBeatOffsetMs')) || 0;
} catch { /* storage unavailable */ }
window.__audio = audio;   // dev/test seam: harnesses sample audio.state via puppeteer

// Dev-only file input: ?audio=file:/music/track.mp3[&seek=120] plays the file
// through the same analyser graph instead of asking for the mic. The /music
// route is served by the controller server from the local (gitignored) dir.
const QUERY = new URLSearchParams(location.search);
const AUDIO_FILE = QUERY.get('audio')?.startsWith('file:')
  ? QUERY.get('audio').slice(5)
  : null;
const AUDIO_SEEK = Number(QUERY.get('seek') ?? 0);
// ?bg=off — boot with Butterchurn dark (clean judging/diagnostic runs):
// deterministic from page load, no WS toggle race, survives per-page resets
const BG_OFF = QUERY.get('bg') === 'off';
// ?clock=pll — force the causal tracker even when a beatgrid sidecar exists
const FORCE_PLL = QUERY.get('clock') === 'pll';

let visualizer = null;
let registry   = null;
let p5Instance = null;
let bgOn = !BG_OFF, fgOn = true;
if (BG_OFF) els.bg.classList.add('layer-off');
let devices = [];
let currentDeviceId = null;

// ─── Sizing ───────────────────────────────────────────────────────────────
function fitCanvas() {
  els.bg.width  = window.innerWidth;
  els.bg.height = window.innerHeight;
  if (visualizer) visualizer.setSize(window.innerWidth, window.innerHeight);
  if (p5Instance) p5Instance.resizeCanvas(window.innerWidth, window.innerHeight);
}
window.addEventListener('resize', fitCanvas);

// ─── p5 boots on page load so the registry can accept WS module-load
//     messages even before the user clicks Start. Audio reactivity is no-op
//     until startAudio() initialises the analyser. ────────────────────────
function startP5() {
  p5Instance = new p5((p) => {
    p.setup = () => {
      const cnv = p.createCanvas(window.innerWidth, window.innerHeight);
      cnv.parent('fg-container');
    };
    p.draw = () => {
      window.__lastP5Draw = performance.now();   // watchdog stamp (brief 13.1)
      p.clear();
      if (!fgOn) return;
      if (registry) registry.drawAll();
    };
  });
  registry = createRegistry({ p: p5Instance, audio });
}
startP5();
// Compositor (brief 10): single WebGL canvas replaces DOM layer stacking —
// integration (bloom, tinted shadow), post, framing. /osc /post/* sets its
// params; post 0 bypasses back to DOM compositing.
const compositor = createCompositor({ audio });
window.__post = compositor;   // dev/test seam, same as window.__audio
requestAnimationFrame(renderLoop);

// ─── Audio + Butterchurn boot (on the one and only Start click) ──────────
async function startAudio() {
  try {
    els.btnStart.disabled = true;
    els.btnStart.textContent = 'starting…';
    if (AUDIO_FILE) {
      const fileInfo = await audio.startFromFile(AUDIO_FILE, { seekSec: AUDIO_SEEK, forcePll: FORCE_PLL });
      ws.send({ type: 'clock-tier', tier: fileInfo.gridLoaded ? 'grid' : 'pll', file: AUDIO_FILE });
    } else {
      await audio.start();
      await refreshDeviceList();
    }
    fitCanvas();
    visualizer = createButterchurn(els.bg, {
      audioCtx:    audio.audioCtx,
      mediaSource: audio.mediaSource,
    });
    // main-thread long tasks block everything driven from rAF — evidence
    // for the music-pause hunt (brief 13 Task 2)
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (e.duration > 200 && audio.state?.audioHealth) {
            audio.state.audioHealth.push({ t: Date.now(), kind: 'long-task', detail: `${Math.round(e.duration)}ms` });
          }
        }
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* observer unsupported — fine */ }
    // keep the display awake during a set: OS display sleep throttles tabs
    try { navigator.wakeLock?.request('screen'); } catch { /* unsupported */ }
    // tab visibility flips are the throttling prime suspect — record them
    document.addEventListener('visibilitychange', () => {
      audio.state?.audioHealth?.push({ t: Date.now(), kind: 'visibility', detail: document.visibilityState });
    });
    // hide the overlay forever
    els.startOverlay.style.display = 'none';
    broadcastState();
  } catch (err) {
    console.error(err);
    els.btnStart.disabled = false;
    els.btnStart.textContent = 'click to retry';
  }
}

async function refreshDeviceList() {
  const inputs = await audio.listDevices();
  devices = inputs.map((d) => ({ deviceId: d.deviceId, label: d.label || '(unnamed input)' }));
  // best-effort default: BlackHole if present
  const bh = devices.find((d) => /blackhole/i.test(d.label));
  if (bh && !currentDeviceId) currentDeviceId = bh.deviceId;
}

async function switchDevice(deviceId) {
  if (!deviceId || deviceId === currentDeviceId) return;
  const newSource = await audio.switchDevice(deviceId);
  currentDeviceId = deviceId;
  if (newSource && visualizer) visualizer.reconnect(newSource);
  broadcastState();
}

// ─── Bar-quantized pick commit ───────────────────────────────────────────
// A director pick ('apply-pick') is not applied on arrival: it commits at
// the next barPhase wrap so preset changes land on phrase boundaries — or
// after ≤4 s when beatConfidence < 0.4 (no trustworthy grid to wait for).
let pendingPick = null;   // { name, blendSec, filter, arrivedMs, lastBarPhase }

function commitPick(reason) {
  const p = pendingPick;
  pendingPick = null;
  if (!p) return;
  if (visualizer) {
    const name = visualizer.loadByName(p.name, p.blendSec ?? 1.5);
    if (!name) console.warn('[main] preset not found:', p.name);
  }
  if (p.filter !== undefined) compositor.setFilter(p.filter || '');
  ws.send({
    type: 'preset-committed',
    name: p.name,
    barPhase: audio.state.barPhase,
    beatConfidence: audio.state.beatConfidence,
    waitedMs: Math.round(performance.now() - p.arrivedMs),
    lowConfidenceFallback: reason === 'low-confidence-timeout',
  });
  broadcastState();
}

function advancePendingPick() {
  if (!pendingPick) return;
  const p = pendingPick;
  const conf = audio.state.beatConfidence;
  const waited = performance.now() - p.arrivedMs;
  const wrapped = audio.state.barPhase < p.lastBarPhase - 0.5;
  p.lastBarPhase = audio.state.barPhase;
  if (conf >= 0.4 && audio.state.bpm > 0) {
    if (wrapped) commitPick('bar-wrap');
    else if (waited > 12_000) commitPick('bar-timeout');   // safety: bpm stalled
  } else if (waited > 4_000) {
    commitPick('low-confidence-timeout');
  }
}

// ─── Render loop (audio analysis + butterchurn) ──────────────────────────
let lastBroadcastMs = 0;
let lastBenchMs = 0;
let lastHealthIdx = 0;
let lastMainTick = 0;
function renderLoop() {
  requestAnimationFrame(renderLoop);
  audio.tick();
  advancePendingPick();
  if (bgOn && visualizer) visualizer.render();
  compositor.tick({ bgOn });

  // broadcast render-state at ~10 Hz so the controller's level bar is smooth
  const now = performance.now();
  if (now - lastBroadcastMs > 100) {
    lastBroadcastMs = now;
    broadcastState();
  }
  // p5-loop watchdog (brief 13.1): p5 runs its OWN rAF — if it dies while
  // this loop (a different rAF) is alive and the page is visible, restart
  // it and shout. This is the "module events stop, audio-health keeps
  // logging" death mode from the live session. Only fire when THIS loop
  // ran continuously through the window — a shared gap (occlusion, long
  // task) freezes both loops and is handled by the resume path, not here.
  const mainGap = now - lastMainTick;
  lastMainTick = now;
  if (document.visibilityState === 'visible' && mainGap < 1000 &&
      window.__lastP5Draw && now - window.__lastP5Draw > 2000) {
    window.__lastP5Draw = now;   // one report per stall
    audio.state?.audioHealth?.push({ t: Date.now(), kind: 'p5-loop-stalled', detail: 'restarting' });
    try { p5Instance?.loop(); } catch { /* p5 gone — the health event is the evidence */ }
  }

  // audio-health forwarding (brief 13 Task 2): new ring entries → WS
  const health = audio.state?.audioHealth ?? [];
  while (health.length && lastHealthIdx < health.length) {
    const h = health[lastHealthIdx++];
    if (ws.alive) ws.send({ type: 'audio-health', ...h });
  }
  if (health.length < lastHealthIdx) lastHealthIdx = health.length;   // ring shifted

  // bench observer feed (brief 12.6) at ~15 Hz — read-only exposure of
  // already-computed audio + creature values, nothing new in the live path
  if (now - lastBenchMs > 66 && ws.alive) {
    lastBenchMs = now;
    const s = audio.state ?? {};
    ws.send({
      type: 'bench-state',
      t: Date.now(),
      beatPhase: s.beatPhase ?? 0,
      barPhase: s.barPhase ?? 0,
      bpm: s.bpm ?? 0,
      beatConfidence: s.beatConfidence ?? 0,
      level: s.smoothedLevel ?? 0,
      flux: s.flux ?? 0,
      centroid: s.smoothedCentroid ?? 0,
      bands: s.bands ?? null,
      tier: s.clockTier ?? 'pll',
      visualOffsetMs: s.visualBeatOffsetMs ?? 0,
      onsets: (s.onsetLog ?? []).slice(-8),
      creature: window.__creatureBench ?? null,
    });
  }
}

// ─── WebSocket bridge ────────────────────────────────────────────────────
const ws = createWs({   // (exposed below as window.__ws for the tools/ harnesses)
  url: `ws://${location.host}/ws`,
  onMessage(msg) {
    if (msg.type === 'osc' && msg.address?.startsWith('/post/')) {
      compositor.setParam(msg.address.slice(6), msg.value);
    } else if (msg.type === 'osc' && registry) {
      registry.dispatchOsc(msg.address, msg.value);
    } else if (msg.type === 'module-load' && registry) {
      registry.load(msg.id, { url: msg.url });
    } else if (msg.type === 'module-unload' && registry) {
      registry.unload(msg.id);
    } else if (msg.type === 'module-enable' && registry) {
      registry.setEnabled(msg.id, msg.enabled);
    } else if (msg.type === 'module-exit' && registry) {
      registry.exitModule(msg.id);
    } else if (msg.type === 'trigger' && registry) {
      registry.fireTrigger(msg.id, msg.args);
    } else if (msg.type === 'preset-next' && visualizer) {
      visualizer.next();
      broadcastState();
    } else if (msg.type === 'preset-prev' && visualizer) {
      visualizer.prev();
      broadcastState();
    } else if (msg.type === 'apply-pick') {
      // Replaces any not-yet-committed pick — only the newest decision counts.
      pendingPick = {
        name: msg.name,
        blendSec: msg.blendSec,
        filter: msg.filter,
        arrivedMs: performance.now(),
        lastBarPhase: audio.state.barPhase,
      };
    } else if (msg.type === 'load-preset-by-name' && visualizer) {
      const name = visualizer.loadByName(msg.name, msg.blendSec ?? 1.5);
      if (!name) console.warn('[main] preset not found:', msg.name);
      broadcastState();
    } else if (msg.type === 'set-bg') {
      bgOn = !!msg.on;
      els.bg.classList.toggle('layer-off', !bgOn);
      broadcastState();
    } else if (msg.type === 'set-fg') {
      fgOn = !!msg.on;
      broadcastState();
    } else if (msg.type === 'set-device') {
      switchDevice(msg.deviceId).catch((e) => console.warn(e));
    } else if (msg.type === 'set-tint') {
      if (els.tintOverlay) {
        els.tintOverlay.style.backgroundColor = msg.color ?? 'transparent';
        els.tintOverlay.style.opacity = msg.opacity ?? 0;
        if (msg.blendMode) els.tintOverlay.style.mixBlendMode = msg.blendMode;
      }
    } else if (msg.type === 'set-filter') {
      // Director colour grade (hue-rotate / saturate / …). With the
      // compositor active it applies to the whole composite — creature
      // included — so the figure shares the scene's grade; on bypass it
      // falls back to the Butterchurn canvas as before.
      compositor.setFilter(msg.filter ?? '');
    } else if (msg.type === 'set-visual-offset') {
      // rhythm-game display-latency calibration (brief 13 Task 6): per
      // machine, persisted on the render side, adjustable from the bench
      const ms = Number(msg.ms) || 0;
      audio.state.visualBeatOffsetMs = ms;
      try { localStorage.setItem('visualBeatOffsetMs', String(ms)); } catch {}
    } else if (msg.type === 'moves-changed') {
      // move workbench (brief 12): the creature polls this seam and
      // re-fetches the changed table in place (validated server-side)
      window.__movesChanged = { name: msg.name, v: msg.v };
    } else if (msg.type === 'request-render-state') {
      broadcastState();
    }
  },
});

window.__ws = ws;   // dev/test seam, same as window.__audio

function broadcastState() {
  if (!ws.alive) return;
  const s = audio.state ?? {};
  ws.send({
    type:       'render-state',
    // legacy aggregates — kept so existing rule classifier still works
    level:      s.smoothedLevel    ?? 0,
    bass:       s.smoothedBass     ?? 0,
    mid:        s.smoothedMid      ?? 0,
    treble:     s.smoothedTreble   ?? 0,
    centroid:   s.smoothedCentroid ?? 0,
    beatsPerSec:s.beatsPerSec      ?? 0,
    // wide feature set — for LLM classifier
    bands:      s.bands            ?? null,
    rolloff:    s.rolloff          ?? 0,
    flatness:   s.flatness         ?? 0,
    crest:      s.crest            ?? 0,
    flux:       s.flux             ?? 0,
    bpm:        s.bpm              ?? 0,
    preset:     visualizer?.currentName ?? null,
    bgOn,
    fgOn,
    audioReady: !!visualizer,
    devices,
    currentDeviceId,
    modules: registry?.list?.() ?? [],
  });
}

els.btnStart.addEventListener('click', () => {
  startAudio().catch((e) => console.error('[main] startAudio failed:', e));
});
