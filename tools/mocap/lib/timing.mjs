// Timing routes (brief 16 Task 1 step 5) + cycle averaging.
//
// Route (b), MOTION-DERIVED phase, is the default: tutorial audio is often
// talking or half-tempo demos. We autocorrelate the summed joint angular
// speed inside the loop window and phase-lock the loop to its own
// periodicity. Routes (a) --grid/--audio-bpm only pick beatsPerLoop; the
// loop period itself always comes from the motion (or exactly from the beat
// grid when the clip is danced on its music).

// summed angular speed |dθ/dt| across joints — the periodicity signal
export function angularSpeed(frames, times, jointNames) {
  const s = new Float64Array(frames.length);
  for (let i = 1; i < frames.length; i++) {
    const dt = Math.max(1e-4, times[i] - times[i - 1]);
    let acc = 0;
    for (const nm of jointNames) {
      const d = (frames[i][nm] ?? 0) - (frames[i - 1][nm] ?? 0);
      acc += Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
    }
    s[i] = acc / dt;
  }
  if (s.length > 1) s[0] = s[1];
  return s;
}

// normalized autocorrelation → BASE period: the smallest lag among local
// peaks within tolerance of the global maximum (a periodic signal peaks
// equally at P, 2P, 3P — the fundamental is the smallest strong one).
// Whether the true LOOP is 2× the base is decided by decideLoop() on the
// SIGNED theta channels: summed |angular speed| erases L/R asymmetry, so an
// alternating move's speed genuinely has half-loop period.
export function detectPeriod(signal, fs, { minLag = 0.25, maxLag = 4, peakTol = 0.85 } = {}) {
  const n = signal.length;
  const mean = signal.reduce((a, b) => a + b, 0) / n;
  const x = Array.from(signal, (v) => v - mean);
  const denom = x.reduce((a, b) => a + b * b, 0) || 1;
  const acAt = (lag) => {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    return s / denom;
  };
  const lo = Math.max(2, Math.round(minLag * fs));
  const hi = Math.min(n - 2, Math.round(maxLag * fs));
  const ac = [];
  for (let lag = lo; lag <= hi; lag++) ac.push(acAt(lag));
  const globalMax = Math.max(...ac);
  let lag = lo + ac.indexOf(globalMax);
  for (let k = 1; k < ac.length - 1; k++) {
    if (ac[k] > ac[k - 1] && ac[k] >= ac[k + 1] && ac[k] >= peakTol * globalMax) {
      lag = lo + k;
      break;                                   // smallest qualifying peak
    }
  }
  // parabolic refinement
  const y0 = acAt(lag - 1), y1 = acAt(lag), y2 = acAt(lag + 1);
  const off = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
  return { period: (lag + Math.max(-0.5, Math.min(0.5, off))) / fs, strength: y1 };
}

// Does the loop span 1× or 2× the base period? Fold the signed channels at
// both; if consecutive-cycle mismatch at 2× is clearly lower, the halves
// differ (L/R alternation) and the loop is the double. channels = arrays on
// the uniform fs grid.
export function decideLoop(channels, fs, basePeriod, { bins = 32, margin = 0.7 } = {}) {
  const mismatch = (P) => {
    const cyc = binCycles(channels, fs, P, 0, bins);
    if (cyc.length < 2) return Infinity;
    let s = 0, k = 0;
    for (let c = 1; c < cyc.length; c++) {
      for (const nm of Object.keys(cyc[0])) {
        for (let b = 0; b < bins; b++) { s += (cyc[c][nm][b] - cyc[c - 1][nm][b]) ** 2; k++; }
      }
    }
    return Math.sqrt(s / k);
  };
  const e1 = mismatch(basePeriod), e2 = mismatch(2 * basePeriod);
  const doubled = e2 < margin * e1;
  return { mult: doubled ? 2 : 1, e1, e2 };
}

// phase-normalize into cycles of `period` starting at t0+anchor·period, bin
// each channel to `bins` per cycle. channels = { name: Float64Array } on the
// uniform fs grid. Returns per-cycle binned matrices.
export function binCycles(channels, fs, period, anchorSec, bins = 64) {
  const names = Object.keys(channels);
  const n = channels[names[0]].length;
  const nCycles = Math.floor((n / fs - anchorSec) / period);
  const cycles = [];
  for (let c = 0; c < nCycles; c++) {
    const m = {}, cnt = new Float64Array(bins);
    for (const nm of names) m[nm] = new Float64Array(bins);
    for (let b = 0; b < bins; b++) {
      const t = anchorSec + (c + b / bins) * period;
      const i = Math.min(n - 1, Math.max(0, Math.round(t * fs)));
      for (const nm of names) m[nm][b] = channels[nm][i];
      cnt[b] = 1;
    }
    cycles.push(m);
  }
  return cycles;
}

// drop outlier cycles by RMS distance to the per-bin MEDIAN cycle —
// instructors demo slow-then-fast; averaging those smears timing. Returns
// { mean, kept, dropped } with kept/dropped as cycle indices.
export function averageCycles(cycles, { maxRatio = 2.5 } = {}) {
  if (!cycles.length) return { mean: {}, kept: [], dropped: [] };
  const names = Object.keys(cycles[0]);
  const bins = cycles[0][names[0]].length;
  const median = {};
  for (const nm of names) {
    median[nm] = new Float64Array(bins);
    for (let b = 0; b < bins; b++) {
      const vals = cycles.map((c) => c[nm][b]).sort((a, z) => a - z);
      median[nm][b] = vals[Math.floor(vals.length / 2)];
    }
  }
  const dist = cycles.map((c) => {
    let s = 0, k = 0;
    for (const nm of names) for (let b = 0; b < bins; b++) { s += (c[nm][b] - median[nm][b]) ** 2; k++; }
    return Math.sqrt(s / k);
  });
  const sorted = [...dist].sort((a, z) => a - z);
  const medD = sorted[Math.floor(sorted.length / 2)] || 1e-9;
  const kept = [], dropped = [];
  dist.forEach((d, i) => (d <= maxRatio * medD ? kept : dropped).push(i));
  const mean = {};
  for (const nm of names) {
    mean[nm] = new Float64Array(bins);
    for (let b = 0; b < bins; b++) {
      let s = 0;
      for (const i of kept) s += cycles[i][nm][b];
      mean[nm][b] = s / kept.length;
    }
  }
  return { mean, kept, dropped };
}
