// Distill a cycle-averaged loop (64-bin channels) into the STANDARD move
// table (MODULE_ABI.md): keys at extrema + inflection points, contacts from
// foot-height minima + low velocity, `travel` from pelvis drift.

const TAU = Math.PI * 2;

// candidate key phases: per-channel local extrema of value AND of the first
// difference (inflections), on the circular bin grid
function candidatePhases(channels, bins, minRange) {
  const set = new Set([0]);
  for (const nm of Object.keys(channels)) {
    const v = channels[nm];
    const range = Math.max(...v) - Math.min(...v);
    if (range < minRange) continue;
    const d = v.map((_, i) => v[(i + 1) % bins] - v[i]);
    for (const arr of [v, d]) {
      for (let i = 0; i < bins; i++) {
        const a = arr[(i - 1 + bins) % bins], b = arr[i], c = arr[(i + 1) % bins];
        if ((b > a && b >= c) || (b < a && b <= c)) set.add(i);
      }
    }
  }
  return [...set].sort((a, b) => a - b);
}

// greedy thin: repeatedly remove the candidate whose removal introduces the
// least reconstruction error (linear interp between circular neighbours),
// until ≤ maxKeys. Deterministic.
function thinKeys(phasesIdx, channels, bins, maxKeys) {
  const idx = [...phasesIdx];
  const errOf = (arr, k) => {
    const prev = arr[(k - 1 + arr.length) % arr.length];
    const next = arr[(k + 1) % arr.length];
    const span = ((next - prev + bins) % bins) || bins;
    let worst = 0;
    for (const nm of Object.keys(channels)) {
      const v = channels[nm];
      for (let s = 1; s < span; s++) {
        const b = (prev + s) % bins;
        const interp = v[prev] + (v[next] - v[prev]) * (s / span);
        worst = Math.max(worst, Math.abs(v[b] - interp));
      }
    }
    return worst;
  };
  while (idx.length > maxKeys) {
    let bestK = -1, bestErr = Infinity;
    for (let k = 0; k < idx.length; k++) {
      if (idx[k] === 0) continue;               // phase 0 is the loop anchor
      const e = errOf(idx, k);
      if (e < bestErr) { bestErr = e; bestK = k; }
    }
    if (bestK < 0) break;
    idx.splice(bestK, 1);
  }
  return idx;
}

/**
 * @param avg        { thetas: {joint: Float64Array(bins)}, pelvisU: Float64Array,
 *                     footY: {L,R: Float64Array}, footVX: {L,R: Float64Array} }
 * @param opts       { bins, bpl, name, overlay, verticalContent, maxKeys,
 *                     minRange (rad), snapSpeed (rad/loop-fraction) }
 */
export function distillMove(avg, opts) {
  const { bins = 64, bpl = 4, maxKeys = 16, minRange = 0.06 } = opts;
  const joints = {};
  for (const [nm, v] of Object.entries(avg.thetas)) {
    if (Math.max(...v) - Math.min(...v) >= minRange) joints[nm] = v;
  }
  const phases = thinKeys(candidatePhases(joints, bins, minRange), joints, bins, maxKeys);

  // contacts: a foot is planted where its height is near the cycle low AND
  // its horizontal speed is low (image space carries the ground truth)
  const contactMask = { L: new Array(bins).fill(false), R: new Array(bins).fill(false) };
  for (const side of ['L', 'R']) {
    const y = avg.footY[side], vx = avg.footVX[side];
    const yMax = Math.max(...y), yMin = Math.min(...y);
    // absolute floor band: a pivoting weighted foot barely changes height, so
    // a purely relative band collapses to nothing and reports zero contacts
    const band = Math.max(0.02, 0.15 * (yMax - yMin));
    const vLim = 2.5 * (vx.reduce((a, b) => a + Math.abs(b), 0) / bins);
    for (let b = 0; b < bins; b++) {
      contactMask[side][b] = y[b] >= yMax - band && Math.abs(vx[b]) <= vLim;
    }
  }

  // travel: pelvis drift in shape units per BEAT, from the circular
  // derivative of pelvisU (wrap-corrected by the net per-loop drift so the
  // seam derivative is continuous). Default subtracts the net drift —
  // authored guidance wants zero-net loops and a static camera isn't
  // guaranteed; keepDrift preserves it for single-side captures (a lone
  // t-step half REALLY travels; the stitched full loop nets zero).
  const pU = avg.pelvisU;
  // per-loop drift: the loop closes at bin `bins` (next cycle's bin 0), so
  // last-minus-first spans only bins-1 of it — extrapolate the missing bin
  const net = (pU[bins - 1] - pU[0]) * bins / (bins - 1);
  const detrend = opts.keepDrift ? 0 : net / bins;
  // seam samples live in the neighbouring loop: b+1 wrapping forward gains
  // +net (next loop is net further along), b-1 wrapping back is net BEHIND —
  // adding net to the difference in both cases keeps the derivative continuous
  const travelAt = (b) => {
    const d = (pU[(b + 1) % bins] - pU[(b - 1 + bins) % bins]
      + (b + 1 >= bins ? net : 0) + (b - 1 < 0 ? net : 0));
    return (d / 2 - detrend) * (bins / bpl);
  };

  // ease: snap where the summed |Δθ| entering the key is in the top quartile
  const speed = new Float64Array(bins);
  for (const v of Object.values(joints)) {
    for (let b = 0; b < bins; b++) speed[b] += Math.abs(v[b] - v[(b - 1 + bins) % bins]);
  }
  const snapLim = [...speed].sort((a, z) => a - z)[Math.floor(bins * 0.75)];

  const keys = phases.map((b) => {
    const jk = {};
    for (const [nm, v] of Object.entries(joints)) jk[nm] = { rot: +v[b].toFixed(3) };
    const contacts = [];
    if (contactMask.L[b]) contacts.push('footL');
    if (contactMask.R[b]) contacts.push('footR');
    return {
      phase: +(b / bins).toFixed(5),
      joints: jk,
      contacts,
      ease: speed[b] > snapLim ? 'snap' : 'smooth',
      travel: +travelAt(b).toFixed(4),
    };
  });
  return {
    name: opts.name,
    beatsPerLoop: bpl,
    overlay: opts.overlay ?? 0.3,
    verticalContent: opts.verticalContent ?? 0.7,
    keys,
    _netDriftUnits: +net.toFixed(4),
  };
}
