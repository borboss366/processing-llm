/**
 * big-message — first triggerable + fadeable module.
 *
 * Big centered text that fades in, holds, fades out on each trigger.
 * Replaces the old text-popup hack: it's no longer a one-off feature, it's
 * a shape any text/image/silhouette module can adopt by declaring the same
 * two interfaces.
 *
 * Trigger via:
 *   curl -X POST http://localhost:3000/browser-modules/trigger \
 *        -H "Content-Type: application/json" \
 *        -d '{"id":"big-message"}'
 * or
 *   curl -X POST http://localhost:3000/browser-modules/trigger \
 *        -H "Content-Type: application/json" \
 *        -d '{"id":"big-message","args":{"text":"DROP!"}}'
 */

export default {
  id: 'big-message',
  oscPrefix: 'msg',
  interfaces: ['triggerable', 'fadeable'],

  // configs read by the interface middleware
  triggerable: {
    enterMs: 350,
    holdMs:  1800,
    exitMs:  600,
    autoRetrigger: true,        // re-firing while active restarts the entrance
  },
  fadeable: {
    easing: 'cubic-out',
    maxAlpha: 1,
  },

  defaults: {
    text:        'HELLO',
    color:       '#ff3d7f',
    shadowColor: '#8c3aff',
    sizeFrac:    0.18,          // text height as a fraction of canvas height
    shadowOffset: 8,
  },

  setup(ctx) {
    ctx.state = {};
  },

  /** Optional: incoming triggers may carry args — copy into params before lifecycle starts.
   *  The registry calls this BEFORE flipping state to 'entering' if defined.
   *  (For the v1 it's still safe to just mutate params from osc() — see below.) */
  onTrigger(ctx, args) {
    if (args && typeof args.text === 'string') ctx.params.text = args.text;
  },

  osc(ctx, address, value) {
    const param = address.split('/').pop();
    if (param === 'say' && typeof value === 'string') {
      ctx.params.text = value;
      return { trigger: true };          // signal the registry to fire the lifecycle
    }
    if (param && Object.prototype.hasOwnProperty.call(ctx.params, param)) {
      ctx.params[param] = value;
    }
    return null;
  },

  draw(ctx) {
    const { p, params, lifecycle } = ctx;
    if (lifecycle.state === 'idle') return;     // saves draw cost when invisible

    const alpha = lifecycle.alpha * 255;
    const textPx = p.height * params.sizeFrac;
    const cx = p.width  / 2;
    const cy = p.height / 2;

    p.push();
      p.textAlign(p.CENTER, p.CENTER);
      p.textSize(textPx);
      p.textStyle(p.BOLD);

      // shadow first
      const sh = p.color(params.shadowColor);
      p.fill(p.red(sh), p.green(sh), p.blue(sh), alpha * 0.8);
      p.text(params.text, cx + params.shadowOffset, cy + params.shadowOffset);

      // main text
      const fg = p.color(params.color);
      p.fill(p.red(fg), p.green(fg), p.blue(fg), alpha);
      p.text(params.text, cx, cy);
    p.pop();
  },
};
