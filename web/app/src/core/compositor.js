/**
 * Compositor (brief 10) — one WebGL2 canvas that composites the DOM layer
 * stack (#bg Butterchurn, #creature-shadow, #creature-shade, p5 #fg) with
 * integration and post effects, replacing browser DOM compositing:
 *
 *   pass 1  bloom threshold+downsample of the creature shade layer (1/8 res)
 *   pass 2  separable gaussian blur H then V (1/8 res)
 *   pass 3  composite: bg → contact shadow (multiply, tinted by the local
 *           background colour, not pure black) → creature (premultiplied)
 *           → p5 fg → additive bloom halo
 *   pass 4  post + framing to screen (Tasks 2–3): drift/zoom UV transform,
 *           chromatic aberration, highlight knee, grain, vignette
 *
 * Live-path rules: never throws — if WebGL2 is unavailable or `post` is 0,
 * the DOM stack renders as before (bypass restores layer visibility and
 * moves the director's CSS colour filter back onto #bg). While compositing
 * is active the filter string applies to the composite canvas instead, so
 * the whole frame — creature included — shares the director's grade.
 *
 * All texture uploads are premultiplied-passthrough and every blend in the
 * composite shader is premultiplied source-over, so 2D and WebGL sources
 * mix without double-multiplying alpha.
 */

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// creature bloom source: soft-threshold the shade layer's bright pixels
const FS_BRIGHT = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
out vec4 o;
void main() {
  vec4 c = texture(uTex, vUv);
  float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  o = vec4(c.rgb * smoothstep(0.35, 0.75, luma), 1.0);
}`;

const FS_BLUR = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uStep;                 // one blur step in uv (dir / texSize)
in vec2 vUv;
out vec4 o;
void main() {
  vec3 acc = texture(uTex, vUv).rgb * 0.227;
  vec2 s1 = uStep * 1.385, s2 = uStep * 3.231;
  acc += (texture(uTex, vUv + s1).rgb + texture(uTex, vUv - s1).rgb) * 0.316;
  acc += (texture(uTex, vUv + s2).rgb + texture(uTex, vUv - s2).rgb) * 0.070;
  o = vec4(acc, 1.0);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
uniform sampler2D uBg;
uniform sampler2D uShadow;
uniform sampler2D uShade;
uniform sampler2D uFg;
uniform sampler2D uBloom;
uniform float uBgOn;
uniform float uShadowTint;          // how much local bg colour the shadow keeps
uniform float uBloomStrength;
in vec2 vUv;
out vec4 o;
void main() {
  vec3 col = texture(uBg, vUv).rgb * uBgOn;
  // contact shadow: multiply toward a dimmed copy of the local background
  // colour — a hint of the scene, not pure black
  float shA = texture(uShadow, vUv).a;
  col = mix(col, col * uShadowTint, shA);
  vec4 cr = texture(uShade, vUv);     // premultiplied
  col = cr.rgb + col * (1.0 - cr.a);
  vec4 fg = texture(uFg, vUv);        // premultiplied
  col = fg.rgb + col * (1.0 - fg.a);
  col += texture(uBloom, vUv).rgb * uBloomStrength;
  o = vec4(col, 1.0);
}`;

// post + framing (Tasks 2–3). uZoom/uDrift transform the sampled region —
// margin is guaranteed by the caller so edges are never exposed.
const FS_POST = `#version 300 es
precision highp float;
uniform sampler2D uTex;
uniform vec2 uDrift;
uniform float uZoom;
uniform float uChroma;              // max radial RGB split in uv units
uniform float uKnee;                // 0..1 highlight rolloff amount
uniform float uGrain;
uniform float uVignette;
uniform float uTime;
in vec2 vUv;
out vec4 o;
vec3 grab(vec2 uv) { return texture(uTex, uv).rgb; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 c = vec2(0.5);
  vec2 uv = c + (vUv - c) / uZoom + uDrift;
  vec2 r = vUv - c;
  float rad = dot(r, r) * 2.0;                    // 0 centre → ~1 corners
  // chromatic aberration: radial, edges only
  vec2 ca = r * rad * uChroma;
  vec3 col = vec3(grab(uv + ca).r, grab(uv).g, grab(uv - ca).b);
  // soft highlight rolloff: reinhard on the top end only, so the
  // 255-saturating specular/core stops clipping flat
  vec3 hi = max(col - 0.7, 0.0);
  col = mix(col, min(col, 0.7) + hi / (1.0 + hi * 2.2), uKnee);
  // animated luminance-weighted grain (strongest in the mids)
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float n = hash(vUv * vec2(1613.0, 917.0) + fract(uTime * 0.417) * 101.0) - 0.5;
  col += n * uGrain * (luma * (1.0 - luma) * 4.0);
  // vignette
  col *= 1.0 - uVignette * rad * rad;
  o = vec4(col, 1.0);
}`;

