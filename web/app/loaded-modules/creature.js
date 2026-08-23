/**
 * creature — soft-body dancing creature with locomotion and behaviour.
 *
 * Reference beatPhase user (see MODULE_ABI.md): gait phase comes from
 * audio.state.beatPhase while beatConfidence ≥ 0.4, otherwise free-runs at
 * lastConfidentBpm. Never stops.
 *
 * Shapes are AUTHORED as drawn silhouettes (brief 8 Task 2): a
 * `web/app/shapes/<name>.png` (white = inside) plus a `<name>.json` sidecar
 * with joints/parts/palette — format documented in MODULE_ABI.md. Tissue is
 * rejection-sampled against the bitmap; parts labelled `limb*` are fitted
 * with ring chains along their region's principal axis so limbs stay
 * continuous. The capsule-union shapes are gone.
 *
 * Physics runs in LOCAL shape space; the world transform (root x, facing
 * mirror, squash/stretch) is applied at draw time. Locomotion uses
 * phase-locked odometry (body advances by Δphase·stride — the same clock
 * the stance feet drift on, so frame stalls cancel exactly).
 *
 * Render (brief 8 Task 1): shaded metaball — node sprites accumulate a
 * density + colour field at half res; a WebGL2 fragment shader thresholds
 * and lights it. renderMode:'wire' keeps the old diagnostic.
 */

// ── Gait tables (rotation gaits; walking feet are handled geometrically) ──
// Joint `phase` comes from the shape sidecar (e.g. left/right alternation).
const GAITS = {
  biped: {
    limb:   (i, ph) => ({ A: 0.40, freq: 1, off: ph }),          // arm swing
    knee:   (i, ph) => ({ A: 0.28, freq: 1, off: ph - 0.1 }),
    head:   ()      => ({ A: 0.20, freq: 2, off: -0.25 }),
    root:   ()      => ({ A: 0.03, freq: 1, off: 0 }),           // stride lean
    rootMid:()      => ({ A: 0.03, freq: 1, off: 0.5 }),
    bellPulse: 0, bounce: 0.05, drift: 0,
  },
  trot: {
    limb:   (i, ph) => ({ A: 0.50, freq: 1, off: ph }),
    knee:   (i, ph) => ({ A: 0.35, freq: 1, off: ph - 0.1 }),
    head:   ()      => ({ A: 0.28, freq: 2, off: -0.25 }),
    root:   ()      => ({ A: 0.04, freq: 1, off: 0 }),
    rootMid:()      => ({ A: 0.04, freq: 1, off: 0.5 }),
    bellPulse: 0, bounce: 0.05, drift: 0,
  },
  pulse: {
    limb:   ()      => ({ A: 0.40, freq: 1, off: 0 }),
    knee:   ()      => ({ A: 0.25, freq: 1, off: -0.1 }),
    head:   ()      => ({ A: 0.10, freq: 1, off: 0 }),
    root:   ()      => ({ A: 0, freq: 1, off: 0 }),
    rootMid:()      => ({ A: 0, freq: 1, off: 0 }),
    bellPulse: 0.20, bounce: 0.012, drift: 0.02,
  },
};

// Palette rule (brief 8.2): PRIMARY colours body + limbs, SECONDARY only
// tints the core brightening (never a region hue), ACCENT does head + rim.
const DEFAULT_HUES = { huePrimary: 190, hueSecondary: 150, hueAccent: 315 };

// User-set hue params (via OSC) win; otherwise the shape's palette.
function paletteHue(which, params, palette) {
  const key = which === 'accent' ? 'hueAccent' : which === 'secondary' ? 'hueSecondary' : 'huePrimary';
  const p = Number(params[key]);
  if (Number.isFinite(p) && p !== DEFAULT_HUES[key]) return p;
  return Number(palette?.[which] ?? DEFAULT_HUES[key]);
}
function hueFor(lab, params, palette) {
  return paletteHue(lab === 'head' ? 'accent' : 'primary', params, palette);
}

// ── Shape loading: PNG silhouette + JSON sidecar ──────────────────────────
const shapeCache = new Map();
function loadShape(name) {
  if (shapeCache.has(name)) return shapeCache.get(name);
  const promise = (async () => {
    const json = await (await fetch(`/shapes/${name}.json`)).json();
    const img = new Image();
    img.src = `/shapes/${name}.png`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const px = g.getImageData(0, 0, c.width, c.height).data;
    const W = c.width, H = c.height;
    const inside = (x, y) => {
      if (x < 0 || x >= 1 || y < 0 || y >= 1) return false;
      const i = (((y * H) | 0) * W + ((x * W) | 0)) * 4;
      return px[i + 3] > 127 && px[i] > 127;   // opaque and white
    };
    return { json, inside };
  })();
  shapeCache.set(name, promise);
  return promise;
}

