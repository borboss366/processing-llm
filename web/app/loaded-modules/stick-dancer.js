/**
 * stick-dancer — first proof-of-concept hot-loaded module.
 *
 * Hot-loaded via the registry at /loaded/stick-dancer.js. Demonstrates:
 *   - setup/draw/osc/teardown ABI
 *   - audio.state used for scale + arm wave + beat detection
 *   - OSC-tunable params via ctx.params
 *
 * To reload: just POST to the controller — the registry imports with a
 * cache-busting query, so the same URL gets fresh code without page reload.
 */

export default {
  id: 'stick-dancer',
  oscPrefix: 'sd',
  defaults: {
    bodyColor:    '#ff8c2a',
    handColor:    '#ff3d7f',
    hairColor:    '#8c3aff',
    baseSize:     90,
    waveRate:     0.18,
    waveAmplitude: 0.6,
    armsUp:       true,
    bounceOnBeat: true,
    xFrac:        0.85,
    yFrac:        0.5,
  },

  setup(ctx) {
    ctx.state = { bounceVel: 0, bounceOff: 0 };
  },

  draw(ctx) {
    const { p, audio, params, state } = ctx;
    const s  = params.baseSize;
    const cx = p.width  * params.xFrac;
    const cy = p.height * params.yFrac;

    // beat bounce
    if (params.bounceOnBeat && audio.state.onBeat) state.bounceVel = -4;
    state.bounceVel += 0.4;
    state.bounceOff += state.bounceVel;
    if (state.bounceOff > 0) { state.bounceOff = 0; state.bounceVel = 0; }

    const armOsc = Math.sin(p.frameCount * params.waveRate * (1 + audio.state.smoothedLevel * 2)) * params.waveAmplitude;

    p.push();
      p.translate(cx, cy);
      p.scale(1 + audio.state.smoothedLevel * 0.6);
      p.translate(0, state.bounceOff);

      p.stroke(params.bodyColor); p.strokeWeight(s * 0.06);
      p.line(0, -s * 0.55, 0, 0);                                     // spine
      p.line(0, 0, -s * 0.2, s * 0.8);                                // left leg
      p.line(0, 0,  s * 0.2, s * 0.8);                                // right leg

      p.noStroke(); p.fill(params.bodyColor);
      p.ellipse(0, -s * 0.72, s * 0.32, s * 0.36);                    // head
      p.fill(params.hairColor);
      p.ellipse(0, -s * 0.86, s * 0.30, s * 0.18);                    // hair

      const baseR = params.armsUp ? -Math.PI / 3   : Math.PI / 3;
      const baseL = params.armsUp ? -2 * Math.PI/3 : 2 * Math.PI/3;

      p.push();
        p.translate(0, -s * 0.55);
        p.rotate(baseR + armOsc);
        p.stroke(params.bodyColor); p.strokeWeight(s * 0.06);
        p.line(0, 0, s * 0.5, 0);
        p.noStroke(); p.fill(params.handColor);
        p.ellipse(s * 0.5, 0, s * 0.18, s * 0.18);
      p.pop();

      p.push();
        p.translate(0, -s * 0.55);
        p.rotate(baseL - armOsc);
        p.stroke(params.bodyColor); p.strokeWeight(s * 0.06);
        p.line(0, 0, s * 0.5, 0);
        p.noStroke(); p.fill(params.handColor);
        p.ellipse(s * 0.5, 0, s * 0.18, s * 0.18);
      p.pop();
    p.pop();
  },

  osc(ctx, address, value) {
    const param = address.split('/').pop();
    if (param && Object.prototype.hasOwnProperty.call(ctx.params, param)) {
      ctx.params[param] = value;
    }
  },
};
