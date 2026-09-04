// One Euro filter (Casiez 2012) — applied to LANDMARK POSITIONS per axis,
// never to angles (wrap). Dance-tuned defaults: minCutoff low enough to kill
// landmark jitter in holds, beta high enough that a kick doesn't lag.
export function oneEuro({ minCutoff = 1.2, beta = 0.35, dCutoff = 1.0 } = {}) {
  let xPrev = null, dxPrev = 0, tPrev = null;
  const alpha = (cutoff, dt) => {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  };
  return (x, t) => {
    if (xPrev === null) { xPrev = x; tPrev = t; return x; }
    const dt = Math.max(1e-4, t - tPrev);
    tPrev = t;
    const dx = (x - xPrev) / dt;
    const aD = alpha(dCutoff, dt);
    dxPrev = dxPrev + aD * (dx - dxPrev);
    const cutoff = minCutoff + beta * Math.abs(dxPrev);
    const a = alpha(cutoff, dt);
    xPrev = xPrev + a * (x - xPrev);
    return xPrev;
  };
}

// filter a whole landmark stream: frames[i][lm] = [x, y, z?] → same shape
export function filterLandmarks(frames, times, opts) {
  if (!frames.length) return frames;
  const nLm = frames[0].length, nAx = frames[0][0].length;
  const filters = Array.from({ length: nLm }, () =>
    Array.from({ length: nAx }, () => oneEuro(opts)));
  return frames.map((f, i) =>
    f.map((lm, l) => lm.map((v, a) => filters[l][a](v, times[i]))));
}
