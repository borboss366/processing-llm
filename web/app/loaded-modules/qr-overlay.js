/**
 * QR stage overlay (brief 11 Task 4): shows the audience event QR + call to
 * action, pad/panel-triggerable, auto-hides. The QR PNG is generated
 * server-side by the submission service (never phone data) and fetched
 * through the /submit-api proxy.
 */
export default {
  id: 'qr-overlay',
  oscPrefix: 'qr',
  interfaces: ['triggerable', 'fadeable'],
  triggerable: { enterMs: 600, holdMs: 15_000, exitMs: 600, autoRetrigger: true },
  fadeable: { easing: 'cubic-out', maxAlpha: 1 },
  defaults: {
    qrShowSec: 15,           // visible time before the hold fade (≤ holdMs/1000)
    corner: 'right',         // 'right' | 'left'
    sizeFrac: 0.22,          // QR edge as a fraction of the shorter screen side
  },
  draw(ctx) {
    const { p, params } = ctx;
    const state = (ctx.state ??= {});
    const alpha = ctx.lifecycle?.alpha ?? 0;
    if (alpha <= 0.001) { state.shownMs = 0; return; }

    if (!state.img && !state.imgLoading) {
      state.imgLoading = true;
      const img = new Image();
      img.onload = () => { state.img = img; };
      img.onerror = () => { state.imgLoading = false; };   // retry next trigger
      img.src = '/submit-api/api/qr.png';
    }
    if (!state.img) return;

    state.shownMs = (state.shownMs ?? 0) + p.deltaTime;
    const showCut = Number(params.qrShowSec) * 1000;
    // param can shorten the stay below holdMs: fade the last 600 ms ourselves
    const selfFade = Math.max(0, Math.min(1, (showCut - state.shownMs) / 600));
    const a = alpha * selfFade;
    if (a <= 0.001) return;

    const S = Math.min(p.width, p.height) * Math.max(0.1, Math.min(0.5, Number(params.sizeFrac)));
    const pad = S * 0.1;
    const x = params.corner === 'left' ? pad : p.width - S - pad * 3;
    const y = p.height - S - pad * 4.5;
    const g = p.drawingContext;
    g.save();
    g.globalAlpha = a;
    g.fillStyle = '#fff';
    g.beginPath();
    g.roundRect(x - pad, y - pad, S + pad * 2, S + pad * 3.2, 12);
    g.fill();
    g.drawImage(state.img, x, y, S, S);
    g.fillStyle = '#111';
    g.font = `600 ${Math.round(S * 0.09)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.fillText('draw yourself into the show', x + S / 2, y + S + pad * 1.4);
    g.restore();
  },
};