function buildFromShape(state, params, shape) {
  const { json, inside } = shape;
  const target = Math.max(150, Math.min(800, params.nodeCount | 0));
  const limbRegions = (json.parts ?? []).filter((p) => /^limb/.test(p.label));
  const headRegion = (json.parts ?? []).find((p) => p.label === 'head');
  const inCircle = (r, x, y) => (x - r.x) ** 2 + (y - r.y) ** 2 <= r.r * r.r;
  const inAnyLimb = (x, y) => limbRegions.some((r) => inCircle(r, x, y));

  const xs = [], ys = [], labels = [];
  const addNode = (x, y, lab) => { xs.push(x); ys.push(y); labels.push(lab); return xs.length - 1; };
  const edgeSet = new Set();
  const EK = (i, j) => (i < j ? i * 4096 + j : j * 4096 + i);
  const addEdge = (i, j) => { if (i !== j) edgeSet.add(EK(i, j)); };

  // core (body/head = silhouette minus limb regions): jittered grid
  let hits = 0;
  const PROBE = 72;
  for (let i = 0; i < PROBE; i++) for (let j = 0; j < PROBE; j++) {
    const x = (i + 0.5) / PROBE, y = (j + 0.5) / PROBE;
    if (inside(x, y) && !inAnyLimb(x, y)) hits++;
  }
  const coreArea = hits / (PROBE * PROBE);
  const limbBudget = limbRegions.length * 12 * 3;
  const coreTarget = Math.max(80, target - limbBudget);
  const step = Math.sqrt(Math.max(1e-6, coreArea) / coreTarget);
  for (let gx = step / 2; gx < 1; gx += step) {
    for (let gy = step / 2; gy < 1; gy += step) {
      const x = gx + (Math.random() - 0.5) * step * 0.8;
      const y = gy + (Math.random() - 0.5) * step * 0.8;
      if (!inside(x, y) || inAnyLimb(x, y)) continue;
      addNode(x, y, headRegion && inCircle(headRegion, x, y) ? 'head' : 'body');
    }
  }
  const nCore = xs.length;
  for (let i = 0; i < nCore; i++) {
    const d2 = [];
    for (let j = 0; j < nCore; j++) if (j !== i) {
      d2.push([(xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2, j]);
    }
    d2.sort((a, b) => a[0] - b[0]);
    for (let m = 0; m < 3 && m < d2.length; m++) addEdge(i, d2[m][1]);
  }

  // limbs: ring chains fitted along each region's principal axis
  const RINGS = 12;
  for (const R of limbRegions) {
    // collect silhouette pixels in the region → mean + covariance → axis
    const pts = [];
    const ps = R.r / 16;
    for (let x = R.x - R.r; x <= R.x + R.r; x += ps) {
      for (let y = R.y - R.r; y <= R.y + R.r; y += ps) {
        if (inCircle(R, x, y) && inside(x, y)) pts.push([x, y]);
      }
    }
    if (pts.length < 8) continue;
    let mx = 0, my = 0;
    for (const [x, y] of pts) { mx += x; my += y; }
    mx /= pts.length; my /= pts.length;
    let cxx = 0, cxy = 0, cyy = 0;
    for (const [x, y] of pts) {
      const dx = x - mx, dy = y - my;
      cxx += dx * dx; cxy += dx * dy; cyy += dy * dy;
    }
    const ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    let ax = Math.cos(ang), ay = Math.sin(ang);
    let tMin = Infinity, tMax = -Infinity;
    for (const [x, y] of pts) {
      const t = (x - mx) * ax + (y - my) * ay;
      tMin = Math.min(tMin, t); tMax = Math.max(tMax, t);
    }
    // orient: ring 0 (t=tMin) is the body-adjacent end
    const dNear = Math.hypot(mx + ax * tMin - 0.5, my + ay * tMin - 0.45);
    const dFar = Math.hypot(mx + ax * tMax - 0.5, my + ay * tMax - 0.45);
    if (dFar < dNear) { ax = -ax; ay = -ay; const t = tMin; tMin = -tMax; tMax = -t; }
    const perpX = -ay, perpY = ax;

    let prevRing = null;
    for (let k = 0; k < RINGS; k++) {
      const t = tMin + (tMax - tMin) * (k / (RINGS - 1));
      const cx = mx + ax * t, cy = my + ay * t;
      // local half-width: scan outward both ways until the silhouette ends
      const scan = (dir) => {
        let s = 0;
        while (s < R.r && inside(cx + perpX * (s + 0.004) * dir, cy + perpY * (s + 0.004) * dir)) s += 0.004;
        return s;
      };
      const hw = Math.max(0.006, Math.min(scan(1), scan(-1)));
      const ringN = hw > 0.023 ? 3 : 2;
      const ring = [];
      for (let m = 0; m < ringN; m++) {
        const off = ringN === 1 ? 0 : (m / (ringN - 1) - 0.5) * 2 * hw * 0.7;
        ring.push(addNode(cx + perpX * off, cy + perpY * off, R.label));
      }
      for (let m = 0; m + 1 < ring.length; m++) addEdge(ring[m], ring[m + 1]);
      if (prevRing) {
        for (let m = 0; m < ring.length; m++) addEdge(ring[m], prevRing[Math.min(m, prevRing.length - 1)]);
        addEdge(ring[0], prevRing[prevRing.length - 1]);   // shear diagonal
      } else {
        for (const i of ring) {
          const d2 = [];
          for (let j = 0; j < nCore; j++) d2.push([(xs[i] - xs[j]) ** 2 + (ys[i] - ys[j]) ** 2, j]);
          d2.sort((a, b) => a[0] - b[0]);
          if (d2[0]) addEdge(i, d2[0][1]);
          if (d2[1]) addEdge(i, d2[1][1]);
        }
      }
      prevRing = ring;
    }
  }

  // Orphan removal: tissue whose spring graph is disconnected from the main
  // body can NEVER stay attached (no springs reach it) — it renders as a
  // free-floating blob. Root cause of the original severed-mitt symptom:
  // drawn mitts poking outside the sidecar limb regions got body-sampled
  // into isolated k-NN islands. Keep only the largest component.
  {
    const adj0 = Array.from({ length: xs.length }, () => []);
    for (const key of edgeSet) {
      const i = (key / 4096) | 0, j = key % 4096;
      adj0[i].push(j); adj0[j].push(i);
    }
    const comp = new Int32Array(xs.length).fill(-1);
    let nc = 0;
    for (let s0 = 0; s0 < xs.length; s0++) {
      if (comp[s0] !== -1) continue;
      const stack = [s0]; comp[s0] = nc;
      while (stack.length) {
        const q = stack.pop();
        for (const nb of adj0[q]) if (comp[nb] === -1) { comp[nb] = nc; stack.push(nb); }
      }
      nc++;
    }
    if (nc > 1) {
      const sizes = new Array(nc).fill(0);
      for (let i = 0; i < xs.length; i++) sizes[comp[i]]++;
      const keep = sizes.indexOf(Math.max(...sizes));
      const remap = new Int32Array(xs.length).fill(-1);
      const nxs = [], nys = [], nlabels = [];
      for (let i = 0; i < xs.length; i++) {
        if (comp[i] !== keep) continue;
        remap[i] = nxs.length;
        nxs.push(xs[i]); nys.push(ys[i]); nlabels.push(labels[i]);
      }
      const newEdges = new Set();
      for (const key of edgeSet) {
        const i = remap[(key / 4096) | 0], j = remap[key % 4096];
        if (i !== -1 && j !== -1) newEdges.add(i < j ? i * 4096 + j : j * 4096 + i);
      }
      console.warn(`[creature] dropped ${xs.length - nxs.length} orphan tissue nodes in ${nc - 1} disconnected island(s) — check the shape's part regions cover all extremities`);
      xs.length = 0; xs.push(...nxs);
      ys.length = 0; ys.push(...nys);
      labels.length = 0; labels.push(...nlabels);
      edgeSet.clear();
      for (const k2 of newEdges) edgeSet.add(k2);
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

  const tris = [];
  for (let i = 0; i < n; i++) {
    const nb = adj[i];
    for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) {
      const j = nb[a], q = nb[b];
      if (i < j && j < q && edgeSet.has(EK(j, q))) tris.push(i, j, q);
    }
  }
  // surface = a bitmap-edge neighbourhood (any of 8 probes outside)
  const surface = new Uint8Array(n);
  const EPS = 0.013;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (!inside(xs[i] + Math.cos(a) * EPS, ys[i] + Math.sin(a) * EPS)) { surface[i] = 1; break; }
    }
  }
  const lens = Array.from(restLen).sort((a, b) => a - b);
  const medLen = lens[Math.floor(lens.length / 2)] || 0.02;
  const boundary = new Uint8Array(restLen.length);
  for (let e2 = 0; e2 < restLen.length; e2++) {
    boundary[e2] =
      surface[edges[e2 * 2]] && surface[edges[e2 * 2 + 1]] && restLen[e2] <= medLen * 1.9 ? 1 : 0;
  }

  // joints from the sidecar (parents by name; parents precede children)
  const names = (json.joints ?? []).map((J) => J.name);
  const joints = (json.joints ?? []).map((J) => ({
    name: J.name, x: J.x, y: J.y,
    parent: J.parent == null ? -1 : names.indexOf(J.parent),
    role: J.role ?? 'root',
    limb: J.limb, paw: !!J.paw, ground: !!J.ground, phase: J.phase ?? 0,
  }));
  const pinR = Number(json.pinRadius) || 0.07;
  const pinned = new Set();
  for (const J of joints) {
    // paws pin EVERY node of their part within the paw radius — a count cap
    // left the fist's distal rings free to whip off on springs and sever
    // (brief 8.1; measured blobs 18-57 px beyond the joint)
    const want = J.paw ? Infinity : 4;
    // Pin audit (brief 8.1 step 3): a joint grabs only nodes of ITS part —
    // a wrist pinning forearm ring nodes dragged the whole chain and
    // stretched it past the density threshold. limb joints → their limb
    // label; head → head; roots → body.
    const wantLab = J.limb != null ? `limb${J.limb}` : J.role === 'head' ? 'head' : 'body';
    const byDist = [];
    for (let i = 0; i < n; i++) {
      if (labels[i] !== wantLab) continue;
      byDist.push([Math.hypot(xs[i] - J.x, ys[i] - J.y), i]);
    }
    byDist.sort((a, b) => a[0] - b[0]);
    J.pins = [];
    for (let m = 0; m < byDist.length && J.pins.length < want; m++) {
      const i = byDist[m][1];
      if (pinned.has(i) || byDist[m][0] > (J.paw ? Math.min(pinR, 0.09) : pinR * 1.5)) continue;
      pinned.add(i);
      J.pins.push({ i, offX: xs[i] - J.x, offY: ys[i] - J.y });
    }
  }

  const drawNodes = [];
  const nodeR = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let dMin = Infinity;
    for (const J of joints) dMin = Math.min(dMin, Math.hypot(xs[i] - J.x, ys[i] - J.y));
    if (dMin < 0.11) {
      drawNodes.push(i);
      nodeR[i] = 2 + 3.5 * Math.max(0, 1 - dMin / 0.16);
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

  // per-part sprite-radius floors — also the bone-splat radius per part
  // limb floor 2.1×: swings stretch ring spacing ~2×, and sprites must still
  // overlap at max excursion or the rope thins below the goo threshold
  // between nodes (brief 8.1 step 4 — measured 0.15-0.22 vs 0.18 when
  // stretched, borderline exactly where mitts severed)
  const partFloor = { body: 1.9 * medLen, head: 1.9 * medLen };
  for (const lab of new Set(labels)) if (/^limb/.test(lab)) partFloor[lab] = 2.1 * medLen;
  const spriteR = new Float32Array(n);
  {
    const sum = new Float32Array(n), cnt = new Float32Array(n);
    for (let e2 = 0; e2 < restLen.length; e2++) {
      sum[edges[e2 * 2]] += restLen[e2]; cnt[edges[e2 * 2]]++;
      sum[edges[e2 * 2 + 1]] += restLen[e2]; cnt[edges[e2 * 2 + 1]]++;
    }
    for (let i = 0; i < n; i++) {
      const local = 1.4 * (cnt[i] ? sum[i] / cnt[i] : medLen);
      spriteR[i] = Math.max(local, partFloor[labels[i]] ?? 0);
    }
  }

  const headNodes = [];
  for (let i = 0; i < n; i++) if (labels[i] === 'head') headNodes.push(i);

  // bones (parent→joint segments) for splats + length preservation checks.
  // groundChain bones (hip→knee→foot of walking legs) stretch BY DESIGN in
  // stance/swing; they are measured separately from rotation-driven bones.
  const partOf = (J) => (J.limb != null ? `limb${J.limb}` : J.role === 'head' ? 'head' : 'body');
  const groundLimbs = new Set(joints.filter((J) => J.ground).map((J) => J.limb));
  const bones = [];
  for (let ji = 0; ji < joints.length; ji++) {
    const J = joints[ji];
    if (J.parent < 0) continue;
    const P = joints[J.parent];
    bones.push({
      j: ji, p: J.parent,
      label: partOf(J),
      restLen: Math.hypot(J.x - P.x, J.y - P.y),
      groundChain: J.limb != null && groundLimbs.has(J.limb),
      tip: J.role === 'limb',
    });
  }

  // per-limb node lists for the density probe (step 4 measurement)
  const limbNodeIdx = {};
  for (let i = 0; i < n; i++) {
    if (/^limb/.test(labels[i])) (limbNodeIdx[labels[i]] ??= []).push(i);
  }

  Object.assign(state, {
    n, pos, prev, rest, edges, restLen, boundary, joints, pinned,
    nodeR, drawNodes, labels, triByPart, medLen, spriteR, headNodes,
    bones, limbNodeIdx, partFloor, limbDensity: {}, densityFrame: 0,
    tips: joints.filter((J) => J.role === 'limb'),
    hasFeet: joints.some((J) => J.ground),
    gaitName: json.archetype ?? 'biped',
    palette: json.palette ?? {},
    eyes: json.eyes ?? [],
    bbox: { minX, maxX, minY, maxY, h: maxY - minY, w: maxX - minX, cx: (minX + maxX) / 2 },
    freePhase: 0, perfMs: 0, sprites: null, spriteKey: '',
    world: null, feet: null,
    eye: { nextBlinkMs: 0, blinkUntilMs: 0, saccade: 0, prevLook: 0 },
    beh: { state: 'walk', lastBar: 0, lowBars: 0, em: 0.2, ev: 0.01 },
    slidePx: 0,
    builtShape: params.shape, builtCount: params.nodeCount,
  });
}

function startBuild(state, params) {
  const token = (state.buildToken = (state.buildToken ?? 0) + 1);
  state.n = 0;                       // not ready; draw() waits
  state.builtShape = params.shape;   // claim now so draw() doesn't re-trigger
  state.builtCount = params.nodeCount;
  loadShape(params.shape)
    .then((shape) => { if (state.buildToken === token) buildFromShape(state, params, shape); })
    .catch((e) => console.error(`[creature] shape "${params.shape}" failed to load:`, e));
}

// ── Shaded metaball layer (brief 8 Task 1) ────────────────────────────────
const SHADE_VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SHADE_FS = `#version 300 es
precision highp float;
uniform sampler2D uField;
uniform sampler2D uDens;
uniform vec2 uTexel;
uniform float uD0;
uniform float uD1;
uniform float uNz;
uniform vec3 uLightDir;
uniform float uLightInt;
uniform float uCore;
uniform vec3 uAccent;
uniform vec3 uSecondary;
uniform float uAlpha;
in vec2 vUv;
out vec4 outColor;
// union-by-max across body groups (brief 9 Task 0a): R = torso+head+legs,
// G = armL, B = armR. Additive stacking stays WITHIN a channel; a crossing
// arm takes max, so no weld-flash and no normal smear at the overlap.
uniform float uUnion;
float dmax(vec2 uv) {
  vec3 g = texture(uDens, uv).rgb;
  // uUnion 0 = legacy additive field (A/B evidence for the weld fix only)
  return mix(texture(uField, uv).a, max(g.r, max(g.g, g.b)), uUnion);
}
void main() {
  vec4 f = texture(uField, vUv);
  float d = dmax(vUv);
  if (d < uD0 - 0.06) discard;
  vec3 base = f.rgb / max(f.a, 1e-4);
  float dl = dmax(vUv - vec2(uTexel.x, 0.0));
  float dr = dmax(vUv + vec2(uTexel.x, 0.0));
  float dt = dmax(vUv - vec2(0.0, uTexel.y));
  float db = dmax(vUv + vec2(0.0, uTexel.y));
  vec3 nrm = normalize(vec3((dl - dr) * 4.0, (dt - db) * 4.0, uNz));
  float lam = max(dot(nrm, uLightDir), 0.0);
  float tMid  = smoothstep(uD0, uD0 + 0.14, d);
  float tCore = smoothstep(uD1, uD1 + 0.22, d);
  vec3 edgeC = base * base * 1.4;
  vec3 coreC = mix(base, mix(vec3(1.0), uSecondary, 0.45), 0.4) * (1.0 + 0.45 * uCore);
  vec3 c = mix(edgeC, base, tMid);
  c = mix(c, coreC, tCore);
  c *= 0.45 + 0.65 * lam * uLightInt;
  float rim = smoothstep(uD0 - 0.05, uD0, d) * (1.0 - smoothstep(uD0, uD0 + 0.05, d));
  c += rim * mix(vec3(1.0), uAccent, 0.6) * 0.9;
  vec3 h = normalize(uLightDir + vec3(0.0, 0.0, 1.0));
  c += pow(max(dot(nrm, h), 0.0), 28.0) * smoothstep(uD1, uD1 + 0.1, d) * 0.6;
  float a = smoothstep(uD0 - 0.03, uD0 + 0.03, d) * uAlpha;
  outColor = vec4(c * a, a);
}`;

function compileShadeProgram(gl) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`creature shader: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, SHADE_VS));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, SHADE_FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`creature shader link: ${gl.getProgramInfoLog(prog)}`);
  }
  return prog;
}

function ensureShadeLayer(state) {
  if (!state.shade) {
    const canvas = document.createElement('canvas');
    canvas.id = 'creature-shade';
    canvas.style.cssText =
      'position:absolute; inset:0; width:100%; height:100%; pointer-events:none;';
    const fg = document.getElementById('fg-container');
    (fg ?? document.body).before(canvas);
    const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error('creature: WebGL2 unavailable');
    const prog = compileShadeProgram(gl);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const dtex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, dtex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const u = {};
    for (const name of ['uField', 'uDens', 'uUnion', 'uTexel', 'uD0', 'uD1', 'uNz', 'uLightDir', 'uLightInt', 'uCore', 'uAccent', 'uSecondary', 'uAlpha']) {
      u[name] = gl.getUniformLocation(prog, name);
    }
    const accum = document.createElement('canvas');
    const dens = document.createElement('canvas');
    const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    state.shade = {
      canvas, gl, prog, tex, dtex, u,
      accum, g: accum.getContext('2d'),
      dens, dg: dens.getContext('2d'),
      timerExt, gpuMs: 0, passMs: 0, query: null,
    };
  }
  const sh = state.shade;
  const W = window.innerWidth, H = window.innerHeight;
  if (sh.canvas.width !== W || sh.canvas.height !== H) {
    sh.canvas.width = W; sh.canvas.height = H;
    sh.accum.width = Math.ceil(W / 2); sh.accum.height = Math.ceil(H / 2);
    sh.dens.width = sh.accum.width; sh.dens.height = sh.accum.height;
    sh.gl.viewport(0, 0, W, H);
  }
  return sh;
}

// Contact shadow lives on its own 2D canvas UNDER the shade layer (the
// brief: drawn under the shaded body, not through the density field).
function ensureShadowLayer(state) {
  if (!state.shadow) {
    const canvas = document.createElement('canvas');
    canvas.id = 'creature-shadow';
    canvas.style.cssText =
      'position:absolute; inset:0; width:100%; height:100%; pointer-events:none;';
    // below the shade canvas (which ensureShadeLayer put before #fg-container)
    (state.shade?.canvas ?? document.getElementById('fg-container') ?? document.body)
      .before(canvas);
    state.shadow = { canvas, g: canvas.getContext('2d') };
  }
  const sd = state.shadow;
  if (sd.canvas.width !== window.innerWidth || sd.canvas.height !== window.innerHeight) {
    sd.canvas.width = window.innerWidth;
    sd.canvas.height = window.innerHeight;
  }
  return sd;
}

function ensureSprites(state, params) {
  const hues = {
    body: paletteHue('primary', params, state.palette),
    head: paletteHue('accent', params, state.palette),
    limb: paletteHue('primary', params, state.palette),   // primary covers limbs too
  };
  const key = `${hues.body}|${hues.head}|${hues.limb}`;
  if (state.sprites && state.spriteKey === key) return state.sprites;
  const sprites = {};
  for (const [lab, hue] of Object.entries(hues)) {
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

// Pure-channel density sprites (brief 9 Task 0a): same radial profile as the
// colour sprites but writing into exactly one of R/G/B, so 'lighter' blending
// accumulates each body group's density in its own channel.
function ensureDensSprites(state) {
  if (state.densSprites) return state.densSprites;
  const out = {};
  for (const [ch, rgb] of [['r', '255,0,0'], ['g', '0,255,0'], ['b', '0,0,255']]) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, `rgba(${rgb},1)`);
    grad.addColorStop(0.35, `rgba(${rgb},0.62)`);
    grad.addColorStop(0.65, `rgba(${rgb},0.22)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    out[ch] = c;
  }
  state.densSprites = out;
  return out;
}

