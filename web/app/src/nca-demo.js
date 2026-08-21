/**
 * NCA playground — Mordvintsev's Hexells (self-organising-textures NCA) driven
 * by the app's real audio analysis.
 *
 * Isolated experiment page: it shares core/audio.js and the dev server with the
 * render window but touches neither the registry nor the WS bridge. The param
 * names + mapping shapes below are deliberately module-like so promoting this
 * into loaded-modules/ later is mechanical, not a rewrite.
 *
 * Audio → CA mappings (each 0..1, 0 = off):
 *   beatErase   — on beat, clear a circle at a random spot; the NCA regrows it
 *                 (the "regenerating lizard" effect, free audio-reactivity)
 *   beatSplat   — on beat, paint a *different* model into a circle; textures
 *                 compete at the boundary until the next full morph
 *   fluxToSpeed — spectral flux adds extra sim steps per frame (busy music =
 *                 faster life)
 *   bassToRadius— splat radius scales with smoothed bass
 *   autoSwitchBeats — full-field morph to the next model every N beats
 */
import * as twgl from 'twgl.js';
import { CA } from './nca/hexells/ca.js';
import { createAudio } from './core/audio.js';
import modelsUrl from './nca/hexells/models.json?url';

const $ = (q) => document.querySelector(q);

// model_names carry a training-artifact prefix like "texture/models/…" — noise in the UI
const prettyName = (name) => name.replace(/^texture\/models\//, '');

const els = {
  canvas:     $('#nca-canvas'),
  btnAudio:   $('#btn-audio'),
  devicePick: $('#device-pick'),
  modelPick:  $('#model-pick'),
  btnPrev:    $('#btn-prev'),
  btnNext:    $('#btn-next'),
  btnDisturb: $('#btn-disturb'),
  btnErase:   $('#btn-erase-all'),
  visPick:    $('#vis-pick'),
  modelLabel: $('#model-label'),
  status:     $('#status'),
  beatDot:    $('#beat-dot'),
  bpmLabel:   $('#bpm-label'),
};

const params = {
  stepsPerFrame:   1,
  brushRadius:     16,
  fuzz:            8,
  beatErase:       0.6,
  beatSplat:       0,
  fluxToSpeed:     0.5,
  bassToRadius:    0.5,
  autoSwitchBeats: 0,
};

// ─── State ────────────────────────────────────────────────────────────────
const audio = createAudio();
let audioOn = false;
let ca = null;
let modelNames = [];
let modelId = 149;            // "coral" — the hexells default
let visMode = 'color';
let wasBeat = false;
let beatCount = 0;

const gl = els.canvas.getContext('webgl', { alpha: false });

// ─── Boot ─────────────────────────────────────────────────────────────────
fetch(modelsUrl)
  .then((r) => r.json())
  .then((models) => {
    modelNames = models.model_names;
    ca = new CA(gl, models, [160, 160], null, () => {
      setModel(modelId);
      els.status.textContent = `${modelNames.length} pretrained texture models · b36e1bd`;
    });
    fillModelPicker();
    requestAnimationFrame(render);
  })
  .catch((err) => {
    els.status.textContent = `failed to load models.json: ${err}`;
  });

function fillModelPicker() {
  els.modelPick.innerHTML = '';
  modelNames.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${i} · ${prettyName(name)}`;
    els.modelPick.appendChild(opt);
  });
  els.modelPick.value = modelId;
}

function viewSize() {
  return [els.canvas.clientWidth, els.canvas.clientHeight];
}

function setModel(id) {
  const n = modelNames.length;
  modelId = ((id % n) + n) % n;
  ca.paint(0, 0, -1, modelId);       // repaint whole control field → in-place morph
  ca.disturb();
  els.modelPick.value = modelId;
  els.modelLabel.textContent = prettyName(modelNames[modelId] ?? `#${modelId}`);
}

// ─── Audio ────────────────────────────────────────────────────────────────
async function startAudio() {
  els.btnAudio.disabled = true;
  els.btnAudio.textContent = 'starting…';
  try {
    await audio.start();
    audioOn = true;
    els.btnAudio.textContent = 'audio on';
    els.btnAudio.classList.add('on');
    const inputs = await audio.listDevices();
    els.devicePick.innerHTML = '';
    for (const d of inputs) {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || '(unnamed input)';
      els.devicePick.appendChild(opt);
    }
    // best-effort default: BlackHole loopback if present (same as main.js)
    const bh = inputs.find((d) => /blackhole/i.test(d.label));
    if (bh) {
      els.devicePick.value = bh.deviceId;
      await audio.switchDevice(bh.deviceId);
    }
    els.devicePick.style.display = '';
  } catch (err) {
    console.error(err);
    audioOn = false;
    els.btnAudio.disabled = false;
    els.btnAudio.textContent = 'retry audio';
  }
}

// ─── Beat actions ─────────────────────────────────────────────────────────
function splatRadius(amount) {
  const [w, h] = viewSize();
  const base = Math.min(w, h) * 0.08;
  const bassBoost = 1 + params.bassToRadius * audio.state.smoothedBass * 4;
  return base * (0.5 + amount) * bassBoost;
}

function onBeatActions() {
  const [w, h] = viewSize();
  const rx = () => w * (0.15 + Math.random() * 0.7);
  const ry = () => h * (0.15 + Math.random() * 0.7);

  if (params.beatErase > 0) {
    ca.clearCircle(rx(), ry(), splatRadius(params.beatErase), viewSize());
  }
  if (params.beatSplat > 0) {
    const other = Math.floor(Math.random() * modelNames.length);
    ca.paint(rx(), ry(), splatRadius(params.beatSplat), other, viewSize());
  }
  if (params.autoSwitchBeats > 0 && beatCount % params.autoSwitchBeats === 0) {
    setModel(modelId + 1);
  }
}

// ─── Render loop ──────────────────────────────────────────────────────────
function render() {
  requestAnimationFrame(render);
  if (!ca) return;

  const s = audio.tick();
  if (audioOn) {
    if (s.onBeat && !wasBeat) {
      beatCount++;
      onBeatActions();
      els.beatDot.classList.add('hit');
    } else if (!s.onBeat) {
      els.beatDot.classList.remove('hit');
    }
    wasBeat = s.onBeat;
    updateMeters(s);
  }

  ca.fuzz = params.fuzz;
  const extraSteps = audioOn ? Math.round(Math.min(1, s.flux * 8) * params.fluxToSpeed * 4) : 0;
  const steps = Math.min(params.stepsPerFrame + extraSteps, 8);
  for (let i = 0; i < steps; i++) ca.step();

  const dpr = window.devicePixelRatio || 1;
  const w = Math.round(els.canvas.clientWidth * dpr);
  const h = Math.round(els.canvas.clientHeight * dpr);
  if (els.canvas.width !== w || els.canvas.height !== h) {
    els.canvas.width = w;
    els.canvas.height = h;
  }
  twgl.bindFramebufferInfo(gl);
  ca.draw(viewSize(), visMode);
}

function updateMeters(s) {
  $('#m-bass').style.width   = `${Math.min(1, s.smoothedBass)   * 100}%`;
  $('#m-mid').style.width    = `${Math.min(1, s.smoothedMid)    * 100}%`;
  $('#m-treble').style.width = `${Math.min(1, s.smoothedTreble) * 100}%`;
  $('#m-flux').style.width   = `${Math.min(1, s.flux * 8)       * 100}%`;
  els.bpmLabel.textContent = s.bpm > 30 ? `${Math.round(s.bpm)} bpm` : '— bpm';
}

// ─── Pointer: drag = erase, shift-drag = splat a random other model ──────
function pointerAction(e) {
  if (!ca) return;
  const xy = [e.offsetX, e.offsetY];
  if (e.shiftKey) {
    const other = Math.floor(Math.random() * modelNames.length);
    ca.paint(xy[0], xy[1], params.brushRadius, other, viewSize());
  } else {
    ca.clearCircle(xy[0], xy[1], params.brushRadius, viewSize());
  }
}
els.canvas.addEventListener('mousedown', (e) => { if (e.buttons === 1) pointerAction(e); });
els.canvas.addEventListener('mousemove', (e) => { if (e.buttons === 1) pointerAction(e); });
els.canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const rect = els.canvas.getBoundingClientRect();
  for (const t of e.touches) {
    ca?.clearCircle(t.clientX - rect.left, t.clientY - rect.top, params.brushRadius, viewSize());
  }
}, { passive: false });

