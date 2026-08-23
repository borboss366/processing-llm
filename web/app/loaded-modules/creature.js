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

const DEFAULT_HUES = { hueBody: 190, hueLimbs: 150, hueAccent: 315 };

// User-set hue params (via OSC) win; otherwise the shape's palette.
function hueFor(lab, params, palette) {
  const key = lab === 'head' ? 'hueAccent' : lab === 'body' ? 'hueBody' : 'hueLimbs';
  const p = Number(params[key]);
  if (Number.isFinite(p) && p !== DEFAULT_HUES[key]) return p;
  return Number(palette?.[key] ?? DEFAULT_HUES[key]);
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
    const want = J.paw ? 9 : 4;
    const byDist = [];
    for (let i = 0; i < n; i++) byDist.push([Math.hypot(xs[i] - J.x, ys[i] - J.y), i]);
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

  Object.assign(state, {
    n, pos, prev, rest, edges, restLen, boundary, joints, pinned,
    nodeR, drawNodes, labels, triByPart, medLen, spriteR,
    tips: joints.filter((J) => J.role === 'limb'),
    hasFeet: joints.some((J) => J.ground),
    gaitName: json.archetype ?? 'biped',
    palette: json.palette ?? {},
    eyes: json.eyes ?? [],
    bbox: { minX, maxX, minY, maxY, h: maxY - minY, w: maxX - minX, cx: (minX + maxX) / 2 },
    freePhase: 0, perfMs: 0, sprites: null, spriteKey: '',
    world: null, feet: null,
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
uniform vec2 uTexel;
uniform float uD0;
uniform float uD1;
uniform float uNz;
uniform vec3 uLightDir;
uniform float uLightInt;
uniform float uCore;
uniform vec3 uAccent;
uniform float uAlpha;
in vec2 vUv;
out vec4 outColor;
void main() {
  vec4 f = texture(uField, vUv);
  float d = f.a;
  if (d < uD0 - 0.06) discard;
  vec3 base = f.rgb / max(d, 1e-4);
  float dl = texture(uField, vUv - vec2(uTexel.x, 0.0)).a;
  float dr = texture(uField, vUv + vec2(uTexel.x, 0.0)).a;
  float dt = texture(uField, vUv - vec2(0.0, uTexel.y)).a;
  float db = texture(uField, vUv + vec2(0.0, uTexel.y)).a;
  vec3 nrm = normalize(vec3((dl - dr) * 4.0, (dt - db) * 4.0, uNz));
  float lam = max(dot(nrm, uLightDir), 0.0);
  float tMid  = smoothstep(uD0, uD0 + 0.14, d);
  float tCore = smoothstep(uD1, uD1 + 0.22, d);
  vec3 edgeC = base * base * 1.4;
  vec3 coreC = mix(base, vec3(1.0), 0.35) * (1.0 + 0.45 * uCore);
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
    const u = {};
    for (const name of ['uField', 'uTexel', 'uD0', 'uD1', 'uNz', 'uLightDir', 'uLightInt', 'uCore', 'uAccent', 'uAlpha']) {
      u[name] = gl.getUniformLocation(prog, name);
    }
    const accum = document.createElement('canvas');
    const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    state.shade = {
      canvas, gl, prog, tex, u,
      accum, g: accum.getContext('2d'),
      timerExt, gpuMs: 0, passMs: 0, query: null,
    };
  }
  const sh = state.shade;
  const W = window.innerWidth, H = window.innerHeight;
  if (sh.canvas.width !== W || sh.canvas.height !== H) {
    sh.canvas.width = W; sh.canvas.height = H;
    sh.accum.width = Math.ceil(W / 2); sh.accum.height = Math.ceil(H / 2);
    sh.gl.viewport(0, 0, W, H);
  }
  return sh;
}

function ensureSprites(state, params) {
  const hues = {
    body: hueFor('body', params, state.palette),
    head: hueFor('head', params, state.palette),
    limb: hueFor('limb', params, state.palette),
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

export default {
  id: 'creature',
  oscPrefix: 'creature',
  interfaces: ['triggerable', 'fadeable'],
  triggerable: { enterMs: 900, holdMs: 120_000, exitMs: 900, autoRetrigger: true },
  fadeable: { easing: 'cubic-out', maxAlpha: 1 },
  defaults: {
    shape: 'biped-1',          // shapes/<name>.png + .json
    archetype: 'auto',         // 'auto' | 'biped' | 'trot' | 'pulse'
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
    hueBody: 190, hueLimbs: 150, hueAccent: 315,   // override the shape palette when changed
    renderMode: 'goo',         // 'goo' (shaded metaball) | 'wire' (diagnostic)
    gooThreshold: 0.18,        // d0: body surface threshold (unsaturated density scale)
    shadeD1: 0.55,             // d1: core/specular threshold
    shadeNz: 0.6,              // pseudo-normal flatness
    lightX: -0.6, lightY: -0.75,
    simmer: 1.0,
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
    if (next !== beh.state) {
      beh.state = next;
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

    let dPhase = phase - (world.lastPhase ?? phase);
    if (dPhase < -0.5) dPhase += 1;
    if (dPhase < 0) dPhase = 0;
    world.lastPhase = phase;

    if (state.hasFeet && st === 'walk') {
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
      ? 1 + (gait.bellPulse ?? 0) * Math.sin(2 * Math.PI * phase) * amp
      : 1 + 0.02 * Math.sin(2 * Math.PI * 0.2 * tSec);

    let sq = 0, bounceY = 0;
    const H = state.bbox.h;
    if (st === 'walk') {
      const s = Math.cos(4 * Math.PI * phase);
      sq = 0.05 * s * lvl;
      bounceY = -(gait.bounce ?? 0.05) * H * ((s + 1) / 2) * lvl * params.bounce;
    } else if (st === 'groove') {
      const s = Math.sin(4 * Math.PI * phase);
      sq = 0.05 * s * lvl;
      bounceY = -0.08 * H * Math.max(0, Math.sin(4 * Math.PI * phase)) * lvl * params.bounce;
    } else if (st === 'hop') {
      const air = Math.max(0, Math.sin(2 * Math.PI * phase));
      sq = (air > 0 ? 0.07 * air : -0.06) * lvl;
      bounceY = -0.13 * H * air * lvl * params.bounce;
    }
    if (!state.hasFeet) {
      bounceY += (st === 'idle' ? 0 : (gait.drift ?? 0) * -H * Math.sin(2 * Math.PI * (phase - 0.25)) * params.bounce);
    }

    const idleK = st === 'idle' ? 1 : 0.3;
    const swayU = ((p.noise(tSec * 0.13, 7) - 0.5) * 2) * 0.02 * state.bbox.w * idleK;
    const rearBob = ((p.noise(tSec * 0.4, 23) - 0.5) * 2) * 0.006 * idleK;
    let headLook = ((p.noise(tSec * 0.07, 13) - 0.5) * 2) * 0.45 * idleK;
    if (p.noise(tSec * 0.02, 41) > 0.72) headLook += 0.35 * idleK;

    const { joints, pos, prev, rest, edges, restLen, boundary, n } = state;
    for (const J of joints) {
      const g = (gait[J.role] ?? gait.root)(J.limb ?? 0, J.phase ?? 0);
      J.theta = st === 'idle' ? 0 : g.A * amp * Math.sin(2 * Math.PI * (g.freq * phase + g.off));
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
          const air = Math.max(0, Math.sin(2 * Math.PI * phase));
          T.ax = T.x; T.ay = T.y - 0.10 * H * air * lvl;
          foot.plantWX = null;
        } else {
          const cyc = (phase / Math.max(0.25, params.beatsPerStride) - T.phase) % 1;
          const c = cyc < 0 ? cyc + 1 : cyc;
          if (c < 0.6) {
            T.ax = T.x + strideU * (0.3 - c);
            T.ay = T.y;
            const wx = world.x + (T.ax - joints[0].x) * S * world.facingVis;
            if (foot.plantWX === null) foot.plantWX = wx;
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
      if (state.shade) {
        const { gl } = state.shade;
        gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      }
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

    if (params.renderMode === 'goo') {
      const sh = ensureShadeLayer(state);
      const sprites = ensureSprites(state, params);
      const gl = sh.gl;
      const g = sh.g;
      const tPass = performance.now();

      g.clearRect(0, 0, sh.accum.width, sh.accum.height);
      g.globalCompositeOperation = 'lighter';
      // low per-sprite alpha ON PURPOSE: density must not saturate inside
      // the body or the shader's colour ramp has no gradient left to shade
      const aBody = 0.30 + 0.10 * kick;
      const aLimb = 0.30 + 0.10 * mid;
      const simmer = Number(params.simmer) || 0;
      for (let i = 0; i < n; i++) {
        const lab = state.labels[i];
        const sp = lab === 'head' ? sprites.head : lab === 'body' ? sprites.body : sprites.limb;
        const wob = 1 + 0.06 * simmer * (p.noise(i * 0.37, tSec * 0.22) * 2 - 1);
        const r = state.spriteR[i] * S * wob * 0.5;
        g.globalAlpha = (lab === 'body' || lab === 'head') ? aBody : aLimb;
        g.drawImage(sp, X(i) * 0.5 - r, Y(i) * 0.5 - r, r * 2, r * 2);
      }
      g.globalAlpha = 1;

      let query = null;
      if (sh.timerExt && !sh.query) {
        query = gl.createQuery();
        gl.beginQuery(sh.timerExt.TIME_ELAPSED_EXT, query);
      }
      gl.bindTexture(gl.TEXTURE_2D, sh.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sh.accum);
      gl.useProgram(sh.prog);
      gl.uniform1i(sh.u.uField, 0);
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
      const ah = ((hueFor('head', params, state.palette)) % 360) * Math.PI / 180;
      gl.uniform3f(sh.u.uAccent,
        0.5 + 0.5 * Math.cos(ah), 0.5 + 0.5 * Math.cos(ah - 2.094), 0.5 + 0.5 * Math.cos(ah + 2.094));
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

      state.perfMs = state.perfMs * 0.95 + (performance.now() - t0) * 0.05;
      window.__creaturePerf = {
        ms: state.perfMs, nodes: n, edges: restLen.length,
        state: st, z: +z.toFixed(2), slidePx: +state.slidePx.toFixed(2),
        passMs: +sh.passMs.toFixed(2), gpuMs: +sh.gpuMs.toFixed(2),
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
    const sh = ctx.state?.shade;
    if (sh) {
      sh.gl.getExtension('WEBGL_lose_context')?.loseContext();
      sh.canvas.remove();
      ctx.state.shade = null;
    }
  },
};
