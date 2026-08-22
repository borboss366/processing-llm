/**
 * creature — soft-body dancing creature with a generated armature.
 *
 * Reference beatPhase user (see MODULE_ABI.md): gait phase comes from
 * audio.state.beatPhase while beatConfidence ≥ 0.4, otherwise free-runs at
 * lastConfidentBpm. Never stops.
 *
 * Pipeline (built once in setup, physics per frame):
 *   shape   — labelled primitives (body/head circles+capsules, limb
 *             capsules) in a unit box; 'quadruped' | 'jelly'
 *   tissue  — body/head: jittered grid + k-nearest (among themselves).
 *             limbs/tentacles: RING CHAINS along the capsule axis (rings
 *             every ~1/12 length, 2-3 nodes each, ring+next+diagonal edges)
 *             so they stay continuous instead of fragmenting into beads.
 *             First ring is stitched to the nearest body nodes.
 *   bones   — joints with parent links; quadruped legs have knees. Tips pin
 *             8-10 nodes (rigid paws), other joints 4.
 *   gait    — per joint θ = A·sin(2π(freq·phase + off)); root bounce at 2×
 *             beat, stride lean (trot), bell pulse + upward swim (jelly).
 *   physics — pinned → joint targets; Verlet + 3 relaxation iterations,
 *             floor clamp with contact friction, weak centering.
 *   render  — additive within the p5 canvas: part-hue faces (alpha .3),
 *             bright thick boundary edges (+wide low-alpha glow pass), dim
 *             interior edges, nodes only near joints.
 */

// ── SDF / geometry helpers ─────────────────────────────────────────────────
function sdCircle(px, py, c) { return Math.hypot(px - c.cx, py - c.cy) - c.r; }
function sdCapsule(px, py, c) {
  const bax = c.bx - c.ax, bay = c.by - c.ay;
  const pax = px - c.ax, pay = py - c.ay;
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - c.r;
}
function sdPrim(p, x, y) { return p.type === 'circle' ? sdCircle(x, y, p) : sdCapsule(x, y, p); }

