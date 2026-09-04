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
  const defs = (pl, pr) => [
    // name, parent-chain name (null = root-level), obsA, obsB, restAngle
    ['chest', null, 'hipMid', 'shoulderMid', rest('pelvis', 'chest')],
    ['neck', 'chest', 'shoulderMid', 'headMid', rest('chest', 'neck')],
    [`shoulder${pl}`, 'chest', MP.shoulderL, MP.elbowL, rest('shoulderL', 'elbowL')],
    [`elbow${pl}`, `shoulder${pl}`, MP.elbowL, MP.wristL, rest('elbowL', 'handL')],
    [`shoulder${pr}`, 'chest', MP.shoulderR, MP.elbowR, rest('shoulderR', 'elbowR')],
    [`elbow${pr}`, `shoulder${pr}`, MP.elbowR, MP.wristR, rest('elbowR', 'handR')],
    [`knee${pl}`, null, MP.kneeL, MP.ankleL, rest('kneeL', 'ankleL')],
    [`ankle${pl}`, `knee${pl}`, MP.ankleL, MP.toeL, rest('ankleL', 'footL')],
    [`knee${pr}`, null, MP.kneeR, MP.ankleR, rest('kneeR', 'ankleR')],
    [`ankle${pr}`, `knee${pr}`, MP.ankleR, MP.toeR, rest('ankleR', 'footR')],
  ];
  return {
    joints: J,
    order: sidecar.joints.map((j) => j.name),
    defs: (mirror) => (mirror ? defs('R', 'L') : defs('L', 'R')),
  };
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
export function retargetFrame(frame2d, rig, mirror) {
  const thetas = {}, acc = {};
  for (const [name, parent, a, b, restAngle] of rig.defs(mirror)) {
    const obs = ang(point(frame2d, a), point(frame2d, b));
    const accHere = wrap(obs - restAngle);
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
