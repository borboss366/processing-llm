/**
 * Hue-comparison demo — two Butterchurn instances sharing the same audio
 * source and the same preset, with independent CSS filters so you can see
 * exactly what hue-rotate / saturate / brightness do to the rendered output
 * without changing anything inside butterchurn itself.
 */

import butterchurnLib        from 'butterchurn';
import butterchurnPresetsLib from 'butterchurn-presets';
import { createAudio }       from './core/audio.js';

const bcLib = butterchurnLib.default || butterchurnLib;
const ppLib = butterchurnPresetsLib.default || butterchurnPresetsLib;

const els = {
  btnStart:   document.getElementById('btn-start'),
  btnPrev:    document.getElementById('btn-prev'),
  btnNext:    document.getElementById('btn-next'),
  presetPick: document.getElementById('preset-pick'),
  canvasL:    document.getElementById('canvas-left'),
  canvasR:    document.getElementById('canvas-right'),
  hueL:       document.getElementById('hue-left'),
  hueR:       document.getElementById('hue-right'),
  hueLVal:    document.getElementById('hue-left-val'),
  hueRVal:    document.getElementById('hue-right-val'),
  sat:        document.getElementById('sat'),
  satVal:     document.getElementById('sat-val'),
  bright:     document.getElementById('bright'),
  brightVal:  document.getElementById('bright-val'),
  filterL:    document.getElementById('filter-left'),
  filterR:    document.getElementById('filter-right'),
};

const audio = createAudio();
let visL = null, visR = null;
const presets = ppLib.getPresets();
const presetNames = Object.keys(presets).sort((a, b) => a.localeCompare(b));

// Populate preset dropdown; pick a Geiss preset as the default (richer colors)
els.presetPick.innerHTML = presetNames.map(n => `<option value="${n}">${n}</option>`).join('');
const defaultIdx = Math.max(0, presetNames.findIndex(k => /Geiss/.test(k)));
els.presetPick.value = presetNames[defaultIdx];

function fitCanvases() {
  for (const c of [els.canvasL, els.canvasR]) {
    const r = c.getBoundingClientRect();
    c.width  = Math.floor(r.width  * (window.devicePixelRatio || 1));
    c.height = Math.floor(r.height * (window.devicePixelRatio || 1));
  }
  if (visL) visL.setRendererSize(els.canvasL.width, els.canvasL.height);
  if (visR) visR.setRendererSize(els.canvasR.width, els.canvasR.height);
}
window.addEventListener('resize', fitCanvases);

function buildFilter(hue) {
  const s = Number(els.sat.value);
  const b = Number(els.bright.value);
  return `hue-rotate(${hue}deg) saturate(${s.toFixed(2)}) brightness(${b.toFixed(2)})`;
}

function applyFilters() {
  const hL = els.hueL.value, hR = els.hueR.value;
  const fL = buildFilter(hL), fR = buildFilter(hR);
  els.canvasL.style.filter = fL;
  els.canvasR.style.filter = fR;
  els.hueLVal.textContent  = `${hL}°`;
  els.hueRVal.textContent  = `${hR}°`;
  els.satVal.textContent   = Number(els.sat.value).toFixed(2);
  els.brightVal.textContent = Number(els.bright.value).toFixed(2);
  els.filterL.textContent  = fL;
  els.filterR.textContent  = fR;
}
for (const inp of [els.hueL, els.hueR, els.sat, els.bright]) {
  inp.addEventListener('input', applyFilters);
}
applyFilters();

function loadPresetOnBoth(name, blend = 0) {
  const p = presets[name];
  if (!p) return;
  if (visL) visL.loadPreset(p, blend);
  if (visR) visR.loadPreset(p, blend);
}

els.presetPick.addEventListener('change', () => loadPresetOnBoth(els.presetPick.value, 1.2));
els.btnNext.addEventListener('click', () => {
  const i = (presetNames.indexOf(els.presetPick.value) + 1) % presetNames.length;
  els.presetPick.value = presetNames[i];
  loadPresetOnBoth(presetNames[i], 1.2);
});
els.btnPrev.addEventListener('click', () => {
  const i = (presetNames.indexOf(els.presetPick.value) - 1 + presetNames.length) % presetNames.length;
  els.presetPick.value = presetNames[i];
  loadPresetOnBoth(presetNames[i], 1.2);
});

async function startAudio() {
  try {
    els.btnStart.disabled = true;
    els.btnStart.textContent = 'starting…';
    await audio.start();
    fitCanvases();

    const opts = (canvas) => ({
      width:        canvas.width,
      height:       canvas.height,
      pixelRatio:   window.devicePixelRatio || 1,
      textureRatio: 1,
    });
    visL = bcLib.createVisualizer(audio.audioCtx, els.canvasL, opts(els.canvasL));
    visR = bcLib.createVisualizer(audio.audioCtx, els.canvasR, opts(els.canvasR));
    // Both instances share the SAME analyser via the same mediaSource.
    visL.connectAudio(audio.mediaSource);
    visR.connectAudio(audio.mediaSource);

    loadPresetOnBoth(els.presetPick.value, 0);

    els.btnStart.textContent = '✓ live';
    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    els.btnStart.disabled = false;
    els.btnStart.textContent = 'retry';
  }
}
els.btnStart.addEventListener('click', startAudio);

function loop() {
  requestAnimationFrame(loop);
  if (visL) visL.render();
  if (visR) visR.render();
}
