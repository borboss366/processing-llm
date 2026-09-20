// Retarget MediaPipe pose landmarks → 15-joint rig rotations (brief 16).
//
// Principle: match WORLD BONE ORIENTATIONS. For each rig bone we take the
// observed segment's angle (atan2, y-down screen convention — same as the
// creature's FK), subtract the rig's rest-pose angle for that bone, subtract
// the parent chain's accumulated rotation: what remains is the joint's table
// `rot`. Signs come out right by construction because extraction and playback
// share one rotation convention. Positions are DERIVED via FK, never copied —
// bone lengths hold by construction. The rig has no hip DOF (thigh is rigid
// pelvis→knee), so leg swing projects onto knee/ankle; the QA video shows
// this honestly.

// MediaPipe pose landmark indices (33-point BlazePose)
export const MP = {
  nose: 0, earL: 7, earR: 8,
  shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16,
  hipL: 23, hipR: 24, kneeL: 25, kneeR: 26, ankleL: 27, ankleR: 28,
  heelL: 29, heelR: 30, toeL: 31, toeR: 32,
};

const mid = (a, b) => a.map((v, i) => (v + b[i]) / 2);
const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
// smallest signed representative — keeps thetas near 0 instead of ±2π
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// Detect world-landmark y orientation once per clip: rig convention is
// y-DOWN (image-like). If shoulders read BELOW hips numerically, y is up →
// flip. Returns +1 (already y-down) or -1 (flip y and z to keep handedness).
export function detectYSign(worldFrames) {
  let s = 0;
  for (const f of worldFrames) {
    s += mid(f[MP.shoulderL], f[MP.shoulderR])[1] - mid(f[MP.hipL], f[MP.hipR])[1];
  }
  return s < 0 ? +1 : -1;
}

// Per-frame yaw about the vertical axis, from the person's left→right
// shoulder+hip vector in the xz plane. Returns radians; 0 = that vector
// along +x (canonical frame).
export function frameYaw(world) {
  const v = [0, 0, 0];
  for (const [a, b] of [[MP.shoulderL, MP.shoulderR], [MP.hipL, MP.hipR]]) {
    for (let i = 0; i < 3; i++) v[i] += world[b][i] - world[a][i];
  }
  return Math.atan2(v[2], v[0]);
}

// Rotate all landmarks about the vertical (y) axis by -yaw and project
// orthographically to xy — the de-yawed frontal pose.
export function deYaw(world, yaw) {
  const c = Math.cos(-yaw), s = Math.sin(-yaw);
  return world.map(([x, y, z]) => [x * c - z * s, y]);
}

// same rotation, z kept — for the depth channels (16.2)
export function deYaw3(world, yaw) {
  const c = Math.cos(-yaw), s = Math.sin(-yaw);
  return world.map(([x, y, z]) => [x * c - z * s, y, x * s + z * c]);
}

// Per-bone out-of-plane TWIST (brief 16.2, consumed by the depth channel in
// brief 17): for each observed segment, the signed angle between the 3D bone
// and the projection (xy) plane of the de-yawed frame — atan2(Δz, planar
// length). 0 = bone lies in the plane the 2D rig renders; ±π/2 = bone points
// at/away from the viewer (exactly what the 2D projection cannot show).
export function boneTwists(frame3, rig, mirror) {
  const p3 = (key) => point(frame3, key);
  const out = {};
  for (const [name, , a, b] of rig.defs(mirror)) {
    const A = p3(a), B = p3(b);
    const dz = (B[2] ?? 0) - (A[2] ?? 0);
    out[name] = Math.atan2(dz, Math.hypot(B[0] - A[0], B[1] - A[1]));
  }
  return out;
}

