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

  // 3) sliding — interpolate position from/to using the lifecycle phase
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

// ── Helper for modules / UI: "should we even bother drawing?" ──────────────

export function isVisible(ctx) {
  return ctx?.lifecycle?.state !== 'idle';
}