// Shapes. Limb capsules are ring-sampled a(root)→b(tip); body/head are
// grid-sampled. Joint lists reference limbs by index.
const SHAPES = {
  quadruped: {
    core: [
      { label: 'body', type: 'capsule', ax: 0.30, ay: 0.45, bx: 0.70, by: 0.45, r: 0.105 },
      { label: 'head', type: 'circle', cx: 0.82, cy: 0.31, r: 0.09 },
    ],
    limbs: [
      { label: 'limb0', ax: 0.33, ay: 0.50, bx: 0.29, by: 0.80, r: 0.042, ringN: 3 },
      { label: 'limb1', ax: 0.41, ay: 0.50, bx: 0.38, by: 0.80, r: 0.042, ringN: 3 },
      { label: 'limb2', ax: 0.61, ay: 0.50, bx: 0.58, by: 0.80, r: 0.042, ringN: 3 },
      { label: 'limb3', ax: 0.69, ay: 0.50, bx: 0.66, by: 0.80, r: 0.042, ringN: 3 },
    ],
    joints: [
      { name: 'hip',      x: 0.35, y: 0.45, parent: -1, role: 'root' },
      { name: 'shoulder', x: 0.65, y: 0.45, parent: 0,  role: 'rootMid' },
      { name: 'neck',     x: 0.80, y: 0.33, parent: 1,  role: 'head' },
      // per leg: knee (parent hip/shoulder) then tip (parent knee)
      { name: 'knee0', x: 0.31, y: 0.65, parent: 0, role: 'knee', limb: 0 },
      { name: 'tip0',  x: 0.29, y: 0.79, parent: 3, role: 'limb', limb: 0, paw: true },
      { name: 'knee1', x: 0.395, y: 0.65, parent: 0, role: 'knee', limb: 1 },
      { name: 'tip1',  x: 0.38, y: 0.79, parent: 5, role: 'limb', limb: 1, paw: true },
      { name: 'knee2', x: 0.595, y: 0.65, parent: 1, role: 'knee', limb: 2 },
      { name: 'tip2',  x: 0.58, y: 0.79, parent: 7, role: 'limb', limb: 2, paw: true },
      { name: 'knee3', x: 0.675, y: 0.65, parent: 1, role: 'knee', limb: 3 },
      { name: 'tip3',  x: 0.66, y: 0.79, parent: 9, role: 'limb', limb: 3, paw: true },
    ],
    naturalGait: 'trot',
  },
  jelly: {
    core: [
      { label: 'body', type: 'circle', cx: 0.50, cy: 0.34, r: 0.185 },
    ],
    limbs: [
      { label: 'limb0', ax: 0.35, ay: 0.47, bx: 0.31, by: 0.84, r: 0.027, ringN: 2 },
      { label: 'limb1', ax: 0.43, ay: 0.50, bx: 0.41, by: 0.87, r: 0.027, ringN: 2 },
      { label: 'limb2', ax: 0.50, ay: 0.51, bx: 0.50, by: 0.88, r: 0.027, ringN: 2 },
      { label: 'limb3', ax: 0.57, ay: 0.50, bx: 0.59, by: 0.87, r: 0.027, ringN: 2 },
      { label: 'limb4', ax: 0.65, ay: 0.47, bx: 0.69, by: 0.84, r: 0.027, ringN: 2 },
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

// Gait tables. trot: diagonal legs (0,3) vs (1,2); knees lag tips by 0.1;
// root bounce 2×, stride lean 1×; head bob 2× at 0.25 behind the bounce.
const GAITS = {
  trot: {
    limb:   (i) => ({ A: 0.50, freq: 1, off: (i === 0 || i === 3) ? 0 : 0.5 }),
    knee:   (i) => ({ A: 0.35, freq: 1, off: ((i === 0 || i === 3) ? 0 : 0.5) - 0.1 }),
    head:   ()  => ({ A: 0.28, freq: 2, off: -0.25 }),
    root:   ()  => ({ A: 0.04, freq: 1, off: 0 }),        // stride lean (radians)
    rootMid:()  => ({ A: 0.04, freq: 1, off: 0.5 }),
    tent:   (i) => ({ A: 0.25, freq: 1, off: (i % 2) * 0.5 }),
    bellPulse: 0, bounce: 0.03, drift: 0,
  },
  pulse: {
    limb:   ()  => ({ A: 0.40, freq: 1, off: 0 }),
    knee:   ()  => ({ A: 0.25, freq: 1, off: -0.1 }),
    head:   ()  => ({ A: 0.10, freq: 1, off: 0 }),
    root:   ()  => ({ A: 0, freq: 1, off: 0 }),
    rootMid:()  => ({ A: 0, freq: 1, off: 0 }),
    tent:   ()  => ({ A: 0.18, freq: 1, off: 0 }),
    bellPulse: 0.20, bounce: 0.012, drift: 0.02,
  },
};

function build(state, params) {
  const def = SHAPES[params.shape] ?? SHAPES.quadruped;
  const target = Math.max(150, Math.min(800, params.nodeCount | 0));

  const xs = [], ys = [], labels = [];
  const addNode = (x, y, lab) => { xs.push(x); ys.push(y); labels.push(lab); return xs.length - 1; };
  const edgeSet = new Set();
  const EK = (i, j) => (i < j ? i * 4096 + j : j * 4096 + i);
  const addEdge = (i, j) => { if (i !== j) edgeSet.add(EK(i, j)); };

  // ── body/head: jittered grid + k-nearest among core nodes only ──────
  const inCore = (x, y) => def.core.some((p) => sdPrim(p, x, y) < 0);
  const coreLabel = (x, y) => {
    let best = Infinity, lab = 'body';
    for (const p of def.core) { const d = sdPrim(p, x, y); if (d < best) { best = d; lab = p.label; } }
    return lab;
  };
  let hits = 0;
  const PROBE = 64;
  for (let i = 0; i < PROBE; i++) for (let j = 0; j < PROBE; j++) {
    if (inCore((i + 0.5) / PROBE, (j + 0.5) / PROBE)) hits++;
  }
  const coreArea = hits / (PROBE * PROBE);
  const limbBudget = def.limbs.length * 12 * (def.limbs[0].ringN ?? 3);
  const coreTarget = Math.max(80, target - limbBudget);
  const step = Math.sqrt(Math.max(1e-6, coreArea) / coreTarget);
  for (let gx = step / 2; gx < 1; gx += step) {
    for (let gy = step / 2; gy < 1; gy += step) {
      const x = gx + (Math.random() - 0.5) * step * 0.8;
      const y = gy + (Math.random() - 0.5) * step * 0.8;
      if (inCore(x, y)) addNode(x, y, coreLabel(x, y));
    }
  }
  const nCore = xs.length;
  const kNear = 3;
  for (let i = 0; i < nCore; i++) {
    const d2 = [];
    for (let j = 0; j < nCore; j++) if (j !== i) {
      d2.push([(xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2, j]);
    }
    d2.sort((a, b) => a[0] - b[0]);
    for (let m = 0; m < kNear && m < d2.length; m++) addEdge(i, d2[m][1]);
  }

  // ── limbs/tentacles: ring chains along the capsule axis ─────────────
  const RINGS = 12;
  for (const L of def.limbs) {
    const dx = L.bx - L.ax, dy = L.by - L.ay;
    const len = Math.hypot(dx, dy);
    const perpX = -dy / len, perpY = dx / len;
    const ringN = L.ringN ?? 3;
    let prevRing = null;
    for (let r = 0; r < RINGS; r++) {
      const t = r / (RINGS - 1);
      const cx = L.ax + dx * t, cy = L.ay + dy * t;
      const ring = [];
      for (let m = 0; m < ringN; m++) {
        const off = ringN === 1 ? 0 : (m / (ringN - 1) - 0.5) * 2 * L.r * 0.7;
        ring.push(addNode(cx + perpX * off, cy + perpY * off, L.label));
      }
      for (let m = 0; m + 1 < ring.length; m++) addEdge(ring[m], ring[m + 1]);
      if (prevRing) {
        for (let m = 0; m < ring.length; m++) addEdge(ring[m], prevRing[Math.min(m, prevRing.length - 1)]);
        addEdge(ring[0], prevRing[prevRing.length - 1]);   // one diagonal per pair: shear stiffness
      } else {
        // stitch the first ring into the body: 2 nearest core nodes each
        for (const i of ring) {
          const d2 = [];
          for (let j = 0; j < nCore; j++) d2.push([(xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2, j]);
          d2.sort((a, b) => a[0] - b[0]);
          addEdge(i, d2[0][1]); addEdge(i, d2[1][1]);
        }
      }
      prevRing = ring;
    }
  }

  const n = xs.length;
  const pos = new Float32Array(n * 2), prev = new Float32Array(n * 2), rest = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    pos[i * 2] = prev[i * 2] = rest[i * 2] = xs[i];
    pos[i * 2 + 1] = prev[i * 2 + 1] = rest[i * 2 + 1] = ys[i];
  }
  const edges = new Int32Array(edgeSet.size * 2);
  const restLen = new Float32Array(edgeSet.size);
  const adj = Array.from({ length: n }, () => []);
  let e = 0;
  for (const key of edgeSet) {
    const i = (key / 4096) | 0, j = key % 4096;
    edges[e * 2] = i; edges[e * 2 + 1] = j;
    restLen[e] = Math.hypot(xs[i] - xs[j], ys[i] - ys[j]);
    adj[i].push(j); adj[j].push(i);
    e++;
  }

  // triangles (3 mutually connected) for the face fill
  const tris = [];
  for (let i = 0; i < n; i++) {
    const nb = adj[i];
    for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) {
      const j = nb[a], q = nb[b];
      if (i < j && j < q && edgeSet.has(EK(j, q))) tris.push(i, j, q);
    }
  }

  // Boundary edges from the SDF, not triangle counts: on a sparse k-NN graph
  // most triangles are isolated, so "edge in exactly one triangle" classifies
  // half the interior as boundary (rendered as bright confetti). Geometric
  // truth instead: both endpoints within one grid step of the SDF surface,
  // and the edge short (a surface-following hop, not a chord).
  const allPrims = [...def.core, ...def.limbs];
  const sdAll = (x, y) => {
    let d = Infinity;
    for (const p of allPrims) d = Math.min(d, sdPrim(p, x, y));
    return d;
  };
  const surface = new Uint8Array(n);
  for (let i = 0; i < n; i++) surface[i] = sdAll(xs[i], ys[i]) > -0.017 ? 1 : 0;
  const lens = Array.from(restLen).sort((a, b) => a - b);
  const medLen = lens[Math.floor(lens.length / 2)] || 0.02;
  const boundary = new Uint8Array(restLen.length);
  for (let e2 = 0; e2 < restLen.length; e2++) {
    boundary[e2] =
      surface[edges[e2 * 2]] && surface[edges[e2 * 2 + 1]] && restLen[e2] <= medLen * 1.9 ? 1 : 0;
  }

  // ── joints + pins (paws grab 8-10 nodes, others 4) ──────────────────
  const joints = def.joints.map((J) => ({ ...J }));
  const pinned = new Set();
  for (const J of joints) {
    const want = J.paw ? 9 : 4;
    const byDist = [];
    for (let i = 0; i < n; i++) byDist.push([Math.hypot(xs[i] - J.x, ys[i] - J.y), i]);
    byDist.sort((a, b) => a[0] - b[0]);
    J.pins = [];
    for (let m = 0; m < byDist.length && J.pins.length < want; m++) {
      const i = byDist[m][1];
      if (pinned.has(i) || byDist[m][0] > (J.paw ? 0.09 : 0.12)) continue;
      pinned.add(i);
      J.pins.push({ i, offX: xs[i] - J.x, offY: ys[i] - J.y });
    }
  }

  // nodes drawn only near joints (within 1.5× pin radius)
  const drawNodes = [];
  const nodeR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let dMin = Infinity;
    for (const J of joints) dMin = Math.min(dMin, Math.hypot(xs[i] - J.x, ys[i] - J.y));
    if (dMin < 0.12 * 1.5) {
      drawNodes.push(i);
      nodeR[i] = 2 + 3.5 * Math.max(0, 1 - dMin / 0.18);
    }
  }

  // rest bounding box → scale/framing (feet placed on the ground line)
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]);
  }

  const triByPart = {};
  for (let t = 0; t < tris.length; t += 3) {
    (triByPart[labels[tris[t]]] ??= []).push(tris[t], tris[t + 1], tris[t + 2]);
  }

  // Per-node metaball radius: 1.4× the LOCAL mean incident edge length —
  // thin ring-chain limbs are spaced ~2× the body grid, and a global radius
  // leaves their sprites below the goo threshold (tentacles vanish).
  const spriteR = new Float32Array(n);
  {
    const sum = new Float32Array(n), cnt = new Float32Array(n);
    for (let e2 = 0; e2 < restLen.length; e2++) {
      sum[edges[e2 * 2]] += restLen[e2]; cnt[edges[e2 * 2]]++;
      sum[edges[e2 * 2 + 1]] += restLen[e2]; cnt[edges[e2 * 2 + 1]]++;
    }
    for (let i = 0; i < n; i++) spriteR[i] = 1.4 * (cnt[i] ? sum[i] / cnt[i] : medLen);
  }

  Object.assign(state, {
    def, n, pos, prev, rest, edges, restLen, boundary, joints, pinned,
    nodeR, drawNodes, labels, triByPart, fleshR: medLen * 1.6, medLen, spriteR,
    bbox: { minX, maxX, minY, maxY, h: maxY - minY, cx: (minX + maxX) / 2 },
    freePhase: 0, perfMs: 0, sprites: null,
    builtShape: params.shape, builtCount: params.nodeCount,
  });
}

