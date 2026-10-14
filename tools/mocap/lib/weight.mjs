// weight (brief 17.6): which foot carries the body, per frame.
// −1 = all on the LEFT foot, +1 = all on the RIGHT, 0 = shared, null =
// neither foot down (airborne — out of scope, the engine keeps today's
// behaviour). Rig body frame: the names are RIG sides, so --mirror (person
// L → rig R) negates the channel by construction.
//
// Rule, per frame, from the rig's OWN FK (never image height — the
// occluded far foot in profile read "planted" from image height and the
// stance lock ate its lift, brief 17):
//   - a foot higher than the lower foot by more than liftOn·L is OFF the
//     floor (hysteresis: it comes back below liftOff·L) → it carries no
//     weight → weight = ±1 toward the other foot;
//   - both down → weight = where the pelvis sits between the two feet
//     along the view's visible axis (x: lateral in front, fore/aft in
//     profile): 2·t − 1 with t = (pelvis − footL) / (footR − footL);
//     feet closer than minSpread·L → 0 (no measurable axis); a dead band
//     snaps |w| < dead to 0 so a standing figure reads steady;
//   - both up → null.
// L is the shape's leg length (hip→knee→ankle at rest).

export const WEIGHT_DEFAULTS = { liftOn: 0.06, liftOff: 0.035, minSpread: 0.05, dead: 0.15 };

export function legLength(rig) {
  const j = rig.joints;
  const d = (a, b) => Math.hypot(j[b].x - j[a].x, j[b].y - j[a].y);
  return (d("hipL", "kneeL") + d("kneeL", "ankleL") + d("hipR", "kneeR") + d("kneeR", "ankleR")) / 2;
}

/**
 * @param poses  per frame { pelvis:[x,y], footL:[x,y], footR:[x,y] } (y down)
 * @param L      leg length (shape units)
 * @returns { weight: (number|null)[], liftL: boolean[], liftR: boolean[] }
 */
export function weightSeries(poses, L, opts = {}) {
  const o = { ...WEIGHT_DEFAULTS, ...opts };
  const weight = [], liftL = [], liftR = [];
  let upL = false, upR = false;
  for (const p of poses) {
    const low = Math.max(p.footL[1], p.footR[1]);                 // y-down: larger = lower
    const hL = low - p.footL[1], hR = low - p.footR[1];
    upL = upL ? hL > o.liftOff * L : hL > o.liftOn * L;
    upR = upR ? hR > o.liftOff * L : hR > o.liftOn * L;
    liftL.push(upL); liftR.push(upR);
    if (upL && upR) { weight.push(null); continue; }
    if (upL) { weight.push(1); continue; }                         // left is up → all on the right
    if (upR) { weight.push(-1); continue; }
    const spread = p.footR[0] - p.footL[0];
    if (Math.abs(spread) < o.minSpread * L) { weight.push(0); continue; }
    const t = (p.pelvis[0] - p.footL[0]) / spread;
    let w = Math.max(-1, Math.min(1, 2 * t - 1));
    if (Math.abs(w) < o.dead) w = 0;
    weight.push(w);
  }
  return { weight, liftL, liftR };
}

// authored tables: weight from contacts (one planted → ±1 toward it; both
// → 0; neither → null = airborne). Exact inverse below: round-trip identity.
export function weightFromContacts(contacts) {
  const L = contacts?.includes("footL"), R = contacts?.includes("footR");
  return L && R ? 0 : L ? -1 : R ? 1 : null;
}

// the engine's contacts, DERIVED from weight: |w| ≥ 0.6 → the free foot is
// unplanted; otherwise both are planted; null → neither
export function contactsFromWeight(w) {
  if (w == null) return [];
  if (w <= -0.6) return ["footL"];
  if (w >= 0.6) return ["footR"];
  return ["footL", "footR"];
}
