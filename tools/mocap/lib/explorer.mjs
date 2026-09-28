// Stage explorer generator (brief 18 Task 1): renderExplorer(D) → a static,
// self-contained HTML page — one section per pipeline stage, each with the
// picture, this clip's numbers, the parameters used, and the real bug that
// lived there. One scrub slider drives every stage's picture together.
// No server, no dependencies: data inlined, canvas 2D, drag-to-orbit 3D.

export function renderExplorer(D, D2 = null) {
  const json = JSON.stringify(D);
  const json2 = D2 ? JSON.stringify(D2) : "null";
  const est = (X) => X.meta.params.estimator ?? "mediapipe";
  const row = (label, a, b) => `<tr><td class="name">${label}</td><td>${a}</td><td>${b}</td></tr>`;
  const abCard = !D2 ? "" : `
<section id="sAB"><h2>A/B — ${est(D)} (A) vs ${est(D2)} (B), same window, same downstream</h2>
  <div id="abbar" class="note">show:
    <label><input type="radio" name="ab" value="A" checked> A · ${est(D)}</label> &nbsp;
    <label><input type="radio" name="ab" value="B"> B · ${est(D2)}</label> &nbsp;
    <label><input type="radio" name="ab" value="overlay"> overlay (B ghosted at 45 %)</label>
  </div>
  <table><tr><th>metric</th><th>A · ${est(D)}</th><th>B · ${est(D2)}</th></tr>
  ${row("jitter raw (px, 2nd-diff)", D.jitter, D2.jitter)}
  ${row("jitter post-smoothing (px)", D.jitterPost, D2.jitterPost)}
  ${row("limb scores", JSON.stringify(D.limbScores), JSON.stringify(D2.limbScores))}
  ${row("frontness → natural view", `${D.frontness} → ${D.natural}`, `${D2.frontness} → ${D2.natural}`)}
  ${row("period (s ×mult)", `${D.period.chosen} ×${D.period.mult}`, `${D2.period.chosen} ×${D2.period.mult}`)}
  ${row("cycles kept / dropped", `${(Object.values(D.cycles.data)[0] ?? []).length - D.cycles.dropped.length} / ${D.cycles.dropped.length}`, `${(Object.values(D2.cycles.data)[0] ?? []).length - D2.cycles.dropped.length} / ${D2.cycles.dropped.length}`)}
  ${row("distill keys · RMS (rad)", `${D.distill.keyCount} · ${D.distill.rms}`, `${D2.distill.keyCount} · ${D2.distill.rms}`)}
  ${row("filter lag (ms)", D.lag.whole, D2.lag.whole)}
  </table>
  <div class="note">The toggle re-renders EVERY stage below from the chosen estimator's data; tables (rest/retarget/keys) always show the primary in overlay mode.</div>
</section>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${D.meta.clip} · ${D.meta.view} — pipeline explorer</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0b0b14; color:#cfd3e8; font:13px/1.45 ui-monospace,Menlo,monospace; padding:14px 18px 80px; }
  h1 { font-size:16px; margin:6px 0 2px; } h1 .dim { color:#667; font-weight:400; }
  h2 { font-size:13px; margin:26px 0 6px; color:#9ad; letter-spacing:.06em; }
  section { border:1px solid #1e1e33; border-radius:8px; padding:10px 12px; margin-top:10px; background:#11111f; }
  .haz { color:#c96; font-size:12px; margin-top:6px; }
  .haz b { color:#e88; }
  .par { color:#7a8; font-size:12px; }
  .num { color:#8fa; }
  canvas { background:#0c0c16; border-radius:4px; display:block; }
  .row { display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start; }
  table { border-collapse:collapse; font-size:12px; }
  td,th { padding:1px 8px; text-align:right; border-bottom:1px solid #1c1c2e; }
  th { color:#667; font-weight:400; }
  td.name { text-align:left; color:#9ad; }
  .err0 { color:#6c6; } .err1 { color:#cc6; } .err2 { color:#e66; font-weight:700; }
  #scrubbar { position:fixed; left:0; right:0; bottom:0; background:#11111fee; border-top:1px solid #1e1e33; padding:10px 18px; display:flex; gap:12px; align-items:center; }
  #scrub { flex:1; }
  select { background:#23233a; color:#dde; border:0; border-radius:4px; padding:2px 6px; font:inherit; }
  .note { color:#667; font-size:12px; margin-top:4px; }
</style>
</head>
<body>
<h1>${D.meta.clip} <span class="dim">· estimator=${D.meta.params.estimator ?? "mediapipe"}${D2 ? " vs " + est(D2) : ""} · view=${D.meta.view} · window ${D.meta.window[0]}–${D.meta.window[1]} s · mirror=${D.meta.mirror}</span></h1>
<div class="note">Scrub the slider (bottom) — every stage's picture moves together. Drag the 3D skeleton to orbit.</div>
${abCard}

<section id="s0"><h2>0 · INPUT — what the estimator saw</h2>
  <div class="row"><canvas id="c0" width="360" height="360"></canvas>
  <div><div class="par">crop [${D.crop.join(', ')}] of ${D.vidW}×${D.vidH} px · upscale ×${D.scale} · flip-TTA ${D.meta.params.enhance === 'on' ? 'ON (two tracked streams, averaged)' : 'off'}</div>
  <div class="num">${D.times.length} frames posed · jitter ${D.jitter} px (second-difference)</div>
  <div class="haz"><b>can go wrong:</b> vertical video cropping the feet (feet matter — contacts + fan come from them); a moving per-frame crop broke MediaPipe's temporal tracking (measured 4.52 vs 3.75 px jitter) — the crop is FIXED for the whole window.</div></div></div>
</section>

<section id="s1"><h2>1 · LANDMARKS — 2D points + 3D world skeleton</h2>
  <div class="row">
    <div><canvas id="c1a" width="360" height="360"></canvas><div class="note">2D over the frame · dot color = visibility (green 1 → red 0)</div></div>
    <div><canvas id="c1b" width="320" height="360"></canvas><div class="note">3D world — MediaPipe's ESTIMATE, not measured; z is a learned guess (drag to orbit)</div></div>
    <div class="haz" style="max-width:340px"><b>can go wrong:</b> occluded far limbs — the running man's far leg tracked at 25–50 % of the near leg's amplitude; visibility color shows where the estimator was guessing.</div>
  </div>
</section>

<section id="s2"><h2>2 · SMOOTHING — raw vs filtered</h2>
  <div class="row">
    <div><canvas id="c2" width="640" height="180"></canvas>
    <div class="note">joint <select id="jsel2"></select> · grey = raw, blue = filtered</div></div>
    <div style="max-width:340px"><div class="par">filter ${D.meta.params.filter} (window ${D.meta.params.sgWindow}, order ${D.meta.params.sgOrder})</div>
    <div class="num">measured lag ${D.lag.whole} ms (thirds ${D.lag.thirds.join(' / ')})</div>
    <div class="haz"><b>can go wrong:</b> a CAUSAL filter (One Euro) lagged 46–60 ms and the lag DRIFTED with velocity — cycle averaging under that skew smeared key timing. Savitzky–Golay is symmetric → zero phase; the lag number here should be ~0.</div></div>
  </div>
</section>

<section id="s3"><h2>3 · VIEW SELECT — no rotation exists in 2D</h2>
  <div class="row">
    <div><canvas id="c3" width="640" height="140"></canvas><div class="note">${D.reinterpret ? "twist traces the reinterpretation produced (hipL ▮ hipR ▮ kneeL ▮ kneeR ▮, rad)" : "frontness per frame (shoulder width / spine length); line = 0.35 threshold"}</div></div>
    <div class="haz" style="max-width:420px">frontness ${D.frontness} (front ≥ 0.35) → natural view <b>${D.natural}</b>, emitted as <b>${D.meta.view}</b>${D.reinterpret ? " — <b>REINTERPRETATION</b>: this view's in-plane deviations are unobserved (≈0); the sagittal deviations are routed to the TWIST channel and rendered by cos-foreshortening" : ""}.<br><b>can go wrong:</b> with 2D landmarks a "de-yaw rotation" degenerates to x·cos(yaw) — a squash, not a view; that fake rotation dropped the running man's knee lift (hip span ×3–5 recovered by removing it). Stage 3 SELECTS a view; the table is always built from the camera plane.</div>
  </div>
</section>

<section id="s3b"><h2>3b · DEPTH FROM 2D — foreshortening twist vs estimator 3D (debug)</h2>
  <div class="row">
    <div><canvas id="c3b2" width="640" height="160"></canvas><div class="note">bone <select id="jsel3b"></select> · <span style="color:#59f">blue = 2D foreshortening</span> (the pipeline's channel) · <span style="color:#889">grey = estimator world z</span>${D.twistWorld ? "" : " — ABSENT on this estimator (2D-only); the pipeline needs no z"}</div></div>
    <div class="haz" style="max-width:340px"><b>can go wrong:</b> acos of a noisy length ratio has a hard noise floor (3 % length noise ≈ 0.25 rad fake twist — hence the 0.965 deadband, flat spans here are the deadband holding); the world z is the network's GUESS, weakest exactly where the 2D is occluded. Agreement is corroboration, not ground truth — the 2D channel is unsigned until the sign ladder picks a lobe.</div>
  </div>
</section>

<section id="s4"><h2>4 · REST REFERENCE — habitual pose vs the rig's rest</h2>
  <div class="row">
    <div><canvas id="c4" width="640" height="90"></canvas><div class="note">calibration frames: ▮ global-quiet · ▮ legL planted · ▮ legR planted</div></div>
    <div><canvas id="c4b" width="180" height="240"></canvas><div class="note">HABITUAL pose (measured, diagnostic)</div></div>
    <div><canvas id="c4c" width="180" height="240"></canvas><div class="note">RIG REST (the reference subtracted)</div></div>
    <div id="restTable"></div>
  </div>
  <div class="haz"><b>can go wrong:</b> subtracting the MEASURED (habitual) pose as "the dancer's neutral" erased every sustained posture — arms held forward all clip retargeted to ≈0 and the rig showed its own rest (collapsed arms / paralytic legs, root-caused 2026-09-28). Since then retarget is ABSOLUTE: reference = the rig's own rest from the view shape's geometry; the Δ column below is what the old scheme silently deleted. (Measured survives for this comparison + bone lengths.)</div>
</section>

<section id="s5"><h2>5 · RETARGET (ABSOLUTE) — per bone at the scrubbed frame</h2>
  <div id="retTable"></div>
  <div class="note">theta = sideSign × wrap(observedAbs − rigRestAbs) − parentAcc &nbsp;·&nbsp; the reference is the RIG's rest, so habitual pose transfers &nbsp;·&nbsp; round-trip = chain-reconstruction error (0 unless something is mismapped)</div>
  <div class="haz"><b>can go wrong:</b> the 2× SIDE-SIGN signature — every far-side bone erring at exactly twice its deviation (profile transfer is orientation-reversing for the side whose rig foot opposes the facing); a clamp hit here is a REST-REFERENCE smell before it is a data property.</div>
</section>

<section id="s6"><h2>6 · PERIOD &amp; CYCLES</h2>
  <div class="row">
    <div><canvas id="c6" width="640" height="160"></canvas><div class="note">autocorrelation · ○ candidate peaks · ● chosen ${D.period.chosen}s ×${D.period.mult}${D.period.cyclesPrior ? ' · --cycles ' + D.period.cyclesPrior + ' prior (owns the octave)' : ''}</div></div>
    <div><canvas id="c6b" width="420" height="160"></canvas><div class="note">cycles overlaid, phase-normalized (<span style="color:#e66">red = dropped outlier</span>) · joint <select id="jsel6"></select></div></div>
  </div>
  <div class="haz"><b>can go wrong:</b> octave/harmonic lock — the body roll's search latched a 0.217 s micro-bounce on a 1.486 s roll (×6.9 off) and averaged the whole move away; ${D.cycles.dropped.length} dropped here (instructors demo slow-then-fast).</div>
</section>

<section id="s7"><h2>7 · DISTILL — keys on the averaged loop</h2>
  <div class="row">
    <div><canvas id="c7" width="640" height="180"></canvas><div class="note">joint <select id="jsel7"></select> · ● = emitted keys</div></div>
    <div style="max-width:340px"><div class="num">${D.distill.keyCount} keys (budget ${D.meta.params.maxKeys}) · reconstruction RMS ${D.distill.rms} rad</div>
    <div class="haz"><b>can go wrong:</b> averaging + a small key budget smears accents — a snap that lives between two keys becomes a smooth ramp. Keys sit at extrema + inflections, greedily thinned by least reconstruction error.</div></div>
  </div>
</section>

<section id="s8"><h2>8 · TABLE — what the stage will play</h2>
  <div id="tableView"></div>
  <div class="note">view=${D.table.view} · bpl ${D.table.beatsPerLoop} · contacts drive the stance lock (a wrongly-planted foot loses its lift — the near-leg bug); twist = out-of-plane deviation (fan / elbow flip)</div>
</section>

<div id="scrubbar">
  <span>scrub</span><input type="range" id="scrub" min="0" max="${(D2 ? Math.min(D.times.length, D2.times.length) : D.times.length) - 1}" value="0" step="1">
  <span id="tlab" class="num">t=0</span>
</div>

<script>
const DA = ${json};
const DB = ${json2};
let D = DA, AB = 'A';
// overlay mode: second pass draws B ghosted on top — clearRect is gated so
// the pass doesn't wipe A's strokes
const _clr = CanvasRenderingContext2D.prototype.clearRect;
CanvasRenderingContext2D.prototype.clearRect = function(...a) { if (!window.SKIPCLEAR) _clr.apply(this, a); };
const MPB = [[3,4],[3,5],[5,7],[4,6],[6,8],[9,10],[3,9],[4,10],[9,11],[11,13],[13,15],[15,17],[13,17],[10,12],[12,14],[14,16],[16,18],[14,18],[1,2]];  // schema bones (18.1)
const $ = (id) => document.getElementById(id);
const ART = Object.keys(D.theta);
let F = 0, orbY = 0.6, orbX = 0.25;

// ---------- helpers ----------
function tracePlot(cv, series, colors, cursorFrac, keys) {
  const g = cv.getContext('2d'); const W = cv.width, H = cv.height;
  g.clearRect(0,0,W,H);
  let lo = Infinity, hi = -Infinity;
  for (const s of series) for (const v of s) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (hi - lo < 1e-6) hi = lo + 1e-6;
  const X = (i, n) => 6 + (W - 12) * i / (n - 1), Y = (v) => H - 8 - (H - 16) * (v - lo) / (hi - lo);
  g.strokeStyle = '#223'; g.beginPath(); g.moveTo(6, Y(0)); g.lineTo(W - 6, Y(0)); g.stroke();
  series.forEach((s, k) => {
    g.strokeStyle = colors[k]; g.lineWidth = k === series.length - 1 ? 1.6 : 1;
    g.beginPath();
    s.forEach((v, i) => i ? g.lineTo(X(i, s.length), Y(v)) : g.moveTo(X(i, s.length), Y(v)));
    g.stroke();
  });
  if (keys) for (const k of keys) {
    g.fillStyle = '#e66'; g.beginPath(); g.arc(X(Math.round(k.i), keys.n), Y(k.v), 3, 0, 7); g.fill();
  }
  if (cursorFrac != null) {
    g.strokeStyle = '#fd4'; g.beginPath();
    const x = 6 + (W - 12) * cursorFrac; g.moveTo(x, 4); g.lineTo(x, H - 4); g.stroke();
  }
  g.fillStyle = '#667'; g.font = '10px monospace';
  g.fillText(hi.toFixed(2), 8, 10); g.fillText(lo.toFixed(2), 8, H - 2);
}
function skel2d(cv, pts, vis, fit) {
  const g = cv.getContext('2d'); g.clearRect(0,0,cv.width,cv.height);
  let lo = [Infinity,Infinity], hi = [-Infinity,-Infinity];
  for (const p of pts) { for (let a = 0; a < 2; a++) { if (p[a] < lo[a]) lo[a] = p[a]; if (p[a] > hi[a]) hi[a] = p[a]; } }
  const s = fit ? Math.min((cv.width-30)/(hi[0]-lo[0]+1e-6), (cv.height-30)/(hi[1]-lo[1]+1e-6)) : 1;
  const P = (p) => fit ? [15+(p[0]-lo[0])*s, 15+(p[1]-lo[1])*s] : [p[0]*cv.width, p[1]*cv.height];
  g.strokeStyle = '#5c5'; g.lineWidth = 1.5;
  for (const [a,b] of MPB) { const A=P(pts[a]), B=P(pts[b]); g.beginPath(); g.moveTo(A[0],A[1]); g.lineTo(B[0],B[1]); g.stroke(); }
  pts.forEach((p, i) => {
    const v = vis ? vis[i] : 1;
    g.fillStyle = 'rgb(' + Math.round(255*(1-v)) + ',' + Math.round(200*v) + ',80)';
    const q = P(p); g.beginPath(); g.arc(q[0], q[1], 2.6, 0, 7); g.fill();
  });
}
function skel3d(cv, w3) {
  const cy = Math.cos(orbY), sy = Math.sin(orbY), cx = Math.cos(orbX), sx = Math.sin(orbX);
  const pts = w3.map(([x,y,z]) => {
    const x1 = x*cy - z*sy, z1 = x*sy + z*cy;
    const y2 = y*cx - z1*sx;
    return [x1, y2];
  });
  skel2d(cv, pts, w3.map(() => 1), true);
}

// ---------- stage renderers ----------
const img0 = new Image();
function stage0() {
  const fr = D.frames0; if (!fr.length) return;
  const t = D.times[F];
  let best = 0; for (let i = 0; i < fr.length; i++) if (Math.abs(fr[i].t - t) < Math.abs(fr[best].t - t)) best = i;
  img0.onload = () => { const g = $('c0').getContext('2d'); g.clearRect(0,0,360,360);
    const s = Math.min(360/img0.width, 360/img0.height);
    g.drawImage(img0, 0, 0, img0.width*s, img0.height*s); };
  img0.src = 'data:image/jpeg;base64,' + fr[best].jpg;
}
function stage1() {
  skel2d($('c1a'), D.img[F].map((p) => [p[0], p[1]]), D.img[F].map((p) => p[2]), true);
  skel3d($('c1b'), D.world[F]);
}
function stage2() {
  const j = $('jsel2').value;
  tracePlot($('c2'), [D.rawTheta[j], D.theta[j]], ['#888', '#59f'], F/(D.times.length-1));
}
function stage3() {
  if (D.reinterpret) {
    tracePlot($('c3'), ['hipL','hipR','kneeL','kneeR'].map(j => D.theta[j]), ['#59f','#5c5','#c95','#c9f'], F/(D.times.length-1));
  } else {
    tracePlot($('c3'), [D.frontSeries, D.frontSeries.map(() => 0.35)], ['#c9f', '#555'], F/(D.times.length-1));
  }
}
function stage3b() {
  const j = $('jsel3b').value;
  const series = [D.twistFore[j] ?? []];
  const colors = ['#59f'];
  if (D.twistWorld) { series.unshift(D.twistWorld[j] ?? []); colors.unshift('#889'); }
  tracePlot($('c3b2'), series, colors, F/(D.times.length-1));
}
function stage4() {
  const g = $('c4').getContext('2d'); g.clearRect(0,0,640,90);
  const rows = [['global', D.masks.global, '#59f'], ['legL', D.masks.legL, '#5c5'], ['legR', D.masks.legR, '#c95']];
  rows.forEach(([nm, m, col], r) => {
    g.fillStyle = '#667'; g.fillText(nm, 4, 20 + r*26);
    m.forEach((on, i) => { if (on) { g.fillStyle = col; g.fillRect(50 + (580*i/m.length), 8 + r*26, Math.max(1, 580/m.length), 16); } });
  });
  const x = 50 + 580*F/(D.times.length-1);
  g.strokeStyle = '#fd4'; g.beginPath(); g.moveTo(x, 2); g.lineTo(x, 86); g.stroke();
  // two rest stickmen: the dancer's HABITUAL pose (measured, diagnostic)
  // vs the RIG REST the absolute retarget actually references
  const stick = (cvId, angles, col) => {
    const cv = $(cvId), gg = cv.getContext('2d'); gg.clearRect(0,0,cv.width,cv.height);
    const posOf = { pelvis: [0.5, 0.55] };
    gg.strokeStyle = col; gg.lineWidth = 2;
    for (const d of D.defs) {
      const [name, parent] = d;
      const from = posOf[parent ?? 'pelvis'] ?? posOf.pelvis;
      const ang = angles[name];
      const len = D.defLen[name] ?? 0.12;
      const to = [from[0] + Math.cos(ang)*len, from[1] + Math.sin(ang)*len];
      posOf[name] = to;
      gg.beginPath(); gg.moveTo(from[0]*cv.width, from[1]*cv.height*0.9);
      gg.lineTo(to[0]*cv.width, to[1]*cv.height*0.9); gg.stroke();
    }
  };
  stick('c4b', D.rests.measured, '#c95');
  stick('c4c', D.restRef ?? D.rests.declared, '#9ad');
  let h = '<table><tr><th>bone</th><th>habitual</th><th>rig ref</th><th>Δ (transfers now)</th><th>frames</th></tr>';
  for (const d of D.defs) {
    const nm = d[0], m = D.rests.measured[nm], dec = (D.restRef ?? D.rests.declared)[nm];
    const dd = Math.atan2(Math.sin(m-dec), Math.cos(m-dec));
    h += '<tr><td class="name">' + nm + '</td><td>' + m.toFixed(2) + '</td><td>' + dec.toFixed(2) +
         '</td><td class="' + (Math.abs(dd) > 0.5 ? 'err1' : 'err0') + '">' + dd.toFixed(2) + '</td><td>' + D.rests.counts[nm] + '</td></tr>';
  }
  if (!window.GHOSTPASS) $('restTable').innerHTML = h + '</table>';
}
function stage5() {
  // replicate the transfer at frame F and compare to the pipeline's theta
  const obsAng = (fr, a, b) => {
    const pt = (k) => typeof k === 'number' ? fr[k]
      : k === 'hipMid' ? [(fr[9][0]+fr[10][0])/2, (fr[9][1]+fr[10][1])/2]
      : k === 'shoulderMid' ? [(fr[3][0]+fr[4][0])/2, (fr[3][1]+fr[4][1])/2]
      : [(fr[1][0]+fr[2][0])/2, (fr[1][1]+fr[2][1])/2];   // schema mids (18.1)
    const A = pt(a), B = pt(b);
    return Math.atan2(B[1]-A[1], B[0]-A[0]);
  };
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  const acc = {};
  let h = '<table><tr><th>bone</th><th>observed abs</th><th>reference abs</th><th>side</th><th>parentAcc</th><th>theta</th><th>pipeline θ</th><th>round-trip</th><th></th></tr>';
  for (const d of D.defs) {
    const [name, parent, a, b] = d;
    const obs = obsAng(D.frontal[F], a, b);
    const rest = (D.restRef ?? D.rests.declared)[name];
    const sgn = D.sideSigns[name] ?? 1;
    const accH = sgn * wrap(obs - rest);
    acc[name] = accH;
    const th = wrap(accH - (parent ? acc[parent] : 0));
    const pipe = D.theta[name] ? D.theta[name][F] : null;
    const err = pipe != null ? Math.abs(wrap(th - pipe)) : 0;
    const lim = D.rotLimits[name.replace(/[LR]$/, '')];
    const clamp = lim && pipe != null && Math.abs(pipe) > lim;
    const cls = err < 0.02 ? 'err0' : err < 0.2 ? 'err1' : 'err2';
    h += '<tr><td class="name">' + name + '</td><td>' + obs.toFixed(2) + '</td><td>' + rest.toFixed(2) +
      '</td><td>' + sgn + '</td><td>' + (parent ? acc[parent].toFixed(2) : '—') + '</td><td>' + th.toFixed(2) +
      '</td><td>' + (pipe != null ? pipe.toFixed(2) : '—') + '</td><td class="' + cls + '">' + err.toFixed(3) +
      '</td><td>' + (clamp ? '<span class="err2">CLAMP</span>' : '') + '</td></tr>';
  }
  if (!window.GHOSTPASS) $('retTable').innerHTML = h + '</table>';
}
function stage6() {
  const g = $('c6').getContext('2d'); const W = 640, H = 160; g.clearRect(0,0,W,H);
  const ac = D.period.ac; const lo = Math.min(...ac), hi = Math.max(...ac);
  const X = (i) => 6 + (W-12)*i/(ac.length-1), Y = (v) => H-14-(H-28)*(v-lo)/(hi-lo+1e-9);
  g.strokeStyle = '#59f'; g.beginPath(); ac.forEach((v,i)=> i?g.lineTo(X(i),Y(v)):g.moveTo(X(i),Y(v))); g.stroke();
  const secToI = (s) => (s - D.period.loSec) * D.period.fs;
  g.strokeStyle = '#889'; for (const c of D.period.candidates) { const i = secToI(c.lagSec); g.beginPath(); g.arc(X(i), Y(c.ac), 4, 0, 7); g.stroke(); }
  const ci = secToI(D.period.chosen / D.period.mult);
  g.fillStyle = '#fd4'; g.beginPath(); g.arc(X(ci), Y(ac[Math.round(ci)] ?? lo), 5, 0, 7); g.fill();
  g.fillStyle = '#667'; g.fillText('lag ' + D.period.loSec + 's', 8, H-2);
  const j = $('jsel6').value;
  const cyc = D.cycles.data[j] ?? [];
  const series = cyc.map((c) => c);
  const colors = cyc.map((_, i) => D.cycles.dropped.includes(i) ? '#e66' : 'rgba(90,160,255,0.55)');
  tracePlot($('c6b'), series, colors, null);
}
function stage7() {
  const j = $('jsel7').value;
  const avg = D.avg[j] ?? [];
  const keys = { n: avg.length };
  const marks = D.distill.keyPhases.map((p) => ({ i: p * avg.length, v: avg[Math.round(p * avg.length) % avg.length] }));
  marks.n = avg.length;
  tracePlot($('c7'), [avg], ['#59f'], null, marks);
}
function stage8() {
  let h = '<table><tr><th>phase</th><th>ease</th><th>contacts</th><th>joints keyed</th><th>twist bones</th><th>travel</th></tr>';
  for (const k of D.table.keys) {
    const tw = Object.entries(k.joints).filter(([,c]) => c.twist).map(([n]) => n);
    h += '<tr><td>' + k.phase.toFixed(3) + '</td><td>' + k.ease + '</td><td class="name">' + (k.contacts.join(',') || '—') +
      '</td><td>' + Object.keys(k.joints).length + '</td><td class="name">' + (tw.join(',') || '—') + '</td><td>' + (k.travel ?? 0).toFixed(3) + '</td></tr>';
  }
  if (!window.GHOSTPASS) $('tableView').innerHTML = h + '</table>';
}

// ---------- wiring ----------
function renderStages() {
  if (F >= D.times.length) F = D.times.length - 1;
  $('tlab').textContent = 't=' + D.times[F].toFixed(2) + 's (frame ' + F + ')';
  stage0(); stage1(); stage2(); stage3(); stage3b(); stage4(); stage5(); stage6(); stage7(); stage8();
}
function renderAll() {
  if (AB === 'overlay' && DB) {
    D = DA; renderStages();
    window.SKIPCLEAR = true; window.GHOSTPASS = true;
    document.querySelectorAll('canvas').forEach((c) => c.getContext('2d').globalAlpha = 0.45);
    D = DB; renderStages();
    document.querySelectorAll('canvas').forEach((c) => c.getContext('2d').globalAlpha = 1);
    window.SKIPCLEAR = false; window.GHOSTPASS = false;
    D = DA;
  } else {
    D = (AB === 'B' && DB) ? DB : DA;
    renderStages();
  }
}
document.querySelectorAll('input[name=ab]').forEach((r) => r.onchange = () => { AB = r.value; renderAll(); });
{
  const el = $('jsel3b');
  for (const j of Object.keys(DA.twistFore ?? {})) { const o = document.createElement('option'); o.value = o.textContent = j; el.appendChild(o); }
  if (el.options.length) el.value = DA.twistFore.hipL ? 'hipL' : el.options[0].value;
  el.onchange = renderAll;
}
for (const [sel, def] of [['jsel2', 'kneeR'], ['jsel6', 'hipR'], ['jsel7', 'kneeR']]) {
  const el = $(sel);
  for (const j of ART) { const o = document.createElement('option'); o.value = o.textContent = j; el.appendChild(o); }
  el.value = ART.includes(def) ? def : ART[0];
  el.onchange = renderAll;
}
$('scrub').oninput = (e) => { F = +e.target.value; renderAll(); };
let dragging = false, px = 0, py = 0;
$('c1b').addEventListener('mousedown', (e) => { dragging = true; px = e.clientX; py = e.clientY; });
window.addEventListener('mouseup', () => dragging = false);
window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  orbY += (e.clientX - px) * 0.01; orbX += (e.clientY - py) * 0.01;
  px = e.clientX; py = e.clientY; stage1();
});
renderAll();
</script>
</body>
</html>`;
}