// group → density channel: arms get their own channels so a crossing arm
// unions by max instead of stacking; everything else shares R
const densChannel = (lab) => (lab === 'limb2' ? 'g' : lab === 'limb3' ? 'b' : 'r');

export default {
  id: 'creature',
  oscPrefix: 'creature',
  interfaces: ['triggerable', 'fadeable'],
  triggerable: { enterMs: 900, holdMs: 120_000, exitMs: 900, autoRetrigger: true },
  fadeable: { easing: 'cubic-out', maxAlpha: 1 },
  defaults: {
    shape: 'biped-1',          // shapes/<name>.png + .json
    weldUnion: 1,              // 0 = legacy additive density (A/B diagnostics only)
    archetype: 'auto',         // 'auto' | 'biped' | 'trot' | 'pulse'
    behavior: 'auto',          // 'auto' | 'idle' | 'walk' | 'groove' | 'hop'
    speed: 0.35,               // body-heights per second when walking
    beatsPerStride: 1,
    blendBeats: 0.75,          // pose blend duration on state/turn changes
    amplitude: 1.0,
    bounce: 1.0,
    stiffness: 0.75,
    nodeCount: 600,
    scale: 1.0,
    ground: 0.82,
    xFrac: 0.5,
    huePrimary: 190, hueSecondary: 150, hueAccent: 315,  // override the shape palette when changed
    swatches: 0,               // diag: render the three palette swatches
    sweep: -1,                 // weld test: 0..1 drags the left arm across the torso
    renderMode: 'goo',         // 'goo' (shaded metaball) | 'wire' (diagnostic)
    gooThreshold: 0.18,        // d0: body surface threshold (unsaturated density scale)
    shadeD1: 0.55,             // d1: core/specular threshold
    shadeNz: 0.6,              // pseudo-normal flatness
    lightX: -0.6, lightY: -0.75,
    simmer: 1.0,
    boneSplats: 1,             // brief 8.1: skeleton density guarantee
    densityProbe: 0,           // verification only: ANY canvas readback
                               // demotes the accum to CPU for the session
  },

  setup(ctx) {
    ctx.state = {};
    startBuild(ctx.state, ctx.params);
  },

  draw(ctx) {
    const { p, params, state } = ctx;
    const a = ctx.audio.state;
    const t0 = performance.now();
    const dt = Math.min(0.08, p.deltaTime / 1000);
    const tSec = t0 / 1000;

    if (state.builtShape !== params.shape || state.builtCount !== params.nodeCount) {
      startBuild(state, params);
    }
    if (!state.n) return;               // shape still loading

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
    // Move-local phase (brief 8.2): accumulates from beatPhase deltas with a
    // per-frame cap, so PLL nudges and clock-source switches spread over the
    // following frames (debt-based catch-up) instead of stepping the pose.
    {
      const nominal = dt / beatSec;
      let dRaw = phase - (state.mvLast ?? phase);
      if (dRaw < -0.5) dRaw += 1;
      if (dRaw < 0) dRaw = 0;
      state.mvLast = phase;
      state.phaseDebt = (state.phaseDebt ?? 0) + dRaw;
      const applied = Math.min(state.phaseDebt, nominal * 1.6);
      state.phaseDebt -= applied;
      state.moveAcc = (state.moveAcc ?? 0) + applied;
      state.moveApplied = applied;
    }
    const mPhase = state.moveAcc % 1;
    const level = a.smoothedLevel ?? 0;
    const lvl = Math.min(1, 0.35 + level * 1.3);

    // ── behaviour state machine ─────────────────────────────────────────
    const beh = state.beh;
    const alphaE = Math.min(0.2, dt / 20);
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
    // pose blending trigger: FSM change or a turn boundary. Same-state
    // re-selection each bar is a strict no-op (no phase resets, no re-latch
    // — moveAcc/freePhase/feet run on untouched).
    const startBlend = () => {
      state.blend = {
        from: state.joints.map((J) => ({ ax: J.bax ?? J.ax ?? J.x, ay: J.bay ?? J.ay ?? J.y, th: J.btheta ?? J.theta ?? 0 })),
        start: state.moveAcc,
        durBeats: Math.max(0.1, Number(params.blendBeats) || 0.75),
      };
      if (state.jm) state.jm.transitionUntil = t0 + state.blend.durBeats * beatSec * 1000 + 250;
    };
    if (next !== beh.state) {
      beh.state = next;
      startBlend();
      try { window.__ws?.send({ type: 'creature-state', state: next, z: +z.toFixed(2) }); } catch {}
    }
    const st = beh.state;

    // ── world locomotion (phase-locked odometry) ────────────────────────
    const S = (0.65 * p.height / Math.max(0.05, state.bbox.h)) * params.scale;
    const groundPx = p.height * params.ground;
    state.world ??= { x: p.width * params.xFrac, facing: 1, facingVis: 1, turn: null };
    const world = state.world;
    const speedU = params.speed * state.bbox.h;
    const strideU = speedU * beatSec * Math.max(0.25, params.beatsPerStride);

    const dPhase = state.moveApplied;   // same clock as the move phase

    if (state.hasFeet && st === 'walk') {
      if (world.turn) {
        const u = Math.min(1, (t0 - world.turn.t0) / 400);
        world.facingVis = world.turn.from + (world.turn.to - world.turn.from) * u;
        if (u >= 1) { world.facing = world.turn.to; world.turn = null; startBlend(); }
      } else {
        world.x += dPhase * strideU * S * world.facing;
        if (world.facing > 0 && world.x > p.width * 0.82) { world.turn = { t0, from: 1, to: -1 }; startBlend(); }
        if (world.facing < 0 && world.x < p.width * 0.18) { world.turn = { t0, from: -1, to: 1 }; startBlend(); }
        world.facingVis = world.facing;
      }
    } else if (!state.hasFeet) {
      world.vx ??= speedU * 0.35;
      const targetV = (world.x > p.width * 0.8 ? -1 : world.x < p.width * 0.2 ? 1 :
        Math.sign(world.vx || 1)) * speedU * 0.35;
      world.vx += (targetV - world.vx) * Math.min(1, dt * 0.8);
      if (st !== 'idle') world.x += world.vx * S * dt;
      world.facingVis = 1;
    }

    // ── skeleton targets per state ──────────────────────────────────────
    const gaitName = params.archetype === 'auto' ? state.gaitName : params.archetype;
    const gait = GAITS[gaitName] ?? GAITS.biped;
    const amp = params.amplitude * lvl * (st === 'idle' ? 0 : 1);
    const bellScale = !state.hasFeet && st !== 'idle'
      ? 1 + (gait.bellPulse ?? 0) * Math.sin(2 * Math.PI * mPhase) * amp
      : 1 + 0.02 * Math.sin(2 * Math.PI * 0.2 * tSec);

    let sq = 0, bounceY = 0;
    const H = state.bbox.h;
    if (st === 'walk') {
      const s = Math.cos(4 * Math.PI * mPhase);
      sq = 0.05 * s * lvl;
      bounceY = -(gait.bounce ?? 0.05) * H * ((s + 1) / 2) * lvl * params.bounce;
    } else if (st === 'groove') {
      const s = Math.sin(4 * Math.PI * mPhase);
      sq = 0.05 * s * lvl;
      // sin² bounce: max(0,sin) has a velocity KINK at each zero crossing
      // (root steps 0 → ~1.8 u/s instantly, twice a beat) — the metric's
      // last surviving spike, and a real visible hiccup. sin² keeps the
      // twice-per-beat bounce with zero-velocity touchdowns.
      const b2 = Math.sin(2 * Math.PI * mPhase);
      bounceY = -0.08 * H * b2 * b2 * lvl * params.bounce;
    } else if (st === 'hop') {
      const air = Math.max(0, Math.sin(2 * Math.PI * mPhase));
      sq = (air > 0 ? 0.07 * air : -0.06) * lvl;
      bounceY = -0.13 * H * air * lvl * params.bounce;
    }
    if (!state.hasFeet) {
      bounceY += (st === 'idle' ? 0 : (gait.drift ?? 0) * -H * Math.sin(2 * Math.PI * (mPhase - 0.25)) * params.bounce);
    }

    const idleK = st === 'idle' ? 1 : 0.3;
    const swayU = ((p.noise(tSec * 0.13, 7) - 0.5) * 2) * 0.02 * state.bbox.w * idleK;
    const rearBob = ((p.noise(tSec * 0.4, 23) - 0.5) * 2) * 0.006 * idleK;
    // head look: the quick reorient is a TARGET that the actual look chases
    // through a low-pass (~150 ms). The old form added 0.35 rad as a step
    // that toggled frame-to-frame at the noise threshold — a literal head
    // twitch, and the top spike source in the hiccup trace (brief 8.2).
    const lookTarget = (((p.noise(tSec * 0.07, 13) - 0.5) * 2) * 0.45 +
      (p.noise(tSec * 0.02, 41) > 0.72 ? 0.35 : 0)) * idleK;
    state.headLook = (state.headLook ?? 0) + (lookTarget - (state.headLook ?? 0)) * Math.min(1, dt * 7);
    const headLook = state.headLook;

    const { joints, pos, prev, rest, edges, restLen, boundary, n } = state;
    for (const J of joints) {
      const g = (gait[J.role] ?? gait.root)(J.limb ?? 0, J.phase ?? 0);
      J.theta = st === 'idle' ? 0 : g.A * amp * Math.sin(2 * Math.PI * (g.freq * mPhase + g.off));
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

    // weld-test pose sweep (brief 9 Task 0a acceptance): drag the left arm
    // across the torso by rotating its chain about the chest
    if (Number(params.sweep) >= 0) {
      const t = Math.min(1, Number(params.sweep));
      const chest = joints.find((J) => J.role === 'rootMid') ?? joints[0];
      for (const J of joints) {
        if (J.limb !== 2) continue;
        const ox = J.x - chest.x, oy = J.y - chest.y;
        const dir = Math.sign(J.x - 0.5) || 1;      // toward the body centre
        const ang = t * 1.5 * dir;
        const c = Math.cos(ang), s2 = Math.sin(ang);
        J.ax = chest.ax + ox * c - oy * s2;
        J.ay = chest.ay + ox * s2 + oy * c;
        J.theta = ang;
      }
    }

    // walking feet override the rotation chain (ground-contact tips only —
    // arms/hands keep their swing from the joint chain above)
    let slidePx = 0;
    if (state.hasFeet && (st === 'walk' || st === 'hop')) {
      state.feet ??= {};
      for (const T of state.tips) {
        if (!T.ground) continue;
        const foot = (state.feet[T.name] ??= { plantWX: null });
        if (world.turn) {
          T.ax = T.x; T.ay = T.y; T.theta = 0;
          foot.plantWX = null;
          continue;
        }
        if (st === 'hop') {
          const air = Math.max(0, Math.sin(2 * Math.PI * mPhase));
          T.ax = T.x; T.ay = T.y - 0.10 * H * air * lvl;
          foot.plantWX = null;
        } else {
          const cyc = (mPhase / Math.max(0.25, params.beatsPerStride) - T.phase) % 1;
          const c = cyc < 0 ? cyc + 1 : cyc;
          if (c < 0.6) {
            T.ax = T.x + strideU * (0.3 - c);
            T.ay = T.y;
            const wx = world.x + (T.ax - joints[0].x) * S * world.facingVis;
            if (foot.plantWX === null || state.blend) foot.plantWX = wx;   // re-anchor while blending
            else slidePx = Math.max(slidePx, Math.abs(wx - foot.plantWX));
          } else {
            const u = (c - 0.6) / 0.4;
            T.ax = T.x + strideU * (-0.3 + 0.6 * u);
            T.ay = T.y - 0.5 * strideU * 0.6 * Math.sin(Math.PI * u);
            foot.plantWX = null;
          }
        }
        T.theta = 0;
      }
      for (const J of joints) {
        if (J.role !== 'knee') continue;
        const T = joints.find((q) => q.role === 'limb' && q.limb === J.limb);
        if (!T || !T.ground) continue;
        const R = joints[J.parent];
        J.ax = (R.ax + T.ax) / 2 + 0.02;
        J.ay = (R.ay + T.ay) / 2;
        J.theta = 0;
      }
    } else {
      state.feet = null;
    }
    state.slidePx = state.slidePx * 0.9 + slidePx * 0.1;

    // pose blending (brief 8.2): previous pose → new move stream over
    // blendBeats (smoothstep) while phase runs on
    if (state.blend) {
      const bt = (state.moveAcc - state.blend.start) / state.blend.durBeats;
      if (bt >= 1) {
        state.blend = null;
      } else {
        const sm = bt * bt * (3 - 2 * bt);
        for (let ji = 0; ji < joints.length; ji++) {
          const F = state.blend.from[ji];
          const J = joints[ji];
          J.ax = F.ax + (J.ax - F.ax) * sm;
          J.ay = F.ay + (J.ay - F.ay) * sm;
          J.theta = F.th + (J.theta - F.th) * sm;
        }
      }
    }
    for (const J of joints) { J.bax = J.ax; J.bay = J.ay; J.btheta = J.theta; }

    // joint-target speed metric (brief 8.2 Task 3): max per-frame target
    // displacement across joints, vs a rolling median; spikes outside a
    // declared transition window (or hop) are the "hiccup" signal
    {
      // velocity over the UNCLAMPED frame delta: a stalled frame advances
      // targets by the real elapsed phase, and dividing by the 80 ms-clamped
      // dt inflates v into a false spike
      const dtReal = Math.max(1e-3, p.deltaTime / 1000);
      let vmax = 0;
      for (const J of joints) {
        if (J.pax !== undefined) {
          vmax = Math.max(vmax, Math.hypot(J.ax - J.pax, J.ay - J.pay) / dtReal);
        }
        J.pax = J.ax; J.pay = J.ay;
      }
      const jm = (state.jm ??= { buf: new Float64Array(120), i: 0, n: 0, spikesAll: 0, spikesFlagged: 0, transitionUntil: 0 });
      const sorted = Array.from(jm.buf.slice(0, jm.n)).sort((a, b) => a - b);
      const median = jm.n > 30 ? sorted[(jm.n / 2) | 0] : 0;
      const inWindow = t0 < jm.transitionUntil || st === 'hop';
      // discontinuity test: sustained fast passages (loud groove ramping the
      // amplitude) keep v continuous frame-to-frame; a hiccup is a JUMP both
      // vs the rolling median and vs the previous frame's own speed. The
      // plain 3×median rule flagged 60+ legitimate loud-groove frames.
      const vPrev = jm.vPrev ?? 0;
      jm.vPrev = vmax;
      if (median > 0.05 && vmax > 3 * median && vmax > 2.5 * vPrev + 0.05) {
        jm.spikesAll++;
        if (!inWindow) jm.spikesFlagged++;
        (jm.log ??= []).push({
          state: st, v: +vmax.toFixed(2), med: +median.toFixed(2),
          inWindow,
          dPhase: +((phase - (state.lastPhaseForSpike ?? phase))).toFixed(4),
          barWrap: wrapped,
        });
        if (jm.log.length > 10) jm.log.shift();
      }
      state.lastPhaseForSpike = phase;
      jm.buf[jm.i] = vmax; jm.i = (jm.i + 1) % 120; jm.n = Math.min(120, jm.n + 1);
      state.jointSpeed = vmax; state.jointMedian = median;
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

    // bone-length preservation (brief 8.1 step 2): rotation-driven bones
    // must stay within 3% of rest length; ground-chain bones stretch by
    // design (stance/swing) and are tracked separately.
    let boneDevRot = 0, boneDevGround = 0;
    // bone lengths measured OUTSIDE blend windows: position-lerp blending
    // transiently bends lengths ~5% by construction (declared transition)
    const inBlend = !!state.blend;
    for (const B of state.bones) {
      const J = joints[B.j], P = joints[B.p];
      const dev = Math.abs(Math.hypot(J.ax - P.ax, J.ay - P.ay) - B.restLen) / B.restLen;
      if (B.groundChain) boneDevGround = Math.max(boneDevGround, dev);
      else if (!inBlend) boneDevRot = Math.max(boneDevRot, dev);
    }
    state.boneDevRot = Math.max(state.boneDevRot ?? 0, boneDevRot);
    state.boneDevGround = Math.max(state.boneDevGround ?? 0, boneDevGround);

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
      if (state.shade) {
        const { gl } = state.shade;
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      }
      if (state.shadow) state.shadow.g.clearRect(0, 0, state.shadow.canvas.width, state.shadow.canvas.height);
      state.perfMs = state.perfMs * 0.95 + (performance.now() - t0) * 0.05;
      return;
    }
    const breath = 0.02 * Math.sin(2 * Math.PI * 0.2 * tSec) * (st === 'idle' ? 1 : 0.4);
    const sx = world.facingVis * (1 - (st === 'walk' ? 0 : sq));
    const sy = (1 + sq) * (1 + (state.hasFeet ? breath : 0));
    const rootX = joints[0].x;
    const X = (i) => world.x + (pos[i * 2] - rootX) * S * sx;
    const Y = (i) => groundPx - (state.bbox.maxY - pos[i * 2 + 1]) * S * sy;
    const kick = a.bands?.kick ?? 0, mid = a.bands?.mid ?? 0;
    const mapX = (x) => world.x + (x - rootX) * S * sx;
    const mapY = (y) => groundPx - (state.bbox.maxY - y) * S * sy;

    // ── contact shadow: soft ellipse under the body, on its own layer ───
    {
      const sdw = ensureShadowLayer(state);
      const g2 = sdw.g;
      g2.clearRect(0, 0, sdw.canvas.width, sdw.canvas.height);
      const feet = state.tips.filter((T) => T.ground);
      let cx, w;
      if (feet.length) {
        const xsF = feet.map((T) => mapX(T.ax));
        cx = xsF.reduce((s2, v) => s2 + v, 0) / xsF.length;
        w = Math.max(...xsF) - Math.min(...xsF) + 0.14 * state.bbox.w * S;
      } else {
        cx = mapX(state.bbox.cx);
        w = state.bbox.w * S * 0.5;
      }
      const airborne = st === 'hop' ? Math.max(0, Math.sin(2 * Math.PI * mPhase)) : 0;
      const low = Math.max(0, -sq);                      // squash → wider, darker
      w *= 1 + 3 * low;
      const h2 = 0.030 * S * (1 + 2 * low);
      const op = 0.38 * alpha * (1 - 0.7 * airborne) * (1 + 3 * low);
      const cy = groundPx + h2 * 0.25;
      g2.save();
      g2.translate(cx, cy);
      g2.scale(w / 2, h2 / 2);
      const grad = g2.createRadialGradient(0, 0, 0, 0, 0, 1);
      grad.addColorStop(0, `rgba(0,0,0,${Math.min(0.6, op).toFixed(3)})`);
      grad.addColorStop(0.7, `rgba(0,0,0,${Math.min(0.6, op * 0.55).toFixed(3)})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g2.fillStyle = grad;
      g2.beginPath();
      g2.arc(0, 0, 1, 0, Math.PI * 2);
      g2.fill();
      g2.restore();
    }

    // ── eyes: blink every 4–7 s, saccade on quick head reorients ────────
    const eye = state.eye;
    if (!eye.nextBlinkMs) eye.nextBlinkMs = t0 + 4000 + Math.random() * 3000;
    if (t0 > eye.nextBlinkMs) {
      eye.blinkUntilMs = t0 + 130;                       // two-frame-ish collapse
      eye.nextBlinkMs = t0 + 4000 + Math.random() * 3000;
    }
    const lookDelta = headLook - eye.prevLook;
    eye.prevLook = headLook;
    if (Math.abs(lookDelta) > 0.12) eye.saccade = Math.max(-1, Math.min(1, lookDelta * 4)) * 0.014;
    eye.saccade *= Math.exp(-dt * 9);
    const drawEyes = () => {
      const hn = state.headNodes;
      if (!hn.length) return;
      let hcx = 0, hcy = 0;
      for (const i of hn) { hcx += pos[i * 2]; hcy += pos[i * 2 + 1]; }
      hcx /= hn.length; hcy /= hn.length;
      const neck = joints.find((J) => J.role === 'head');
      const th = (neck?.theta ?? 0) * 0.6;
      const cth = Math.cos(th), sth = Math.sin(th);
      const walkShift = (st === 'walk' || st === 'hop') ? 0.014 : 0;
      const blink = t0 < eye.blinkUntilMs ? 0.12 : 1;
      const eyes = state.eyes.length ? state.eyes : [{ x: 0.02, y: -0.01, r: 0.013 }];
      p.push();
      p.noStroke();
      if (Number(params.swatches) !== 0) {
        const sw = [
          ['primary', paletteHue('primary', params, state.palette)],
          ['secondary', paletteHue('secondary', params, state.palette)],
          ['accent', paletteHue('accent', params, state.palette)],
        ];
        p.push();
        p.colorMode(p.HSB, 360, 100, 100, 1);
        sw.forEach(([, hue], k) => {
          p.fill(hue, 80, 90, 1);
          p.rect(16 + k * 44, 16, 36, 36);
        });
        p.pop();
      }
      p.fill(8, 12, 14, 235 * alpha);
      for (const E of eyes) {
        const ox = E.x + walkShift + eye.saccade, oy = E.y;
        const ex = hcx + ox * cth - oy * sth;
        const ey = hcy + ox * sth + oy * cth;
        p.ellipse(mapX(ex), mapY(ey), E.r * 2 * S, E.r * 2 * S * blink);
      }
      p.pop();
    };

    if (params.renderMode === 'goo') {
      const sh = ensureShadeLayer(state);
      const sprites = ensureSprites(state, params);
      const dens = ensureDensSprites(state);
      const gl = sh.gl;
      const g = sh.g;
      const dg = sh.dg;
      const tPass = performance.now();

      g.clearRect(0, 0, sh.accum.width, sh.accum.height);
      g.globalCompositeOperation = 'lighter';
      dg.clearRect(0, 0, sh.dens.width, sh.dens.height);
      dg.globalCompositeOperation = 'lighter';
      // low per-sprite alpha ON PURPOSE: density must not saturate inside
      // the body or the shader's colour ramp has no gradient left to shade
      const aBody = 0.30 + 0.10 * kick;
      const aLimb = 0.42 + 0.10 * mid;   // limbs run hotter: stretch headroom
      const simmer = Number(params.simmer) || 0;
      for (let i = 0; i < n; i++) {
        const lab = state.labels[i];
        const sp = lab === 'head' ? sprites.head : lab === 'body' ? sprites.body : sprites.limb;
        const wob = 1 + 0.06 * simmer * (p.noise(i * 0.37, tSec * 0.22) * 2 - 1);
        const r = state.spriteR[i] * S * wob * 0.5;
        g.globalAlpha = (lab === 'body' || lab === 'head') ? aBody : aLimb;
        g.drawImage(sp, X(i) * 0.5 - r, Y(i) * 0.5 - r, r * 2, r * 2);
        dg.globalAlpha = g.globalAlpha;
        dg.drawImage(dens[densChannel(lab)], X(i) * 0.5 - r, Y(i) * 0.5 - r, r * 2, r * 2);
      }
      // bone splats (brief 8.1): sprites lerped along every bone so a limb
      // can NEVER sever, whatever the spring state. Splat COUNT scales with
      // bone length / radius (deviation from the brief's fixed N=5: at limb
      // radius, 5 splats on a long arm bone leave sub-threshold gaps and
      // the chain itself is dotted — measured components=3 with N=5).
      if (Number(params.boneSplats) !== 0) {
        let splatCount = 0;
        for (const B of state.bones) {
          const J = joints[B.j], P = joints[B.p];
          const sp = B.label === 'head' ? sprites.head : B.label === 'body' ? sprites.body : sprites.limb;
          const dsp = dens[densChannel(B.label)];
          // 2× alpha + 1.2× radius: a single-chain splat peaks ~0.25-0.30
          // after gradient/downsample losses — measured dipping below the
          // 0.18 threshold at the wrist. The guarantee must not be marginal.
          const rU = (state.partFloor[B.label] ?? state.medLen * 1.4) * 1.2;
          const r = rU * S * 0.5;
          const len = Math.hypot(J.ax - P.ax, J.ay - P.ay);
          const N = Math.max(5, Math.ceil(len / (rU * 0.5)));
          g.globalAlpha = Math.min(1, ((B.label === 'body' || B.label === 'head') ? aBody : aLimb) * 2);
          dg.globalAlpha = g.globalAlpha;
          for (let k = 0; k <= N; k++) {
            const t = k / N;
            const bx = mapX(P.ax + (J.ax - P.ax) * t) * 0.5;
            const by = mapY(P.ay + (J.ay - P.ay) * t) * 0.5;
            g.drawImage(sp, bx - r, by - r, r * 2, r * 2);
            dg.drawImage(dsp, bx - r, by - r, r * 2, r * 2);
            splatCount++;
          }
          // tip bones also bridge joint → live centroid of the pinned
          // cluster: pin offsets ROTATE with the joint, so during a swing
          // the fist orbits the wrist SIDEWAYS off the bone line — a
          // straight-line overshoot points the wrong way (measured: the
          // severed mitt sat beside, not beyond, the chain end)
          if (B.tip && J.pins.length) {
            let cx = 0, cy = 0;
            for (const pin of J.pins) { cx += pos[pin.i * 2]; cy += pos[pin.i * 2 + 1]; }
            cx /= J.pins.length; cy /= J.pins.length;
            const len2 = Math.hypot(cx - J.ax, cy - J.ay);
            const N2 = Math.max(3, Math.ceil(len2 / (rU * 0.5)));
            for (let k = 0; k <= N2; k++) {
              const t = k / N2;
              const bx = mapX(J.ax + (cx - J.ax) * t) * 0.5;
              const by = mapY(J.ay + (cy - J.ay) * t) * 0.5;
              g.drawImage(sp, bx - r, by - r, r * 2, r * 2);
              dg.drawImage(dsp, bx - r, by - r, r * 2, r * 2);
              splatCount++;
            }
          }
        }
        window.__creatureSplats = splatCount;
      }
      g.globalAlpha = 1;
      dg.globalAlpha = 1;
      window.__creatureAccum = sh.accum;   // harness seam: component counting
      window.__creatureDens = sh.dens;     // harness seam: weld overlap masks
      // on-demand node dump for sever forensics (computed only when called)
      window.__creatureDump = () => {
        const out = [];
        for (let i = 0; i < n; i++) {
          out.push({ i, x: Math.round(X(i)), y: Math.round(Y(i)),
                     lab: state.labels[i], pin: state.pinned.has(i) ? 1 : 0 });
        }
        return out;
      };
      window.__creatureJoints = joints.map((J) => ({
        name: J.name, ax: +J.ax.toFixed(3), ay: +J.ay.toFixed(3),
        sx: Math.round(mapX(J.ax)), sy: Math.round(mapY(J.ay)),
        theta: +(J.theta ?? 0).toFixed(3), pins: J.pins.length,
      }));

      // density probe (brief 8.1 step 4): every 30th frame, min accumulated
      // density along each limb's tissue nodes. NEVER getImageData the accum
      // itself — that permanently flips it into readback mode (measured:
      // module 1 ms → 9 ms). Blit to a CPU scratch canvas and read that.
      if (Number(params.densityProbe) !== 0 &&
          (state.densityFrame = (state.densityFrame + 1) % 30) === 0) {
        if (!sh.probe) {
          sh.probe = document.createElement('canvas');
          sh.probeG = sh.probe.getContext('2d', { willReadFrequently: true });
        }
        if (sh.probe.width !== sh.accum.width || sh.probe.height !== sh.accum.height) {
          sh.probe.width = sh.accum.width; sh.probe.height = sh.accum.height;
        }
        sh.probeG.clearRect(0, 0, sh.probe.width, sh.probe.height);
        sh.probeG.drawImage(sh.accum, 0, 0);
        const img = sh.probeG.getImageData(0, 0, sh.accum.width, sh.accum.height).data;
        for (const [lab, idxs] of Object.entries(state.limbNodeIdx)) {
          let dMin = 1;
          for (const i of idxs) {
            const axp = Math.max(0, Math.min(sh.accum.width - 1, (X(i) * 0.5) | 0));
            const ayp = Math.max(0, Math.min(sh.accum.height - 1, (Y(i) * 0.5) | 0));
            dMin = Math.min(dMin, img[(ayp * sh.accum.width + axp) * 4 + 3] / 255);
          }
          state.limbDensity[lab] = Math.min(state.limbDensity[lab] ?? 1, +dMin.toFixed(3));
        }
      }

      let query = null;
      if (sh.timerExt && !sh.query) {
        query = gl.createQuery();
        gl.beginQuery(sh.timerExt.TIME_ELAPSED_EXT, query);
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sh.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sh.accum);
      // density canvas: premultiplied PASSTHROUGH — the channel sums ARE the
      // per-group densities; un-premultiplying would divide them by the summed
      // alpha and deflate every channel wherever groups overlap
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, sh.dtex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sh.dens);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.activeTexture(gl.TEXTURE0);
      gl.useProgram(sh.prog);
      gl.uniform1i(sh.u.uField, 0);
      gl.uniform1i(sh.u.uDens, 1);
      gl.uniform1f(sh.u.uUnion, Number(params.weldUnion ?? 1) === 0 ? 0 : 1);
      gl.uniform2f(sh.u.uTexel, 1 / sh.accum.width, 1 / sh.accum.height);
      gl.uniform1f(sh.u.uD0, Math.max(0.05, Math.min(0.9, Number(params.gooThreshold) || 0.18)));
      gl.uniform1f(sh.u.uD1, Number(params.shadeD1) || 0.55);
      gl.uniform1f(sh.u.uNz, Number(params.shadeNz) || 0.6);
      const lx = Number.isFinite(+params.lightX) ? +params.lightX : -0.6;
      const ly = Number.isFinite(+params.lightY) ? +params.lightY : -0.75;
      const lm = Math.hypot(lx, ly, 0.5) || 1;
      gl.uniform3f(sh.u.uLightDir, lx / lm, -ly / lm, 0.5 / lm);
      gl.uniform1f(sh.u.uLightInt, 0.65 + 0.55 * level);
      gl.uniform1f(sh.u.uCore, kick);
      const hue2rgb = (deg) => {
        const r2 = (deg % 360) * Math.PI / 180;
        return [0.5 + 0.5 * Math.cos(r2), 0.5 + 0.5 * Math.cos(r2 - 2.094), 0.5 + 0.5 * Math.cos(r2 + 2.094)];
      };
      const acc = hue2rgb(paletteHue('accent', params, state.palette));
      const sec = hue2rgb(paletteHue('secondary', params, state.palette));
      gl.uniform3f(sh.u.uAccent, acc[0], acc[1], acc[2]);
      gl.uniform3f(sh.u.uSecondary, sec[0], sec[1], sec[2]);
      gl.uniform1f(sh.u.uAlpha, alpha);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (query) { gl.endQuery(sh.timerExt.TIME_ELAPSED_EXT); sh.query = query; }
      if (sh.query && !query) {
        if (gl.getQueryParameter(sh.query, gl.QUERY_RESULT_AVAILABLE)) {
          sh.gpuMs = gl.getQueryParameter(sh.query, gl.QUERY_RESULT) / 1e6;
          gl.deleteQuery(sh.query); sh.query = null;
        }
      }
      sh.passMs = sh.passMs * 0.9 + (performance.now() - tPass) * 0.1;

      drawEyes();   // p5 canvas sits above the shade layer

      state.perfMs = state.perfMs * 0.95 + (performance.now() - t0) * 0.05;
      window.__creaturePerf = {
        ms: state.perfMs, nodes: n, edges: restLen.length,
        state: st, z: +z.toFixed(2), slidePx: +state.slidePx.toFixed(2),
        passMs: +sh.passMs.toFixed(2), gpuMs: +sh.gpuMs.toFixed(2),
        jointSpeed: +(state.jointSpeed ?? 0).toFixed(3),
        spikesAll: state.jm?.spikesAll ?? 0,
        spikesFlagged: state.jm?.spikesFlagged ?? 0,
        spikeLog: state.jm?.log ?? [],
        d0: Math.max(0.05, Math.min(0.9, Number(params.gooThreshold) || 0.18)),
        boneDevRot: +(state.boneDevRot ?? 0).toFixed(4),
        boneDevGround: +(state.boneDevGround ?? 0).toFixed(4),
        limbDensity: state.limbDensity,
      };
      return;
    }
    if (state.shade) {
      const { gl } = state.shade;
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // wire diagnostic
    p.push();
    p.colorMode(p.HSB, 360, 100, 100, 1);
    p.blendMode(p.ADD);
    for (const [lab, list] of Object.entries(state.triByPart)) {
      const bright = 35 + 45 * (lab === 'body' || lab === 'head' ? kick : mid);
      p.noStroke();
      p.fill(hueFor(lab, params, state.palette), 70, bright, 0.32 * alpha);
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
    // bone splats as outlines in the diagnostic
    if (Number(params.boneSplats) !== 0) {
      p.noFill();
      p.stroke(60, 80, 100, 0.7 * alpha);
      p.strokeWeight(1.2);
      for (const B of state.bones) {
        const J = joints[B.j], P = joints[B.p];
        const r = (state.partFloor[B.label] ?? state.medLen * 1.4) * S;
        for (let k = 1; k <= 5; k++) {
          const t = k / 6;
          p.circle(mapX(P.ax + (J.ax - P.ax) * t), mapY(P.ay + (J.ay - P.ay) * t), r * 2);
        }
      }
    }
    p.pop();

    drawEyes();

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
    const sh = ctx.state?.shade;
    if (sh) {
      sh.gl.getExtension('WEBGL_lose_context')?.loseContext();
      sh.canvas.remove();
      ctx.state.shade = null;
    }
    const sdw = ctx.state?.shadow;
    if (sdw) {
      sdw.canvas.remove();
      ctx.state.shadow = null;
    }
  },
};
