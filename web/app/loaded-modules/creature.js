/**
 * creature — soft-body dancing creature with a generated armature.
 *
 * Reference beatPhase user (see MODULE_ABI.md): gait phase comes from
 * audio.state.beatPhase while beatConfidence ≥ 0.4, otherwise free-runs at
 * lastConfidentBpm. Never stops.
 *
 * Pipeline (all built once in setup, physics per frame):
 *   shape  — union of circles/capsules as a 2D SDF in a unit box, parts
 *            labelled body / head / limb[i]; 'quadruped' | 'jelly'
 *   tissue — jittered grid inside the SDF (~nodeCount points), k-nearest
 *            edges, typed arrays, rest length = initial distance
 *   bones  — hardcoded joints with parent links; each joint pins its
 *            nearest tissue nodes and drags them by its gait rotation
 *   gait   — per joint θ = A·sin(2π(freq·phase + phaseOffset)); archetypes:
 *            'trot' (diagonal limbs in phase) | 'pulse' (all in phase +
 *            bell scale); A scales with smoothedLevel
 *   physics— pinned nodes set to joint targets; the rest Verlet-integrate
 *            with 3 rounds of spring relaxation, damping, weak centering
 */

// ── SDF primitives ─────────────────────────────────────────────────────────
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}
function sdCapsule(px, py, ax, ay, bx, by, r) {
  const bax = bx - ax, bay = by - ay;
  const pax = px - ax, pay = py - ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - r;
}

// Shapes: list of labelled primitives in a unit box (y down, like p5).
const SHAPES = {
  quadruped: {
    prims: [
      { label: 'body',  sd: (x, y) => sdCapsule(x, y, 0.30, 0.45, 0.70, 0.45, 0.105) },
      { label: 'head',  sd: (x, y) => sdCircle(x, y, 0.82, 0.31, 0.09) },
      { label: 'limb0', sd: (x, y) => sdCapsule(x, y, 0.33, 0.50, 0.29, 0.80, 0.042) },
      { label: 'limb1', sd: (x, y) => sdCapsule(x, y, 0.41, 0.50, 0.38, 0.80, 0.042) },
      { label: 'limb2', sd: (x, y) => sdCapsule(x, y, 0.61, 0.50, 0.58, 0.80, 0.042) },
      { label: 'limb3', sd: (x, y) => sdCapsule(x, y, 0.69, 0.50, 0.66, 0.80, 0.042) },
    ],
    joints: [
      { name: 'hip',      x: 0.35, y: 0.45, parent: -1, role: 'root' },
      { name: 'shoulder', x: 0.65, y: 0.45, parent: 0,  role: 'root' },
      { name: 'neck',     x: 0.80, y: 0.33, parent: 1,  role: 'head' },
      { name: 'tip0',     x: 0.29, y: 0.78, parent: 0,  role: 'limb', limb: 0 },
      { name: 'tip1',     x: 0.38, y: 0.78, parent: 0,  role: 'limb', limb: 1 },
      { name: 'tip2',     x: 0.58, y: 0.78, parent: 1,  role: 'limb', limb: 2 },
      { name: 'tip3',     x: 0.66, y: 0.78, parent: 1,  role: 'limb', limb: 3 },
    ],
    naturalGait: 'trot',
  },
  jelly: {
    prims: [
      { label: 'body',  sd: (x, y) => sdCircle(x, y, 0.50, 0.34, 0.185) },
      { label: 'limb0', sd: (x, y) => sdCapsule(x, y, 0.35, 0.47, 0.31, 0.84, 0.027) },
      { label: 'limb1', sd: (x, y) => sdCapsule(x, y, 0.43, 0.50, 0.41, 0.87, 0.027) },
      { label: 'limb2', sd: (x, y) => sdCapsule(x, y, 0.50, 0.51, 0.50, 0.88, 0.027) },
      { label: 'limb3', sd: (x, y) => sdCapsule(x, y, 0.57, 0.50, 0.59, 0.87, 0.027) },
      { label: 'limb4', sd: (x, y) => sdCapsule(x, y, 0.65, 0.47, 0.69, 0.84, 0.027) },
    ],
    joints: [
      { name: 'bell',  x: 0.50, y: 0.34, parent: -1, role: 'root' },
      { name: 'root0', x: 0.35, y: 0.47, parent: 0, role: 'tent' },
      { name: 'root1', x: 0.43, y: 0.50, parent: 0, role: 'tent' },
      { name: 'root2', x: 0.50, y: 0.51, parent: 0, role: 'tent' },
      { name: 'root3', x: 0.57, y: 0.50, parent: 0, role: 'tent' },
      { name: 'root4', x: 0.65, y: 0.47, parent: 0, role: 'tent' },
      { name: 'tip0',  x: 0.31, y: 0.84, parent: 1, role: 'limb', limb: 0 },
      { name: 'tip1',  x: 0.41, y: 0.87, parent: 2, role: 'limb', limb: 1 },
      { name: 'tip2',  x: 0.50, y: 0.88, parent: 3, role: 'limb', limb: 2 },
      { name: 'tip3',  x: 0.59, y: 0.87, parent: 4, role: 'limb', limb: 3 },
      { name: 'tip4',  x: 0.69, y: 0.84, parent: 5, role: 'limb', limb: 4 },
    ],
    naturalGait: 'pulse',
  },
};

