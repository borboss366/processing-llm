// Zero-phase smoothing for the OFFLINE pipeline (brief 16 lag fix):
// Savitzky–Golay — symmetric least-squares polynomial kernel, so it smooths
// without phase delay. One Euro (lib/oneeuro.mjs) is causal and lags by
// design; it stays behind --filter oneeuro for future LIVE capture only.
// Applies to LANDMARK POSITIONS, never angles (wrap) — same rule as before.

function invert(M) {
  const m = M.length;
  const A = M.map((row, i) => [...row, ...Array.from({ length: m }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < m; c++) {
    let piv = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const d = A[c][c];
    for (let j = 0; j < 2 * m; j++) A[c][j] /= d;
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let j = 0; j < 2 * m; j++) A[r][j] -= f * A[c][j];
    }
  }
  return A.map((row) => row.slice(m));
}

// central-point SG kernel: k_i = [(AᵀA)⁻¹ Aᵀ]₀ᵢ with A_{ip} = iᵖ, i ∈ [−h..h]
export function savgolKernel(window = 9, order = 3) {
  if (window % 2 === 0 || window < order + 2) throw new Error(`bad SG window ${window}/order ${order}`);
  const h = (window - 1) / 2, m = order + 1;
  const ata = Array.from({ length: m }, () => new Array(m).fill(0));
  for (let p = 0; p < m; p++) {
    for (let q = 0; q < m; q++) {
      let s = 0;
      for (let i = -h; i <= h; i++) s += i ** (p + q);
      ata[p][q] = s;
    }
  }
  const inv = invert(ata);
  const kernel = new Float64Array(window);
  for (let i = -h; i <= h; i++) {
    let s = 0;
    for (let p = 0; p < m; p++) s += inv[0][p] * i ** p;
    kernel[i + h] = s;
  }
  return kernel;
}

// mirror-padded convolution — endpoints stay unbiased for smooth signals
export function savgolSmooth(vals, window = 9, order = 3) {
  const k = savgolKernel(window, order);
  const h = (window - 1) / 2, n = vals.length;
  const at = (i) => vals[i < 0 ? -i : i >= n ? 2 * n - 2 - i : i];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -h; j <= h; j++) s += k[j + h] * at(i + j);
    out[i] = s;
  }
  return out;
}

// hold-last-valid gating (16.2 foot gate): where mask[i] is true the value
// is untrustworthy — replace with the last valid sample (or the first valid
// ahead, for a masked prefix). Returns the count held.
export function holdWhere(values, mask) {
  let held = 0;
  let firstValid = mask.findIndex((m) => !m);
  if (firstValid < 0) return 0;                 // nothing valid — leave as-is
  for (let i = 0; i < firstValid; i++) { values[i] = values[firstValid]; held++; }
  for (let i = firstValid + 1; i < values.length; i++) {
    if (mask[i]) { values[i] = values[i - 1]; held++; }
  }
  return held;
}

// same shape contract as oneeuro's filterLandmarks: frames[i][lm] = [x,y,z?]
export function sgLandmarks(frames, { window = 9, order = 3 } = {}) {
  if (!frames.length) return frames;
  const nLm = frames[0].length, nAx = frames[0][0].length;
  const out = frames.map((f) => f.map((lm) => [...lm]));
  for (let l = 0; l < nLm; l++) {
    for (let a = 0; a < nAx; a++) {
      const smoothed = savgolSmooth(frames.map((f) => f[l][a]), window, order);
      for (let i = 0; i < frames.length; i++) out[i][l][a] = smoothed[i];
    }
  }
  return out;
}