const PART_HUE = { body: 190, head: 315, limb0: 25, limb1: 55, limb2: 85, limb3: 130, limb4: 160 };

// ── Gooey layer (brief 6, Task 1): the tissue nodes are invisible metaball
// centres. Soft radial sprites accumulate additively on a dedicated canvas
// between Butterchurn and the p5 fg canvas; an SVG gaussian-blur +
// alpha-threshold filter (the standard gooey filter) turns the union into a
// smooth soft body with a clean silhouette. Physics untouched. ────────────

function ensureGooLayer(state, params) {
  if (!state.goo) {
    const canvas = document.createElement('canvas');
    canvas.id = 'creature-goo';
    canvas.style.cssText =
      'position:absolute; inset:0; width:100%; height:100%; pointer-events:none;';
    // between the Butterchurn canvas (#bg) and the p5 layer (#fg-container)
    const fg = document.getElementById('fg-container');
    (fg ?? document.body).before(canvas);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.position = 'absolute';
    svg.innerHTML =
      `<defs><filter id="creature-goo-f">` +
      `<feGaussianBlur in="SourceGraphic" stdDeviation="6" result="b"/>` +
      `<feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7"/>` +
      `</filter></defs>`;
    document.body.appendChild(svg);
    canvas.style.filter = 'url(#creature-goo-f)';
    state.goo = { canvas, g: canvas.getContext('2d'), svg, blur: 6, threshold: 0.42 };
  }
  const goo = state.goo;
  // params → filter attributes: alpha' = slope·a + (0.5 − slope·threshold)
  const blur = Number(params.gooBlur) || 6;
  const thr = Math.max(0.05, Math.min(0.9, Number(params.gooThreshold) || 0.42));
  if (blur !== goo.blur || thr !== goo.threshold) {
    goo.blur = blur; goo.threshold = thr;
    const slope = 18;
    goo.svg.querySelector('feGaussianBlur').setAttribute('stdDeviation', String(blur));
    goo.svg.querySelector('feColorMatrix').setAttribute('values',
      `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${slope} ${(0.5 - slope * thr).toFixed(2)}`);
  }
  if (goo.canvas.width !== window.innerWidth || goo.canvas.height !== window.innerHeight) {
    goo.canvas.width = window.innerWidth;
    goo.canvas.height = window.innerHeight;
  }
  return goo;
}

