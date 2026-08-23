/**
 * creature — soft-body dancing creature with locomotion and behaviour.
 *
 * Reference beatPhase user (see MODULE_ABI.md): gait phase comes from
 * audio.state.beatPhase while beatConfidence ≥ 0.4, otherwise free-runs at
 * lastConfidentBpm. Never stops.
 *
 * v4 (brief 7): world-space locomotion with planted feet, behaviour state
 * machine (idle/walk/groove/hop, bar-boundary transitions on an energy
 * z-score), Perlin idle motion, two-hue palette + accent, neck flesh.
 *
 * Physics runs in LOCAL shape space; the world transform (root x, facing
 * mirror, squash/stretch) is applied at draw time. A world-fixed foot is a
 * foot drifting backwards at body speed in local coordinates: feet plant at
 * +0.3·stride ahead of rest and lift at −0.3·stride behind (consistent with
 * a 60% stance), so world-space slide is zero by construction — measured
 * anyway and exposed via window.__creaturePerf.slidePx.
 *
 * Render: gooey metaball layer (brief 6 Task 1) — invisible node sprites +
 * SVG blur/threshold filter. renderMode:'wire' keeps the old diagnostic.
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

const SHAPES = {
  quadruped: {
    core: [
      { label: 'body', type: 'capsule', ax: 0.30, ay: 0.45, bx: 0.70, by: 0.45, r: 0.105 },
      // neck: core flesh, not a pinned satellite — grid-sampled like the body
      { label: 'body', type: 'capsule', ax: 0.70, ay: 0.43, bx: 0.80, by: 0.34, r: 0.055 },
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

// Rotation gaits (groove/pulse). Walk drives tips/knees geometrically.
const GAITS = {
  trot: {
    limb:   (i) => ({ A: 0.50, freq: 1, off: (i === 0 || i === 3) ? 0 : 0.5 }),
    knee:   (i) => ({ A: 0.35, freq: 1, off: ((i === 0 || i === 3) ? 0 : 0.5) - 0.1 }),
    head:   ()  => ({ A: 0.28, freq: 2, off: -0.25 }),
    root:   ()  => ({ A: 0.04, freq: 1, off: 0 }),
    rootMid:()  => ({ A: 0.04, freq: 1, off: 0.5 }),
    tent:   (i) => ({ A: 0.25, freq: 1, off: (i % 2) * 0.5 }),
    bellPulse: 0,
  },
  pulse: {
    limb:   ()  => ({ A: 0.40, freq: 1, off: 0 }),
    knee:   ()  => ({ A: 0.25, freq: 1, off: -0.1 }),
    head:   ()  => ({ A: 0.10, freq: 1, off: 0 }),
    root:   ()  => ({ A: 0, freq: 1, off: 0 }),
    rootMid:()  => ({ A: 0, freq: 1, off: 0 }),
    tent:   ()  => ({ A: 0.18, freq: 1, off: 0 }),
    bellPulse: 0.20,
  },
};

function hueFor(lab, params) {
  if (lab === 'head') return params.hueAccent;
  if (lab === 'body') return params.hueBody;
  return params.hueLimbs;
}

function build(state, params) {
  const def = SHAPES[params.shape] ?? SHAPES.quadruped;
  const target = Math.max(150, Math.min(800, params.nodeCount | 0));

  const xs = [], ys = [], labels = [];
  const addNode = (x, y, lab) => { xs.push(x); ys.push(y); labels.push(lab); return xs.length - 1; };
  const edgeSet = new Set();
  const EK = (i, j) => (i < j ? i * 4096 + j : j * 4096 + i);
  const addEdge = (i, j) => { if (i !== j) edgeSet.add(EK(i, j)); };

  // body/head: jittered grid + k-nearest among core nodes only
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

  // limbs/tentacles: ring chains along the capsule axis
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
        addEdge(ring[0], prevRing[prevRing.length - 1]);
      } else {
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

  // triangles for the wire-diagnostic face fill
  const tris = [];
  for (let i = 0; i < n; i++) {
    const nb = adj[i];
    for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) {
      const j = nb[a], q = nb[b];
      if (i < j && j < q && edgeSet.has(EK(j, q))) tris.push(i, j, q);
    }
  }
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

  // joints + pins
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

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i]); maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]); maxY = Math.max(maxY, ys[i]);
  }

  const triByPart = {};
  for (let t = 0; t < tris.length; t += 3) {
    (triByPart[labels[tris[t]]] ??= []).push(tris[t], tris[t + 1], tris[t + 2]);
  }

  // Per-node metaball radius: 1.4× LOCAL mean incident edge length (thin
  // limb chains vanish under a global radius); body/head get a floor so the
  // torso has no threshold holes.
  const spriteR = new Float32Array(n);
  {
    const sum = new Float32Array(n), cnt = new Float32Array(n);
    for (let e2 = 0; e2 < restLen.length; e2++) {
      sum[edges[e2 * 2]] += restLen[e2]; cnt[edges[e2 * 2]]++;
      sum[edges[e2 * 2 + 1]] += restLen[e2]; cnt[edges[e2 * 2 + 1]]++;
    }
    for (let i = 0; i < n; i++) {
      let r = 1.4 * (cnt[i] ? sum[i] / cnt[i] : medLen);
      if (labels[i] === 'body' || labels[i] === 'head') r = Math.max(r, 1.9 * medLen);
      spriteR[i] = r;
    }
  }

  // per-limb tip metadata for the walk cycle
  const tips = joints.filter((J) => J.role === 'limb');

  Object.assign(state, {
    def, n, pos, prev, rest, edges, restLen, boundary, joints, pinned,
    nodeR, drawNodes, labels, triByPart, medLen, spriteR, tips,
    bbox: { minX, maxX, minY, maxY, h: maxY - minY, w: maxX - minX, cx: (minX + maxX) / 2 },
    freePhase: 0, perfMs: 0, sprites: null, spriteKey: '',
    world: null, feet: null,
    beh: { state: 'walk', lastBar: 0, lowBars: 0, em: 0.2, ev: 0.01 },
    slidePx: 0,
    builtShape: params.shape, builtCount: params.nodeCount,
  });
}

// ── Gooey layer (brief 6) ──────────────────────────────────────────────────
function ensureGooLayer(state, params) {
  if (!state.goo) {
    const canvas = document.createElement('canvas');
    canvas.id = 'creature-goo';
    canvas.style.cssText =
      'position:absolute; inset:0; width:100%; height:100%; pointer-events:none;';
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

function ensureSprites(state, params) {
  const key = `${params.hueBody}|${params.hueLimbs}|${params.hueAccent}`;
  if (state.sprites && state.spriteKey === key) return state.sprites;
  const sprites = {};
  for (const lab of ['body', 'head', 'limb']) {
    const hue = lab === 'limb' ? params.hueLimbs : hueFor(lab, params);
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
  state.spriteKey = key;
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
    archetype: 'auto',         // 'auto' | 'trot' | 'pulse' (groove rotation gait)
    behavior: 'auto',          // 'auto' | 'idle' | 'walk' | 'groove' | 'hop'
    speed: 0.35,               // body-heights per second when walking
    beatsPerStride: 1,
    amplitude: 1.0,
    bounce: 1.0,
    stiffness: 0.75,
    nodeCount: 600,
    scale: 1.0,
    ground: 0.82,
    xFrac: 0.5,
    hueBody: 190, hueLimbs: 150, hueAccent: 315,   // two families + accent
    renderMode: 'goo',
    gooBlur: 6,
    gooThreshold: 0.42,
  },

  setup(ctx) {
    ctx.state = {};
    build(ctx.state, ctx.params);
  },

  draw(ctx) {
    const { p, params, state } = ctx;
    const a = ctx.audio.state;
    const t0 = performance.now();
    const dt = Math.min(0.08, p.deltaTime / 1000);
    const tSec = t0 / 1000;

    if (state.builtShape !== params.shape || state.builtCount !== params.nodeCount) {
      build(state, params);
    }

    // ── phase: PLL when confident, else free-run ────────────────────────
    let phase;
    const confident = a.beatConfidence >= 0.4 && a.bpm > 0;
    const bpmUsed = confident ? a.bpm : (a.lastConfidentBpm > 0 ? a.lastConfidentBpm : 120);
    if (confident) {
      phase = a.beatPhase;
      state.freePhase = phase;
    } else {
      state.freePhase = (state.freePhase + dt * (bpmUsed / 60)) % 1;
      phase = state.freePhase;
    }
    const beatSec = 60 / bpmUsed;
    const level = a.smoothedLevel ?? 0;
    const lvl = Math.min(1, 0.35 + level * 1.3);

    // ── behaviour state machine: transitions on bar wraps, energy z-score ─
    const beh = state.beh;
    const alphaE = Math.min(0.2, dt / 20);       // ~20 s running stats
    beh.em = beh.em * (1 - alphaE) + level * alphaE;
    const dev = level - beh.em;
    beh.ev = beh.ev * (1 - alphaE) + dev * dev * alphaE;
    const z = dev / Math.sqrt(beh.ev + 1e-6);
    const barPhase = confident ? a.barPhase : state.freePhase / 4;
    const wrapped = barPhase < beh.lastBar - 0.5;
    beh.lastBar = barPhase;
    let next = beh.state;
    if (params.behavior !== 'auto') {
      next = params.behavior;
    } else if (!confident) {
      next = 'idle';
    } else if (wrapped) {
      if (z < -0.5) { beh.lowBars++; if (beh.lowBars >= 2) next = 'idle'; }
      else {
        beh.lowBars = 0;
        next = z > 1.5 ? 'hop' : z > 0.5 ? 'groove' : 'walk';
      }
    }
    if (next !== beh.state) {
      beh.state = next;
      try { window.__ws?.send({ type: 'creature-state', state: next, z: +z.toFixed(2) }); } catch {}
    }
    const st = beh.state;

    // ── world locomotion ────────────────────────────────────────────────
    const S = (0.65 * p.height / Math.max(0.05, state.bbox.h)) * params.scale;
    const groundPx = p.height * params.ground;
    state.world ??= { x: p.width * params.xFrac, facing: 1, facingVis: 1, turn: null };
    const world = state.world;
    const isQuad = state.def === SHAPES.quadruped;
    const speedU = params.speed * state.bbox.h;              // unit/s
    const strideU = speedU * beatSec * Math.max(0.25, params.beatsPerStride);

    // Phase-locked odometry: the body advances by Δphase·stride, the SAME
    // clock the stride cycle runs on — never by wall-clock dt. With separate
    // clocks any frame stall desynchronises body translation from stance
    // foot drift (dt clamps differ render vs audio) and feet slide; measured
    // 12–19 px per stall. On one clock the two cancel exactly.
    let dPhase = phase - (world.lastPhase ?? phase);
    if (dPhase < -0.5) dPhase += 1;
    if (dPhase < 0) dPhase = 0;
    world.lastPhase = phase;

    if (isQuad && st === 'walk') {
      if (world.turn) {
        const u = Math.min(1, (t0 - world.turn.t0) / 400);
        world.facingVis = world.turn.from + (world.turn.to - world.turn.from) * u;
        if (u >= 1) { world.facing = world.turn.to; world.turn = null; }
      } else {
        world.x += dPhase * strideU * S * world.facing;
        if (world.facing > 0 && world.x > p.width * 0.82) world.turn = { t0, from: 1, to: -1 };
        if (world.facing < 0 && world.x < p.width * 0.18) world.turn = { t0, from: -1, to: 1 };
        world.facingVis = world.facing;
      }
    } else if (!isQuad) {
      // jelly: slow drift, lazy eased turns, no mirror
      world.vx ??= speedU * 0.35;
      const targetV = (world.x > p.width * 0.8 ? -1 : world.x < p.width * 0.2 ? 1 :
        Math.sign(world.vx || 1)) * speedU * 0.35;
      world.vx += (targetV - world.vx) * Math.min(1, dt * 0.8);
      if (st !== 'idle') world.x += world.vx * S * dt;
      world.facingVis = 1;
    }

    // ── skeleton targets per state ──────────────────────────────────────
    const gaitName = params.archetype === 'auto' ? state.def.naturalGait : params.archetype;
    const gait = GAITS[gaitName] ?? GAITS.trot;
    const amp = params.amplitude * lvl * (st === 'idle' ? 0 : 1);
    const bellScale = !isQuad && st !== 'idle'
      ? 1 + gait.bellPulse * Math.sin(2 * Math.PI * phase) * amp : 1 + 0.02 * Math.sin(2 * Math.PI * 0.2 * tSec);

    // squash/stretch driver: cos aligns squash with mid-stance compression
    // (the brief's sin puts it between plants). s=+1 flight/plant, −1 mid-stance.
    let sq = 0, bounceY = 0;
    const H = state.bbox.h;
    if (st === 'walk') {
      const s = Math.cos(4 * Math.PI * phase);
      sq = 0.05 * s * lvl;
      bounceY = -0.05 * H * ((s + 1) / 2) * lvl * params.bounce;   // high at plant/flight
    } else if (st === 'groove') {
      const s = Math.sin(4 * Math.PI * phase);
      sq = 0.05 * s * lvl;
      bounceY = -0.08 * H * Math.max(0, Math.sin(4 * Math.PI * phase)) * lvl * params.bounce;
    } else if (st === 'hop') {
      const air = Math.max(0, Math.sin(2 * Math.PI * phase));
      sq = (air > 0 ? 0.07 * air : -0.06) * lvl;
      bounceY = -0.13 * H * air * lvl * params.bounce;
    }
    if (!isQuad) {
      bounceY += (st === 'idle' ? 0 : -0.02 * H * Math.sin(2 * Math.PI * (phase - 0.25)) * params.bounce);
    }

    // idle layers (full strength in idle, faint under everything else)
    const idleK = st === 'idle' ? 1 : 0.3;
    const swayU = ((p.noise(tSec * 0.13, 7) - 0.5) * 2) * 0.02 * state.bbox.w * idleK;
    const rearBob = ((p.noise(tSec * 0.4, 23) - 0.5) * 2) * 0.006 * idleK;
    let headLook = ((p.noise(tSec * 0.07, 13) - 0.5) * 2) * 0.45 * idleK;
    if (p.noise(tSec * 0.02, 41) > 0.72) headLook += 0.35 * idleK;   // occasional quick reorient

    const { joints, pos, prev, rest, edges, restLen, boundary, n } = state;
    for (const J of joints) {
      const g = (gait[J.role] ?? gait.root)(J.limb ?? 0);
      const rotOn = (st === 'groove' || st === 'hop' || (!isQuad && st !== 'idle'));
      J.theta = rotOn ? g.A * amp * Math.sin(2 * Math.PI * (g.freq * phase + g.off)) : 0;
      if (J.role === 'head') J.theta += headLook;
      if (J.parent < 0) {
        J.ax = J.x + swayU; J.ay = J.y + bounceY + (J.role === 'root' ? rearBob : 0);
      } else {
        const P = joints[J.parent];
        const ox = J.x - P.x, oy = J.y - P.y;
        const rot = J.theta + (P.theta ?? 0) * 0.35;
        const c = Math.cos(rot), s = Math.sin(rot);
        J.ax = P.ax + ox * c - oy * s;
        J.ay = P.ay + ox * s + oy * c;
      }
    }

    // walk/hop feet override the rotation chain: stance locks the foot in
    // world space (expressed as backward drift in local space), swing arcs
    // to the next plant; hop lifts all feet together.
    let slidePx = 0;
    if (isQuad && (st === 'walk' || st === 'hop')) {
      state.feet ??= {};
      for (const T of state.tips) {
        const off = (T.limb === 0 || T.limb === 3) ? 0 : 0.5;
        const foot = (state.feet[T.name] ??= { plantWX: null });
        if (st === 'hop') {
          const air = Math.max(0, Math.sin(2 * Math.PI * phase));
          T.ax = T.x; T.ay = T.y - 0.10 * H * air * lvl;
          foot.plantWX = null;
        } else {
          // stride clock = `phase`, NOT barPhase: phase is continuous across
          // the confidence-gate switch (freePhase shadows beatPhase), while
          // barPhase jumps there — measured ~11 px of foot slide from it
          const cyc = (phase / Math.max(0.25, params.beatsPerStride) - off) % 1;
          const c = cyc < 0 ? cyc + 1 : cyc;
          if (c < 0.6) {
            // stance: fixed in world = drifting back at body speed in local
            T.ax = T.x + strideU * (0.3 - c);
            T.ay = T.y;
            const wx = world.x + (T.ax - joints[0].x) * S * world.facingVis;
            if (foot.plantWX === null) foot.plantWX = wx;
            else if (!world.turn) slidePx = Math.max(slidePx, Math.abs(wx - foot.plantWX));
          } else {
            const u = (c - 0.6) / 0.4;
            T.ax = T.x + strideU * (-0.3 + 0.6 * u);
            T.ay = T.y - 0.5 * strideU * 0.6 * Math.sin(Math.PI * u);
            foot.plantWX = null;
          }
        }
        T.theta = 0;
      }
      // knees: geometric — midpoint of root joint and foot, bent forward
      for (const J of joints) {
        if (J.role !== 'knee') continue;
        const T = joints.find((q) => q.role === 'limb' && q.limb === J.limb);
        const R = joints[J.parent];
        J.ax = (R.ax + T.ax) / 2 + 0.02;
        J.ay = (R.ay + T.ay) / 2;
        J.theta = 0;
      }
    } else {
      state.feet = null;
    }
    state.slidePx = state.slidePx * 0.9 + slidePx * 0.1;

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
    const groundY = state.bbox.maxY + 0.004;
    for (let i = 0; i < n; i++) {
      if (state.pinned.has(i)) continue;
      const ix = i * 2, iy = ix + 1;
      const vx = (pos[ix] - prev[ix]) * damping;
      const vy = (pos[iy] - prev[iy]) * damping;
      prev[ix] = pos[ix]; prev[iy] = pos[iy];
      pos[ix] += vx + (rest[ix] - pos[ix]) * centering;
      pos[iy] += vy + (rest[iy] - pos[iy]) * centering;
      if (pos[iy] > groundY) {
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
    // world transform: mirror + squash/stretch (about root x / ground line).
    // In walk the horizontal squash component is OFF: sx pivots at the root,
    // so it would translate planted feet sideways (measured ~12 px of stance
    // slide, squash oscillation being the dominant term). Vertical squash
    // carries the look; contact-point-pivoted squash isn't worth the cost.
    const breath = 0.02 * Math.sin(2 * Math.PI * 0.2 * tSec) * (st === 'idle' ? 1 : 0.4);
    const sx = world.facingVis * (1 - (st === 'walk' ? 0 : sq));
    const sy = (1 + sq) * (1 + (isQuad ? breath : 0));
    const rootX = joints[0].x;
    const X = (i) => world.x + (pos[i * 2] - rootX) * S * sx;
    const Y = (i) => groundPx - (state.bbox.maxY - pos[i * 2 + 1]) * S * sy;
    const kick = a.bands?.kick ?? 0, mid = a.bands?.mid ?? 0;

    if (params.renderMode === 'goo') {
      const goo = ensureGooLayer(state, params);
      const sprites = ensureSprites(state, params);
      const g = goo.g;
      g.clearRect(0, 0, goo.canvas.width, goo.canvas.height);
      g.globalCompositeOperation = 'lighter';
      // audio drives brightness only (hue fixed by the palette params)
      const aBody = (0.70 + 0.30 * kick) * alpha;
      const aLimb = (0.70 + 0.30 * mid) * alpha;
      for (let i = 0; i < n; i++) {
        const lab = state.labels[i];
        const sp = lab === 'head' ? sprites.head : lab === 'body' ? sprites.body : sprites.limb;
        const r = state.spriteR[i] * S;
        g.globalAlpha = (lab === 'body' || lab === 'head') ? aBody : aLimb;
        g.drawImage(sp, X(i) - r, Y(i) - r, r * 2, r * 2);
      }
      g.globalAlpha = 1;
      state.perfMs = state.perfMs * 0.95 + (performance.now() - t0) * 0.05;
      window.__creaturePerf = {
        ms: state.perfMs, nodes: n, edges: restLen.length,
        state: st, z: +z.toFixed(2), slidePx: +state.slidePx.toFixed(2),
      };
      return;
    }
    if (state.goo) state.goo.g.clearRect(0, 0, state.goo.canvas.width, state.goo.canvas.height);

    // wire diagnostic
    p.push();
    p.colorMode(p.HSB, 360, 100, 100, 1);
    p.blendMode(p.ADD);
    for (const [lab, list] of Object.entries(state.triByPart)) {
      const bright = 35 + 45 * (lab === 'body' || lab === 'head' ? kick : mid);
      p.noStroke();
      p.fill(hueFor(lab, params), 70, bright, 0.32 * alpha);
      p.beginShape(p.TRIANGLES);
      for (let t = 0; t < list.length; t++) p.vertex(X(list[t]), Y(list[t]));
      p.endShape();
    }
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
    p.stroke(200, 15, 70, 0.16 * alpha);
    p.strokeWeight(0.8);
    p.beginShape(p.LINES);
    for (let e2 = 0; e2 < restLen.length; e2++) {
      if (boundary[e2]) continue;
      p.vertex(X(edges[e2 * 2]), Y(edges[e2 * 2]));
      p.vertex(X(edges[e2 * 2 + 1]), Y(edges[e2 * 2 + 1]));
    }
    p.endShape();
    p.pop();

    state.perfMs = state.perfMs * 0.95 + (performance.now() - t0) * 0.05;
    window.__creaturePerf = {
      ms: state.perfMs, nodes: n, edges: restLen.length,
      state: st, z: +z.toFixed(2), slidePx: +state.slidePx.toFixed(2),
    };
  },

  osc(ctx, address, value) {
    const k = address.split('/').pop();
    if (k in ctx.params) ctx.params[k] = value;
    return null;
  },

  teardown(ctx) {
    const goo = ctx.state?.goo;
    if (goo) {
      goo.canvas.remove();
      goo.svg.remove();
      ctx.state.goo = null;
    }
  },
};
