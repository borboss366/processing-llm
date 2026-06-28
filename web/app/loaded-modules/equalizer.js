/**
 * equalizer — permanent FFT-bar visualizer.
 *
 * Reads audio.freqBins (512 dB values in [-100, 0]) and renders N logarithmic
 * bands as vertical bars across the bottom of the screen. Each bar has a
 * "peak-hold" indicator that decays over time.
 *
 * Always-on (no lifecycle); use OSC /eq/<param> <value> to retune live, or
 * Apply OSC in the controller's Modules pane.
 *
 *   /eq/bars 96            // 16..256
 *   /eq/widthFrac 0.6      // 0..1 — how much of screen width to use
 *   /eq/heightFrac 0.35    // 0..1 — max bar height
 *   /eq/baseY 0.95         // 0..1 — y of bar bottoms (1 = page bottom)
 *   /eq/gap 1              // px between bars
 *   /eq/colorLow #ff3d7f
 *   /eq/colorHigh #3df7ff
 *   /eq/peakColor #ffffff
 *   /eq/peakDecay 0.97     // 0.9..0.999 — closer to 1 = slower fall
 *   /eq/smoothing 0.7      // 0..1 — extra visual smoothing on top of analyser
 *   /eq/mirror 1           // 1 = mirror upper half
 *   /eq/glow 1             // 1 = additive glow blendmode
 */

export default {
  id: 'equalizer',
  oscPrefix: 'eq',
  interfaces: [],                     // permanent / no lifecycle

  defaults: {
    bars:        96,
    widthFrac:   0.92,                // 92% of screen width, centered
    heightFrac:  0.35,
    baseY:       0.97,
    gap:         1,
    colorLow:    '#ff3d7f',
    colorHigh:   '#3df7ff',
    peakColor:   '#ffffff',
    peakDecay:   0.965,
    smoothing:   0.7,
    mirror:      false,
    glow:        true,
  },

  setup(ctx) {
    // Per-bar smoothed amplitude + peak-hold value. Sized dynamically as
    // params.bars changes — recalculated at draw if length doesn't match.
    ctx.state = {
      bands: new Float32Array(ctx.params.bars),
      peaks: new Float32Array(ctx.params.bars),
    };
  },

  draw(ctx) {
    const { p, params, audio, state } = ctx;
    const bins = audio?.freqBins;
    if (!bins) return;            // no audio yet

    const n = Math.max(8, Math.min(256, Math.floor(params.bars)));
    if (state.bands.length !== n) {
      state.bands = new Float32Array(n);
      state.peaks = new Float32Array(n);
    }

    // Map N log-spaced bands across the bin range. Skip the DC bin (0).
    const binCount = bins.length;
    const minBin = 1, maxBin = binCount - 1;
    const logMin = Math.log(minBin), logMax = Math.log(maxBin);

    for (let i = 0; i < n; i++) {
      const lo = Math.floor(Math.exp(logMin + (i     / n) * (logMax - logMin)));
      const hi = Math.max(lo + 1, Math.floor(Math.exp(logMin + ((i + 1) / n) * (logMax - logMin))));
      // peak over the slice (in dB)
      let dbMax = -Infinity;
      for (let k = lo; k < hi && k < binCount; k++) if (bins[k] > dbMax) dbMax = bins[k];
      const amp = Math.max(0, Math.min(1, (dbMax + 80) / 80));

      // visual smoothing on top of the analyser's own smoothing
      const smooth = Math.max(0, Math.min(0.98, params.smoothing));
      state.bands[i] = state.bands[i] * smooth + amp * (1 - smooth);

      // peak-hold: rise instantly, decay slowly
      if (state.bands[i] > state.peaks[i]) state.peaks[i] = state.bands[i];
      else state.peaks[i] *= Math.max(0.9, Math.min(0.999, params.peakDecay));
    }

    const W = p.width, H = p.height;
    const usableW = W * Math.max(0.1, Math.min(1, params.widthFrac));
    const x0 = (W - usableW) / 2;
    const baseY = H * Math.max(0, Math.min(1, params.baseY));
    const maxBarH = H * Math.max(0.05, Math.min(1, params.heightFrac));
    const gap = Math.max(0, params.gap);
    const barW = Math.max(1, usableW / n - gap);

    p.push();
    if (params.glow) p.drawingContext.globalCompositeOperation = 'lighter';
    p.noStroke();

    // colour ramp endpoints
    const cLow  = p.color(params.colorLow);
    const cHigh = p.color(params.colorHigh);

    for (let i = 0; i < n; i++) {
      const v = state.bands[i];
      const h = v * maxBarH;
      if (h < 0.5) continue;
      const x = x0 + i * (barW + gap);
      const t = i / Math.max(1, n - 1);                   // 0..1 across spectrum
      const c = p.lerpColor(cLow, cHigh, t);

      // main bar (or mirrored)
      p.fill(c);
      if (params.mirror) {
        p.rect(x, baseY - h / 2, barW, h);
      } else {
        p.rect(x, baseY - h, barW, h);
      }

      // peak-hold marker
      const ph = state.peaks[i] * maxBarH;
      if (ph > h + 1) {
        p.fill(params.peakColor);
        const py = params.mirror ? baseY - ph / 2 - 2 : baseY - ph - 2;
        p.rect(x, py, barW, 2);
      }
    }

    p.pop();
    // reset composite for following modules
    p.drawingContext.globalCompositeOperation = 'source-over';
  },

  // OSC handler — write any known param verbatim, coerce numerics for floats.
  osc(ctx, address, value) {
    const param = address.split('/').pop();
    if (!param) return null;
    if (!Object.prototype.hasOwnProperty.call(ctx.params, param)) return null;
    const cur = ctx.params[param];
    if (typeof cur === 'number') {
      const n = Number(value);
      if (!Number.isNaN(n)) ctx.params[param] = n;
    } else if (typeof cur === 'boolean') {
      ctx.params[param] = !!Number(value) || value === true || value === 'true';
    } else {
      ctx.params[param] = String(value);
    }
    return null;
  },
};
