// Depth from 2D (brief 18.1 Task 2): the finding behind this module is that
// the estimator's 2D landmarks are trustworthy and its 3D head is not — so
// out-of-plane angles are DERIVED from what 2D actually encodes about depth:
// FORESHORTENING. A bone rotated out of the view plane by θ projects at
// cos(θ) of its true length; with the rest length measured from the clip's
// own calibration frames (stage 4), |θ| = acos(projected / rest).
//
// The projection can't see WHICH way the bone leans, so the SIGN is decided:
//   1. temporal continuity — a real flip must pass through θ ≈ 0 (full
//      length), so the sign holds until the magnitude dips into the
//      ambiguous zone;
//   2. keypoint-score asymmetry on re-entry — the end going AWAY from the
//      camera scores lower (distal − proximal < 0 ⇒ leaning away);
//   3. hold the last sign when both are silent.
// Every decision is counted and logged.

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

const AMBIG = 0.12;          // rad — below this the sign is unknowable
const SCORE_EPS = 0.08;      // minimum score asymmetry to count as evidence
// acos noise floor: d(acos)/dρ → ∞ at ρ=1, so a few % of landmark-length
// noise near full extension reads as ~0.25 rad of fake twist (measured:
// in-plane profile femur, fore rms 0.26 vs world 0.05). The deadband
// renormalizes: ratios ≥ DEAD are in-plane; real twist re-enters smoothly.
const DEAD = 0.965;

// One signed-twist series from a projected-length series + score series.
function signedSeries(projLen, restLen, dScore, log) {
  const n = projLen.length;
  const out = new Float64Array(n);
  let sign = 0;
  for (let t = 0; t < n; t++) {
    const ratio = projLen[t] / restLen;
    const mag = ratio >= DEAD ? 0 : Math.acos(clamp01(ratio / DEAD));
    if (mag < AMBIG) {
      sign = 0;                                     // plane crossing: reset
      out[t] = 0;
      continue;
    }
    if (sign !== 0) {
      log.continuity++;                             // 1: hold through the lobe
    } else if (Math.abs(dScore[t]) > SCORE_EPS) {
      sign = dScore[t] < 0 ? -1 : 1;                // 2: score asymmetry
      log.score++;
    } else {
      sign = out[t - 1] < 0 ? -1 : 1;               // 3: hold last known
      log.hold++;
    }
    out[t] = sign * mag;
  }
  return out;
}

/**
 * Per-bone signed twist for every def, plus pelvis/chest yaw from width
 * foreshortening.
 * @param frontal  frames of isotropic 2D points (schema order)
 * @param scores   frames of per-point scores (schema order)
 * @param defs     rig.defs rows [name, parent, a, b, rest]
 * @param maskFor  (defName) → boolean[] calibration mask (stage 4's masks)
 * @param S        schema index table
 */
export function foreshortenAll(frontal, scores, defs, maskFor, S) {
  const log = { continuity: 0, score: 0, hold: 0 };
  const pt = (f, k) => typeof k === 'number' ? f[k]
    : k === 'hipMid' ? [(f[S.hipL][0] + f[S.hipR][0]) / 2, (f[S.hipL][1] + f[S.hipR][1]) / 2]
    : k === 'shoulderMid' ? [(f[S.shoulderL][0] + f[S.shoulderR][0]) / 2, (f[S.shoulderL][1] + f[S.shoulderR][1]) / 2]
    : [(f[S.earL][0] + f[S.earR][0]) / 2, (f[S.earL][1] + f[S.earR][1]) / 2];
  const sc = (f, k) => typeof k === 'number' ? f[k] : 1;    // mids: no single score
  const twists = {};
  const restLens = {};
  for (const [name, , a, b] of defs) {
    const projLen = frontal.map((f) => {
      const A = pt(f, a), B = pt(f, b);
      return Math.hypot(B[0] - A[0], B[1] - A[1]);
    });
    const mask = maskFor(name);
    const calib = projLen.filter((_, i) => mask[i]);
    // calibration median is the bone's in-plane length; if the whole window
    // is foreshortened the p95 keeps the reference honest
    const restLen = Math.max(calib.length >= 5 ? median(calib) : 0,
      [...projLen].sort((x, y) => x - y)[Math.floor(projLen.length * 0.95)] * 0.999) || 1e-6;
    restLens[name] = restLen;
    const dScore = frontal.map((_, i) => sc(scores[i], b) - sc(scores[i], a));
    twists[name] = signedSeries(projLen, restLen, dScore, log);
  }
  // body yaw from width foreshortening (B2's channels)
  const width = (f, l, r) => Math.hypot(f[r][0] - f[l][0], f[r][1] - f[l][1]);
  const yaws = {};
  for (const [nm, l, r] of [['pelvis', S.hipL, S.hipR], ['chest', S.shoulderL, S.shoulderR]]) {
    const w = frontal.map((f) => width(f, l, r));
    const calib = w.filter((_, i) => maskFor('chest')[i]);
    const restW = (calib.length >= 5 ? median(calib) : median(w)) || 1e-6;
    const dScore = frontal.map((_, i) => scores[i][l] - scores[i][r]);
    yaws[nm] = signedSeries(w, restW, dScore, log);
  }
  return { twists, yaws, restLens, log };
}

// frontness for --view auto, 2D-only (estimator-agnostic): shoulder width
// over spine length — measured 0.63 on the frontal T-step vs 0.07 on the
// profile running man; the boundary sits comfortably between.
export function frontnessRatio(imgIso, S) {
  const sw = [], sp = [];
  for (const f of imgIso) {
    sw.push(Math.hypot(f[S.shoulderR][0] - f[S.shoulderL][0], f[S.shoulderR][1] - f[S.shoulderL][1]));
    const hm = [(f[S.hipL][0] + f[S.hipR][0]) / 2, (f[S.hipL][1] + f[S.hipR][1]) / 2];
    const sm = [(f[S.shoulderL][0] + f[S.shoulderR][0]) / 2, (f[S.shoulderL][1] + f[S.shoulderR][1]) / 2];
    sp.push(Math.hypot(sm[0] - hm[0], sm[1] - hm[1]));
  }
  return median(sw) / (median(sp) || 1e-6);
}