// Build the retarget map from a rig sidecar (shapes/<name>.json). Each entry:
// which rig joint, its parent joint (for accRot subtraction), the observed
// segment (MP indices or 'mid' pseudo-points), and the rig rest bone.
export function buildRig(sidecar) {
  const J = {};
  for (const j of sidecar.joints) J[j.name] = j;
  const rest = (a, b) => ang([J[a].x, J[a].y], [J[b].x, J[b].y]);
  // person side S → rig side: canonical de-yawed frame has the person's
  // left→right vector along +x; tutorials teach mirrored, so default maps
  // person L → rig L ("as your mirror image"); --mirror swaps.
  // rest angles MUST reference the ASSIGNED rig joint's own chain (template
  // side `pl`/`pr`), never a hardcoded side: with --mirror the assigned name
  // flips but a hardcoded rest would stay left — theta then carries
  // rest(L)−rest(R) and FK renders every mirrored chain coherently wrong
  // (the 2026-09-20 "legs splayed, arm raised" screenshot; found by the
  // round-trip check in root-diag, worst 132° on an arm bone)
  const defs = (pl, pr) => [
    // name, parent-chain name (null = root-level), obsA, obsB, restAngle
    ['chest', null, 'hipMid', 'shoulderMid', rest('pelvis', 'chest')],
    ['neck', 'chest', 'shoulderMid', 'headMid', rest('chest', 'neck')],
    [`shoulder${pl}`, 'chest', MP.shoulderL, MP.elbowL, rest(`shoulder${pl}`, `elbow${pl}`)],
    [`elbow${pl}`, `shoulder${pl}`, MP.elbowL, MP.wristL, rest(`elbow${pl}`, `hand${pl}`)],
    [`shoulder${pr}`, 'chest', MP.shoulderR, MP.elbowR, rest(`shoulder${pr}`, `elbow${pr}`)],
    [`elbow${pr}`, `shoulder${pr}`, MP.elbowR, MP.wristR, rest(`elbow${pr}`, `hand${pr}`)],
    // femur decomposition (16.1): hip absorbs the whole-leg swing, knee is
    // the RELATIVE femur–tibia angle, ankle relative tibia–foot — same
    // discipline as the arm chain
    [`hip${pl}`, null, MP.hipL, MP.kneeL, rest(`hip${pl}`, `knee${pl}`)],
    [`knee${pl}`, `hip${pl}`, MP.kneeL, MP.ankleL, rest(`knee${pl}`, `ankle${pl}`)],
    // foot observed as HEEL→TOE (2026-09-21): ankle→toe slopes ~25–30°
    // down-forward even when the foot is flat (the ankle sits above the
    // foot), so planted frames read as plantarflexion and the stickman
    // tiptoes; heel→toe is horizontal when flat
    [`ankle${pl}`, `knee${pl}`, MP.heelL, MP.toeL, rest(`ankle${pl}`, `foot${pl}`)],
    [`hip${pr}`, null, MP.hipR, MP.kneeR, rest(`hip${pr}`, `knee${pr}`)],
    [`knee${pr}`, `hip${pr}`, MP.kneeR, MP.ankleR, rest(`knee${pr}`, `ankle${pr}`)],
    [`ankle${pr}`, `knee${pr}`, MP.heelR, MP.toeR, rest(`ankle${pr}`, `foot${pr}`)],
  ];
  // view-specific rest overrides (2026-09-20 "palsy foot"): the sidecar is
  // a FRONT view — feet point outward on opposite sides, arms slope outward.
  // In a PROFILE clip both feet point the facing direction and arms hang
  // along the body; measuring against front rests parks ~π on one ankle
  // (clamps at the rotLimit) and a constant on the shoulders. view =
  // { profileFacing: -1 | +1 } swaps in profile rests: one shared forward
  // foot neutral (the facing side's own rest) and straight-down arms.
  const applyView = (rows, view) => {
    if (!view?.profileFacing) return rows;
    // heel→toe observation: a flat profile foot is HORIZONTAL in the facing
    // direction (was: the rig foot's own sloped rest — the tiptoe bias)
    const footNeutral = view.profileFacing < 0 ? Math.PI : 0;
    const DOWN = Math.PI / 2;                          // y-down screen: hanging arm
    return rows.map(([name, parent, a, b, r]) => {
      if (/^ankle/.test(name)) return [name, parent, a, b, footNeutral];
      if (/^(shoulder|elbow)/.test(name)) return [name, parent, a, b, DOWN];
      return [name, parent, a, b, r];
    });
  };
  return {
    joints: J,
    order: sidecar.joints.map((j) => j.name),
    rest,
    defs: (mirror, view) => applyView(mirror ? defs('R', 'L') : defs('L', 'R'), view),
  };
}

// ── Measured-rest calibration (2026-09-21) ─────────────────────────────────
// Declared rest sets (front sidecar geometry, profile overrides) are GUESSES
// about the human's neutral; every guess so far shipped a bias (opposing
// feet, sloped arms, ankle→toe tiptoes). Measure instead: the median
// observed bone angle over PLANTED, LOW-VELOCITY frames is the human's own
// rest in this clip and view; thetas are deviations from it, applied onto
// the rig's rest by FK. Declared rests remain only the fallback when a bone
// never qualifies. QA/engine semantics: rendered = rigRest + (obs −
// humanRest) — the calibration pose renders AS the rig's rest pose.

// frame masks: global = lowest-30% whole-body velocity; legL/legR = frames
// where that PERSON side's foot is planted (within 10% of its lowest point)
export function calibMasks(frontalFrames) {
  const n = frontalFrames.length;
  const vel = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    let s = 0;
    for (let l = 0; l < frontalFrames[i].length; l++) {
      if (!frontalFrames[i][l] || !frontalFrames[i - 1][l]) continue;   // sparse test frames
      s += Math.hypot(frontalFrames[i][l][0] - frontalFrames[i - 1][l][0],
                      frontalFrames[i][l][1] - frontalFrames[i - 1][l][1]);
    }
    vel[i] = s;
  }
  vel[0] = vel[1] ?? 0;
  const thresh = [...vel].sort((a, b) => a - b)[Math.floor(n * 0.3)];
  const global = Array.from(vel, (v) => v <= thresh);
  const planted = (heel, toe) => {
    const fy = frontalFrames.map((f) => Math.max(f[heel][1], f[toe][1]));
    const hi = Math.max(...fy), lo = Math.min(...fy);
    return fy.map((y) => y >= hi - 0.1 * (hi - lo || 1));
  };
  return { global, legL: planted(MP.heelL, MP.toeL), legR: planted(MP.heelR, MP.toeR) };
}

