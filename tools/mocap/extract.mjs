#!/usr/bin/env node
/**
 * Mocap extraction pipeline (brief 16 Task 1): tutorial clip → rig rotations
 * → distilled move table + stickman QA video. Fully offline; nothing here
 * touches the live path.
 *
 *   node tools/mocap/extract.mjs <video> [options]
 *     --loop-window 0:12-0:22   analysis bounds (from MOTION_SOURCES.md log)
 *     --audio-bpm N | --grid <sidecar.json>   timing route (a); default is
 *                               motion-derived phase (route b)
 *     --bpl N                   beats per loop when no audio route (default 4)
 *     --mirror                  instructor mirrors for teaching (swaps sides)
 *     --rig <shapes/x.json>     rest pose (default web/app/shapes/biped-1.json)
 *     --name <move-name>        output table name (default <clip>-captured)
 *     --filter savgol|oneeuro|none   landmark smoothing (default savgol —
 *                               zero-phase; oneeuro is CAUSAL and lags ~2-3
 *                               frames, kept only for future live capture)
 *     --sg-window N --sg-order N  Savitzky–Golay tuning (default 9 / 3)
 *     --min-cutoff F --beta F   One Euro tuning (default 1.2 / 0.35)
 *     --foot-gate F             projected/full heel→toe ratio below which the
 *                               ankle angle holds last valid (default 0.35)
 *     --enhance on|off          bbox crop + flip-TTA pose inference (default
 *                               on; off = legacy full-frame single-pass)
 *     --view frontal|as-filmed  projection plane (default frontal = de-yaw to
 *                               front view). as-filmed projects onto the
 *                               CAMERA plane with no rotation — for clips
 *                               filmed in the plane of the motion (profile
 *                               running man: de-yaw rotates the sagittal
 *                               knee lift into z and the projection drops it)
 *     --anchor F                extra phase shift 0..1 after auto-anchor
 *     --keep-drift              keep net pelvis drift in `travel` (single-side
 *                               captures of travelling moves; default removes it)
 *     --out <prefix>            output path prefix (default: next to the clip;
 *                               needed when extracting several windows of one clip)
 *     --no-qa                   skip the QA video render
 *     --self-test               run synthetic math checks and exit
 *
 * Outputs next to the clip: <clip>.poses.json, <clip>.move.json,
 * <clip>.qa.mp4 (side-by-side source landmarks vs retargeted rig, beat ticks
 * burned in, dropped cycles tinted).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { filterLandmarks, oneEuro } from "./lib/oneeuro.mjs";
import { sgLandmarks, savgolSmooth, holdWhere } from "./lib/smooth.mjs";
import { MP, buildRig, detectYSign, frameYaw, deYaw, deYaw3, boneTwists, retargetFrame, fkPose, calibMasks, measureRest } from "./lib/retarget.mjs";
import { angularSpeed, detectPeriod, decideLoop, binCycles, averageCycles } from "./lib/timing.mjs";
import { distillMove } from "./lib/distill.mjs";
import { renderExplorer } from "./lib/explorer.mjs";
import { sideSigns } from "./lib/retarget.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const RIG_HEIGHT_UNITS = 0.82;           // ground 0.905 → head top ≈ 0.085 in shape units
const ARTICULATED = ["chest", "neck", "shoulderL", "elbowL", "shoulderR", "elbowR",
                     "hipL", "kneeL", "ankleL", "hipR", "kneeR", "ankleR"];

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const parseTime = (s) => {
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
  return m ? +m[1] * 60 + +m[2] : +s;
};

if (flag("self-test")) { selfTest(); process.exit(0); }

const VALUE_OPTS = new Set(["loop-window", "audio-bpm", "grid", "bpl", "rig", "name",
                            "min-cutoff", "beta", "anchor", "max-keys", "out",
                            "filter", "sg-window", "sg-order", "foot-gate", "enhance", "view", "emit-views", "cycles", "estimator", "estimator-model"]);
let video = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) { if (VALUE_OPTS.has(argv[i].slice(2))) i++; continue; }
  video = argv[i]; break;
}
if (!video || !fs.existsSync(video)) {
  console.error("usage: node tools/mocap/extract.mjs <video> [--loop-window 0:12-0:22] ... (see header)");
  process.exit(1);
}
const [winA, winB] = (opt("loop-window", "0-99999")).split(/[-–]/).map(parseTime);
const mirror = flag("mirror");
const rigPath = opt("rig", path.join(ROOT, "web/app/shapes/biped-1.json"));
const sidecar = JSON.parse(fs.readFileSync(rigPath, "utf8"));
const rig = buildRig(sidecar);
const clipBase = opt("out", video.replace(/\.[^.]+$/, ""));   // output prefix (default: next to clip)
const moveName = opt("name", `${path.basename(clipBase)}-captured`);
const euro = { minCutoff: +opt("min-cutoff", 1.2), beta: +opt("beta", 0.35) };

// timing route (a) inputs
let beatSec = null, timingRoute = "motion";
if (opt("audio-bpm", null)) { beatSec = 60 / +opt("audio-bpm"); timingRoute = "audio-bpm"; }
else if (opt("grid", null)) {
  beatSec = 60 / JSON.parse(fs.readFileSync(opt("grid"), "utf8")).bpm;
  timingRoute = "grid";
}

// ── stage 1: pose worker ──────────────────────────────────────────────────
const py = path.join(HERE, ".venv/bin/python");
if (!fs.existsSync(py)) { console.error("[mocap] no .venv — run tools/mocap/setup.sh first"); process.exit(1); }
console.log(`[mocap] extracting poses: ${path.basename(video)} window ${winA}-${winB}s mirror=${mirror}`);
const enhance = opt("enhance", "on");   // 16.2 item 3: bbox crop + flip-TTA (off = legacy full-frame VIDEO mode)
const estimator = opt("estimator", "mediapipe");     // 18.1: mediapipe | rtmpose
const estimatorModel = opt("estimator-model", "balanced");
const raw = await new Promise((resolve, reject) => {
  const p = spawn(py, [path.join(HERE, "pose_worker.py"), video, String(winA), String(winB), enhance, estimator, estimatorModel]);
  let buf = "", err = "";
  const frames = [];
  let meta = null;
  p.stdout.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const j = JSON.parse(line);
      if (j.meta) meta = j;
      else if (j.meta2) meta = { ...meta, crop: j.crop, cropScale: j.scale };
      else if (j.error) reject(new Error(j.error));
      else frames.push(j);
    }
  });
  p.stderr.on("data", (d) => { err += d; });
  p.on("close", (code) => code === 0 ? resolve({ meta, frames }) : reject(new Error(`worker exit ${code}\n${err.slice(-2000)}`)));
});
const detected = raw.frames.filter((f) => !f.miss);
const missed = raw.frames.length - detected.length;
console.log(`[mocap] frames: ${raw.frames.length} in window, ${detected.length} with pose (${missed} missed) @ ${raw.meta.fps.toFixed(2)} fps · enhance=${enhance}`);
// landmark jitter: mean SECOND DIFFERENCE of raw image landmarks (px) —
// second diff cancels constant-velocity real motion and isolates
// frame-to-frame noise (a plain Δ metric mostly measures the dance)
{
  let s = 0, k = 0;
  for (let i = 1; i < detected.length - 1; i++) {
    for (let l = 0; l < detected[i].img.length; l++) {
      const ddx = (detected[i - 1].img[l][0] + detected[i + 1].img[l][0] - 2 * detected[i].img[l][0]) * raw.meta.w;
      const ddy = (detected[i - 1].img[l][1] + detected[i + 1].img[l][1] - 2 * detected[i].img[l][1]) * raw.meta.h;
      s += Math.hypot(ddx, ddy) / 2;
      k++;
    }
  }
  console.log(`[mocap] landmark jitter (second-difference, pre-smoothing): ${(s / k).toFixed(2)} px mean`);
  raw.meta.jitterPx = +(s / k).toFixed(2);
}
if (detected.length < 30) { console.error("[mocap] too few pose frames — check the loop window / clip"); process.exit(1); }

// ── stage 2: smoothing on LANDMARK POSITIONS (world + image), then angles.
// Default savgol = ZERO-PHASE (offline luxury); oneeuro is causal and lags —
// live-capture only; none = raw (diagnostics).
const times = detected.map((f) => f.t);
const filterMode = opt("filter", "savgol");
const sg = { window: +opt("sg-window", 9), order: +opt("sg-order", 3) };
// 18.1: world is a DEBUG channel (mediapipe only) — depth comes from 2D.
// Estimators without world get a flat z=0 stand-in so legacy world-path
// diagnostics stay runnable; nothing downstream may CONSUME z (Task 2).
const hasWorld = detected.every((f) => Array.isArray(f.world));
const rawWorld = detected.map((f) => hasWorld ? f.world : f.img.map((p) => [p[0], p[1], 0]));
const rawImg = detected.map((f) => f.img.map((l) => l.slice(0, 2)));
const smooth = (frames) =>
  filterMode === "oneeuro" ? filterLandmarks(frames, times, euro)
  : filterMode === "none" ? frames
  : sgLandmarks(frames, sg);
const world = smooth(rawWorld);
const img = smooth(rawImg);
const conf = detected.map((f) => f.img.reduce((a, l) => a + l[2], 0) / f.img.length);
console.log(`[mocap] filter: ${filterMode}${filterMode === "savgol" ? ` (window ${sg.window}, order ${sg.order})` : ""}`);

// ── view-independent normalization ───────────────────────────────────────
const ySign = detectYSign(world);
const worldN = ySign === 1 ? world : world.map((f) => f.map(([x, y, z]) => [x, -y, -z]));
const yawsRaw = worldN.map((f) => frameYaw(f));
const yawMedDeg = median(yawsRaw.map((y) => y * 180 / Math.PI));
// frontness: distance to the nearest of {0°, 180°} — facing the camera reads
// |yaw| ≈ 180 (the left→right vector flips), facing away ≈ 0; both are the
// FRONT projection. Profile is ±90°. Median of per-frame distances (wrap-safe).
const frontDeg = median(yawsRaw.map((y) => {
  const a = Math.abs(y * 180 / Math.PI);
  return Math.min(a, 180 - a);
}));
console.log(`[mocap] world y-sign ${ySign > 0 ? "down (as-is)" : "up (flipped)"} · yaw median ${yawMedDeg.toFixed(0)}° (frontness ${frontDeg.toFixed(0)}°)`);

// ── canonical view selection (brief 17 A5) ───────────────────────────────
// --view auto picks the NEAREST canonical view by yaw (front if |yaw| < 45°,
// else profile) — never blindly front; --emit-views profile,front runs the
// whole projection→table pipeline once per view from ONE capture (first
// listed = primary: unsuffixed outputs + the QA video).
const normView = (v) => (v === "as-filmed" || v === "profile") ? "profile" : "front";
const emitV = opt("emit-views", null);
let views;
if (emitV) {
  views = emitV.split(",").map((s) => normView(s.trim()));
} else {
  const v = opt("view", "auto");
  views = [v === "auto" ? (frontDeg < 45 ? "front" : "profile") : normView(v)];
}
console.log(`[mocap] views: ${views.join(" + ")}${opt("view", "auto") === "auto" && !emitV ? " (auto by yaw)" : ""}`);

for (let vi = 0; vi < views.length; vi++) await processView(views[vi], vi === 0);

async function processView(vk, primary) {
  const vBase = primary ? clipBase : `${clipBase}-${vk}`;
  const vName = primary ? moveName : `${moveName}-${vk}`;
  let rawThetaX = null, lagX = null;            // explorer taps (set in the lag block)
  // ── stage 3: projection for this view ────────────────────────────────────
  // profile: camera-plane projection, no rotation (yaw recorded in provenance)
  const yaws = vk === "profile" ? yawsRaw.map(() => 0) : yawsRaw;
  const frontal = worldN.map((f, i) => deYaw(f, yaws[i]));

  // ── stage 4: retarget to rig rotations ────────────────────────────────────
  // as-filmed = profile-family view: estimate the dancer's facing (median
  // heel→toe x over both feet) and swap in the profile rest set (both feet
  // forward, arms hanging) — measuring a profile pose against FRONT rests
  // parked ~π on one ankle (the "palsy foot": clamps at rotLimits.ankle)
  let view = null;
  if (vk === "profile") {
    let s = 0;
    for (const f of frontal) {
      s += (f[MP.toeL][0] - f[MP.heelL][0]) + (f[MP.toeR][0] - f[MP.heelR][0]);
    }
    view = { profileFacing: s < 0 ? -1 : 1 };
    console.log(`[mocap] profile rest set: facing ${view.profileFacing < 0 ? "left" : "right"} (heel→toe median)`);
  }
  // measured-rest calibration (2026-09-21): the human's own neutral from
  // planted low-velocity frames; declared/view rests only as fallback
  const masks = calibMasks(frontal);
  const cal = measureRest(frontal, rig, mirror, view, masks);
  {
    const declared = Object.fromEntries(rig.defs(mirror, view).map((d) => [d[0], d[4]]));
    const deltas = Object.fromEntries(Object.entries(cal.rests)
      .map(([nm, v]) => [nm, +((((v - declared[nm]) + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI).toFixed(2)]));
    console.log(`[mocap] measured rest: calib frames global=${masks.global.filter(Boolean).length} legL=${masks.legL.filter(Boolean).length} legR=${masks.legR.filter(Boolean).length}` +
      `${cal.fallbacks.length ? ` · fallback declared: [${cal.fallbacks}]` : ""}`);
    console.log(`[mocap] measured−declared rest deltas (rad): ${JSON.stringify(deltas)}`);
  }
  const thetaFrames = frontal.map((f) => retargetFrame(f, rig, mirror, view, cal.rests));

  // foot-length gating (16.2 item 1): where the projected heel→toe length
  // collapses (foot pointing at the camera), the 2D ankle angle is atan2 of
  // noise — hold the last valid sample instead. Ratio = projected/full-3D.
  const FOOT_GATE = +opt("foot-gate", 0.35);
  {
    const gateLog = {};
    for (const rigSide of ["L", "R"]) {
      const p = mirror ? (rigSide === "L" ? "R" : "L") : rigSide;
      const mask = frontal.map((f2, i) => {
        const h2 = f2[MP[`heel${p}`]], t2 = f2[MP[`toe${p}`]];
        const h3 = worldN[i][MP[`heel${p}`]], t3 = worldN[i][MP[`toe${p}`]];
        const proj = Math.hypot(t2[0] - h2[0], t2[1] - h2[1]);
        const full = Math.hypot(t3[0] - h3[0], t3[1] - h3[1], t3[2] - h3[2]);
        return proj / (full || 1) < FOOT_GATE;
      });
      const series = thetaFrames.map((f2) => f2[`ankle${rigSide}`]);
      const held = holdWhere(series, mask);
      thetaFrames.forEach((f2, i) => { f2[`ankle${rigSide}`] = series[i]; });
      gateLog[`ankle${rigSide}`] = held;
    }
    console.log(`[mocap] foot gate (<${FOOT_GATE}): held ${JSON.stringify(gateLog)} of ${thetaFrames.length} frames`);
  }

  // (the 2026-09-20 ankle re-centering is gone: measured-rest calibration
  // subsumes it — the ankle's planted median IS the stance neutral)

  // rotLimit clamp report (2026-09-20): a retargeted theta past the engine's
  // clamp is a REST-REFERENCE SMELL, not a data property — captured human
  // motion lives well inside anatomical limits when measured against the
  // right neutral
  {
    const lim = { shoulder: 3.15, elbow: 2.4, hip: 0.9, knee: 2.0, ankle: 1.0,
                  ...(sidecar.rotLimits ?? {}) };
    const limitOf = (nm) => lim[nm.replace(/[LR]$/, "")] ?? null;
    const hits = {};
    for (const f of thetaFrames) {
      for (const [nm, v] of Object.entries(f)) {
        const l = limitOf(nm);
        if (l && Math.abs(v) > l) hits[nm] = (hits[nm] ?? 0) + 1;
      }
    }
    if (Object.keys(hits).length) {
      console.log(`[mocap] CLAMP SMELL: thetas past rotLimits ${JSON.stringify(hits)} of ${thetaFrames.length} frames — check rest references`);
    } else {
      console.log(`[mocap] rotLimit clamp check: 0 hits across ${thetaFrames.length} frames`);
    }
  }

  // depth channels (16.2 item 2 — emitted now, consumed by brief 17's depth
  // mechanism): per-frame de-yawed 3D pose → footYaw (floor-plane heel→toe
  // angle) + per-bone out-of-plane twist
  const frontal3 = worldN.map((f, i) => deYaw3(f, yaws[i]));
  const footYawOf = (i, rigSide) => {
    const p = mirror ? (rigSide === "L" ? "R" : "L") : rigSide;
    const h = frontal3[i][MP[`heel${p}`]], t = frontal3[i][MP[`toe${p}`]];
    return Math.atan2(t[2] - h[2], t[0] - h[0]);
  };
  const twistFrames = frontal3.map((f) => boneTwists(f, rig, mirror));

  // ── lag diagnostic: filtered pipeline vs a RAW parallel path ─────────────
  // Cross-correlate joint-angle signals; peak at lag>0 = rig lags source.
  // Reported whole-window + per-third (constant vs drifting).
  {
    const rawN = ySign === 1 ? rawWorld : rawWorld.map((f) => f.map(([x, y, z]) => [x, -y, -z]));
    const rawTheta = rawN.map((f, i) => retargetFrame(deYaw(f, vk === "profile" ? 0 : frameYaw(f)), rig, mirror, view));
    rawThetaX = rawTheta;
    const fps = raw.meta.fps;
    const xlag = (i0, i1) => {
      const seg = (frames2) => ARTICULATED.map((nm) => {
        const v = [];
        for (let i = i0; i < i1; i++) v.push(frames2[i][nm] ?? 0);
        const mean = v.reduce((a, b) => a + b, 0) / v.length;
        return v.map((x) => x - mean);
      });
      const F = seg(thetaFrames), R = seg(rawTheta);
      const maxL = Math.min(10, Math.floor((i1 - i0) / 3));
      const score = (l) => {
        let s = 0;
        for (let j = 0; j < F.length; j++) {
          for (let i = Math.max(0, l); i < F[j].length && i - l < F[j].length; i++) {
            if (i - l >= 0) s += F[j][i] * R[j][i - l];
          }
        }
        return s;
      };
      let best = 0, bestS = -Infinity;
      const sc = {};
      for (let l = -maxL; l <= maxL; l++) { sc[l] = score(l); if (sc[l] > bestS) { bestS = sc[l]; best = l; } }
      // parabolic sub-frame refinement
      const y0 = sc[best - 1] ?? bestS, y2 = sc[best + 1] ?? bestS;
      const off = (y0 - y2) / (2 * (y0 - 2 * bestS + y2) || 1);
      return (best + Math.max(-0.5, Math.min(0.5, off))) / fps * 1000;
    };
    const n = thetaFrames.length;
    const whole = xlag(0, n);
    const thirds = [0, 1, 2].map((k) => xlag(Math.floor(n * k / 3), Math.floor(n * (k + 1) / 3)));
    const spread = Math.max(...thirds) - Math.min(...thirds);
    lagX = { whole: +whole.toFixed(1), thirds: thirds.map((v) => +v.toFixed(1)) };
    console.log(`[mocap] lag vs raw: ${whole.toFixed(1)} ms (thirds ${thirds.map((v) => v.toFixed(1)).join("/")} ms → ${spread < 1000 / fps ? "constant" : "DRIFTING"})`);
  }

  // image-space channels: pelvis drift + foot heights (shape units)
  const bodyH = median(img.map((f) => {
    const feet = Math.max(f[MP.heelL][1], f[MP.heelR][1], f[MP.toeL][1], f[MP.toeR][1]);
    const head = Math.min(f[MP.nose][1], f[MP.earL][1], f[MP.earR][1]);
    return feet - head;
  }));
  const toUnits = RIG_HEIGHT_UNITS / bodyH;
  const sideIdx = (s) => (mirror ? (s === "L" ? "R" : "L") : s);
  const pelvisU = detected.map((_, i) => (img[i][MP.hipL][0] + img[i][MP.hipR][0]) / 2 * toUnits * (mirror ? -1 : 1));
  const footY = {}, footX = {};
  for (const rigSide of ["L", "R"]) {
    const p = sideIdx(rigSide);                 // person side feeding this rig side
    footY[rigSide] = detected.map((_, i) => Math.max(img[i][MP[`heel${p}`]][1], img[i][MP[`toe${p}`]][1]));
    footX[rigSide] = detected.map((_, i) => img[i][MP[`toe${p}`]][0] * (mirror ? -1 : 1));
  }

  // ── stage 5: timing ───────────────────────────────────────────────────────
  const fsHz = 1 / median(times.slice(1).map((t, i) => t - times[i]));
  // resample everything onto a uniform grid (worker frames can jitter)
  const uni = (vals) => {
    const out = new Float64Array(Math.floor((times.at(-1) - times[0]) * fsHz));
    let j = 0;
    for (let i = 0; i < out.length; i++) {
      const t = times[0] + i / fsHz;
      while (j < times.length - 2 && times[j + 1] < t) j++;
      const u = Math.min(1, Math.max(0, (t - times[j]) / Math.max(1e-9, times[j + 1] - times[j])));
      out[i] = vals[j] + (vals[j + 1] - vals[j]) * u;
    }
    return out;
  };
  const channels = {};
  for (const nm of ARTICULATED) channels[`th:${nm}`] = uni(thetaFrames.map((f) => f[nm] ?? 0));
  // twist channels ride the same averaging (17 B1) — distill emits them
  // as per-key twist where the bone meaningfully leaves the plane
  for (const nm of ARTICULATED) channels[`tw:${nm}`] = uni(twistFrames.map((f) => f[nm] ?? 0));
  channels.pelvisU = uni(pelvisU);
  for (const s of ["L", "R"]) {
    channels[`footY${s}`] = uni(footY[s]);
    const fx = uni(footX[s]);
    channels[`footVX${s}`] = fx.map((v, i) => i ? (v - fx[i - 1]) * fsHz : 0);
  }

  const speed = angularSpeed(thetaFrames, times, ARTICULATED);
  const cyclesPrior = opt("cycles", null);   // logged cycle count for this window
  const per = detectPeriod(speed, fsHz,
    cyclesPrior ? { target: (winB - winA) / +cyclesPrior } : {});
  const signedCh = Object.fromEntries(ARTICULATED.map((nm) => [nm, channels[`th:${nm}`]]));
  const loop = decideLoop(signedCh, fsHz, per.period);
  let period = per.period * loop.mult;
  let bpl = +opt("bpl", 4);
  if (beatSec) {
    const beats = period / beatSec;
    bpl = [1, 2, 3, 4, 6, 8].reduce((a, b) => Math.abs(b - beats) < Math.abs(a - beats) ? b : a);
    period = bpl * beatSec;                     // lock the loop to the music exactly
  }
  console.log(`[mocap] base period ${per.period.toFixed(3)}s (ac ${per.strength.toFixed(2)}) ×${loop.mult}${loop.mult === 2 ? " (L/R halves differ)" : ""} route=${timingRoute} view=${vk} → bpl ${bpl}${beatSec ? ` @ ${(60 / beatSec).toFixed(1)} BPM, locked ${period.toFixed(3)}s` : ""}`);

  // auto-anchor: phase 0 at the calmest bin of the folded speed signal, plus
  // any user shift — deterministic, and holds usually start a move key
  const BINS = 64;
  const fold = new Float64Array(BINS);
  const foldN = new Float64Array(BINS);
  for (let i = 0; i < speed.length; i++) {
    const b = Math.floor((((times[i] - times[0]) / period) % 1) * BINS) % BINS;
    fold[b] += speed[i]; foldN[b]++;
  }
  let calmBin = 0;
  for (let b = 0; b < BINS; b++) if (foldN[b] && fold[b] / foldN[b] < fold[calmBin] / Math.max(1, foldN[calmBin])) calmBin = b;
  const anchorSec = ((calmBin / BINS) + (+opt("anchor", 0))) % 1 * period;

  // ── stage 6: cycle average with outlier drop ─────────────────────────────
  const cycles = binCycles(channels, fsHz, period, anchorSec, BINS);
  const { mean, kept, dropped } = averageCycles(cycles);
  console.log(`[mocap] cycles: ${cycles.length} → kept ${kept.length}, dropped [${dropped.join(",")}]`);
  if (kept.length < 2) { console.error("[mocap] fewer than 2 clean cycles — widen the loop window"); process.exit(1); }

  // ── stage 7: distill to the standard table ────────────────────────────────
  const thetasAvg = {};
  for (const nm of ARTICULATED) thetasAvg[nm] = mean[`th:${nm}`];
  const twistAvg = {};
  for (const nm of ARTICULATED) twistAvg[nm] = mean[`tw:${nm}`];
  const pelvisAvg = mean.pelvisU;
  const pelvisMean = pelvisAvg.reduce((a, b) => a + b, 0) / BINS;
  // contacts from the RIG'S OWN FK (2026-09-23): image-space foot height is
  // unreliable for the OCCLUDED far foot in profile — the runningman's
  // footL read planted through its whole swing and the stage stance lock
  // then killed the lift. The averaged thetas demonstrably carry the lift
  // (QA stickman), so contact is judged where the rig itself puts each foot.
  const fkFY = { L: new Float64Array(BINS), R: new Float64Array(BINS) };
  const fkFX = { L: new Float64Array(BINS), R: new Float64Array(BINS) };
  for (let b = 0; b < BINS; b++) {
    const pose = fkPose(rig, Object.fromEntries(ARTICULATED.map((nm) => [nm, thetasAvg[nm][b]])));
    fkFY.L[b] = pose.footL[1]; fkFY.R[b] = pose.footR[1];
    fkFX.L[b] = pose.footL[0]; fkFX.R[b] = pose.footR[0];
  }
  const circD = (arr) => Float64Array.from(arr, (_, b) =>
    (arr[(b + 1) % BINS] - arr[(b - 1 + BINS) % BINS]) / 2);
  for (const s of ["L", "R"]) {
    const range = Math.max(...fkFY[s]) - Math.min(...fkFY[s]);
    const band = range < 0.04 ? range : Math.max(0.02, 0.25 * range);   // mirror of distill's rule
    console.log(`[mocap] fk foot${s}: y-range ${range.toFixed(3)} u (contact band ${band.toFixed(3)}${range < 0.04 ? ", pivot foot: all planted" : ""})`);
  }
  const table = distillMove({
    thetas: thetasAvg,
    twists: twistAvg,
    pelvisU: pelvisAvg,
    footY: { L: fkFY.L, R: fkFY.R },
    footVX: { L: circD(fkFX.L), R: circD(fkFX.R) },
  }, { bins: BINS, bpl, maxKeys: +opt("max-keys", 16), name: vName, keepDrift: flag("keep-drift") });
  // pelvis lateral sway rides as dx (shape units around the loop mean)
  for (const k of table.keys) {
    const b = Math.round(k.phase * BINS) % BINS;
    const dx = +(pelvisAvg[b] - pelvisMean).toFixed(4);
    if (Math.abs(dx) >= 0.004) (k.joints.pelvis ??= {}).dx = dx;
  }
  console.log(`[mocap] table: ${table.keys.length} keys, joints ${Object.keys(table.keys[0].joints).length}+, net drift ${table._netDriftUnits} u/loop (${flag("keep-drift") ? "KEPT in travel" : "removed from travel"})`);

  // ── stage 8: outputs ──────────────────────────────────────────────────────
  const clipHash = createHash("sha256").update(fs.readFileSync(video)).digest("hex").slice(0, 12);
  const poses = {
    source: path.basename(video), clipSha: clipHash, view: vk,
    window: [winA, winB], mirror, rig: path.basename(rigPath),
    filter: filterMode === "oneeuro" ? { mode: "oneeuro", ...euro } : { mode: filterMode, ...sg },
    fps: raw.meta.fps,
    timing: { route: timingRoute, period: +period.toFixed(4), bpl,
              bpm: beatSec ? +(60 / beatSec).toFixed(2) : null,
              anchorSec: +anchorSec.toFixed(4), acStrength: +per.strength.toFixed(3),
              cycles: cycles.length, kept: kept.length, dropped },
    restCalibration: {
      rests: Object.fromEntries(Object.entries(cal.rests).map(([k, v]) => [k, +v.toFixed(4)])),
      counts: cal.counts, fallbacks: cal.fallbacks,
    },
    frames: detected.map((f, i) => ({
      t: +times[i].toFixed(4),
      yaw: +yawsRaw[i].toFixed(4),
      conf: +conf[i].toFixed(3),
      thetas: Object.fromEntries(ARTICULATED.map((nm) => [nm, +thetaFrames[i][nm].toFixed(4)])),
      pelvisU: +pelvisU[i].toFixed(4),
      footYaw: { L: +footYawOf(i, "L").toFixed(4), R: +footYawOf(i, "R").toFixed(4) },
      twist: Object.fromEntries(Object.entries(twistFrames[i]).map(([nm, v]) => [nm, +v.toFixed(4)])),
    })),
  };
  fs.writeFileSync(`${vBase}.poses.json`, JSON.stringify(poses));
  const { _netDriftUnits, ...moveOut } = table;
  moveOut.view = vk;
moveOut.estimator = estimator;
  moveOut.provenance = { clip: path.basename(video), clipSha: clipHash, window: [winA, winB],
                         mirror, cyclesKept: kept.length, cyclesDropped: dropped.length,
                         netDriftUnits: _netDriftUnits, pipeline: "tools/mocap/extract.mjs" };
  fs.writeFileSync(`${vBase}.move.json`, JSON.stringify(moveOut, null, 2));
  console.log(`[mocap] wrote ${path.basename(vBase)}.poses.json + .move.json (clip sha ${clipHash})`);

  // ── stage 9: QA video ─────────────────────────────────────────────────────
  if (primary && !flag("no-qa")) {
    const bones = sidecar.joints.filter((j) => j.parent).map((j) => [j.name, j.parent]);
    const spec = {
      video: path.resolve(video), out: `${vBase}.qa.mp4`,
      w: raw.meta.w, h: raw.meta.h, fps: raw.meta.fps,
      period, anchorSec, t0: times[0], bpl, beatSec,
      droppedCycles: dropped, bones,
      ground: sidecar.ground ?? 0.905,
      // extracted pelvis drift about the window mean, shape units — the QA
      // ground marker (16.2 item 4) makes travel capture visible
      pelvisDrift: (() => {
        const m = pelvisU.reduce((a, b) => a + b, 0) / pelvisU.length;
        return pelvisU.map((v) => +(v - m).toFixed(4));
      })(),
      frames: detected.map((f, i) => {
        // rig-anchored render: theta = obs − measured human rest, so the
        // calibration pose draws AS the rig's rest pose — this is what the
        // stage will do, no view correction needed
        const pose = fkPose(rig, thetaFrames[i]);
        return {
          i: f.i, k: i, t: +times[i].toFixed(4),
          img: img[i].map(([x, y]) => [+(x).toFixed(4), +(y).toFixed(4)]),
          rig: Object.fromEntries(Object.entries(pose).map(([nm, [x, y]]) => [nm, [+x.toFixed(4), +y.toFixed(4)]])),
        };
      }),
    };
    const specPath = `${vBase}.qa-spec.json`;
    fs.writeFileSync(specPath, JSON.stringify(spec));
    console.log("[mocap] rendering QA video…");
    await new Promise((resolve, reject) => {
      const p = spawn(py, [path.join(HERE, "qa_render.py"), specPath], { stdio: "inherit" });
      p.on("close", (c) => c === 0 ? resolve() : reject(new Error(`qa_render exit ${c}`)));
    });
    fs.unlinkSync(specPath);
    console.log(`[mocap] wrote ${path.basename(vBase)}.qa.mp4`);
  }

  // ── stage 10: the stage explorer (brief 18 Task 1) ───────────────────────
  if (primary && !flag("no-explorer")) {
    const r3 = (v) => +(+v).toFixed(3);
    const cropStr = raw.meta.crop ? raw.meta.crop.join(",") : "full";
    let frames0 = { frames: [], crop: raw.meta.crop ?? [0, 0, raw.meta.w, raw.meta.h] };
    try {
      const out = await new Promise((resolve, reject) => {
        let buf2 = "";
        const p2 = spawn(py, [path.join(HERE, "frame_dump.py"), video, String(winA), String(winB), cropStr, "14"]);
        p2.stdout.on("data", (d) => { buf2 += d; });
        p2.on("close", (c) => c === 0 ? resolve(JSON.parse(buf2)) : reject(new Error("frame_dump " + c)));
      });
      frames0 = out;
    } catch (e) { console.warn("[mocap] explorer frame dump failed (page still written):", e.message); }
    const boneOf = (nm) => nm === "chest" ? ["pelvis", "chest"] : nm === "neck" ? ["chest", "neck"]
      : /^shoulder/.test(nm) ? [nm, "elbow" + nm.slice(-1)] : /^elbow/.test(nm) ? [nm, "hand" + nm.slice(-1)]
      : /^hip/.test(nm) ? [nm, "knee" + nm.slice(-1)] : /^knee/.test(nm) ? [nm, "ankle" + nm.slice(-1)]
      : [nm, "foot" + nm.slice(-1)];
    const defRows = rig.defs(mirror, view);
    const defLen = {}, declared = {};
    for (const [nm, , , , restDecl] of defRows) {
      const [ja, jb] = boneOf(nm);
      defLen[nm] = r3(Math.hypot(rig.joints[jb].x - rig.joints[ja].x, rig.joints[jb].y - rig.joints[ja].y));
      declared[nm] = r3(restDecl);
    }
    const sgnFn = sideSigns(rig, view);
    const cycJoints = ["hipL", "hipR", "kneeL", "kneeR"].filter((j) => ARTICULATED.includes(j));
    // reconstruction RMS of the emitted keys vs the averaged loop
    let rmsAcc = 0, rmsN = 0;
    const kp = table.keys.map((k) => k.phase);
    for (const [nm, v] of Object.entries(thetasAvg)) {
      for (let b = 0; b < BINS; b++) {
        const lp = b / BINS;
        let i = kp.length - 1;
        for (let k = 0; k < kp.length; k++) if (kp[k] <= lp) i = k;
        const A = table.keys[i], B2 = table.keys[(i + 1) % kp.length];
        const span = (((B2.phase - A.phase) % 1) + 1) % 1 || 1;
        const u = ((((lp - A.phase) % 1) + 1) % 1) / span;
        const va = A.joints[nm]?.rot ?? 0, vb = B2.joints[nm]?.rot ?? 0;
        rmsAcc += (va + (vb - va) * u - v[b]) ** 2; rmsN++;
      }
    }
    const Dx = {
      meta: { clip: path.basename(video), view: vk, window: [winA, winB], mirror,
        params: { filter: filterMode, sgWindow: sg.window, sgOrder: sg.order, enhance,
                  footGate: FOOT_GATE, bpl, maxKeys: +opt("max-keys", 16), cycles: opt("cycles", null) } },
      crop: frames0.crop, vidW: raw.meta.w, vidH: raw.meta.h, scale: raw.meta.cropScale ?? 1,
      jitter: raw.meta.jitterPx ?? 0,
      frames0: frames0.frames,
      times: times.map(r3),
      img: img.map((f, i) => f.map((p, l) => [r3(p[0]), r3(p[1]), r3(detected[i].img[l][2])])),
      world: worldN.map((f) => f.map((p) => p.map(r3))),
      camPlane: worldN.map((f) => deYaw(f, 0).map((p) => p.map(r3))),
      frontal: frontal.map((f) => f.map((p) => p.map(r3))),
      rawTheta: Object.fromEntries(ARTICULATED.map((nm) => [nm, rawThetaX.map((f) => r3(f[nm]))])),
      theta: Object.fromEntries(ARTICULATED.map((nm) => [nm, thetaFrames.map((f) => r3(f[nm]))])),
      lag: lagX ?? { whole: 0, thirds: [] },
      yawDeg: yawsRaw.map((y) => r3(y * 180 / Math.PI)),
      frontness: +frontDeg.toFixed(1),
      masks: { global: masks.global.map(Number), legL: masks.legL.map(Number), legR: masks.legR.map(Number) },
      rests: { measured: Object.fromEntries(Object.entries(cal.rests).map(([k, v]) => [k, r3(v)])),
               declared, counts: cal.counts, fallbacks: cal.fallbacks },
      defs: defRows.map(([nm, parent, a, b]) => [nm, parent, a, b]),
      defLen,
      sideSigns: Object.fromEntries(defRows.map(([nm]) => [nm, sgnFn(nm)])),
      rotLimits: { shoulder: 3.15, elbow: 2.4, hip: 0.9, knee: 2.0, ankle: 1.0, ...(sidecar.rotLimits ?? {}) },
      period: { ...per.debug, chosen: +period.toFixed(4), mult: loop.mult,
                cyclesPrior: opt("cycles", null), anchorSec: +anchorSec.toFixed(3) },
      cycles: { data: Object.fromEntries(cycJoints.map((j) => [j, cycles.map((c) => Array.from(c["th:" + j]).map(r3))])),
                kept, dropped },
      avg: Object.fromEntries(Object.entries(thetasAvg).map(([k, v]) => [k, Array.from(v).map(r3)])),
      distill: { keyPhases: kp, keyCount: table.keys.length, rms: +Math.sqrt(rmsAcc / Math.max(1, rmsN)).toFixed(3) },
      table: moveOut,
    };
    fs.writeFileSync(`${vBase}.explorer.html`, renderExplorer(Dx));
    console.log(`[mocap] wrote ${path.basename(vBase)}.explorer.html (${(fs.statSync(`${vBase}.explorer.html`).size / 1e6).toFixed(1)} MB)`);
  }

}

function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

// ── self-test: synthetic checks, no video needed ─────────────────────────
function selfTest() {
  const fails = [];
  // 1) One Euro: noisy hold converges near truth; a fast ramp lags < 60 ms
  {
    const f = oneEuro({ minCutoff: 1.2, beta: 0.35 });
    let last = 0;
    for (let i = 0; i < 200; i++) last = f(1 + 0.05 * Math.sin(i * 7919), i / 60);
    if (Math.abs(last - 1) > 0.02) fails.push(`oneEuro hold ${last.toFixed(3)} vs 1`);
    const g = oneEuro({ minCutoff: 1.2, beta: 0.35 });
    let lag = 0;
    for (let i = 0; i < 120; i++) {
      const t = i / 60, truth = t * 2;             // 2 units/s ramp
      lag = truth - g(truth, t);
    }
    if (lag / 2 > 0.06) fails.push(`oneEuro ramp lag ${(lag / 2 * 1000).toFixed(0)} ms > 60`);
    console.log(`[self-test] oneEuro: hold err ${(Math.abs(last - 1)).toFixed(4)}, ramp lag ${(lag / 2 * 1000).toFixed(1)} ms`);
  }
  // 1b) Savitzky–Golay: zero phase on a noisy sine (xcorr lag < 2 ms) AND
  //     denoises; One Euro on the same signal must show its known lag —
  //     that contrast is the reason savgol is the offline default
  {
    const fs2 = 30, f0 = 1.2, n = 300;
    const t = (i) => i / fs2;
    const clean = Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * f0 * t(i)));
    const noisy = clean.map((v, i) => v + 0.08 * Math.sin(i * 7919 + 1.3));
    const sgOut = savgolSmooth(noisy, 9, 3);
    const lagOf = (sig) => {
      const score = (l) => {
        let s = 0;
        for (let i = Math.max(0, l); i < n; i++) if (i - l >= 0 && i - l < n) s += sig[i] * clean[i - l];
        return s;
      };
      let best = 0, bestS = -Infinity;
      for (let l = -6; l <= 6; l++) { const s = score(l); if (s > bestS) { bestS = s; best = l; } }
      const y0 = score(best - 1), y2 = score(best + 1);
      const off = (y0 - y2) / (2 * (y0 - 2 * bestS + y2) || 1);
      return (best + Math.max(-0.5, Math.min(0.5, off))) / fs2 * 1000;
    };
    const rms = (sig) => Math.sqrt(sig.reduce((a, v, i) => a + (v - clean[i]) ** 2, 0) / n);
    const oe = oneEuro({ minCutoff: 1.2, beta: 0.35 });
    const oeOut = noisy.map((v, i) => oe(v, t(i)));
    const sgLag = lagOf(sgOut), oeLag = lagOf(oeOut);
    console.log(`[self-test] savgol: lag ${sgLag.toFixed(1)} ms (oneEuro ${oeLag.toFixed(1)} ms), residual ${rms(sgOut).toFixed(3)} vs noisy ${rms(noisy).toFixed(3)}`);
    if (Math.abs(sgLag) > 2) fails.push(`savgol lag ${sgLag.toFixed(1)} ms > 2`);
    if (rms(sgOut) > 0.6 * rms(noisy)) fails.push("savgol does not denoise");
    if (oeLag < 10) fails.push(`oneEuro lag ${oeLag.toFixed(1)} ms — expected its known causal lag; contrast check broken`);
  }
  // 2) period + loop-multiple: (a) symmetric move — base period IS the loop;
  //    (b) L/R-alternating move — |speed| has half-loop period, the SIGNED
  //    channel disambiguates and decideLoop must double
  {
    const fs2 = 100, P = 0.8, n = 800;
    const noise = (i) => 0.02 * Math.sin(i * 7919);
    const speedSym = Array.from({ length: n }, (_, i) =>
      Math.abs(Math.sin(2 * Math.PI * (i / fs2 / P))) + noise(i));
    const ra = detectPeriod(speedSym, fs2);
    // decideLoop on a signed channel whose true period IS the base (both
    // sides do the same thing): e2 ≈ e1 → mult 1
    const chSym = { a: Float64Array.from({ length: n }, (_, i) => Math.sin(2 * Math.PI * i / fs2 / (P / 2)) + noise(i)) };
    const la = decideLoop(chSym, fs2, ra.period);
    const errA = Math.abs(ra.period - P / 2) / (P / 2);   // |sin| halves the period
    console.log(`[self-test] period(sym): base ${ra.period.toFixed(4)}s ×${la.mult} (want ${(P / 2).toFixed(2)}×1)`);
    if (errA > 0.02) fails.push(`sym base period err ${(errA * 100).toFixed(1)}%`);
    if (la.mult !== 1) fails.push("symmetric loop wrongly doubled");
    // alternating: signed channel period 2P (kick L then kick R), speed period P
    const speedAlt = Array.from({ length: n }, (_, i) =>
      Math.abs(Math.sin(2 * Math.PI * (i / fs2 / P))) + noise(i));
    const rb = detectPeriod(speedAlt, fs2);
    const chAlt = { a: Float64Array.from({ length: n }, (_, i) => {
      const ph = (i / fs2 / (2 * P)) % 1;
      return (ph < 0.5 ? 1 : -1) * Math.abs(Math.sin(2 * Math.PI * ph * 2)) + noise(i);
    }) };
    const lb = decideLoop(chAlt, fs2, 2 * rb.period);      // base×2 candidate from |speed| period P
    const full = 2 * rb.period * lb.mult;
    const errB = Math.abs(full - 2 * P) / (2 * P);
    console.log(`[self-test] period(alt): base ${rb.period.toFixed(4)}s → full ${full.toFixed(4)}s ×${lb.mult} (want ${(2 * P).toFixed(2)})`);
    if (errB > 0.02) fails.push(`alt full loop err ${(errB * 100).toFixed(1)}%`);
  }
  // 3) retarget↔FK round-trip on the real rig: known thetas → positions →
  //    recovered thetas (uses FK output as synthetic "observation")
  {
    const sc = JSON.parse(fs.readFileSync(path.join(ROOT, "web/app/shapes/biped-1.json"), "utf8"));
    const rg = buildRig(sc);
    const truth = { chest: -0.12, neck: 0.08, shoulderL: 0.95, elbowL: 0.6,
                    shoulderR: -0.3, elbowR: -0.5, hipL: -0.55, kneeL: 0.7,
                    ankleL: -0.25, hipR: 0.4, kneeR: -0.2, ankleR: 0.22 };
    const pose = fkPose(rg, truth);
    // build a fake de-yawed frame: place MP landmarks at the rig joint
    // positions the observed segments read from
    const fake = [];
    fake[MP.hipL] = pose.hipL; fake[MP.hipR] = pose.hipR;
    fake[MP.shoulderL] = pose.shoulderL; fake[MP.shoulderR] = pose.shoulderR;
    fake[MP.elbowL] = pose.elbowL; fake[MP.elbowR] = pose.elbowR;
    fake[MP.wristL] = pose.handL; fake[MP.wristR] = pose.handR;
    fake[MP.kneeL] = pose.kneeL; fake[MP.kneeR] = pose.kneeR;
    fake[MP.ankleL] = pose.ankleL; fake[MP.ankleR] = pose.ankleR;
    fake[MP.toeL] = pose.footL; fake[MP.toeR] = pose.footR;
    // heel→toe ankle defs: heel at the ankle keeps obs == ankle→foot angle
    fake[MP.heelL] = pose.ankleL; fake[MP.heelR] = pose.ankleR;
    fake[MP.earL] = pose.neck; fake[MP.earR] = pose.neck;
    // chest observation is hipMid→shoulderMid, which the rig bends at chest —
    // it cannot round-trip exactly (documented DOF projection); check the
    // arm/leg chains, which must be exact
    const rec = retargetFrame(fake, rg, false);
    let worst = 0, worstName = "";
    for (const nm of ["shoulderL", "elbowL", "shoulderR", "elbowR",
                      "hipL", "kneeL", "ankleL", "hipR", "kneeR", "ankleR"]) {
      // arm chain parent is chest: recovered accRot is exact, theta differs
      // by the chest projection error — compare CHAIN-ACCUMULATED rotation
      const chain = (th, names2) => names2.reduce((a, n2) => a + (th[n2] ?? 0), 0);
      const pairs = {
        shoulderL: ["chest", "shoulderL"], elbowL: ["chest", "shoulderL", "elbowL"],
        shoulderR: ["chest", "shoulderR"], elbowR: ["chest", "shoulderR", "elbowR"],
        hipL: ["hipL"], kneeL: ["hipL", "kneeL"], ankleL: ["hipL", "kneeL", "ankleL"],
        hipR: ["hipR"], kneeR: ["hipR", "kneeR"], ankleR: ["hipR", "kneeR", "ankleR"],
      };
      const d = Math.abs(chain(rec, pairs[nm]) - chain(truth, pairs[nm]));
      if (d > worst) { worst = d; worstName = nm; }
    }
    console.log(`[self-test] retarget round-trip: worst chain-accRot err ${worst.toExponential(2)} rad (${worstName})`);
    if (worst > 1e-9) fails.push(`round-trip err ${worst} rad`);
    // MIRROR round-trip (2026-09-20 regression): with mirror the rendered
    // rig-R bones must reproduce the observed person-L segment angles
    // exactly — the hardcoded-rest bug made every mirrored chain off by
    // rest(L)−rest(R)
    const recM = retargetFrame(fake, rg, true);
    const poseM = fkPose(rg, recM);
    const a2 = (p, q) => Math.atan2(q[1] - p[1], q[0] - p[0]);
    let worstM = 0, worstMB = "";
    for (const [rigA, rigB, obsA, obsB] of [
      ["shoulderR", "elbowR", pose.shoulderL, pose.elbowL],
      ["elbowR", "handR", pose.elbowL, pose.handL],
      ["hipR", "kneeR", pose.hipL, pose.kneeL],
      ["kneeR", "ankleR", pose.kneeL, pose.ankleL],
    ]) {
      const d = Math.abs(Math.atan2(
        Math.sin(a2(poseM[rigA], poseM[rigB]) - a2(obsA, obsB)),
        Math.cos(a2(poseM[rigA], poseM[rigB]) - a2(obsA, obsB))));
      if (d > worstM) { worstM = d; worstMB = `${rigA}→${rigB}`; }
    }
    console.log(`[self-test] mirror round-trip: worst rendered-vs-observed ${worstM.toExponential(2)} rad (${worstMB})`);
    if (worstM > 1e-9) fails.push(`mirror round-trip err ${worstM} rad (${worstMB})`);
    // profile rest set (2026-09-20 palsy foot): both observed feet forward
    // (left) → ankle thetas small under view rests; against FRONT rests the
    // off-side foot reads ~π (the clamp-smell case)
    const fake2 = fake.map((p) => p && [...p]);
    fake2[MP.toeL] = [pose.ankleL[0] - 0.1, pose.ankleL[1] + 0.02];
    fake2[MP.toeR] = [pose.ankleR[0] - 0.1, pose.ankleR[1] + 0.02];
    fake2[MP.heelL] = [pose.ankleL[0] + 0.02, pose.ankleL[1] + 0.02];
    fake2[MP.heelR] = [pose.ankleR[0] + 0.02, pose.ankleR[1] + 0.02];
    const thProf = retargetFrame(fake2, rg, false, { profileFacing: -1 });
    const thFront = retargetFrame(fake2, rg, false);
    const maxProf = Math.max(Math.abs(thProf.ankleL), Math.abs(thProf.ankleR));
    const maxFront = Math.max(Math.abs(thFront.ankleL), Math.abs(thFront.ankleR));
    console.log(`[self-test] profile foot rests: max |ankle| ${maxProf.toFixed(2)} rad under view (front rests read ${maxFront.toFixed(2)})`);
    if (maxProf > 0.5) fails.push(`profile ankle theta ${maxProf.toFixed(2)} rad — view rests not applied`);
    if (maxFront < 2) fails.push("front-rest control did not show the ~π off-side foot");
    // measured-rest self-calibration (2026-09-21 tiptoes): a static clip
    // calibrated on itself is its own rest — every theta must be ~0
    // regardless of how the pose disagrees with any declared rest
    const staticClip = Array.from({ length: 12 }, () => fake2);
    const m = calibMasks(staticClip);
    const c = measureRest(staticClip, rg, false, null, m);
    const thCal = retargetFrame(fake2, rg, false, null, c.rests);
    const maxCal = Math.max(...Object.values(thCal).map(Math.abs));
    console.log(`[self-test] measured-rest self-calibration: max |theta| ${maxCal.toExponential(2)} rad, fallbacks [${c.fallbacks}]`);
    if (maxCal > 1e-9) fails.push(`self-calibration theta ${maxCal} — measured rest broken`);
    if (c.fallbacks.length) fails.push(`self-calibration fell back on [${c.fallbacks}]`);
    // profile knee-lift, BOTH sides (2026-09-21 far-side flip): measured
    // rest + per-side sign together — each side's lift must round-trip
    // < 1° in the side-aware sense (rendered deviation × sideSign ==
    // observed deviation). Pre-fix the far side erred at 2× the lift.
    {
      const prof = (lift) => {
        const f = [];
        const leg = (s, dx) => {
          f[MP[`hip${s}`]] = [dx, 0.5]; f[MP[`knee${s}`]] = [dx, 0.75];
          f[MP[`ankle${s}`]] = [dx, 1.0]; f[MP[`heel${s}`]] = [dx + 0.01, 1.02];
          f[MP[`toe${s}`]] = [dx - 0.09, 1.02];              // feet point LEFT (facing -1)
        };
        leg("L", 0); leg("R", 0.02);
        if (lift) {
          // swing the whole leg forward (screen left, facing -1): femur
          // rotates +40°, shin follows, foot dangles
          f[MP[`knee${lift}`]] = [f[MP[`hip${lift}`]][0] - 0.16, 0.69];
          f[MP[`ankle${lift}`]] = [f[MP[`knee${lift}`]][0] - 0.05, 0.93];
          f[MP[`heel${lift}`]] = [f[MP[`ankle${lift}`]][0] + 0.01, 0.95];
          f[MP[`toe${lift}`]] = [f[MP[`ankle${lift}`]][0] - 0.09, 0.95];
        }
        for (const [s, dx] of [["L", 0], ["R", 0.02]]) {
          f[MP[`shoulder${s}`]] = [dx, 0.1]; f[MP[`elbow${s}`]] = [dx, 0.3];
          f[MP[`wrist${s}`]] = [dx, 0.45];
        }
        f[MP.earL] = [0, 0]; f[MP.earR] = [0.02, 0]; f[MP.nose] = [-0.03, 0.01];
        return f;
      };
      const view2 = { profileFacing: -1 };
      const stand = prof(null);
      for (const lift of ["L", "R"]) {
        const clip = [...Array.from({ length: 8 }, () => stand), prof(lift), prof(lift)];
        const m2 = calibMasks(clip);
        const c2 = measureRest(clip, rg, false, view2, m2);
        const th2 = retargetFrame(prof(lift), rg, false, view2, c2.rests);
        const pose2 = fkPose(rg, th2);
        const sgn = (nm) => (Math.sign(rg.joints[`foot${nm.slice(-1)}`].x - rg.joints[`ankle${nm.slice(-1)}`].x) === -1 ? 1 : -1);
        let worstS = 0, worstSB = "";
        for (const [pa, ch, a, b] of [[`hip${lift}`, `knee${lift}`, MP[`hip${lift}`], MP[`knee${lift}`]],
                                      [`knee${lift}`, `ankle${lift}`, MP[`knee${lift}`], MP[`ankle${lift}`]]]) {
          const F = prof(lift);
          const obsDev = Math.atan2(Math.sin(Math.atan2(F[b][1] - F[a][1], F[b][0] - F[a][0]) - c2.rests[pa]),
                                    Math.cos(Math.atan2(F[b][1] - F[a][1], F[b][0] - F[a][0]) - c2.rests[pa]));
          const rigRest2 = Math.atan2(rg.joints[ch].y - rg.joints[pa].y, rg.joints[ch].x - rg.joints[pa].x);
          const renDev = Math.atan2(Math.sin(Math.atan2(pose2[ch][1] - pose2[pa][1], pose2[ch][0] - pose2[pa][0]) - rigRest2),
                                    Math.cos(Math.atan2(pose2[ch][1] - pose2[pa][1], pose2[ch][0] - pose2[pa][0]) - rigRest2));
          const d = Math.abs(Math.atan2(Math.sin(sgn(pa) * renDev - obsDev), Math.cos(sgn(pa) * renDev - obsDev)));
          if (d > worstS) { worstS = d; worstSB = pa; }
        }
        console.log(`[self-test] profile knee-lift ${lift}: side-aware round-trip worst ${(worstS * 180 / Math.PI).toFixed(2)}° (${worstSB})`);
        if (worstS > Math.PI / 180) fails.push(`profile lift ${lift}: ${(worstS * 180 / Math.PI).toFixed(1)}° > 1°`);
      }
    }
  }
  // 4) outlier cycles dropped: 6 clean + 2 scaled
  {
    const bins = 64;
    const mk = (scale) => ({ a: Float64Array.from({ length: bins }, (_, b) => scale * Math.sin(2 * Math.PI * b / bins)) });
    const cyc = [mk(1), mk(1.02), mk(0.98), mk(1.01), mk(0.99), mk(1), mk(2.4), mk(0.2)];
    const { kept, dropped } = averageCycles(cyc);
    console.log(`[self-test] outlier drop: kept ${kept.length}/8, dropped [${dropped.join(",")}]`);
    if (dropped.length !== 2 || !dropped.includes(6) || !dropped.includes(7)) fails.push(`outlier drop got [${dropped}]`);
  }
  // 5) distill: known smooth loop → table whose linear interp reconstructs
  //    the loop within tolerance, zero net travel on a symmetric drift
  {
    const bins = 64;
    const th = (fn) => Float64Array.from({ length: bins }, (_, b) => fn(b / bins));
    const avg = {
      thetas: {
        kneeL: th((u) => 0.6 * Math.sin(2 * Math.PI * u)),
        ankleR: th((u) => 0.25 * Math.sin(4 * Math.PI * u + 1)),
        chest: th(() => 0.01),                     // below minRange → excluded
      },
      pelvisU: th((u) => 0.03 * Math.sin(2 * Math.PI * u)),
      footY: { L: th((u) => 0.9 - 0.05 * Math.max(0, Math.sin(2 * Math.PI * u))),
               R: th((u) => 0.9 - 0.05 * Math.max(0, -Math.sin(2 * Math.PI * u))) },
      footVX: { L: th(() => 0), R: th(() => 0) },
    };
    const t = distillMove(avg, { bins, bpl: 4, maxKeys: 12, name: "self-test" });
    let worst = 0;
    for (let b = 0; b < bins; b++) {
      const lp = b / bins;
      let i = t.keys.length - 1;
      for (let k = 0; k < t.keys.length; k++) if (t.keys[k].phase <= lp) i = k;
      const a = t.keys[i], nx = t.keys[(i + 1) % t.keys.length];
      const span = (((nx.phase - a.phase) % 1) + 1) % 1 || 1;
      const u = ((((lp - a.phase) % 1) + 1) % 1) / span;
      for (const nm of ["kneeL", "ankleR"]) {
        const va = a.joints[nm]?.rot ?? 0, vb = nx.joints[nm]?.rot ?? 0;
        worst = Math.max(worst, Math.abs(va + (vb - va) * u - avg.thetas[nm][b]));
      }
    }
    const netTravel = t.keys.reduce((s, k) => s + k.travel, 0) / t.keys.length;
    console.log(`[self-test] distill: ${t.keys.length} keys, worst linear-interp err ${worst.toFixed(3)} rad, mean travel ${netTravel.toFixed(4)} u/beat, chest excluded=${!("chest" in t.keys[0].joints)}`);
    if (t.keys.length > 12) fails.push(`distill keys ${t.keys.length} > 12`);
    if (worst > 0.08) fails.push(`distill reconstruction err ${worst.toFixed(3)} rad > 0.08`);
    if ("chest" in t.keys[0].joints) fails.push("sub-range joint not excluded");
    // keepDrift seam regression: constant-rate drift must give a FLAT travel
    // channel — the wrap-sign bug multiplied the seam key by ~bins
    const drift = -0.12;
    const t2 = distillMove({ ...avg, pelvisU: th((u) => drift * u) },
      { bins, bpl: 2, maxKeys: 12, name: "drift", keepDrift: true });
    const tv = t2.keys.map((k) => k.travel);
    const want = drift / 2;                        // u/beat at bpl 2
    const worstTv = Math.max(...tv.map((v) => Math.abs(v - want)));
    console.log(`[self-test] keepDrift seam: travel ${Math.min(...tv).toFixed(3)}..${Math.max(...tv).toFixed(3)} u/beat (want flat ${want.toFixed(3)})`);
    if (worstTv > 0.02) fails.push(`keepDrift travel deviates ${worstTv.toFixed(3)} from flat`);
  }
  // 6) foot gate hold (16.2): masked spans hold last valid, masked prefix
  //    backfills from the first valid sample
  {
    const vals = [9, 1, 2, 3, 4, 5];
    const held = holdWhere(vals, [true, false, false, true, true, false]);
    const want = [1, 1, 2, 2, 2, 5];
    const ok = vals.every((v, i) => v === want[i]) && held === 3;
    console.log(`[self-test] foot gate hold: [${vals}] held=${held} (want [${want}] held=3)`);
    if (!ok) fails.push("holdWhere gating wrong");
  }
  for (const f of fails) console.error(`[self-test] FAIL: ${f}`);
  console.log(`VERIFY:${fails.length ? "FAIL" : "PASS"} mocap-self-test`);
  process.exitCode = fails.length ? 1 : 0;
}
