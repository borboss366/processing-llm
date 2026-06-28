/**
 * peek-seagull — triggerable + sliding composition example.
 *
 * Slides in from the right edge of the canvas, peeks for ~2 seconds with a
 * subtle head-bob, then slides back out. Procedural silhouette so it needs
 * no asset files.
 *
 * Trigger:
 *   curl -X POST http://localhost:3000/browser-modules/trigger \
 *        -H "Content-Type: application/json" \
 *        -d '{"id":"peek-seagull"}'
 *
 * OSC: /gull/<paramName>  e.g.  /gull/size  /gull/bodyColor
 */

export default {
  id: 'peek-seagull',
  oscPrefix: 'gull',
  interfaces: ['triggerable', 'sliding'],

  triggerable: {
    enterMs: 700,
    holdMs:  2200,
    exitMs:  700,
    autoRetrigger: false,    // re-triggers while peeking are ignored
  },
  sliding: {
    from: { x: 1.20, y: 0.55 },    // offscreen right (x > 1.0)
    to:   { x: 0.80, y: 0.55 },    // peeking — visible from the right edge
    easing:     'cubic-out',
    exitEasing: 'cubic-in',
  },

  defaults: {
    size:       200,
    bodyColor:  '#fafafa',
    wingColor:  '#1f1f1f',
    beakColor:  '#ff8c2a',
    eyeColor:   '#000000',
    feetColor:  '#ff8c2a',
    bobAmp:     0.10,        // head bob amplitude in radians while active
    bobRateMs:  450,          // period of the head bob (ms per half-cycle)
  },

  draw(ctx) {
    const { p, params, lifecycle } = ctx;
    if (lifecycle.state === 'idle') return;

    const cx = lifecycle.position.x * p.width;
    const cy = lifecycle.position.y * p.height;
    const s  = params.size;

    // Subtle head-bob during the hold phase. The sliding interface drives the
    // overall body position; this is a small rotation on top, module-specific.
    let bob = 0;
    if (lifecycle.state === 'active') {
      bob = Math.sin((lifecycle.phaseMs / params.bobRateMs) * Math.PI) * params.bobAmp;
    }

    p.push();
      p.translate(cx, cy);
      p.rotate(bob);

      // ── feet (drawn first, behind body) ──
      p.stroke(params.feetColor);
      p.strokeWeight(s * 0.04);
      p.noFill();
      p.line(-s * 0.10, s * 0.45, -s * 0.10, s * 0.62);
      p.line( s * 0.10, s * 0.45,  s * 0.10, s * 0.62);
      // little webbed toes (3 small lines fanning out from each foot)
      for (const fx of [-s * 0.10, s * 0.10]) {
        for (const tx of [-0.05, 0, 0.05]) {
          p.line(fx, s * 0.62, fx + s * tx, s * 0.68);
        }
      }

      // ── body (oval) ──
      p.noStroke();
      p.fill(params.bodyColor);
      p.ellipse(0, s * 0.15, s * 1.10, s * 0.78);

      // ── tail (small triangle off the back-right) ──
      p.fill(params.bodyColor);
      p.triangle(
        s * 0.50,  s * 0.10,
        s * 0.78,  s * 0.00,
        s * 0.55,  s * 0.30
      );

      // ── wing (dark arc on body) ──
      p.fill(params.wingColor);
      p.arc(s * 0.05, s * 0.05, s * 0.95, s * 0.55, Math.PI, 0);

      // ── head (slightly tilted up-left, peeking) ──
      p.fill(params.bodyColor);
      p.ellipse(-s * 0.50, -s * 0.20, s * 0.55, s * 0.55);

      // ── beak ──
      p.fill(params.beakColor);
      p.triangle(
        -s * 0.95, -s * 0.18,
        -s * 0.72, -s * 0.14,
        -s * 0.95, -s * 0.10
      );

      // ── eye ──
      p.fill(params.eyeColor);
      p.ellipse(-s * 0.55, -s * 0.28, s * 0.07, s * 0.07);
      // tiny highlight
      p.fill(255);
      p.ellipse(-s * 0.535, -s * 0.295, s * 0.025, s * 0.025);
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