// ─── Controls ─────────────────────────────────────────────────────────────
els.btnAudio.addEventListener('click', startAudio);
els.devicePick.addEventListener('change', () => audio.switchDevice(els.devicePick.value));
els.modelPick.addEventListener('change', () => setModel(Number(els.modelPick.value)));
els.btnPrev.addEventListener('click', () => setModel(modelId - 1));
els.btnNext.addEventListener('click', () => setModel(modelId + 1));
els.btnDisturb.addEventListener('click', () => ca?.disturb());
els.btnErase.addEventListener('click', () => ca?.clearCircle(0, 0, -1));
els.visPick.addEventListener('change', () => { visMode = els.visPick.value; });

document.addEventListener('keypress', (e) => {
  if (e.key === 'a') setModel(modelId + 1);
  if (e.key === 'z') setModel(modelId - 1);
});

function bindSlider(id, key, fmt = (v) => v) {
  const input = $(`#${id}`);
  const val = $(`#${id}-val`);
  input.addEventListener('input', () => {
    params[key] = Number(input.value);
    val.textContent = fmt(params[key]);
  });
}
bindSlider('steps', 'stepsPerFrame');
bindSlider('brush', 'brushRadius');
bindSlider('fuzz', 'fuzz');
bindSlider('beat-erase', 'beatErase');
bindSlider('beat-splat', 'beatSplat');
bindSlider('flux-speed', 'fluxToSpeed');
bindSlider('bass-radius', 'bassToRadius');
$('#auto-switch').addEventListener('change', (e) => {
  params.autoSwitchBeats = Number(e.target.value);
});
