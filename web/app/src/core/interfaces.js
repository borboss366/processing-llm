/**
 * Module interface middleware.
 *
 * A module declares which interfaces it implements via `interfaces: [...]`.
 * The registry calls into this file to:
 *   1. Initialise lifecycle state once per instance (`initInterfaces`).
 *   2. Advance the state machine each frame (`advanceInterfaces`).
 *   3. Apply derived transforms (alpha, transform, scale) into ctx.lifecycle
 *      so the module's draw() can read them.
 *   4. Handle `trigger()` calls from the WS bus or the UI.
 *
 * Pipeline order (fixed): trigger -> phase progression -> fadeable -> sliding
 *                         -> growable -> module.draw()
 *
 * Each interface declares its config under `module.<interfaceName>`, e.g.:
 *   { interfaces: ['triggerable', 'fadeable'],
 *     fadeable: { enterMs: 400, holdMs: 1500, exitMs: 600, easing: 'cubic-out' } }
 */

// ── Easings ────────────────────────────────────────────────────────────────

const EASINGS = {
  'linear':        (t) => t,
  'cubic-in':      (t) => t * t * t,
  'cubic-out':     (t) => 1 - Math.pow(1 - t, 3),
  'cubic-in-out':  (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  'quint-out':     (t) => 1 - Math.pow(1 - t, 5),
};
function ease(name, t) { return (EASINGS[name] ?? EASINGS.linear)(t); }
function clamp01(x)   { return Math.max(0, Math.min(1, x)); }

// ── Default configs per interface ──────────────────────────────────────────

const DEFAULTS = {
  triggerable: { enterMs: 500, holdMs: 1500, exitMs: 600, autoRetrigger: false },
  fadeable:    { easing: 'cubic-out', maxAlpha: 1 },
  sliding: {
    from:       { x: 0, y: 0 },
    to:         { x: 0, y: 0 },
    easing:     'cubic-out',     // entrance curve
    exitEasing: 'cubic-in',      // exit curve
  },
  movable: {
    behavior: 'linear',                // 'linear' | 'bounce' | 'wander' | 'orbit'
    start:    { x: 0.5, y: 0.5 },      // initial position in canvas-fractions [0..1]
    speed:    0.3,                     // canvas-widths per second
    velocity: { x: 1, y: 0 },          // initial direction (will be normalised)
    damping:  1.0,                     // bounce: 1.0 = fully elastic, <1 loses energy
    wrap:     false,                   // linear: exit one side = enter the other
    jitter:   0.6,                     // wander: radians-per-second random direction wobble
    center:   { x: 0.5, y: 0.5 },      // orbit: rotation centre
    radius:   0.2,                     // orbit: radius in canvas-widths
  },
};

// ── Initialise once per loaded instance ────────────────────────────────────

export function initInterfaces(mod, ctx) {
  const ifaces = mod.interfaces ?? [];
  // Merge the shared timing config (triggerable + fadeable) — these still live
  // on lifecycle.config for backwards-compat with existing modules.
  const cfg = { ...DEFAULTS.triggerable, ...DEFAULTS.fadeable, ...(mod.triggerable ?? {}), ...(mod.fadeable ?? {}) };

  ctx.interfaces = new Set(ifaces);
  ctx.lifecycle = {
    state:    ifaces.includes('triggerable') ? 'idle' : 'active',
    phaseMs:  0,
    progress: 0,
    alpha:    ifaces.includes('triggerable') ? 0 : 1,
    config:   cfg,
  };

  // sliding lives in its own config sub-object so its from/to don't collide
  // with anything else, and the middleware can compute lifecycle.position.
  if (ifaces.includes('sliding')) {
    const sl = { ...DEFAULTS.sliding, ...(mod.sliding ?? {}) };
    ctx.lifecycle.slidingConfig = sl;
    ctx.lifecycle.position = { x: sl.from.x, y: sl.from.y };
  } else {
    ctx.lifecycle.position = { x: 0, y: 0 };
  }

  // movable owns its own position state at ctx.movable.position — kept
  // separate from lifecycle.position so a module can have BOTH sliding (for
  // enter/exit) AND movable (for steady-state motion in between) without
  // them clobbering each other.
  if (ifaces.includes('movable')) {
    const mc = { ...DEFAULTS.movable, ...(mod.movable ?? {}) };
    ctx.movable = {
      config:   mc,
      position: { x: mc.start.x, y: mc.start.y },
      velocity: scaledVelocity(mc.velocity, mc.speed),
      angle:    0,        // orbit progress
    };
  }
}

// Normalise a velocity vector to unit length, then scale by speed. Falls back
// to {speed, 0} if the input vector is zero.
function scaledVelocity(v, speed) {
  const mag = Math.hypot(v.x, v.y);
  if (mag === 0) return { x: speed, y: 0 };
  return { x: (v.x / mag) * speed, y: (v.y / mag) * speed };
}

// ── Trigger a module (called from WS handler or UI) ────────────────────────

export function trigger(ctx) {
  const lc = ctx?.lifecycle;
  if (!lc || !ctx.interfaces?.has('triggerable')) return false;

  // Always restart the entering phase. If already entering/active and
  // autoRetrigger=false, the call is ignored.
  if (lc.state === 'entering' || lc.state === 'active') {
    if (!lc.config.autoRetrigger) return false;
  }
  lc.state = 'entering';
  lc.phaseMs = 0;
  lc.progress = 0;

  // Reset movable state so each trigger restarts the motion from `start`.
  // Otherwise a walking-person triggered twice in a row would keep walking
  // off-screen forever (no reset between cycles).
  if (ctx.interfaces?.has('movable')) {
    const mc = ctx.movable.config;
    ctx.movable.position = { x: mc.start.x, y: mc.start.y };
    ctx.movable.velocity = scaledVelocity(mc.velocity, mc.speed);
    ctx.movable.angle    = 0;
  }
  return true;
}

// ── Per-frame advance ──────────────────────────────────────────────────────

export function advanceInterfaces(ctx, deltaMs) {
  const lc = ctx?.lifecycle;
  if (!lc) return;

  // 1) progress the state machine (only for triggerable modules)
  if (ctx.interfaces.has('triggerable') && lc.state !== 'idle') {
    lc.phaseMs += deltaMs;
    const cfg = lc.config;
    if (lc.state === 'entering') {
      lc.progress = clamp01(lc.phaseMs / cfg.enterMs);
      if (lc.phaseMs >= cfg.enterMs) {
        lc.state = 'active'; lc.phaseMs = 0; lc.progress = 0;
      }
    } else if (lc.state === 'active') {
      lc.progress = clamp01(lc.phaseMs / cfg.holdMs);
      if (lc.phaseMs >= cfg.holdMs) {
        lc.state = 'exiting'; lc.phaseMs = 0; lc.progress = 0;
      }
    } else if (lc.state === 'exiting') {
      lc.progress = clamp01(lc.phaseMs / cfg.exitMs);
      if (lc.phaseMs >= cfg.exitMs) {
        lc.state = 'idle'; lc.phaseMs = 0; lc.progress = 0;
      }
    }
  }

  // 2) fadeable — compute alpha from lifecycle state
  if (ctx.interfaces.has('fadeable')) {
    const cfg = lc.config;
    if (lc.state === 'entering')      lc.alpha = ease(cfg.easing, lc.progress) * cfg.maxAlpha;
    else if (lc.state === 'active')   lc.alpha = cfg.maxAlpha;
    else if (lc.state === 'exiting')  lc.alpha = (1 - ease(cfg.easing, lc.progress)) * cfg.maxAlpha;
    else                              lc.alpha = 0;     // idle
  }

  // 3) movable — integrate position based on behavior. Runs continuously
  //    regardless of triggerable state; module's draw() can gate on lifecycle
  //    if it shouldn't render while idle.
  if (ctx.interfaces.has('movable')) {
    advanceMovable(ctx.movable, deltaMs / 1000);
  }

  // 4) sliding — interpolate position from/to using the lifecycle phase
  if (ctx.interfaces.has('sliding')) {
    const sc = lc.slidingConfig;
    if (lc.state === 'entering') {
      const t = ease(sc.easing, lc.progress);
      lc.position.x = sc.from.x + (sc.to.x - sc.from.x) * t;
      lc.position.y = sc.from.y + (sc.to.y - sc.from.y) * t;
    } else if (lc.state === 'active') {
      lc.position.x = sc.to.x;
      lc.position.y = sc.to.y;
    } else if (lc.state === 'exiting') {
      const t = ease(sc.exitEasing, lc.progress);
      lc.position.x = sc.to.x + (sc.from.x - sc.to.x) * t;
      lc.position.y = sc.to.y + (sc.from.y - sc.to.y) * t;
    } else {
      lc.position.x = sc.from.x;
      lc.position.y = sc.from.y;
    }
  }
}

// ── Movable behaviors ──────────────────────────────────────────────────────
//
// Each behavior mutates m.position (and m.velocity / m.angle where relevant).
// Positions are kept in canvas-fractions [0..1]; modules multiply by p.width
// / p.height when drawing.

function advanceMovable(m, dt) {
  const cfg = m.config;
  switch (cfg.behavior) {
    case 'linear':  return linearStep(m, cfg, dt);
    case 'bounce':  return bounceStep(m, cfg, dt);
    case 'wander':  return wanderStep(m, cfg, dt);
    case 'orbit':   return orbitStep(m, cfg, dt);
    default:        return linearStep(m, cfg, dt);
  }
}

function linearStep(m, cfg, dt) {
  m.position.x += m.velocity.x * dt;
  m.position.y += m.velocity.y * dt;
  if (cfg.wrap) {
    m.position.x = ((m.position.x % 1) + 1) % 1;
    m.position.y = ((m.position.y % 1) + 1) % 1;
  }
}

function bounceStep(m, cfg, dt) {
  m.position.x += m.velocity.x * dt;
  m.position.y += m.velocity.y * dt;
  if (m.position.x < 0) { m.position.x = 0; m.velocity.x = Math.abs(m.velocity.x) * cfg.damping; }
  if (m.position.x > 1) { m.position.x = 1; m.velocity.x = -Math.abs(m.velocity.x) * cfg.damping; }
  if (m.position.y < 0) { m.position.y = 0; m.velocity.y = Math.abs(m.velocity.y) * cfg.damping; }
  if (m.position.y > 1) { m.position.y = 1; m.velocity.y = -Math.abs(m.velocity.y) * cfg.damping; }
}

function wanderStep(m, cfg, dt) {
  // Rotate velocity by a small random angle every frame; magnitude stays
  // constant so the wanderer doesn't accidentally stop. Then integrate +
  // softly bounce off canvas edges with a 5% inset so the subject stays in-view.
  const a = (Math.random() - 0.5) * cfg.jitter * dt;
  const cs = Math.cos(a), sn = Math.sin(a);
  const vx = m.velocity.x * cs - m.velocity.y * sn;
  const vy = m.velocity.x * sn + m.velocity.y * cs;
  const mag = Math.hypot(vx, vy) || 1;
  m.velocity.x = (vx / mag) * cfg.speed;
  m.velocity.y = (vy / mag) * cfg.speed;
  m.position.x += m.velocity.x * dt;
  m.position.y += m.velocity.y * dt;
  if (m.position.x < 0.05) { m.position.x = 0.05; m.velocity.x = Math.abs(m.velocity.x); }
  if (m.position.x > 0.95) { m.position.x = 0.95; m.velocity.x = -Math.abs(m.velocity.x); }
  if (m.position.y < 0.05) { m.position.y = 0.05; m.velocity.y = Math.abs(m.velocity.y); }
  if (m.position.y > 0.95) { m.position.y = 0.95; m.velocity.y = -Math.abs(m.velocity.y); }
}

function orbitStep(m, cfg, dt) {
  // speed is interpreted as revolutions-per-second here so the API stays
  // single-knob ("speed=0.1" means "10 seconds per full lap").
  m.angle += cfg.speed * dt * Math.PI * 2;
  m.position.x = cfg.center.x + Math.cos(m.angle) * cfg.radius;
  m.position.y = cfg.center.y + Math.sin(m.angle) * cfg.radius;
}

// ── Helper for modules / UI: "should we even bother drawing?" ──────────────

export function isVisible(ctx) {
  return ctx?.lifecycle?.state !== 'idle';
}
