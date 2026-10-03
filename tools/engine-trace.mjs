#!/usr/bin/env node
/**
 * Engine explorer capture (brief 19.1 Task 2): run a move on a shape with
 * the engine taps on, dump the per-stage trace, and write a self-contained
 * explorer page beside it — the capture explorer's idioms (shared scrub,
 * heatmap, filmstrip) pointed at table → pixels.
 *
 *   node tools/engine-trace.mjs --move runningman-captured [--shape biped-1]
 *                               [--seconds 8] [--out reports/engine-<move>-<shape>]
 *                               [--no-webm] [--table-json <path override>]
 *   --move none  = procedural groove (no table reference; s1 rows are 0)
 *
 * Writes <out>.engine-trace.json, <out>.engine.explorer.html,
 * <out>.webm (unless --no-webm), and three render-mode thumbs embedded in
 * the page at the worst-deviation frame.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);
const MOVE = opt("move", null);
if (!MOVE) { console.error("usage: node tools/engine-trace.mjs --move <name|none> [--shape biped-1] [--seconds 8]"); process.exit(1); }
const SHAPE = opt("shape", "biped-1");
const SECONDS = +opt("seconds", 8);
const OUT = opt("out", path.join(ROOT, `reports/engine-${MOVE}-${SHAPE}`));

const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const osc = (address, value) => post("/osc", { address, value });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await assertStackRunning();
const browser = await launchBrowser();
let D = null;
try {
  const page = await openRenderWithFile(browser, MIX, { seekSec: 300 });
  await post("/browser-modules/load", { id: "creature" });
  await sleep(1500);
  await osc("/creature/entryConf", 0);
  await osc("/creature/behavior", "groove");
  await osc("/post/post", 0);
  await post("/browser-modules/trigger", { id: "creature" });
  await sleep(3000);
  if (SHAPE !== "biped-1") { await osc("/creature/shape", SHAPE); await sleep(3000); }
  await osc("/creature/move", MOVE === "none" ? "none" : MOVE);
  await sleep(7000);                                   // view switch + xfade fully in
  await osc("/creature/engineTrace", 1);
  await page.evaluate(() => window.__engineTraceReset?.());
  await sleep(SECONDS * 1000);
  const tr = await page.evaluate(() => window.__engineTraceDump?.() ?? null);
  await osc("/creature/engineTrace", 0);
  if (!tr?.frames?.length) throw new Error("no trace captured — engineTrace tap produced nothing");
  console.log(`[engine-trace] ${tr.frames.length} frames · move=${tr.meta.move} remapped=${tr.meta.remapped}`);

  // worst-deviation frame (lock stage vs s1) for the render-mode strip
  const BONES = Object.keys(tr.frames[0].s1 ?? {});
  const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
  let worstF = 0, worstV = -1;
  tr.frames.forEach((f, i) => {
    let m = 0;
    for (const b of BONES) m = Math.max(m, Math.abs(wrap((f.lockE?.[b] ?? 0) - (f.s1?.[b] ?? 0))));
    if (m > worstV) { worstV = m; worstF = i; }
  });

  // render-mode thumbs at the worst frame (manual scrub there)
  const thumbs = {};
  if (MOVE !== "none") {
    await osc("/creature/clockMode", "manual");
    await osc("/creature/phaseScrub", tr.frames[worstF].ph);
    await sleep(1200);
    for (const m of ["bones", "silhouette", "goo"]) {
      await osc("/creature/renderMode", m);
      await sleep(700);
      const buf = await page.screenshot({ type: "jpeg", quality: 60 });
      thumbs[m] = buf.toString("base64");
    }
    await osc("/creature/renderMode", "goo");
    await osc("/creature/clockMode", "live");
  }

  if (!flag("no-webm")) {
    const rec = await page.screencast({ path: `${OUT}.webm` });
    await sleep(6000);
    await rec.stop();
  }
  await osc("/creature/move", "none");
  await osc("/creature/view", "auto");

  D = { meta: { ...tr.meta, shape: SHAPE, seconds: SECONDS, worstF, worstV: +worstV.toFixed(3) },
        frames: tr.frames, thumbs };
  fs.writeFileSync(`${OUT}.engine-trace.json`, JSON.stringify(D));
} finally {
  await browser.close();
}

// ── explorer page ──────────────────────────────────────────────────────────
const html = renderEngineExplorer(D);
fs.writeFileSync(`${OUT}.engine.explorer.html`, html);
console.log(`[engine-trace] wrote ${OUT}.engine-trace.json + .engine.explorer.html (${(html.length / 1e6).toFixed(1)} MB)${flag("no-webm") ? "" : " + .webm"}`);

export function renderEngineExplorer(D) {
  const json = JSON.stringify(D);
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8">
<title>${D.meta.move ?? "procedural"} × ${D.meta.shape} — engine explorer</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:#0b0b14; color:#cfd3e8; font:13px/1.45 ui-monospace,Menlo,monospace; padding:14px 18px 80px; }
  h1 { font-size:16px; margin:6px 0 2px; } h1 .dim { color:#667; font-weight:400; }
  h2 { font-size:13px; margin:26px 0 6px; color:#9ad; letter-spacing:.06em; }
  section { border:1px solid #1e1e33; border-radius:8px; padding:10px 12px; margin-top:10px; background:#11111f; }
  canvas { background:#0c0c16; border-radius:4px; display:block; }
  .row { display:flex; gap:14px; flex-wrap:wrap; align-items:flex-start; }
  .note { color:#667; font-size:12px; margin-top:4px; }
  .haz { color:#c96; font-size:12px; }
  select { background:#23233a; color:#dde; border:0; border-radius:4px; padding:2px 6px; font:inherit; }
  #scrubbar { position:fixed; left:0; right:0; bottom:0; background:#11111fee; border-top:1px solid #1e1e33; padding:10px 18px; display:flex; gap:12px; align-items:center; }
  #scrub { flex:1; }
  img.thumb { height:170px; border-radius:4px; }
  table { border-collapse:collapse; font-size:12px; }
  td,th { padding:1px 8px; text-align:right; border-bottom:1px solid #1c1c2e; }
  td.name { text-align:left; color:#9ad; }
</style></head>
<body>
<h1>ENGINE — ${D.meta.move ?? "procedural groove"} × ${D.meta.shape} <span class="dim">· ${D.frames.length} frames · ${D.meta.remapped ? "captured (remapped)" : "authored/none"} · bpl ${D.meta.bpl}</span></h1>
<div class="note">Same idioms as the capture explorer: one scrub, pick a stage, read which joint dies where. Stage key: s1 table sample · s2 blend · s3 spring · s4 +gait/liveness · s5 clamps · lock = after stance lock (final).</div>

<section><h2>SKELETONS — table ghost vs engine after <select id="stSel">
  <option value="s2">s2 blend</option><option value="s3">s3 spring</option>
  <option value="s4">s4 liveness</option><option value="s5">s5 limits</option>
  <option value="fkP" selected>FK positions</option><option value="lockP">after lock (final)</option>
</select></h2>
  <div class="row">
    <div><canvas id="cSK" width="340" height="420"></canvas><div class="note">ghost = TABLE pose (s1, FK'd) · solid = engine; bones colored by |Δ| (green &lt; 0.05 · yellow &lt; 0.2 · red ≥)</div></div>
    <div><canvas id="cHM" width="620" height="220" style="cursor:crosshair"></canvas>
      <div class="note">joint × time · |after stage − table| rad · <span id="hmWorst" class="haz"></span> · click → scrub</div>
      <canvas id="cFLAGS" width="620" height="60" style="margin-top:8px"></canvas>
      <div class="note">flags: <span style="color:#e66">▮ clamp</span> <span style="color:#5c5">▮ lock w&gt;0.5</span> <span style="color:#fd4">▮ lift-yield</span> <span style="color:#c9f">▮ blend</span> <span style="color:#f80">▮ spike</span> · click → scrub</div>
    </div>
  </div>
</section>

<section><h2>LADDER — RMS vs table after each stage (the rung that eats the radians)</h2>
  <div class="row"><canvas id="cLAD" width="560" height="200"></canvas><div id="ladTbl"></div></div>
</section>

<section><h2>RENDER-MODE STRIP — worst frame (f${D.meta.worstF}, max |Δ| ${D.meta.worstV} rad)</h2>
  <div class="row">${["bones", "silhouette", "goo"].map((m) => D.thumbs?.[m] ? `<div><img class="thumb" src="data:image/jpeg;base64,${D.thumbs[m]}"><div class="note">${m}</div></div>` : "").join("")}</div>
</section>

<div id="scrubbar"><span>scrub</span><input type="range" id="scrub" min="0" max="${D.frames.length - 1}" value="0" step="1"><span id="tlab" class="note">f0</span></div>

<script>
const D = ${json};
const $ = (id) => document.getElementById(id);
const F0 = D.frames;
const BONES = Object.keys(F0[0].s1 ?? F0[0].s4 ?? {});
const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
let F = 0;
// extractor-convention FK over the rig rest geometry (bone LEAVING a joint
// rotates by that joint's accumulated theta)
const KIDS = {};
for (const nm of Object.keys(D.meta.rigParent)) {
  (KIDS[D.meta.rigParent[nm] ?? '_root'] ??= []).push(nm);
}
const EXT_OF = { chest:'chest', neck:'neck', hipL:'hipL', kneeL:'kneeL', ankleL:'ankleL',
                 hipR:'hipR', kneeR:'kneeR', ankleR:'ankleR',
                 shoulderL:'shoulderL', elbowL:'elbowL', shoulderR:'shoulderR', elbowR:'elbowR' };
// bone leaving joint P toward child C is named: pelvis→chest 'chest',
// chest→neck 'neck', hip→knee 'hipX', knee→ankle 'kneeX', ankle→foot
// 'ankleX', shoulder→elbow 'shoulderX', elbow→hand 'elbowX'
const BONE_NAME = (p, c) => {
  if (p === 'pelvis' && c === 'chest') return 'chest';
  if (p === 'chest' && c === 'neck') return 'neck';
  const m = /^(hip|knee|ankle|shoulder|elbow)([LR])$/.exec(p);
  if (m && !/^(hip|shoulder)/.test(c)) return p;
  return null;                                   // pelvis→hip etc: rigid
};
function fkExt(th) {
  const out = {}, acc = {};
  const walk = (name, accIn) => {
    const j = D.meta.rigJoints[name], p = D.meta.rigParent[name];
    if (p == null) { out[name] = [j[0], j[1]]; }
    else {
      const pj = D.meta.rigJoints[p];
      const bn = BONE_NAME(p, name);
      const a = accIn + (bn ? (th[bn] ?? 0) : 0);
      const dx = j[0] - pj[0], dy = j[1] - pj[1];
      const c = Math.cos(a), s = Math.sin(a);
      out[name] = [out[p][0] + dx * c - dy * s, out[p][1] + dx * s + dy * c];
      acc[name] = a;
      for (const k of KIDS[name] ?? []) walk(k, a);
      return;
    }
    for (const k of KIDS[name] ?? []) walk(k, 0);
  };
  for (const k of KIDS['_root'] ?? []) walk(k, 0);
  return out;
}
const dCol = (d) => d < 0.05 ? '#5c5' : d < 0.2 ? '#cc6' : '#e66';
function drawSkel(g, pts, colFn, w, alpha, fit) {
  g.globalAlpha = alpha;
  for (const nm of Object.keys(D.meta.rigParent)) {
    const p = D.meta.rigParent[nm];
    if (p == null || !pts[nm] || !pts[p]) continue;
    g.strokeStyle = colFn(nm); g.lineWidth = w;
    g.beginPath();
    g.moveTo(fit(pts[p])[0], fit(pts[p])[1]);
    g.lineTo(fit(pts[nm])[0], fit(pts[nm])[1]);
    g.stroke();
  }
  g.globalAlpha = 1;
}
function stageSk() {
  const cv = $('cSK'), g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const st = $('stSel').value;
  const f = F0[F];
  const fit = (p) => [30 + p[0] * (cv.width - 60), 10 + p[1] * (cv.height - 40)];
  const ghost = fkExt(f.s1 ?? {});
  drawSkel(g, ghost, () => '#8899cc', 2, 0.35, fit);
  let pts, devOf = () => 0;
  if (st === 'fkP' || st === 'lockP') {
    pts = Object.fromEntries(D.meta.jointNames.map((nm, i) => [nm, f[st][i]]));
    const eff = f.lockE ?? {};
    devOf = (nm) => Math.abs(wrap((eff[nm] ?? 0) - (f.s1?.[nm] ?? 0)));
  } else {
    pts = fkExt(f[st] ?? {});
    devOf = (nm) => Math.abs(wrap(((f[st] ?? {})[nm] ?? 0) - (f.s1?.[nm] ?? 0)));
  }
  drawSkel(g, pts, (nm) => dCol(devOf(BONE_NAME(D.meta.rigParent[nm], nm) ?? nm)), 3, 0.95, fit);
}
function stageHM() {
  const cv = $('cHM'), g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const st = $('stSel').value;
  const key = (st === 'fkP' || st === 'lockP') ? 'lockE' : st;
  const cw = (cv.width - 80) / F0.length, ch = (cv.height - 8) / BONES.length;
  let worst = { v: -1, b: '', f: 0 };
  BONES.forEach((b, r) => {
    g.fillStyle = '#667'; g.font = '9px monospace'; g.fillText(b, 2, 10 + r * ch + ch / 2);
    for (let i = 0; i < F0.length; i++) {
      const v = Math.abs(wrap(((F0[i][key] ?? {})[b] ?? 0) - (F0[i].s1?.[b] ?? 0)));
      if (v > worst.v) worst = { v, b, f: i };
      const c2 = Math.round(210 * Math.min(1, v / 0.4));
      g.fillStyle = 'rgb(' + (30 + c2) + ',' + Math.round(60 - c2 * 0.2) + ',' + Math.round(90 - c2 * 0.3) + ')';
      g.fillRect(74 + i * cw, 4 + r * ch, Math.ceil(cw), Math.ceil(ch) - 1);
    }
  });
  g.strokeStyle = '#fd4'; g.beginPath();
  g.moveTo(74 + F * cw, 2); g.lineTo(74 + F * cw, cv.height - 4); g.stroke();
  $('hmWorst').textContent = 'worst: ' + worst.b + ' ' + worst.v.toFixed(2) + ' rad @ f' + worst.f;
  cv.onclick = (e) => { F = Math.max(0, Math.min(F0.length - 1, Math.round((e.offsetX - 74) / cw))); $('scrub').value = F; renderAll(); };
}
function stageFlags() {
  const cv = $('cFLAGS'), g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const cw = (cv.width - 80) / F0.length;
  let prevClamps = 0;
  F0.forEach((f, i) => {
    const rows = [];
    const totC = f.flags?.clamps ? Object.values(f.flags.clamps).reduce((a, b) => a + b, 0) : 0;
    if (totC > prevClamps) rows.push('#e66');
    prevClamps = totC;
    const lk = f.flags?.lock ?? {};
    if (Object.values(lk).some((l) => l.w > 0.5)) rows.push('#5c5');
    if (Object.values(lk).some((l) => l.lift)) rows.push('#fd4');
    if (f.flags?.blend) rows.push('#c9f');
    if ((f.flags?.spikes ?? 0) > (F0[i - 1]?.flags?.spikes ?? 0)) rows.push('#f80');
    rows.forEach((col, r) => { g.fillStyle = col; g.fillRect(74 + i * cw, 4 + r * 11, Math.max(1, cw), 9); });
  });
  g.strokeStyle = '#fd4'; g.beginPath(); g.moveTo(74 + F * cw, 0); g.lineTo(74 + F * cw, cv.height); g.stroke();
  cv.onclick = (e) => { F = Math.max(0, Math.min(F0.length - 1, Math.round((e.offsetX - 74) / cw))); $('scrub').value = F; renderAll(); };
}
function ladder() {
  const stages = [['s2', 'blend'], ['s3', 'spring'], ['s4', '+gait/liveness'], ['s5', 'limits'], ['lockE', 'lock+FK (final)']];
  const rows = stages.map(([k, label]) => {
    let s = 0, n = 0, worstB = '', worstV = -1;
    for (const b of BONES) {
      let sb = 0;
      for (const f of F0) sb += wrap(((f[k] ?? {})[b] ?? 0) - (f.s1?.[b] ?? 0)) ** 2;
      sb = Math.sqrt(sb / F0.length);
      if (sb > worstV) { worstV = sb; worstB = b; }
      s += sb * sb; n++;
    }
    return { k, label, rms: Math.sqrt(s / n), worstB, worstV };
  });
  const cv = $('cLAD'), g = cv.getContext('2d');
  g.clearRect(0, 0, cv.width, cv.height);
  const hi = Math.max(0.15, ...rows.map((r) => r.rms));
  rows.forEach((r, i) => {
    const h = (cv.height - 40) * r.rms / hi;
    const x = 30 + i * ((cv.width - 50) / rows.length);
    g.fillStyle = i === rows.length - 1 ? '#59f' : '#39415e';
    g.fillRect(x, cv.height - 24 - h, 60, h);
    g.fillStyle = '#9ad'; g.font = '10px monospace';
    g.fillText(r.label, x, cv.height - 10);
    g.fillStyle = '#8fa'; g.fillText(r.rms.toFixed(3), x, cv.height - 30 - h);
  });
  $('ladTbl').innerHTML = '<table><tr><th>stage</th><th>RMS all</th><th>worst bone</th><th>worst RMS</th></tr>' +
    rows.map((r) => '<tr><td class="name">' + r.label + '</td><td>' + r.rms.toFixed(3) + '</td><td class="name">' + r.worstB + '</td><td>' + r.worstV.toFixed(3) + '</td></tr>').join('') + '</table>';
}
function renderAll() {
  $('tlab').textContent = 'f' + F + ' · phase ' + (F0[F].ph ?? 0);
  stageSk(); stageHM(); stageFlags();
}
$('scrub').oninput = (e) => { F = +e.target.value; renderAll(); };
$('stSel').onchange = renderAll;
ladder();
renderAll();
</script>
</body></html>`;
}
