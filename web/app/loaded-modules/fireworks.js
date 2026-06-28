/**
 * fireworks — multi-instance particle burst.
 *
 * Each trigger spawns a fresh transient at (x, y) on the canvas. Particles
 * fan out radially, fall under gravity, fade as they age, and leave short
 * trails. The lifecycle envelope (fadeable.alpha) multiplies on top of the
 * per-particle alpha so the whole burst tucks itself out cleanly.
 *
 * Trigger (singleton-style — fires at center, random hue):
 *   curl -X POST http://localhost:3000/browser-modules/trigger \
 *        -H "Content-Type: application/json" \
 *        -d '{"id":"fireworks"}'
 *
 * Trigger with placement + color:
 *   curl -X POST http://localhost:3000/browser-modules/trigger \
 *        -H "Content-Type: application/json" \
 *        -d '{"id":"fireworks","args":{"x":0.3,"y":0.4,"color":"#ff3d7f","count":80}}'
 *
 * OSC: /fw/<param>   e.g.  /fw/x 0.7   /fw/gravity 500
 *      /fw/trigger 1     spawns a fresh burst with current template params
 */

export default {
  id: 'fireworks',
  oscPrefix: 'fw',
  interfaces: ['triggerable', 'fadeable', 'multi-instance'],

  'multi-instance': {
    max: 24,                       // soft cap; oldest live burst evicted past this
  },
  triggerable: {
    enterMs: 40,                   // quick pop
    holdMs:  1500,                 // particles fly + fade naturally
    exitMs:  450,                  // envelope tucks survivors out cleanly
    autoRetrigger: true,           // irrelevant for transients but harmless
  },
  fadeable: {
    easing:   'cubic-out',
    maxAlpha: 1,
  },

  defaults: {
    x:        0.5,                 // burst centre, canvas-normalized 0..1
    y:        0.4,
    count:    70,                  // particle count per burst
    spread:   360,                 // initial speed (px/sec)
    gravity:  420,                 // px/sec^2 (positive = falls down)
    drag:     0.92,                // per-second velocity multiplier
    life:     1300,                // ms each particle lives
    size:     3,                   // base particle radius (px)
    trailLen: 6,                   // history points drawn as a streak
    color:    'auto',              // 'auto' = random palette per burst, else hex
    sparkle:  true,                // pale sub-flashes for shimmer
    upBias:   0.15,                // 0..1, slight upward kick on initial vy
  },

  onTrigger(ctx, args) {
    const { p, params } = ctx;

    // apply optional args onto this transient's params (template stays clean)
    if (args) {
      for (const k of ['x', 'y', 'count', 'spread', 'gravity', 'drag', 'life', 'size', 'trailLen', 'color', 'sparkle', 'upBias']) {
        if (args[k] !== undefined) params[k] = args[k];
      }
    }

    const cx = params.x * p.width;
    const cy = params.y * p.height;

    // resolve burst-wide color choice once
    const auto = params.color === 'auto';
    const baseHue = auto ? Math.random() * 360 : null;

    const particles = [];
    for (let i = 0; i < params.count; i++) {
      // spread direction roughly uniform around the circle, with jitter
      const ang   = (i / params.count) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const speed = params.spread * (0.45 + Math.random() * 0.6);
      const vx    = Math.cos(ang) * speed;
      const vy    = Math.sin(ang) * speed - speed * params.upBias;
      particles.push({
        x: cx, y: cy,
        vx, vy,
        age:  0,
        life: params.life * (0.7 + Math.random() * 0.5),
        size: params.size * (0.6 + Math.random() * 0.8),
        hue:  auto ? (baseHue + (Math.random() - 0.5) * 50) : null,
        trail: [{ x: cx, y: cy }],
      });
    }

    ctx.state = { particles };
  },

  draw(ctx) {
    const { p, params, lifecycle, state } = ctx;
    if (!state || lifecycle.state === 'idle') return;

    const envelope = lifecycle.alpha ?? 1;
    const dtMs = Math.min(80, p.deltaTime ?? 16);   // clamp big stalls
    const dt   = dtMs / 1000;

    // per-frame drag = drag^(dt * 60) so drag config is per ~60fps frame
    const dragF = Math.pow(params.drag, dt * 60);

    p.push();
    p.colorMode(p.HSB, 360, 100, 100, 1);

    for (let i = state.particles.length - 1; i >= 0; i--) {
      const q = state.particles[i];

      // physics integrate
      q.vy += params.gravity * dt;
      q.vx *= dragF;
      q.vy *= dragF;
      q.x  += q.vx * dt;
      q.y  += q.vy * dt;
      q.age += dtMs;

      // age out
      if (q.age >= q.life) {
        state.particles.splice(i, 1);
        continue;
      }

      // trail history
      q.trail.unshift({ x: q.x, y: q.y });
      if (q.trail.length > params.trailLen) q.trail.length = params.trailLen;

      const lifeT = q.age / q.life;
      const alpha = (1 - lifeT) * envelope;

      // ── trail streak: thinner + dimmer than head ──
      p.noFill();
      p.strokeWeight(q.size * 0.75);
      if (q.hue !== null) p.stroke(q.hue, 80, 100, alpha * 0.55);
      else {
        const c = p.color(params.color); c.setAlpha(255 * alpha * 0.55); p.stroke(c);
      }
      for (let j = 1; j < q.trail.length; j++) {
        p.line(q.trail[j - 1].x, q.trail[j - 1].y, q.trail[j].x, q.trail[j].y);
      }

      // ── head ──
      p.noStroke();
      if (q.hue !== null) p.fill(q.hue, 60, 100, alpha);
      else {
        const c = p.color(params.color); c.setAlpha(255 * alpha); p.fill(c);
      }
      p.circle(q.x, q.y, q.size * 2);

      // ── pale sub-sparkle ──
      if (params.sparkle && Math.random() < 0.25) {
        p.fill(55, 25, 100, alpha * 0.85);   // warm white
        p.circle(q.x + (Math.random() - 0.5) * 6,
                 q.y + (Math.random() - 0.5) * 6,
                 q.size * 0.6);
      }
    }

    p.pop();
  },

  osc(ctx, address, value) {
    const param = address.split('/').pop();
    if (param === 'trigger') {
      // returning {trigger:true} on a multi-instance template spawns a transient.
      // optional positional args could be passed via OSC tuple later.
      return { trigger: true };
    }
    if (param && Object.prototype.hasOwnProperty.call(ctx.params, param)) {
      ctx.params[param] = value;
    }
    return null;
  },
};