// Pre-rendered soft sprites, one per part hue: radial gaussian-ish falloff.
function ensureSprites(state) {
  if (state.sprites) return state.sprites;
  const sprites = {};
  for (const [lab, hue] of Object.entries(PART_HUE)) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    const col = (a) => `hsla(${hue}, 85%, 62%, ${a})`;
    grad.addColorStop(0, col(1));
    grad.addColorStop(0.35, col(0.62));
    grad.addColorStop(0.65, col(0.22));
    grad.addColorStop(1, col(0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    sprites[lab] = c;
  }
  state.sprites = sprites;
  return sprites;
}

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
    bounce: 1.0,               // root bounce multiplier
    stiffness: 0.75,           // spring relaxation factor 0..1
    nodeCount: 600,
    scale: 1.0,                // × (65% of canvas height)
    ground: 0.82,              // floor line, canvas-height fraction
    xFrac: 0.5,
    renderMode: 'goo',         // 'goo' (metaball soft body) | 'wire' (diagnostic)
    gooBlur: 6,                // gooey filter stdDeviation (px)
    gooThreshold: 0.42,        // gooey alpha threshold 0..1
  },

  setup(ctx) {
    ctx.state = {};
    build(ctx.state, ctx.params);
  },

  draw(ctx) {
    const { p, params, state } = ctx;
    const a = ctx.audio.state;
    const t0 = performance.now();

    if (state.builtShape !== params.shape || state.builtCount !== params.nodeCount) {
      build(state, params);
    }

    // ── phase: PLL when confident, else free-run at lastConfidentBpm ────
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
    const level = Math.min(1, 0.35 + (a.smoothedLevel ?? 0) * 1.3);
    const amp = params.amplitude * level;
    const bellScale = 1 + (gait.bellPulse ?? 0) * Math.sin(2 * Math.PI * phase) * amp;
    // root motion: vertical bounce at 2× beat + jelly upward swim drift
    const bounceY = (gait.bounce ?? 0) * params.bounce * level * Math.sin(4 * Math.PI * phase)
                  + (gait.drift ?? 0) * -Math.sin(2 * Math.PI * (phase - 0.25)) * params.bounce;

    // ── skeleton ────────────────────────────────────────────────────────
    const { joints, pos, prev, rest, edges, restLen, boundary, n } = state;
    for (const J of joints) {
      const g = (gait[J.role] ?? gait.root)(J.limb ?? 0);
      J.theta = g.A * amp * Math.sin(2 * Math.PI * (g.freq * phase + g.off));
      if (J.parent < 0) {
        J.ax = J.x; J.ay = J.y + bounceY;
      } else {
        const P = joints[J.parent];
        const ox = J.x - P.x, oy = J.y - P.y;
        const rot = J.theta + (P.theta ?? 0) * 0.35;
        const c = Math.cos(rot), s = Math.sin(rot);
        J.ax = P.ax + ox * c - oy * s;
        J.ay = P.ay + ox * s + oy * c;
      }
    }
    for (const J of joints) {
      const scale = J.parent < 0 ? bellScale : 1;
      const c = Math.cos(J.theta), s = Math.sin(J.theta);
      for (const pin of J.pins) {
        const ox = pin.offX * scale, oy = pin.offY * scale;
        pos[pin.i * 2] = prev[pin.i * 2] = J.ax + ox * c - oy * s;
        pos[pin.i * 2 + 1] = prev[pin.i * 2 + 1] = J.ay + ox * s + oy * c;
      }
    }

    // ── physics ─────────────────────────────────────────────────────────
    const damping = 0.9, centering = 0.004;
    const groundY = state.bbox.maxY + 0.004;    // rest feet level = floor
    for (let i = 0; i < n; i++) {
      if (state.pinned.has(i)) continue;
      const ix = i * 2, iy = ix + 1;
      const vx = (pos[ix] - prev[ix]) * damping;
      const vy = (pos[iy] - prev[iy]) * damping;
      prev[ix] = pos[ix]; prev[iy] = pos[iy];
      pos[ix] += vx + (rest[ix] - pos[ix]) * centering;
      pos[iy] += vy + (rest[iy] - pos[iy]) * centering;
      if (pos[iy] > groundY) {                  // floor clamp + contact friction
        pos[iy] = groundY;
        prev[ix] += (pos[ix] - prev[ix]) * 0.5;
      }
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
      if (state.goo) state.goo.g.clearRect(0, 0, state.goo.canvas.width, state.goo.canvas.height);
      state.perfMs = state.perfMs * 0.95 + (performance.now() - t0) * 0.05;
      return;
    }
    // scale/framing: creature height = 65% canvas height × scale; feet on
    // the ground line
    const S = (0.65 * p.height / Math.max(0.05, state.bbox.h)) * params.scale;
    const ox = p.width * params.xFrac - state.bbox.cx * S;
    const oy = p.height * params.ground - state.bbox.maxY * S;
    const X = (i) => ox + pos[i * 2] * S;
    const Y = (i) => oy + pos[i * 2 + 1] * S;
    const kick = a.bands?.kick ?? 0, mid = a.bands?.mid ?? 0;

    if (params.renderMode === 'goo') {
      // metaball soft body on the dedicated layer; nothing on the p5 canvas
      const goo = ensureGooLayer(state, params);
      const sprites = ensureSprites(state);
      const g = goo.g;
      g.clearRect(0, 0, goo.canvas.width, goo.canvas.height);
      g.globalCompositeOperation = 'lighter';
      // brightness rides the bands: body/head on kick, limbs on mid — with a
      // floor high enough that a quiet band can't push parts below threshold
      const aBody = (0.70 + 0.30 * kick) * alpha;
      const aLimb = (0.70 + 0.30 * mid) * alpha;
      for (let i = 0; i < n; i++) {
        const lab = state.labels[i];
        const sp = sprites[lab] ?? sprites.body;
        const r = state.spriteR[i] * S;
        g.globalAlpha = (lab === 'body' || lab === 'head') ? aBody : aLimb;
        g.drawImage(sp, X(i) - r, Y(i) - r, r * 2, r * 2);
      }
      g.globalAlpha = 1;
      state.perfMs = state.perfMs * 0.95 + (performance.now() - t0) * 0.05;
      window.__creaturePerf = { ms: state.perfMs, nodes: n, edges: restLen.length };
      return;
    }
    if (state.goo) state.goo.g.clearRect(0, 0, state.goo.canvas.width, state.goo.canvas.height);

    p.push();
    p.colorMode(p.HSB, 360, 100, 100, 1);
    p.blendMode(p.ADD);   // in-canvas additive: overlaps bloom into glow

    // flesh pass: one soft circle per node — additive overlaps merge into a
    // continuous glowing body mass (the face fill alone is too sparse)
    p.noStroke();
    const fleshD = state.fleshR * 2 * S;
    for (let i = 0; i < n; i++) {
      const lab = state.labels[i];
      const hue = PART_HUE[lab] ?? 210;
      const bright = 40 + 45 * (lab === 'body' || lab === 'head' ? kick : mid);
      p.fill(hue, 75, bright, 0.06 * alpha);
      p.circle(X(i), Y(i), fleshD);
    }

    // faces (per part hue; brightness kick for body/head, mid for limbs)
    for (const [lab, list] of Object.entries(state.triByPart)) {
      const hue = PART_HUE[lab] ?? 210;
      const bright = 35 + 45 * (lab === 'body' || lab === 'head' ? kick : mid);
      p.noStroke();
      p.fill(hue, 70, bright, 0.32 * alpha);
      p.beginShape(p.TRIANGLES);
      for (let t = 0; t < list.length; t++) p.vertex(X(list[t]), Y(list[t]));
      p.endShape();
    }

    // boundary glow: wide faint pass under the bright boundary pass
    for (const pass of [{ w: 7, al: 0.10, br: 95 }, { w: 2.5, al: 0.85, br: 100 }]) {
      p.stroke(195, 25, pass.br, pass.al * alpha);
      p.strokeWeight(pass.w);
      p.beginShape(p.LINES);
      for (let e2 = 0; e2 < restLen.length; e2++) {
        if (!boundary[e2]) continue;
        p.vertex(X(edges[e2 * 2]), Y(edges[e2 * 2]));
        p.vertex(X(edges[e2 * 2 + 1]), Y(edges[e2 * 2 + 1]));
      }
      p.endShape();
    }
    // interior edges: thin and dim
    p.stroke(200, 15, 70, 0.16 * alpha);
    p.strokeWeight(0.8);
    p.beginShape(p.LINES);
    for (let e2 = 0; e2 < restLen.length; e2++) {
      if (boundary[e2]) continue;
      p.vertex(X(edges[e2 * 2]), Y(edges[e2 * 2]));
      p.vertex(X(edges[e2 * 2 + 1]), Y(edges[e2 * 2 + 1]));
    }
    p.endShape();

    // nodes: only near joints
    p.noStroke();
    for (const i of state.drawNodes) {
      const lab = state.labels[i];
      const hue = PART_HUE[lab] ?? 210;
      const bright = 60 + 40 * (lab === 'body' || lab === 'head' ? kick : mid);
      p.fill(hue, 70, bright, 0.9 * alpha);
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

  teardown(ctx) {
    // the goo layer lives in the page DOM — remove it on unload/hot-reload
    const goo = ctx.state?.goo;
    if (goo) {
      goo.canvas.remove();
      goo.svg.remove();
      ctx.state.goo = null;
    }
  },
};