// Archetype tables: per joint role → amplitude (radians) / freq / phase.
// trot: diagonal limb pairs in phase (0,3 vs 1,2); head bobs at 2× beat.
// pulse: all limbs in phase; the root additionally scale-pulses the body.
const GAITS = {
  trot: {
    limb:  (i) => ({ A: 0.55, freq: 1, off: (i === 0 || i === 3) ? 0 : 0.5 }),
    head:  ()  => ({ A: 0.14, freq: 2, off: 0.25 }),
    root:  ()  => ({ A: 0,    freq: 1, off: 0 }),
    tent:  (i) => ({ A: 0.25, freq: 1, off: (i % 2) * 0.5 }),
    bellPulse: 0,
  },
  pulse: {
    limb:  ()  => ({ A: 0.40, freq: 1, off: 0 }),
    head:  ()  => ({ A: 0.10, freq: 1, off: 0 }),
    root:  ()  => ({ A: 0,    freq: 1, off: 0 }),
    tent:  ()  => ({ A: 0.18, freq: 1, off: 0 }),
    bellPulse: 0.15,
  },
};

function sdShape(prims, x, y) {
  let best = Infinity, label = null;
  for (const p of prims) {
    const d = p.sd(x, y);
    if (d < best) { best = d; label = p.label; }
  }
  return { d: best, label };
}

function build(state, params) {
  const def = SHAPES[params.shape] ?? SHAPES.quadruped;
  const target = Math.max(100, Math.min(800, params.nodeCount | 0));

  // area estimate → grid step so the jittered grid lands near nodeCount
  let hits = 0;
  const PROBE = 64;
  for (let i = 0; i < PROBE; i++) for (let j = 0; j < PROBE; j++) {
    if (sdShape(def.prims, (i + 0.5) / PROBE, (j + 0.5) / PROBE).d < 0) hits++;
  }
  const area = hits / (PROBE * PROBE);
  const step = Math.sqrt(Math.max(1e-6, area) / target);

  // tissue points: jittered grid + SDF rejection
  const xs = [], ys = [], labels = [];
  for (let gx = step / 2; gx < 1; gx += step) {
    for (let gy = step / 2; gy < 1; gy += step) {
      const x = gx + (Math.random() - 0.5) * step * 0.8;
      const y = gy + (Math.random() - 0.5) * step * 0.8;
      const { d, label } = sdShape(def.prims, x, y);
      if (d < 0) { xs.push(x); ys.push(y); labels.push(label); }
    }
  }
  const n = xs.length;
  const pos = new Float32Array(n * 2), prev = new Float32Array(n * 2), rest = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    pos[i * 2] = prev[i * 2] = rest[i * 2] = xs[i];
    pos[i * 2 + 1] = prev[i * 2 + 1] = rest[i * 2 + 1] = ys[i];
  }

  // k-nearest edges (dedup i<j)
  const k = 3;
  const edgeSet = new Set();
  for (let i = 0; i < n; i++) {
    const d2 = [];
    for (let j = 0; j < n; j++) if (j !== i) {
      const dx = xs[i] - xs[j], dy = ys[i] - ys[j];
      d2.push([dx * dx + dy * dy, j]);
    }
    d2.sort((a, b) => a[0] - b[0]);
    for (let m = 0; m < k && m < d2.length; m++) {
      const j = d2[m][1];
      edgeSet.add(i < j ? i * 4096 + j : j * 4096 + i);
    }
  }
  const edges = new Int32Array(edgeSet.size * 2);
  const restLen = new Float32Array(edgeSet.size);
  let e = 0;
  const adj = Array.from({ length: n }, () => []);
  for (const key of edgeSet) {
    const i = (key / 4096) | 0, j = key % 4096;
    edges[e * 2] = i; edges[e * 2 + 1] = j;
    restLen[e] = Math.hypot(xs[i] - xs[j], ys[i] - ys[j]);
    adj[i].push(j); adj[j].push(i);
    e++;
  }

  // triangles: 3 mutually connected nodes, computed once
  const tris = [];
  for (let i = 0; i < n; i++) {
    const nb = adj[i];
    for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) {
      const j = nb[a], q = nb[b];
      if (i < j && j < q && edgeSet.has(j * 4096 + q)) tris.push(i, j, q);
    }
  }

  // joints: pin nearest tissue nodes
  const joints = def.joints.map((J) => ({ ...J }));
  const pinned = new Set();
  for (const J of joints) {
    const byDist = [];
    for (let i = 0; i < n; i++) {
      byDist.push([Math.hypot(xs[i] - J.x, ys[i] - J.y), i]);
    }
    byDist.sort((a, b) => a[0] - b[0]);
    J.pins = [];
    for (let m = 0; m < byDist.length && J.pins.length < 4; m++) {
      const i = byDist[m][1];
      if (pinned.has(i) || byDist[m][0] > 0.12) continue;   // stay local to the joint
      pinned.add(i);
      J.pins.push({ i, offX: xs[i] - J.x, offY: ys[i] - J.y });
    }
  }

  // node radius by distance to nearest joint (bigger near joints)
  const nodeR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let dMin = Infinity;
    for (const J of joints) dMin = Math.min(dMin, Math.hypot(xs[i] - J.x, ys[i] - J.y));
    nodeR[i] = 1.5 + 3.5 * Math.max(0, 1 - dMin / 0.35);
  }

  // triangle index lists per label (p5 fill is per-batch, not per-vertex)
  const labelOf = (i) => labels[i];
  const triByPart = {};
  for (let t = 0; t < tris.length; t += 3) {
    const lab = labelOf(tris[t]);
    (triByPart[lab] ??= []).push(tris[t], tris[t + 1], tris[t + 2]);
  }

  Object.assign(state, {
    def, n, pos, prev, rest, edges, restLen, joints, pinned, nodeR,
    labels, triByPart, freePhase: 0, perfMs: 0, builtShape: params.shape,
    builtCount: params.nodeCount,
  });
}