const LEG_L = new Set([MP.hipL, MP.kneeL, MP.ankleL, MP.heelL, MP.toeL]);
const LEG_R = new Set([MP.hipR, MP.kneeR, MP.ankleR, MP.heelR, MP.toeR]);

// median observed angle per def bone over its calibration mask → human rest.
// Leg bones calibrate on their own side's planted frames; everything else on
// the global quiet mask. < 5 qualifying frames → declared rest (fallback).
export function measureRest(frontalFrames, rig, mirror, view, masks) {
  const rests = {}, counts = {}, fallbacks = [];
  for (const [name, , a, b, declared] of rig.defs(mirror, view)) {
    const mask = (typeof a === "number" && LEG_L.has(a)) ? masks.legL
      : (typeof a === "number" && LEG_R.has(a)) ? masks.legR
      : masks.global;
    let cs = 0, sn = 0, k = 0;
    for (let i = 0; i < frontalFrames.length; i++) {
      if (!mask[i]) continue;
      const o = ang(point(frontalFrames[i], a), point(frontalFrames[i], b));
      cs += Math.cos(o); sn += Math.sin(o); k++;
    }
    if (k >= 5) { rests[name] = Math.atan2(sn, cs); counts[name] = k; }
    else { rests[name] = declared; counts[name] = k; fallbacks.push(name); }
  }
  return { rests, counts, fallbacks };
}

// pseudo-points on a de-yawed 2D frame
function point(frame2d, key) {
  if (typeof key === 'number') return frame2d[key];
  if (key === 'hipMid') return mid(frame2d[MP.hipL], frame2d[MP.hipR]);
  if (key === 'shoulderMid') return mid(frame2d[MP.shoulderL], frame2d[MP.shoulderR]);
  if (key === 'headMid') return mid(frame2d[MP.earL], frame2d[MP.earR]);
  throw new Error(`unknown point ${key}`);
}

// One de-yawed 2D frame → { jointName: theta } for the 10 articulated joints
// (pelvis is root, leaves stay 0). accRot chains through parent entries.
// Per-side deviation sign (2026-09-21 far-side flip): transferring a screen
// deviation onto the rig's side-MIRRORED rests is orientation-reversing for
// the side whose rig foot opposes the profile facing — in profile both
// human limbs deviate with the SAME screen sign, so without the flip the
// far leg kicks backward while the near leg lifts (measured: every
// far-side bone erred at exactly 2× its deviation). Frontal capture needs
// no sign: there the human's own sides already move mirrored. Applied ONCE,
// here, at the acc level so parent chains of mixed sign stay consistent
// (FK reconstructs acc from theta sums).
export function sideSigns(rig, view) {
  if (!view?.profileFacing) return () => 1;
  const dir = {};
  for (const s of ['L', 'R']) {
    dir[s] = Math.sign(rig.joints[`foot${s}`].x - rig.joints[`ankle${s}`].x) === view.profileFacing ? 1 : -1;
  }
  return (name) => {
    const m = /([LR])$/.exec(name);
    return m ? dir[m[1]] : 1;
  };
}

export function retargetFrame(frame2d, rig, mirror, view = null, humanRest = null) {
  const thetas = {}, acc = {};
  const sign = sideSigns(rig, view);
  for (const [name, parent, a, b, restAngle] of rig.defs(mirror, view)) {
    const obs = ang(point(frame2d, a), point(frame2d, b));
    const accHere = sign(name) * wrap(obs - (humanRest?.[name] ?? restAngle));
    acc[name] = accHere;
    thetas[name] = wrap(accHere - (parent ? acc[parent] : 0));
  }
  return thetas;
}

// FK forward — the inverse of retargetFrame, same math as the creature's
// chain (accRot = parent accRot + theta, children rotate about the joint).
// Returns { jointName: [x, y] } in sidecar units. Used by the QA stickman
// and the self-test round-trip.
export function fkPose(rig, thetas) {
  const out = {}, acc = {};
  const walk = (name) => {
    const j = rig.joints[name];
    if (j.parent == null) {
      out[name] = [j.x, j.y];
      acc[name] = thetas[name] ?? 0;
    } else {
      const p = rig.joints[j.parent];
      const pa = acc[j.parent] ?? 0;
      const c = Math.cos(pa), s = Math.sin(pa);
      const dx = j.x - p.x, dy = j.y - p.y;
      out[name] = [out[j.parent][0] + dx * c - dy * s,
                   out[j.parent][1] + dx * s + dy * c];
      acc[name] = pa + (thetas[name] ?? 0);
    }
    for (const k of rig.order) if (rig.joints[k].parent === name) walk(k);
  };
  for (const k of rig.order) if (rig.joints[k].parent == null) walk(k);
  return out;
}
