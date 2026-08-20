/**
 * walking-person — triggerable + fadeable + movable composition demo.
 *
 * On trigger: fades in at left edge, walks across the screen with a subtle
 * bob, fades out as it reaches the right edge. The `movable` interface
 * handles the steady-state walk (linear, no wrap); `fadeable` ties alpha
 * to the lifecycle so entry/exit are smooth; `triggerable` runs the timing.
 *
 * Trigger:
 *   curl -X POST http://localhost:3000/browser-modules/trigger \
 *        -H "Content-Type: application/json" -d '{"id":"walking-person"}'
 *
 * Time budget: holdMs = 10s. At speed 0.12 widths/sec, the person traverses
 * about 1.2 widths in those 10s — exits the right edge cleanly.
 *
 * OSC: /walk/<param>   e.g.  /walk/size  /walk/shirtColor  /walk/bobAmp
 */

export default {
  id: 'walking-person',
  oscPrefix: 'walk',
  interfaces: ['triggerable', 'fadeable', 'movable'],

  triggerable: {
    enterMs: 600,
    holdMs:  10000,
    exitMs:  600,
    autoRetrigger: false,
  },
  fadeable: {
    easing:   'cubic-out',
    maxAlpha: 1,
  },
  movable: {
    behavior: 'linear',
    start:    { x: -0.1, y: 0.72 },
    speed:    0.12,
    velocity: { x: 1, y: 0 },
    wrap:     false,
  },

  defaults: {
    size:        110,
    bodyColor:   '#f4d3a2',  // skin
    shirtColor:  '#ff8c2a',
    pantsColor:  '#37474f',
    shoeColor:   '#212121',
    hairColor:   '#3e2723',
    bobAmp:      8,    // pixels of vertical bob
    bobRateMs:   320,  // ms per half-bob (one step)
  },

  draw(ctx) {
    const { p, params, lifecycle, movable } = ctx;
    if (lifecycle.state === 'idle') return;

    const cx = movable.position.x * p.width;
    const cy = movable.position.y * p.height;
    const s  = params.size;
    const a  = Math.max(0, Math.min(1, lifecycle.alpha ?? 1)) * 255;

    // Bob — sinusoidal vertical wobble synced to walking phase. The PHASE
    // here is the cumulative time since the entering phase started; phaseMs
    // resets between entering/active/exiting so we use movable position as
    // a more continuous proxy.
    const walkPhase = movable.position.x * 8;   // 8 bobs across the screen
    const bob = Math.sin(walkPhase * Math.PI) * params.bobAmp;
    // Legs alternate — left leg up when sin(phase) > 0, etc.
    const legSwing = Math.sin(walkPhase * Math.PI) * 0.18;   // ±0.18 of s

    const tinted = (hex) => { const c = p.color(hex); c.setAlpha(a); return c; };

    p.push();
    p.translate(cx, cy + bob);
    p.noStroke();

    // ── Shadow ──
    const shade = p.color(0); shade.setAlpha(a * 0.35);
    p.fill(shade);
    p.ellipse(0, s * 0.55 - bob * 0.5, s * 0.55, s * 0.10);

    // ── Legs (alternating) ──
    p.fill(tinted(params.pantsColor));
    p.rect(-s * 0.13, s * 0.10, s * 0.10, s * 0.30 + legSwing * s,  3);    // left
    p.rect( s * 0.03, s * 0.10, s * 0.10, s * 0.30 - legSwing * s,  3);    // right

    // ── Shoes ──
    p.fill(tinted(params.shoeColor));
    p.ellipse(-s * 0.08, s * 0.42 + legSwing * s, s * 0.16, s * 0.07);
    p.ellipse( s * 0.08, s * 0.42 - legSwing * s, s * 0.16, s * 0.07);

    // ── Body (shirt) ──
    p.fill(tinted(params.shirtColor));
    p.rect(-s * 0.20, -s * 0.20, s * 0.40, s * 0.34, 5);

    // ── Arms (also alternating, opposite to legs) ──
    p.fill(tinted(params.shirtColor));
    p.rect(-s * 0.28, -s * 0.15 - legSwing * s, s * 0.08, s * 0.30, 3);   // left swings opposite to left leg
    p.rect( s * 0.20, -s * 0.15 + legSwing * s, s * 0.08, s * 0.30, 3);

    // ── Hands ──
    p.fill(tinted(params.bodyColor));
    p.ellipse(-s * 0.24, s * 0.15 - legSwing * s, s * 0.10, s * 0.10);
    p.ellipse( s * 0.24, s * 0.15 + legSwing * s, s * 0.10, s * 0.10);

    // ── Head ──
    p.fill(tinted(params.bodyColor));
    p.ellipse(0, -s * 0.36, s * 0.32, s * 0.36);
    // hair
    p.fill(tinted(params.hairColor));
    p.arc(0, -s * 0.42, s * 0.34, s * 0.30, Math.PI + 0.3, -0.3, p.CHORD);

    // ── Eye ──
    const eye = p.color(0); eye.setAlpha(a);
    p.fill(eye);
    p.ellipse(s * 0.05, -s * 0.36, s * 0.03, s * 0.04);

    p.pop();
  },

  osc(ctx, address, value) {
    const param = address.split('/').pop();
    if (param && Object.prototype.hasOwnProperty.call(ctx.params, param)) {
      ctx.params[param] = value;
    }
    return null;
  },
};