const PART_HUE = { body: 190, head: 315, limb0: 25, limb1: 55, limb2: 85, limb3: 130, limb4: 160 };

export default {
  id: 'creature',
  oscPrefix: 'creature',
  interfaces: ['triggerable', 'fadeable'],
  triggerable: { enterMs: 900, holdMs: 120_000, exitMs: 900, autoRetrigger: true },
  fadeable: { easing: 'cubic-out', maxAlpha: 1 },
  defaults: {
    shape: 'quadruped',        // 'quadruped' | 'jelly'
    archetype: 'auto',         // 'auto' | 'trot' | 'pulse'
    amplitude: 1.0,            // gait amplitude multiplier
    stiffness: 0.5,            // spring relaxation factor 0..1
    nodeCount: 450,
    size: 460,                 // unit-box pixels
    xFrac: 0.5, yFrac: 0.52,
  },

  setup(ctx) {
    ctx.state = {};
    build(ctx.state, ctx.params);
  },

  draw(ctx) {
    const { p, params, state } = ctx;
    const a = ctx.audio.state;
    const t0 = performance.now();

    // structural params changed via OSC → rebuild
    if (state.builtShape !== params.shape || state.builtCount !== params.nodeCount) {
      build(state, params);
    }

    // ── gait phase: PLL when confident, else free-run (never stop) ──────
    let phase;
    if (a.beatConfidence >= 0.4 && a.bpm > 0) {
      phase = a.beatPhase;
      state.freePhase = phase;
    } else {
      const bpm = a.lastConfidentBpm > 0 ? a.lastConfidentBpm : 120;
      state.freePhase = (state.freePhase + (p.deltaTime / 1000) * (bpm / 60)) % 1;
      phase = state.freePhase;
    }

    const gaitName = params.archetype === 'auto' ? state.def.naturalGait : params.archetype;
    const gait = GAITS[gaitName] ?? GAITS.trot;
    const amp = params.amplitude * Math.min(1, 0.35 + (a.smoothedLevel ?? 0) * 1.3);
    const bellScale = 1 + (gait.bellPulse ?? 0) * Math.sin(2 * Math.PI * phase) * amp;

    // ── skeleton: animated joint positions (parents first, 1-level rotation)
    const { joints, pos, prev, rest, edges, restLen, n } = state;
    for (const J of joints) {
      const g = (gait[J.role] ?? gait.root)(J.limb ?? 0);
      J.theta = g.A * amp * Math.sin(2 * Math.PI * (g.freq * phase + g.off));
      if (J.parent < 0) {
        J.ax = J.x; J.ay = J.y;
      } else {
        const P = joints[J.parent];
        const ox = J.x - P.x, oy = J.y - P.y;
        const rot = J.theta + (P.theta ?? 0) * 0.35;   // soft parent influence
        const c = Math.cos(rot), s = Math.sin(rot);
        J.ax = P.ax + ox * c - oy * s;
        J.ay = P.ay + ox * s + oy * c;
      }
    }

    // pinned nodes → joint targets (root pins also scale with the bell pulse)
    for (const J of joints) {
      const scale = J.parent < 0 ? bellScale : 1;
      const c = Math.cos(J.theta), s = Math.sin(J.theta);
      for (const pin of J.pins) {
        const ox = pin.offX * scale, oy = pin.offY * scale;
        const tx = J.ax + ox * c - oy * s;
        const ty = J.ay + ox * s + oy * c;
        pos[pin.i * 2] = prev[pin.i * 2] = tx;
        pos[pin.i * 2 + 1] = prev[pin.i * 2 + 1] = ty;
      }
    }

    // ── physics: Verlet + spring relaxation + weak centering ────────────
    const damping = 0.9, centering = 0.004;
    for (let i = 0; i < n; i++) {
      if (state.pinned.has(i)) continue;
      const ix = i * 2, iy = ix + 1;
      const vx = (pos[ix] - prev[ix]) * damping;
      const vy = (pos[iy] - prev[iy]) * damping;
      prev[ix] = pos[ix]; prev[iy] = pos[iy];
      pos[ix] += vx + (rest[ix] - pos[ix]) * centering;
      pos[iy] += vy + (rest[iy] - pos[iy]) * centering;
    }
    const stiff = Math.max(0.05, Math.min(1, params.stiffness));
    for (let iter = 0; iter < 3; iter++) {
      for (let e2 = 0; e2 < restLen.length; e2++) {
        const i = edges[e2 * 2], j = edges[e2 * 2 + 1];
        const ix = i * 2, jx = j * 2;
        let dx = pos[jx] - pos[ix], dy = pos[jx + 1] - pos[ix + 1];
        const d = Math.hypot(dx, dy) || 1e-6;
        const diff = ((d - restLen[e2]) / d) * 0.5 * stiff;
        dx *= diff; dy *= diff;
        const pi = state.pinned.has(i), pj = state.pinned.has(j);
        if (!pi) { pos[ix] += dx * (pj ? 2 : 1); pos[ix + 1] += dy * (pj ? 2 : 1); }
        if (!pj) { pos[jx] -= dx * (pi ? 2 : 1); pos[jx + 1] -= dy * (pi ? 2 : 1); }
      }
    }

    // ── render ──────────────────────────────────────────────────────────
    const alpha = (ctx.lifecycle?.alpha ?? 1);
    if (alpha <= 0.001) {
      state.perfMs = state.perfMs * 0.95 + (performance.now() - t0) * 0.05;
      return;
    }
    const S = params.size;
    const ox = p.width * params.xFrac - S / 2;
    const oy = p.height * params.yFrac - S / 2;
    const X = (i) => ox + pos[i * 2] * S;
    const Y = (i) => oy + pos[i * 2 + 1] * S;
    const kick = a.bands?.kick ?? 0, mid = a.bands?.mid ?? 0;

    p.push();
    p.colorMode(p.HSB, 360, 100, 100, 1);

    // triangles, batched per part (fill colour = part hue)
    for (const [lab, list] of Object.entries(state.triByPart)) {
      const hue = PART_HUE[lab] ?? 210;
      const bright = 45 + 50 * (lab === 'body' || lab === 'head' ? kick : mid);
      p.noStroke();
      p.fill(hue, 65, bright, 0.10 * alpha);
      p.beginShape(p.TRIANGLES);
      for (let t = 0; t < list.length; t++) p.vertex(X(list[t]), Y(list[t]));
      p.endShape();
    }

    // edges, one LINES batch
    p.stroke(200, 15, 90, 0.35 * alpha);
    p.strokeWeight(1);
    p.beginShape(p.LINES);
    for (let e2 = 0; e2 < restLen.length; e2++) {
      p.vertex(X(edges[e2 * 2]), Y(edges[e2 * 2]));
      p.vertex(X(edges[e2 * 2 + 1]), Y(edges[e2 * 2 + 1]));
    }
    p.endShape();

    // nodes: radius grows near joints, hue by part
    p.noStroke();
    for (let i = 0; i < n; i++) {
      const lab = state.labels[i];
      const hue = PART_HUE[lab] ?? 210;
      const bright = 55 + 45 * (lab === 'body' || lab === 'head' ? kick : mid);
      p.fill(hue, 70, bright, 0.85 * alpha);
      p.circle(X(i), Y(i), state.nodeR[i]);
    }
    p.pop();

    state.perfMs = state.perfMs * 0.95 + (performance.now() - t0) * 0.05;
    window.__creaturePerf = { ms: state.perfMs, nodes: n, edges: restLen.length };  // capture-harness seam
  },

  osc(ctx, address, value) {
    const k = address.split('/').pop();
    if (k in ctx.params) ctx.params[k] = value;
    return null;
  },
};