function compile(gl, fsSrc) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(`compositor shader: ${gl.getShaderInfoLog(s)}`);
    }
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, mk(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, mk(gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`compositor link: ${gl.getProgramInfoLog(prog)}`);
  }
  const u = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) u[gl.getActiveUniform(prog, i).name] = gl.getUniformLocation(prog, gl.getActiveUniform(prog, i).name);
  return { prog, u };
}

export function createCompositor({ audio }) {
  const params = {
    post: 1,             // 0 = bypass to DOM compositing (A/B)
    bloomRadius: 20,     // halo radius in composite px
    bloomStrength: 0.35,
    shadowTint: 0.35,    // shadow keeps this much of the local bg colour
    grain: 0.05,
    vignette: 0.22,
    chroma: 0.12,        // very low: sub-pixel at centre, ~2 px at corners
    knee: 1,             // highlight rolloff on by default
    driftAmp: 0.01,      // Perlin camera drift, fraction of frame
    zoomAmp: 0.015,      // beat zoom pulse
    barZoom: 1,          // extra 0.5% accent on bar wraps (0 = off)
  };

  const bg = document.getElementById('bg');
  const fgContainer = document.getElementById('fg-container');
  const canvas = document.createElement('canvas');
  canvas.id = 'composite';
  canvas.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; pointer-events:none;';
  fgContainer.after(canvas);

  let gl = null;
  try { gl = canvas.getContext('webgl2', { alpha: false, antialias: false }); } catch { /* stays null */ }
  const inert = {
    active: false, params, canvas,
    setParam() {}, setFilter(f) { if (bg) bg.style.filter = f || 'none'; },
    resize() {}, tick() {}, perf: { passMs: 0, gpuMs: 0 },
  };
  if (!gl) { canvas.remove(); return inert; }

  let progs;
  try {
    progs = {
      bright: compile(gl, FS_BRIGHT),
      blur: compile(gl, FS_BLUR),
      comp: compile(gl, FS_COMPOSITE),
      post: compile(gl, FS_POST),
    };
  } catch (e) { console.error('[compositor]', e); canvas.remove(); return inert; }

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');

  const mkTex = (filter = gl.LINEAR) => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const layerTex = { bg: mkTex(), shadow: mkTex(), shade: mkTex(), fg: mkTex() };
  const mkTarget = () => ({ tex: mkTex(), fbo: gl.createFramebuffer(), w: 0, h: 0 });
  const targets = { comp: mkTarget(), bloomA: mkTarget(), bloomB: mkTarget() };
  const sizeTarget = (t, w, h) => {
    if (t.w === w && t.h === h) return;
    t.w = w; t.h = h;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
  };

  const perf = { passMs: 0, gpuMs: 0 };
  let query = null;
  let filterStr = '';
  let visApplied = null;      // last-applied visibility mode, to avoid style churn
  let emptyShade = null;      // 1×1 transparent stand-in when a layer is absent

  const upload = (tex, el) => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (el && el.width > 0 && el.height > 0) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
      return true;
    }
    if (!emptyShade) emptyShade = new Uint8Array([0, 0, 0, 0]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, emptyShade);
    return false;
  };

  function applyVisibility(active) {
    if (visApplied === active) return;
    visApplied = active;
    canvas.style.display = active ? '' : 'none';
    for (const id of ['bg', 'creature-shadow', 'creature-shade']) {
      const el = document.getElementById(id);
      if (el) el.style.visibility = active ? 'hidden' : '';
    }
    if (fgContainer) fgContainer.style.visibility = active ? 'hidden' : '';
    // the director's colour grade follows the visible surface
    if (bg) bg.style.filter = active ? 'none' : (filterStr || 'none');
    canvas.style.filter = active ? (filterStr || 'none') : 'none';
  }

  // hidden layers whose canvases were created AFTER activation must also be
  // hidden — creature layers appear on first module draw
  function hideLateLayers() {
    for (const id of ['creature-shadow', 'creature-shade']) {
      const el = document.getElementById(id);
      if (el && el.style.visibility !== 'hidden') el.style.visibility = 'hidden';
    }
  }

  // ── framing state (Task 3) ────────────────────────────────────────────
  const zoomSpring = { x: 0, v: 0 };
  let lastBarPhase = 0, barPulse = 0, lastMs = performance.now();

  function framing(now) {
    const dt = Math.min(0.08, (now - lastMs) / 1000);
    lastMs = now;
    const a = audio?.state ?? {};
    const conf = a.beatConfidence ?? 0;
    const level = a.smoothedLevel ?? 0;
    // slow drift: two-octave value noise via incommensurate sines — smooth,
    // non-repeating over minutes, zero-mean
    const t = now / 1000;
    const drift = params.driftAmp;
    const dx = drift * (0.6 * Math.sin(t * 0.11) + 0.4 * Math.sin(t * 0.047 + 1.7));
    const dy = drift * (0.6 * Math.sin(t * 0.083 + 0.9) + 0.4 * Math.sin(t * 0.031 + 4.2));
    // beat zoom: impulse target at each beat decaying over the beat, level-
    // scaled and confidence-gated, chased by a critically damped spring so
    // the phase wrap never steps the frame
    let target = 0;
    if (conf >= 0.4) {
      const ph = a.beatPhase ?? 0;
      target = params.zoomAmp * level * Math.exp(-3.5 * ph);
      const bar = a.barPhase ?? 0;
      if (bar < lastBarPhase - 0.5 && conf >= 0.6 && params.barZoom) barPulse = 0.005;
      lastBarPhase = bar;
    }
    barPulse *= Math.exp(-2.5 * dt);
    target += barPulse;
    // substepped so wn·h ≤ 0.5: at the 80 ms stall clamp a single Euler step
    // has damping factor 2·wn·dt > 2 — the spring flips sign and DIVERGES
    // (measured: zoom exploded and the post pass magnified a few texels of
    // the creature to a full-screen flat wash)
    const wn = 14;
    const n = Math.max(1, Math.ceil(dt * wn / 0.5));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      zoomSpring.v += (wn * wn * (target - zoomSpring.x) - 2 * wn * zoomSpring.v) * h;
      zoomSpring.x += zoomSpring.v * h;
    }
    if (!Number.isFinite(zoomSpring.x) || !Number.isFinite(zoomSpring.v)) { zoomSpring.x = 0; zoomSpring.v = 0; }
    // over-render margin: base zoom always covers max drift + max pulse, so
    // no canvas edge is ever exposed
    const margin = 1 + params.driftAmp + params.zoomAmp + (params.barZoom ? 0.005 : 0);
    return { zoom: margin * (1 + Math.max(0, zoomSpring.x)), dx, dy };
  }

  function tick({ bgOn = true } = {}) {
    const active = Number(params.post) !== 0;
    applyVisibility(active);
    if (!active) return;
    hideLateLayers();

    const W = window.innerWidth, H = window.innerHeight;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    sizeTarget(targets.comp, W, H);
    const bw = Math.max(8, W >> 3), bh = Math.max(8, H >> 3);
    sizeTarget(targets.bloomA, bw, bh);
    sizeTarget(targets.bloomB, bw, bh);

    const t0 = performance.now();
    let q = null;
    if (timerExt && !query) { q = gl.createQuery(); gl.beginQuery(timerExt.TIME_ELAPSED_EXT, q); }

    // layer uploads (premultiplied passthrough; GPU-GPU for canvas sources)
    const shadeEl = document.getElementById('creature-shade');
    const shadowEl = document.getElementById('creature-shadow');
    const fgEl = fgContainer?.querySelector('canvas');
    upload(layerTex.bg, bg);
    upload(layerTex.shadow, shadowEl);
    const hasShade = upload(layerTex.shade, shadeEl);
    upload(layerTex.fg, fgEl);

    const draw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
    const bind = (unit, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); };

    // bloom: bright-pass the creature layer, blur H, blur V (1/8 res)
    if (hasShade && params.bloomStrength > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.bloomA.fbo);
      gl.viewport(0, 0, bw, bh);
      gl.useProgram(progs.bright.prog);
      bind(0, layerTex.shade);
      gl.uniform1i(progs.bright.u.uTex, 0);
      draw();
      const step = Math.max(0.5, params.bloomRadius / 8 / 3.2);   // blur reach ≈ radius/8 texels
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.bloomB.fbo);
      gl.useProgram(progs.blur.prog);
      bind(0, targets.bloomA.tex);
      gl.uniform1i(progs.blur.u.uTex, 0);
      gl.uniform2f(progs.blur.u.uStep, step / bw, 0);
      draw();
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.bloomA.fbo);
      bind(0, targets.bloomB.tex);
      gl.uniform2f(progs.blur.u.uStep, 0, step / bh);
      draw();
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets.bloomA.fbo);
      gl.viewport(0, 0, bw, bh);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    }

    // composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.comp.fbo);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progs.comp.prog);
    bind(0, layerTex.bg); bind(1, layerTex.shadow); bind(2, layerTex.shade);
    bind(3, layerTex.fg); bind(4, targets.bloomA.tex);
    gl.uniform1i(progs.comp.u.uBg, 0);
    gl.uniform1i(progs.comp.u.uShadow, 1);
    gl.uniform1i(progs.comp.u.uShade, 2);
    gl.uniform1i(progs.comp.u.uFg, 3);
    gl.uniform1i(progs.comp.u.uBloom, 4);
    gl.uniform1f(progs.comp.u.uBgOn, bgOn ? 1 : 0);
    gl.uniform1f(progs.comp.u.uShadowTint, Number(params.shadowTint) || 0);
    gl.uniform1f(progs.comp.u.uBloomStrength, Number(params.bloomStrength) || 0);
    draw();

    // post + framing to screen
    const f = framing(t0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(progs.post.prog);
    bind(0, targets.comp.tex);
    gl.uniform1i(progs.post.u.uTex, 0);
    gl.uniform1f(progs.post.u.uZoom, f.zoom);
    gl.uniform2f(progs.post.u.uDrift, f.dx, f.dy);
    gl.uniform1f(progs.post.u.uChroma, (Number(params.chroma) || 0) * 0.01);
    gl.uniform1f(progs.post.u.uKnee, Math.max(0, Math.min(1, Number(params.knee) ?? 1)));
    gl.uniform1f(progs.post.u.uGrain, Number(params.grain) || 0);
    gl.uniform1f(progs.post.u.uVignette, Number(params.vignette) || 0);
    gl.uniform1f(progs.post.u.uTime, t0 / 1000);
    draw();

    if (q) { gl.endQuery(timerExt.TIME_ELAPSED_EXT); query = q; }
    if (query && !q) {
      if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
        perf.gpuMs = gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(query); query = null;
      }
    }
    perf.passMs = perf.passMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  return {
    active: true,
    params,
    canvas,
    perf,
    setParam(key, value) { if (key in params) params[key] = value; },
    setFilter(f) {
      filterStr = f || '';
      const active = Number(params.post) !== 0;
      if (bg) bg.style.filter = active ? 'none' : (filterStr || 'none');
      canvas.style.filter = active ? (filterStr || 'none') : 'none';
    },
    resize() { /* sized lazily in tick */ },
    tick,
  };
}
