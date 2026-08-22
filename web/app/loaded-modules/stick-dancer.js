/**
 * stick-dancer — first proof-of-concept hot-loaded module.
 *
 * Hot-loaded via the registry at /loaded/stick-dancer.js. Demonstrates:
 *   - setup/draw/osc ABI (contract: web/app/MODULE_ABI.md)
 *   - audio.state used for scale + arm wave
 *   - beatPhase reference usage: the bounce reads the continuous phase (pop
 *     at the beat, settle through it), scaled by beatConfidence — not the
 *     one-frame onBeat boolean — with the MODULE_ABI.md fallback: while
 *     beatConfidence < 0.4 it free-runs at lastConfidentBpm instead of
 *     following the (jumpy, still-acquiring) PLL phase
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
    ctx.state = { phase: 0 };
  },

  draw(ctx) {
    const { p, audio, params, state } = ctx;
    const s  = params.baseSize;
    const cx = p.width  * params.xFrac;
    const cy = p.height * params.yFrac;

    // Beat bounce from the continuous phase: pop up at the beat boundary
    // (phase 0), settle back through the beat. Confidence scales the height
    // so the dancer calms down when the tracker isn't sure. While the PLL is
    // still acquiring (confidence < 0.4) its phase jumps around — free-run at
    // the last confident tempo instead of following it.
    const a = audio.state;
    let bounceOff = 0;
    if (params.bounceOnBeat) {
      let conf = 0;
      if (a.beatConfidence >= 0.4 && a.bpm > 0) {
        state.phase = a.beatPhase;
        conf = a.beatConfidence;
      } else if (a.lastConfidentBpm > 0) {
        state.phase = (state.phase + (p.deltaTime / 1000) * (a.lastConfidentBpm / 60)) % 1;
        conf = 0.4;
      }
      bounceOff = -Math.pow(1 - state.phase, 3) * s * 0.3 * conf;
    }

    const armOsc = Math.sin(p.frameCount * params.waveRate * (1 + audio.state.smoothedLevel * 2)) * params.waveAmplitude;

    p.push();
      p.translate(cx, cy);
      p.scale(1 + audio.state.smoothedLevel * 0.6);
      p.translate(0, bounceOff);

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
