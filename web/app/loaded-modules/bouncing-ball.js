/**
 * bouncing-ball — minimal movable demo. Permanent module (no lifecycle).
 *
 * Validates the bounce math by reading `ctx.movable.position` each frame.
 * Trails the path with a fading line so you can see the velocity field over
 * time. OSC controls the ball size and color; the bounce parameters
 * (speed/velocity/damping) are interface-level config, not module params.
 *
 * Tweak live:  /ball/size 90    /ball/color #00ff00    /ball/trail 24
 */

export default {
  id: 'bouncing-ball',
  oscPrefix: 'ball',
  interfaces: ['movable'],

  movable: {
    behavior: 'bounce',
    start:    { x: 0.5, y: 0.5 },
    speed:    0.55,                // canvas-widths per second (≈ 2s edge-to-edge)
    velocity: { x: 0.7, y: 0.45 }, // initial direction (auto-normalised by interface)
    damping:  1.0,                 // fully elastic
  },

  defaults: {
    size:  60,
    color: '#ff3d7f',
    trail: 18,
  },

  setup(ctx) {
    ctx.state = { trail: [] };
  },

  draw(ctx) {
    const { p, params, movable, state } = ctx;
    const cx = movable.position.x * p.width;
    const cy = movable.position.y * p.height;

    // Trail history
    state.trail.unshift({ x: cx, y: cy });
    if (state.trail.length > params.trail) state.trail.length = params.trail;

    // Draw trail as fading line strip
    p.push();
    p.noFill();
    p.strokeWeight(2);
    const baseColor = p.color(params.color);
    for (let i = 1; i < state.trail.length; i++) {
      const a = (1 - i / state.trail.length) * 0.55;
      const c = p.color(params.color);
      c.setAlpha(255 * a);
      p.stroke(c);
      p.line(state.trail[i - 1].x, state.trail[i - 1].y, state.trail[i].x, state.trail[i].y);
    }

    // Ball body
    p.noStroke();
    p.fill(baseColor);
    p.circle(cx, cy, params.size);

    // Soft glow
    const glow = p.color(params.color);
    glow.setAlpha(60);
    p.fill(glow);
    p.circle(cx, cy, params.size * 1.6);
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
