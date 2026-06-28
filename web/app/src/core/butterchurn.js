/**
 * Butterchurn wrapper — handles UMD shape variance, preset cycling, sizing.
 */

import butterchurnLib from 'butterchurn';
import butterchurnPresetsLib from 'butterchurn-presets';

function pickDefault(mod) { return mod && (mod.default || mod); }

export function createButterchurn(canvas, { audioCtx, mediaSource }) {
  const bcLib = pickDefault(butterchurnLib);
  const ppLib = pickDefault(butterchurnPresetsLib);
  if (!bcLib || !ppLib) {
    throw new Error('butterchurn lib not loaded');
  }

  // Render at native 1x even on Retina + 0.5x intermediate textures. Visual
  // quality is virtually identical (Butterchurn presets are pre-smoothed) but
  // GPU load on Retina drops 4-8x — important when multiple browser
  // composite layers (CSS filter + tint overlay blend modes) stack on top.
  const visualizer = bcLib.createVisualizer(audioCtx, canvas, {
    width:        canvas.clientWidth,
    height:       canvas.clientHeight,
    pixelRatio:   1,
    textureRatio: 0.5,
  });
  visualizer.connectAudio(mediaSource);

  // Blocklist — presets we don't want cycled into. Matches substrings (case
  // insensitive). Add more here to exclude problem-children.
  const PRESET_BLOCKLIST = [
    'idiot - star of annon',
  ];
  function isBlocked(name) {
    const n = name.toLowerCase();
    return PRESET_BLOCKLIST.some(b => n.includes(b));
  }

  const presets = ppLib.getPresets();
  const presetKeys = Object.keys(presets).filter(k => !isBlocked(k));

  let index = presetKeys.findIndex((k) => /Geiss/.test(k));
  if (index < 0) index = 0;
  visualizer.loadPreset(presets[presetKeys[index]], 0);

  function setSize(w, h) {
    if (visualizer && typeof visualizer.setRendererSize === 'function') {
      visualizer.setRendererSize(w, h);
    }
  }

  function next(crossfadeSec = 1.8) {
    index = (index + 1) % presetKeys.length;
    visualizer.loadPreset(presets[presetKeys[index]], crossfadeSec);
    return presetKeys[index];
  }

  function prev(crossfadeSec = 1.8) {
    index = (index - 1 + presetKeys.length) % presetKeys.length;
    visualizer.loadPreset(presets[presetKeys[index]], crossfadeSec);
    return presetKeys[index];
  }

  function loadByName(name, crossfadeSec = 1.8) {
    const idx = presetKeys.indexOf(name);
    if (idx < 0) return null;
    index = idx;
    visualizer.loadPreset(presets[presetKeys[index]], crossfadeSec);
    return presetKeys[index];
  }

  function reconnect(node) {
    visualizer.connectAudio(node);
  }

  function render() {
    visualizer.render();
  }

  return {
    setSize,
    render,
    next,
    prev,
    loadByName,
    reconnect,
    get currentName() { return presetKeys[index]; },
    get keys()        { return presetKeys.slice(); },
  };
}
