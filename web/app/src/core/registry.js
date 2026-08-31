/**
 * Module registry — holds runtime instances of hot-loaded JS modules.
 *
 * The module contract (export shape, ctx fields, interfaces) is specified in
 * web/app/MODULE_ABI.md — keep that file in sync with any behaviour change here.
 *
 * Modules are loaded via dynamic `import()` with a cache-busting query
 * so we can hot-reload the same URL.
 */

import { initInterfaces, advanceInterfaces, trigger as triggerLifecycle } from './interfaces.js';

export function createRegistry({ p, audio }) {
  let lastTickMs = performance.now();
  /** @type {Map<string, {module: any, ctx: any, enabled: boolean, version: number}>} */
  const entries = new Map();
  /** @type {Array<{module: any, ctx: any, parentId: string, bornAt: number}>} */
  const transients = [];
  let transientSeq = 0;

  function makeContext(id, params = {}) {
    return {
      id,
      p,                       // shared p5 instance
      audio,                   // shared audio handle
      params,                  // OSC-controllable param values
      width:  () => p?.width  ?? window.innerWidth,
      height: () => p?.height ?? window.innerHeight,
    };
  }

  function isMultiInstance(entry) {
    return entry?.ctx?.interfaces?.has?.('multi-instance');
  }

  async function load(id, { url, paramsOverride } = {}) {
    const targetUrl = url || `/loaded/${id}.js`;
    const cacheBust = `${targetUrl}?v=${Date.now()}`;
    let mod;
    try {
      const ns = await import(/* @vite-ignore */ cacheBust);
      mod = ns.default;
      if (!mod || typeof mod.draw !== 'function') {
        throw new Error(`module ${id} missing default export with draw()`);
      }
    } catch (err) {
      console.warn(`[registry] failed to load ${id}:`, err);
      return null;
    }

    const prev = entries.get(id);
    if (prev) {
      try { prev.module.teardown?.(prev.ctx); } catch (e) { console.warn(e); }
      // Any in-flight transients of this id are killed on reload.
      cullTransientsOf(id);
    }

    // Hot-reload keeps the live instance's params (OSC mutations like the
    // audience shape survive). Root cause of the Perform watch-item
    // (2026-08-30/31): load is an unconditional re-import, so the
    // controller's load→shape→trigger raced — the reload finished after
    // the shape OSC landed and reset params to defaults, entering the
    // default biped instead of the picked drawing.
    const params = { ...(mod.defaults ?? {}), ...(prev?.ctx?.params ?? {}), ...(paramsOverride ?? {}) };
    const ctx = makeContext(id, params);

    // wire interface state (lifecycle, alpha, etc.) BEFORE setup() runs so
    // setup() can read lifecycle.config if it cares.
    initInterfaces(mod, ctx);

    // Multi-instance templates never draw and skip setup — setup logic for these
    // belongs in onTrigger(), which runs per spawned transient.
    if (!ctx.interfaces.has('multi-instance')) {
      try {
        mod.setup?.(ctx);
      } catch (e) {
        console.error(`[registry] ${id} setup() threw:`, e);
        return null;
      }
    }

    const version = (prev?.version ?? 0) + 1;
    entries.set(id, { module: mod, ctx, enabled: prev?.enabled ?? true, version });
    console.log(`[registry] loaded ${id} v${version}${ctx.interfaces.has('multi-instance') ? ' (multi-instance template)' : ''}`);
    return entries.get(id);
  }

  function unload(id) {
    const entry = entries.get(id);
    if (!entry) return false;
    cullTransientsOf(id);
    try { entry.module.teardown?.(entry.ctx); } catch (e) { console.warn(e); }
    entries.delete(id);
    console.log(`[registry] unloaded ${id}`);
    return true;
  }

  function cullTransientsOf(id) {
    for (let i = transients.length - 1; i >= 0; i--) {
      if (transients[i].parentId !== id) continue;
      try { transients[i].module.teardown?.(transients[i].ctx); } catch (e) {}
      transients.splice(i, 1);
    }
  }

  /** Allocate a fresh transient instance for a multi-instance template. */
  function spawnTransient(entry, args) {
    const mod  = entry.module;
    const cfg  = mod['multi-instance'] ?? {};
    const max  = cfg.max ?? 16;

    // Enforce per-template cap: evict the oldest live transient of this id.
    let liveCount = 0;
    for (const t of transients) if (t.parentId === mod.id) liveCount++;
    if (liveCount >= max) {
      for (let i = 0; i < transients.length; i++) {
        if (transients[i].parentId !== mod.id) continue;
        try { mod.teardown?.(transients[i].ctx); } catch (e) {}
        transients.splice(i, 1);
        break;
      }
    }

    // Clone template params so per-transient mutation doesn't leak back.
    const params = { ...entry.ctx.params };
    const ctx = makeContext(mod.id, params);
    ctx.instanceId = `${mod.id}#${++transientSeq}`;
    initInterfaces(mod, ctx);

    // onTrigger runs BEFORE the lifecycle flips so the module can read args
    // and initialise ctx.state (particle buffer, position, etc.) for this spawn.
    try { mod.onTrigger?.(ctx, args); } catch (e) { console.warn(`[registry] ${mod.id} onTrigger threw:`, e); }

    transients.push({ module: mod, ctx, parentId: mod.id, bornAt: performance.now() });
    return triggerLifecycle(ctx);
  }

  function setEnabled(id, enabled) {
    const entry = entries.get(id);
    if (entry) entry.enabled = !!enabled;
  }

  function dispatchOsc(address, value) {
    // OSC addresses like /<prefix>/<param> route to the matching module
    const m = /^\/([^/]+)\/(.+)$/.exec(address);
    if (!m) return;
    const [, prefix] = m;
    for (const entry of entries.values()) {
      if (entry.module.oscPrefix !== prefix) continue;
      try {
        // For multi-instance templates, OSC mutates template params (affecting
        // future spawns) and a {trigger:true} return spawns a fresh transient.
        // For singletons, it fires the in-place lifecycle as before.
        const ret = entry.module.osc?.(entry.ctx, address, value);
        if (ret && ret.trigger) {
          if (isMultiInstance(entry)) spawnTransient(entry, ret.args);
          else                        triggerLifecycle(entry.ctx);
        }
      } catch (e) {
        console.warn(`[registry] osc dispatch error in ${entry.module.id}:`, e);
      }
    }
  }

  // module failure ledger (brief 13.1): exceptions are EVENTS, and modules
  // self-heal — a failed module re-inits after a short backoff; two failures
  // inside 60 s keep it down (no crash-loop), error stays visible.
  const failed = new Map();   // id -> { at, count, message }
  function reportModuleError(id, e, kind = 'module-error') {
    const message = String(e?.message ?? e).slice(0, 300);
    try {
      window.__ws?.send({ type: kind, id, message, stack: String(e?.stack ?? '').slice(0, 1200) });
    } catch { /* ws down — console below still fires */ }
    console.error(`[registry] ${kind} ${id}:`, e);
  }

  function drawAll() {
    const now = performance.now();
    const rawDelta = now - lastTickMs;
    const deltaMs = Math.min(80, rawDelta);   // cap big stalls (tab switch)
    lastTickMs = now;
    // resume event (brief 13.1 Task 2): a >1 s gap is NOT a timestep —
    // modules see it via ctx.resumeGapMs for exactly one frame and
    // re-anchor instead of integrating the void
    const resumeGapMs = rawDelta > 1000 ? Math.round(rawDelta) : 0;
    if (resumeGapMs) {
      try { window.__ws?.send({ type: 'resume-after-gap', ms: resumeGapMs }); } catch {}
    }

    // 1) Singletons — multi-instance templates are skipped (their transients draw).
    for (const entry of entries.values()) {
      if (!entry.enabled) continue;
      if (isMultiInstance(entry)) continue;
      const id = entry.module.id;
      const f = failed.get(id);
      if (f) {
        if (f.count >= 2 && now - f.firstAt < 60_000) continue;   // stay down
        if (now - f.at < 2000) continue;                           // backoff
        // recovery: teardown, wipe state, re-enter through the normal fade
        try { entry.module.teardown?.(entry.ctx); } catch { /* already broken */ }
        entry.ctx.state = undefined;
        if (entry.ctx.lifecycle && entry.ctx.lifecycle.state !== 'idle') {
          entry.ctx.lifecycle.state = 'entering';
          entry.ctx.lifecycle.phaseMs = 0;
          entry.ctx.lifecycle.progress = 0;
        }
        failed.delete(id);
        reportModuleError(id, new Error(f.message), 'module-recovered');
      }
      entry.ctx.resumeGapMs = resumeGapMs;
      try { advanceInterfaces(entry.ctx, deltaMs); } catch (e) { console.warn(e); }
      try {
        entry.module.draw(entry.ctx);
      } catch (e) {
        const prev = failed.get(id);
        failed.set(id, {
          at: now,
          firstAt: prev && now - prev.firstAt < 60_000 ? prev.firstAt : now,
          count: prev && now - prev.firstAt < 60_000 ? prev.count + 1 : 1,
          message: String(e?.message ?? e),
        });
        reportModuleError(id, e);
      }
    }

    // 2) Transients — advance, draw, cull when lifecycle returns to idle.
    //    Iterate backwards so splice() during the loop is safe.
    for (let i = transients.length - 1; i >= 0; i--) {
      const t = transients[i];
      const tmpl = entries.get(t.parentId);
      if (!tmpl || !tmpl.enabled) {
        try { t.module.teardown?.(t.ctx); } catch (e) {}
        transients.splice(i, 1);
        continue;
      }
      try { advanceInterfaces(t.ctx, deltaMs); } catch (e) { console.warn(e); }
      try { t.module.draw(t.ctx); } catch (e) { console.warn(`[registry] ${t.module.id} draw() threw:`, e); }
      if (t.ctx.lifecycle?.state === 'idle') {
        try { t.module.teardown?.(t.ctx); } catch (e) {}
        transients.splice(i, 1);
      }
    }
  }

  /** Force a triggerable module into its exit fade (brief 12.7: Exit
   *  through the normal fades, not an instant disable). */
  function exitModule(id) {
    const entry = entries.get(id);
    const lc = entry?.ctx?.lifecycle;
    if (!lc || lc.state === 'idle') return false;
    lc.state = 'exiting';
    lc.phaseMs = 0;
    lc.progress = 0;
    return true;
  }

  /** Fire a triggerable module by id with optional args.
   *  - Singleton:        onTrigger(args) -> lifecycle flips in place.
   *  - Multi-instance:   spawnTransient(args) -> fresh ctx, runs onTrigger,
   *                      lifecycle starts entering; auto-culled when idle. */
  function fireTrigger(id, args) {
    const entry = entries.get(id);
    if (!entry) return false;
    if (isMultiInstance(entry)) return spawnTransient(entry, args);
    try { entry.module.onTrigger?.(entry.ctx, args); } catch (e) { console.warn(e); }
    return triggerLifecycle(entry.ctx);
  }

  function list() {
    return [...entries.entries()].map(([id, e]) => {
      const multi = isMultiInstance(e);
      let activeInstances = null;
      if (multi) {
        activeInstances = 0;
        for (const t of transients) if (t.parentId === id) activeInstances++;
      }
      return {
        id,
        enabled:    e.enabled,
        version:    e.version,
        prefix:     e.module.oscPrefix,
        interfaces: [...(e.ctx.interfaces ?? [])],
        lifecycle:  e.ctx.lifecycle
          ? { state: e.ctx.lifecycle.state, alpha: e.ctx.lifecycle.alpha }
          : null,
        activeInstances,
        // Template / current params for the controller's per-module test pane.
        // Defaults come from the module file; params reflect any OSC mutations.
        defaults:   { ...(e.module.defaults ?? {}) },
        params:     { ...e.ctx.params },
      };
    });
  }

  return {
    load,
    unload,
    setEnabled,
    dispatchOsc,
    drawAll,
    exitModule,
    fireTrigger,
    list,
    get size() { return entries.size; },
    get transientCount() { return transients.length; },
  };
}
