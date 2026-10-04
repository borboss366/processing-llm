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
 *     --view auto|front|profile  emitted view (default auto = the clip's
 *                               NATURAL view from the frontness score). The
 *                               table is ALWAYS built from the camera plane —
 *                               2D has no rotation (a "de-yaw" is x·cos(yaw),
 *                               a squash). Requesting the other view emits a
 *                               REINTERPRETATION: rot keys become twist keys.
 *     --emit-views a,b          emit several views in one run (first = primary)
 *     --anchor F                extra phase shift 0..1 after auto-anchor
 *     --keep-drift              keep net pelvis drift in `travel` (single-side
 *                               captures of travelling moves; default removes it)
 *     --out <prefix>            output path prefix (default: next to the clip;
 *                               needed when extracting several windows of one clip)
 *     --estimator rtmpose|mediapipe  pose backend (default rtmpose — user
 *                               verdict 2026-09-27; mediapipe = ~3× faster
 *                               and smoother raw, kept for fast passes)
 *     --explorer-json           also dump the explorer dataset as JSON
 *                               (input for tools/mocap/explorer-ab.mjs)
 *     --max-keys N              hard key cap (default 32; budget governs)
 *     --err-budget F            distill error budget, worst-bone RMS rad of
 *                               table vs averaged loop (default 0.04)
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
import { S } from "./lib/landmarks.mjs";
import { foreshortenAll, frontnessRatio } from "./lib/foreshorten.mjs";
import { MP, buildRig, detectYSign, deYaw3, boneTwists, retargetFrame, fkPose, calibMasks, measureRest } from "./lib/retarget.mjs";
import { cycleSpread, angularSpeed, detectPeriod, decideLoop, binCycles, averageCycles } from "./lib/timing.mjs";
import { distillMove, sampleTableAt } from "./lib/distill.mjs";
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
                            "filter", "sg-window", "sg-order", "foot-gate", "enhance", "view", "emit-views", "cycles", "estimator", "estimator-model", "err-budget"]);
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
// absolute retarget (2026-09-28): each view retargets against ITS shape's
// rest geometry — the body the table plays on. Profile = the stage's
// profile body, regardless of --rig (which stays the front shape).
const profileSidecar = JSON.parse(fs.readFileSync(path.join(ROOT, "web/app/shapes/biped-profile.json"), "utf8"));
const profileRig = buildRig(profileSidecar);
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
const estimator = opt("estimator", "rtmpose");       // default per user verdict 2026-09-27; mediapipe kept for fast passes
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
      let j;
      try { j = JSON.parse(line); }
      catch { continue; }                        // estimator libs chat on stdout
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
// per-limb mean keypoint score (18.1 comparison card): the estimator
// decision rides on where each one is guessing
{
  const G = { legL: [9, 11, 13, 15, 17], legR: [10, 12, 14, 16, 18],
              arms: [3, 4, 5, 6, 7, 8], smalltoes: [19, 20] };
  const out = {};
  for (const [g, idxs] of Object.entries(G)) {
    let s2 = 0, n2 = 0;
    for (const f of detected) for (const i2 of idxs) { s2 += f.img[i2][2]; n2++; }
    out[g] = +(s2 / n2).toFixed(3);
  }
  raw.meta.limbScores = out;
  console.log(`[mocap] limb scores: ${JSON.stringify(out)} (smalltoes 0 = estimator lacks them)`);
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
// post-smoothing jitter — same second-difference metric on the STAGE-2
// OUTPUT: what the retarget actually consumes (estimator-card number)
{
  let s = 0, k = 0;
  for (let i = 1; i < img.length - 1; i++) {
    for (let l = 0; l < img[i].length; l++) {
      const ddx = (img[i - 1][l][0] + img[i + 1][l][0] - 2 * img[i][l][0]) * raw.meta.w;
      const ddy = (img[i - 1][l][1] + img[i + 1][l][1] - 2 * img[i][l][1]) * raw.meta.h;
      s += Math.hypot(ddx, ddy) / 2;
      k++;
    }
  }
  raw.meta.jitterPostPx = +(s / k).toFixed(3);
  console.log(`[mocap] landmark jitter post-smoothing: ${raw.meta.jitterPostPx} px mean (raw ${raw.meta.jitterPx})`);
}

// ── view-independent normalization (18.1: 2D-only) ───────────────────────
// world is a DEBUG channel; nothing here may consume its z. Frontness comes
// from WIDTH FORESHORTENING (shoulder width / spine length — measured 0.63
// frontal vs 0.07 profile); facing from the nose score (a face the camera
// can see scores high). Isotropic image coords (x scaled by aspect) so
// angles are true.
const AR = raw.meta.w / raw.meta.h;
const iso = (frames) => frames.map((f) => f.map((p) => [p[0] * AR, p[1]]));
const imgIso = iso(img);
const rawImgIso = iso(rawImg);
const scores = detected.map((f) => f.img.map((p) => p[2]));
const frontRatio = frontnessRatio(imgIso, S);
const facing = median(detected.map((f) => f.img[S.nose][2])) > 0.5;
// legacy world path — kept ONLY for the explorer's world-vs-2D comparison
const ySign = hasWorld ? detectYSign(world) : 1;
const worldN = ySign === 1 ? world : world.map((f) => f.map(([x, y, z]) => [x, -y, -z]));
console.log(`[mocap] frontness ratio ${frontRatio.toFixed(2)} (front ≥ 0.35) · facing ${facing ? "camera" : "away"} · world debug ${hasWorld ? "present" : "absent"}`);

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
  views = [v === "auto" ? (frontRatio >= 0.35 ? "front" : "profile") : normView(v)];
}
console.log(`[mocap] views: ${views.join(" + ")}${opt("view", "auto") === "auto" && !emitV ? " (auto by width foreshortening)" : ""}`);

for (let vi = 0; vi < views.length; vi++) await processView(views[vi], vi === 0);

async function processView(vk, primary) {
  const vBase = primary ? clipBase : `${clipBase}-${vk}`;
  const vName = primary ? moveName : `${moveName}-${vk}`;
  let rawThetaX = null, lagX = null;            // explorer taps (set in the lag block)
  // ── stage 3: VIEW SELECTION ONLY (no rotation exists in 2D) ──────────────
  // With 2D-only landmarks a "rotation by yaw" degenerates to x·cos(yaw) —
  // a squash, not a view. So: the camera plane IS the projection, always;
  // stage 3 only DECIDES the canonical view (frontness score). The analysis
  // always runs in the clip's NATURAL view; a requested view that differs
  // is a table-level REINTERPRETATION at stage 8 (sagittal deviations →
  // the twist channel, rendered by B's cos-foreshortening).
  // The x-flip below is mirror CANONICALIZATION (person's left→right along
  // +x for facing-camera front clips), not a rotation.
  const { natural, reinterpret } = viewDecision(frontRatio, vk);
  if (reinterpret) console.log(`[mocap] view ${vk} ≠ natural ${natural} → REINTERPRETATION (rot→twist at the table level)`);
  // mirror canonicalization (never rotation): front facing-camera clips flip
  // so the person's left→right runs along +x; profile clips flip so the
  // dancer FACES +x — the profile shape's facing, whose geometry is the
  // absolute-retarget reference.
  let profileFacingRaw = 0;
  if (natural === "profile") {
    for (const f of imgIso) {
      profileFacingRaw += (f[MP.toeL][0] - f[MP.heelL][0]) + (f[MP.toeR][0] - f[MP.heelR][0]);
    }
  }
  const xFlip = natural === "front" ? facing : profileFacingRaw < 0;
  const flipF = (frames) => xFlip ? frames.map((f) => f.map((p) => [-p[0], p[1]])) : frames;
  const frontal = flipF(imgIso);

  // ── stage 4: retarget to rig rotations (ABSOLUTE, 2026-09-28) ────────────
  // theta = observedAbs − rigRestAbs(view) × sideSign. The reference is the
  // VIEW shape's own rest geometry (profile body: arms hang ~93°, legs down,
  // feet flat toward +x facing) — the dancer's habitual pose is SIGNAL and
  // transfers to the stage. On the profile shape both feet face +x, so
  // sideSigns resolves to identity by construction.
  const rigV = natural === "profile" ? profileRig : rig;
  const sidecarV = natural === "profile" ? profileSidecar : sidecar;
  let view = null;
  if (natural === "profile") {
    view = { profileFacing: 1 };
    console.log(`[mocap] profile facing ${profileFacingRaw < 0 ? "left → x-flipped to +x" : "right (+x)"} · reference: biped-profile rest geometry`);
  }
  // measured rest: DIAGNOSTIC ONLY since 2026-09-28 (it is the dancer's
  // HABITUAL pose — subtracting it erased sustained postures: collapsed
  // arms, paralytic legs). Kept for the explorer's habitual-vs-reference
  // comparison; lengths for foreshortening calibrate separately.
  const masks = calibMasks(frontal);
  const cal = measureRest(frontal, rigV, mirror, masks);
  {
    const refs = Object.fromEntries(rigV.defs(mirror).map((d) => [d[0], d[4]]));
    const deltas = Object.fromEntries(Object.entries(cal.rests)
      .map(([nm, v]) => [nm, +((((v - refs[nm]) + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI).toFixed(2)]));
    console.log(`[mocap] calib frames global=${masks.global.filter(Boolean).length} legL=${masks.legL.filter(Boolean).length} legR=${masks.legR.filter(Boolean).length}`);
    console.log(`[mocap] habitual−rigRest deltas (rad, DIAGNOSTIC — this is what measured-rest used to erase): ${JSON.stringify(deltas)}`);
  }
  // depth channels (18.1: DERIVED FROM 2D — the estimator's 3D head is not
  // trusted): per-bone signed twist from projected-length foreshortening
  // against stage-4's calibration-frame rest lengths; pelvis/chest yaw from
  // width foreshortening. Sign: continuity through each lobe, score
  // asymmetry at plane crossings, hold when silent — decisions counted.
  const legLName = mirror ? "R" : "L";   // person side feeding rig L
  const maskFor = (nm) => /L$/.test(nm) ? (legLName === "L" ? masks.legL : masks.legR)
    : /R$/.test(nm) ? (legLName === "L" ? masks.legR : masks.legL)
    : masks.global;
  const fore = foreshortenAll(frontal, scores, rigV.defs(mirror), maskFor, S);
  console.log(`[mocap] foreshorten sign decisions: ${JSON.stringify(fore.log)}`);
  const twistFrames = frontal.map((_, i) =>
    Object.fromEntries(Object.entries(fore.twists).map(([nm, s2]) => [nm, s2[i]])));
  const yawFrames = frontal.map((_, i) =>
    ({ pelvis: fore.yaws.pelvis[i], chest: fore.yaws.chest[i] }));
  const footYawOf = (i, rigSide) => twistFrames[i][`ankle${rigSide}`] ?? 0;
  // world-derived twist — EXPLORER COMPARISON ONLY (acceptance plot)
  const twistWorldFrames = hasWorld
    ? worldN.map((f) => boneTwists(deYaw3(f, 0), rigV, mirror)) : null;

  const thetaFrames = frontal.map((f) => retargetFrame(f, rigV, mirror, view));

  // foot-length gating (16.2 item 1; 18.1 made 2D-only): where the
  // projected heel→toe length collapses vs the MEASURED rest length (the
  // foot pointing at the camera), the 2D ankle angle is atan2 of noise —
  // hold the last valid sample. (The old ratio divided image-space by
  // metric-3D — meaningless once the projection went image-based.)
  const FOOT_GATE = +opt("foot-gate", 0.35);
  {
    const gateLog = {};
    var gateMasks = {};                       // 18.2 overlays: per-frame gate
    for (const rigSide of ["L", "R"]) {
      const p = mirror ? (rigSide === "L" ? "R" : "L") : rigSide;
      const restLen = fore.restLens[`ankle${rigSide}`] || 1;
      const mask = frontal.map((f2) => {
        const h2 = f2[MP[`heel${p}`]], t2 = f2[MP[`toe${p}`]];
        return Math.hypot(t2[0] - h2[0], t2[1] - h2[1]) / restLen < FOOT_GATE;
      });
      const series = thetaFrames.map((f2) => f2[`ankle${rigSide}`]);
      const held = holdWhere(series, mask);
      thetaFrames.forEach((f2, i) => { f2[`ankle${rigSide}`] = series[i]; });
      gateLog[`ankle${rigSide}`] = held;
      gateMasks[`ankle${rigSide}`] = mask.map(Number);
    }
    console.log(`[mocap] foot gate (<${FOOT_GATE}): held ${JSON.stringify(gateLog)} of ${thetaFrames.length} frames`);
  }

  // (the 2026-09-20 ankle re-centering is gone: measured-rest calibration
  // subsumes it — the ankle's planted median IS the stance neutral)

  // rotLimit clamp report (2026-09-20; recontextualized 2026-09-28): under
  // ABSOLUTE retarget thetas carry the habitual offset too, so a clamp hit
  // can be either a reference smell OR a real "the engine's limit is tighter
  // than this dancer's pose" finding — report it either way, judge per case
  {
    const lim = { shoulder: 3.15, elbow: 2.4, hip: 0.9, knee: 2.0, ankle: 1.0,
                  ...(sidecarV.rotLimits ?? {}) };
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


  // ── lag diagnostic: filtered pipeline vs a RAW parallel path ─────────────
  // Cross-correlate joint-angle signals; peak at lag>0 = rig lags source.
  // Reported whole-window + per-third (constant vs drifting).
  {
    const rawFrontal = flipF(rawImgIso);
    const rawTheta = rawFrontal.map((f) => retargetFrame(f, rigV, mirror, view));
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
  channels["yw:pelvis"] = uni(yawFrames.map((f) => f.pelvis));
  channels["yw:chest"] = uni(yawFrames.map((f) => f.chest));
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
  // --cycles N declares the FULL-loop count for the window: when the ×2
  // L/R test would break that count, the human wins — on weak-ac clips
  // (running_man_3: ac 0.23) the halves-differ test misfires and the
  // doubled loop no longer fits the window
  if (cyclesPrior && loop.mult > 1) {
    const target = (winB - winA) / +cyclesPrior;
    if (Math.abs(per.period - target) < Math.abs(period - target)) {
      console.log(`[mocap] ×${loop.mult} overridden by --cycles ${cyclesPrior}: base ${per.period.toFixed(3)}s already matches window/${cyclesPrior} = ${target.toFixed(3)}s`);
      period = per.period;
      loop.mult = 1;
    }
  }
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
  let anchorSec = ((calmBin / BINS) + (+opt("anchor", 0))) % 1 * period;

  // ── stage 6: cycle average with outlier drop ─────────────────────────────
  let cycles = binCycles(channels, fsHz, period, anchorSec, BINS);
  // OCTAVE GUARD (19 3.1b follow-through): if reps only agree when the loop
  // is DOUBLED, the detected loop caught a single half — the runningman's
  // 0.665 s "loop" was one STEP, so L-steps averaged with R-steps and the
  // stride halved (the table ghost's lost amplitude). Direct evidence test:
  // re-bin at 2× and adopt it when the cycle spread collapses.
  if (cycles.length >= 2) {
    // judge on the THETA channels only — footVX/pelvisU are different units
    // and dilute the ratio
    const thOnly = (cys) => cys.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith("th:"))));
    const s1 = cycleSpread(thOnly(cycles));
    // anchor mod the base period — a late anchor leaves too little window
    // for 2 doubled cycles; which HALF leads is then ambiguous, and the
    // full-circle alignment resolves it
    const anchor2 = anchorSec % period;
    const cyc2 = binCycles(channels, fsHz, period * 2, anchor2, BINS);
    if (cyc2.length >= 2) {
      const s2 = cycleSpread(thOnly(cyc2));
      if (s2 < 0.6 * s1) {
        console.log(`[mocap] loop DOUBLED by cycle-consistency: spread ${s1.toFixed(3)} → ${s2.toFixed(3)} rad · period ${period.toFixed(3)} → ${(period * 2).toFixed(3)} s · anchor ${anchorSec.toFixed(3)} → ${anchor2.toFixed(3)}`);
        period *= 2;
        anchorSec = anchor2;
        cycles = cyc2;
      }
    } else if (cycles.length >= 3) {
      // window fits only ONE doubled cycle — use the PARITY signature
      // instead: if consecutive half-cycles are the two halves of a bigger
      // loop (L-step vs R-step), same-parity cycles agree and cross-parity
      // don't. Then the doubled loop IS meanEven ++ meanOdd.
      const chNames = Object.keys(cycles[0]);
      const dist = (a2, b2) => {
        let s3 = 0, k3 = 0;
        for (const nm of chNames) { if (!nm.startsWith("th:")) continue;
          for (let b3 = 0; b3 < BINS; b3++) { s3 += (a2[nm][b3] - b2[nm][b3]) ** 2; k3++; } }
        return Math.sqrt(s3 / k3);
      };
      let same = 0, cross = 0, nS = 0, nC = 0;
      for (let i2 = 0; i2 < cycles.length; i2++) for (let j2 = i2 + 1; j2 < cycles.length; j2++) {
        if ((j2 - i2) % 2 === 0) { same += dist(cycles[i2], cycles[j2]); nS++; }
        else { cross += dist(cycles[i2], cycles[j2]); nC++; }
      }
      same = nS ? same / nS : 0; cross = nC ? cross / nC : 0;
      var parityMerged = false;
      if (nS && nC && cross > 1.8 * same) {
        parityMerged = true;
        const half = (par) => {
          const m = {};
          const members = cycles.filter((_, i2) => i2 % 2 === par);
          for (const nm of chNames) m[nm] = Float64Array.from({ length: BINS }, (_, b3) =>
            members.reduce((a2, c3) => a2 + c3[nm][b3], 0) / members.length);
          return m;
        };
        const E = half(0), O = half(1);
        const merged = {};
        for (const nm of chNames) merged[nm] = Float64Array.from({ length: BINS }, (_, b3) => {
          const src2 = b3 < BINS / 2 ? E : O;
          return src2[nm][(b3 % (BINS / 2)) * 2];
        });
        console.log(`[mocap] loop DOUBLED by parity: cross-parity spread ${cross.toFixed(3)} vs same-parity ${same.toFixed(3)} rad (${cycles.length} half-cycles → evenMean ++ oddMean) · period ${period.toFixed(3)} → ${(period * 2).toFixed(3)} s`);
        period *= 2;
        cycles = [merged];
      }
    }
  }
  const { mean, kept, dropped, shifts } = averageCycles(cycles);
  if (shifts?.some((s2) => s2 !== 0)) {
    console.log(`[mocap] cycle alignment (3.1b): shifts ${JSON.stringify(shifts)} bins (xcorr vs median before averaging)`);
  }
  console.log(`[mocap] cycles: ${cycles.length} → kept ${kept.length}, dropped [${dropped.join(",")}]`);
  if (kept.length < 2 && !(typeof parityMerged !== "undefined" && parityMerged)) {
    console.error(`[mocap] fewer than 2 clean cycles in the window. Detected loop ${period.toFixed(3)}s`
      + ` (autocorrelation strength ${per.strength.toFixed(2)}${per.strength < 0.4 ? " — WEAK, likely an octave/period miss" : ""}).`);
    console.error("[mocap] fixes, in order: (1) count the full L+R loops you see in the window and pass"
      + " --cycles N (pins the period search); (2) check --bpl matches the move's musical rate;"
      + " (3) widen or tighten the --window to clean repetitions only.");
    process.exit(1);
  }

  // ── stage 7: distill to the standard table ────────────────────────────────
  const thetasAvg = {};
  for (const nm of ARTICULATED) thetasAvg[nm] = mean[`th:${nm}`];
  const twistAvg = {};
  for (const nm of ARTICULATED) twistAvg[nm] = mean[`tw:${nm}`];
  const yawAvg = { pelvis: mean["yw:pelvis"], chest: mean["yw:chest"] };
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
    const pose = fkPose(rigV, Object.fromEntries(ARTICULATED.map((nm) => [nm, thetasAvg[nm][b]])));
    fkFY.L[b] = pose.footL[1]; fkFY.R[b] = pose.footR[1];
    fkFX.L[b] = pose.footL[0]; fkFX.R[b] = pose.footR[0];
  }
  const circD = (arr) => Float64Array.from(arr, (_, b) =>
    (arr[(b + 1) % BINS] - arr[(b - 1 + BINS) % BINS]) / 2);
  const contactDebug = {};                    // 18.2 overlays: bins + band
  for (const s of ["L", "R"]) {
    const range = Math.max(...fkFY[s]) - Math.min(...fkFY[s]);
    const band = range < 0.04 ? range : Math.max(0.02, 0.25 * range);   // mirror of distill's rule
    contactDebug[s] = { fy: Array.from(fkFY[s], (v) => +v.toFixed(4)),
                        band: +band.toFixed(4), hi: +Math.max(...fkFY[s]).toFixed(4),
                        pivot: range < 0.04 };
    console.log(`[mocap] fk foot${s}: y-range ${range.toFixed(3)} u (contact band ${band.toFixed(3)}${range < 0.04 ? ", pivot foot: all planted" : ""})`);
  }
  const table = distillMove({
    thetas: thetasAvg,
    twists: twistAvg,
    yaws: yawAvg,
    pelvisU: pelvisAvg,
    footY: { L: fkFY.L, R: fkFY.R },
    footVX: { L: circD(fkFX.L), R: circD(fkFX.R) },
  }, { bins: BINS, bpl, maxKeys: +opt("max-keys", 32), errBudget: +opt("err-budget", 0.04),
       name: vName, keepDrift: flag("keep-drift") });
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
  estimator, limbScores: raw.meta.limbScores, jitterPx: raw.meta.jitterPx,
  jitterPostPx: raw.meta.jitterPostPx,
    filter: filterMode === "oneeuro" ? { mode: "oneeuro", ...euro } : { mode: filterMode, ...sg },
    fps: raw.meta.fps,
    timing: { route: timingRoute, period: +period.toFixed(4), bpl,
              bpm: beatSec ? +(60 / beatSec).toFixed(2) : null,
              anchorSec: +anchorSec.toFixed(4), acStrength: +per.strength.toFixed(3),
              cycles: cycles.length, kept: kept.length, dropped },
    foreshorten: { signDecisions: fore.log,
    restLens: Object.fromEntries(Object.entries(fore.restLens).map(([k, v]) => [k, +v.toFixed(4)])) },
  // habitualPose = measured rest, DIAGNOSTIC only (2026-09-28); restRef =
    // the rig rest angles the absolute retarget actually subtracts
    habitualPose: {
      rests: Object.fromEntries(Object.entries(cal.rests).map(([k, v]) => [k, +v.toFixed(4)])),
      counts: cal.counts, fallbacks: cal.fallbacks,
    },
    restRef: Object.fromEntries(rigV.defs(mirror).map((d) => [d[0], +d[4].toFixed(4)])),
    // 18.2: per-frame/bin debug for on-frame overlays — offline only
    debug: { signSrc: Object.fromEntries(Object.entries(fore.twistSrcs ?? {}).map(([nm, s2]) => [nm, Array.from(s2)])),
             gateMasks: typeof gateMasks !== "undefined" ? gateMasks : null,
             contactDebug },
    frames: detected.map((f, i) => ({
      t: +times[i].toFixed(4),
      conf: +conf[i].toFixed(3),
      thetas: Object.fromEntries(ARTICULATED.map((nm) => [nm, +thetaFrames[i][nm].toFixed(4)])),
      pelvisU: +pelvisU[i].toFixed(4),
      footYaw: { L: +footYawOf(i, "L").toFixed(4), R: +footYawOf(i, "R").toFixed(4) },
      twist: Object.fromEntries(Object.entries(twistFrames[i]).map(([nm, v]) => [nm, +v.toFixed(4)])),
      yaw2d: { pelvis: +yawFrames[i].pelvis.toFixed(4), chest: +yawFrames[i].chest.toFixed(4) },
      ...(twistWorldFrames ? { twistWorld: Object.fromEntries(Object.entries(twistWorldFrames[i]).map(([nm, v]) => [nm, +v.toFixed(4)])) } : {}),
    })),
  };
  fs.writeFileSync(`${vBase}.poses.json`, JSON.stringify(poses));
  // R1 rung (brief 19 3.1a): per-bone RMS of the TABLE sampled at each
  // frame's phase vs the raw per-frame retarget, plus the AVERAGING FLOOR
  // (avg loop vs raw) — the part no loop table can beat (cycle variation)
  {
    const wrapR = (x) => Math.atan2(Math.sin(x), Math.cos(x));
    const accT = {}, accA = {};
    for (let i = 0; i < thetaFrames.length; i++) {
      const ph = ((((times[i] - times[0] - anchorSec) / period) % 1) + 1) % 1;
      const th = sampleTableAt(table, ph);
      const b = Math.min(BINS - 1, Math.floor(ph * BINS));
      for (const nm of ARTICULATED) {
        const raw2 = thetaFrames[i][nm];
        accT[nm] = (accT[nm] ?? 0) + wrapR((th[nm] ?? 0) - raw2) ** 2;
        accA[nm] = (accA[nm] ?? 0) + wrapR(thetasAvg[nm][b] - raw2) ** 2;
      }
    }
    const rms = (acc2) => Object.fromEntries(Object.entries(acc2).map(([nm, v]) => [nm, Math.sqrt(v / thetaFrames.length)]));
    const rT = rms(accT), rA = rms(accA);
    const all = (r) => Math.sqrt(Object.values(r).reduce((a2, v) => a2 + v * v, 0) / Object.keys(r).length);
    const worst = Object.entries(rT).sort((a2, b2) => b2[1] - a2[1])[0];
    console.log(`[mocap] R1 table-vs-raw: ALL ${all(rT).toFixed(3)} rad (avg-floor ${all(rA).toFixed(3)}, distill adds ${(all(rT) - all(rA)).toFixed(3)}) · worst ${worst[0]} ${worst[1].toFixed(3)} · keys ${table.keys.length}`);
  }
  const { _netDriftUnits, ...moveOut } = table;
  moveOut.view = vk;
  moveOut.estimator = estimator;
  // reinterpretation (stage 3's contract): the requested view differs from
  // the natural one — the requested view's in-plane deviations are
  // unobserved (≈0); the observed deviations are OUT-OF-PLANE there, so
  // every rot key becomes a twist key (clamped ±2). Positional channels
  // (dx/dy/travel: in the natural plane) and foreshortening twists (the
  // other plane, sign-ambiguous) do not transfer; contacts/ease do.
  if (reinterpret) {
    moveOut.reinterpreted = `from-${natural}`;
    moveOut.keys = reinterpretKeys(moveOut.keys);
    console.log(`[mocap] reinterpreted table: ${moveOut.keys.reduce((a2, k) => a2 + Object.keys(k.joints).length, 0)} twist keys, rot channels empty by design`);
  }
  moveOut.provenance = { clip: path.basename(video), clipSha: clipHash, window: [winA, winB],
                         mirror, cyclesKept: kept.length, cyclesDropped: dropped.length,
                         netDriftUnits: _netDriftUnits, pipeline: "tools/mocap/extract.mjs" };
  fs.writeFileSync(`${vBase}.move.json`, JSON.stringify(moveOut, null, 2));
  console.log(`[mocap] wrote ${path.basename(vBase)}.poses.json + .move.json (clip sha ${clipHash})`);

  // ── stage 9: QA video ─────────────────────────────────────────────────────
  if (primary && !flag("no-qa")) {
    // FK over the body the STAGE will use — same geometry the retarget
    // references (rigV), so calibration pose == rig rest by construction
    const bones = sidecarV.joints.filter((j) => j.parent).map((j) => [j.name, j.parent]);
    const spec = {
      video: path.resolve(video), out: `${vBase}.qa.mp4`,
      w: raw.meta.w, h: raw.meta.h, fps: raw.meta.fps,
      period, anchorSec, t0: times[0], bpl, beatSec,
      droppedCycles: dropped, bones,
      ground: sidecarV.ground ?? 0.905,
      // extracted pelvis drift about the window mean, shape units — the QA
      // ground marker (16.2 item 4) makes travel capture visible
      pelvisDrift: (() => {
        const m = pelvisU.reduce((a, b) => a + b, 0) / pelvisU.length;
        return pelvisU.map((v) => +(v - m).toFixed(4));
      })(),
      frames: detected.map((f, i) => {
        // rig-anchored render: theta = obs − measured human rest, so the
        // calibration pose draws AS the view-correct rig's rest pose —
        // exactly what the stage does with this table
        const pose = fkPose(rigV, thetaFrames[i]);
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
  // reinterpreted views get their own page (stage 3 must show the twist
  // traces the reinterpretation produced); other secondary views share the
  // primary's analysis exactly, so a second page would be a duplicate.
  if ((primary || reinterpret) && !flag("no-explorer")) {
    const r3 = (v) => +(+v).toFixed(3);
    const cropStr = raw.meta.crop ? raw.meta.crop.join(",") : "full";
    let frames0 = { frames: [], crop: raw.meta.crop ?? [0, 0, raw.meta.w, raw.meta.h] };
    try {
      const out = await new Promise((resolve, reject) => {
        let buf2 = "";
        const p2 = spawn(py, [path.join(HERE, "frame_dump.py"), video, String(winA), String(winB), cropStr, "40"]);
        p2.stdout.on("data", (d) => { buf2 += d; });
        p2.on("close", (c) => c === 0 ? resolve(JSON.parse(buf2)) : reject(new Error("frame_dump " + c)));
      });
      frames0 = out;
    } catch (e) { console.warn("[mocap] explorer frame dump failed (page still written):", e.message); }
    const boneOf = (nm) => nm === "chest" ? ["pelvis", "chest"] : nm === "neck" ? ["chest", "neck"]
      : /^shoulder/.test(nm) ? [nm, "elbow" + nm.slice(-1)] : /^elbow/.test(nm) ? [nm, "hand" + nm.slice(-1)]
      : /^hip/.test(nm) ? [nm, "knee" + nm.slice(-1)] : /^knee/.test(nm) ? [nm, "ankle" + nm.slice(-1)]
      : [nm, "foot" + nm.slice(-1)];
    const defRows = rigV.defs(mirror);
    const defLen = {}, declared = {};
    for (const [nm, , , , restDecl] of defRows) {
      const [ja, jb] = boneOf(nm);
      defLen[nm] = r3(Math.hypot(rigV.joints[jb].x - rigV.joints[ja].x, rigV.joints[jb].y - rigV.joints[ja].y));
      declared[nm] = r3(restDecl);
    }
    const sgnFn = sideSigns(rigV, view);
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
        params: { estimator, filter: filterMode, sgWindow: sg.window, sgOrder: sg.order, enhance,
                  footGate: FOOT_GATE, bpl, maxKeys: +opt("max-keys", 32), errBudget: +opt("err-budget", 0.04), cycles: opt("cycles", null) } },
      crop: frames0.crop, vidW: raw.meta.w, vidH: raw.meta.h, scale: raw.meta.cropScale ?? 1,
      jitter: raw.meta.jitterPx ?? 0,
      jitterPost: raw.meta.jitterPostPx ?? 0,
      limbScores: raw.meta.limbScores ?? {},
      // T2.3 fore-vs-world twist overlay: 2D-derived signed twist vs the
      // estimator's own 3D (mediapipe only — null on 2D-only estimators)
      // fore.twists are typed arrays — Array.from, or JSON turns them into {"0":..} objects
      twistFore: Object.fromEntries(Object.entries(fore.twists).map(([nm, s2]) => [nm, Array.from(s2, r3)])),
      // 18.2 overlay plumbing: sign sources (0 dead, 1 continuity, 2 score,
      // 3 hold), foreshortening rest lengths, raw landmarks, gate masks,
      // contact bins, the rig tree for in-page FK, loop timing
      signSrc: Object.fromEntries(Object.entries(fore.twistSrcs ?? {}).map(([nm, s2]) => [nm, Array.from(s2)])),
      restLens: Object.fromEntries(Object.entries(fore.restLens).map(([k, v]) => [k, +v.toFixed(4)])),
      imgRaw: rawImg.map((f) => f.map((p) => [r3(p[0]), r3(p[1])])),
      gateMasks: typeof gateMasks !== "undefined" ? gateMasks : null,
      contactDebug,
      rigJoints: Object.fromEntries(sidecarV.joints.map((j) => [j.name, [r3(j.x), r3(j.y)]])),
      rigParent: Object.fromEntries(sidecarV.joints.map((j) => [j.name, j.parent ?? null])),
      anchorSec: +anchorSec.toFixed(4), loopSec: +(period).toFixed(4),
      twistWorld: twistWorldFrames
        ? Object.fromEntries(Object.keys(fore.twists).map((nm) => [nm, twistWorldFrames.map((f) => r3(f[nm] ?? 0))]))
        : null,
      frames0: frames0.frames,
      times: times.map(r3),
      img: img.map((f, i) => f.map((p, l) => [r3(p[0]), r3(p[1]), r3(detected[i].img[l][2])])),
      world: worldN.map((f) => f.map((p) => p.map(r3))),
      frontal: frontal.map((f) => f.map((p) => p.map(r3))),
      rawTheta: Object.fromEntries(ARTICULATED.map((nm) => [nm, rawThetaX.map((f) => r3(f[nm]))])),
      theta: Object.fromEntries(ARTICULATED.map((nm) => [nm, thetaFrames.map((f) => r3(f[nm]))])),
      lag: lagX ?? { whole: 0, thirds: [] },
      frontness: +frontRatio.toFixed(2),
      natural, reinterpret,
      // per-frame frontness (shoulder width / spine length) — stage 3's trace
      frontSeries: imgIso.map((f) => {
        const sw = Math.hypot(f[S.shoulderR][0] - f[S.shoulderL][0], f[S.shoulderR][1] - f[S.shoulderL][1]);
        const hm = [(f[S.hipL][0] + f[S.hipR][0]) / 2, (f[S.hipL][1] + f[S.hipR][1]) / 2];
        const sm = [(f[S.shoulderL][0] + f[S.shoulderR][0]) / 2, (f[S.shoulderL][1] + f[S.shoulderR][1]) / 2];
        return r3(sw / (Math.hypot(sm[0] - hm[0], sm[1] - hm[1]) || 1e-6));
      }),
      masks: { global: masks.global.map(Number), legL: masks.legL.map(Number), legR: masks.legR.map(Number) },
      // measured = the dancer's HABITUAL pose (diagnostic); restRef = the rig
      // rest angles actually subtracted (absolute retarget 2026-09-28)
      rests: { measured: Object.fromEntries(Object.entries(cal.rests).map(([k, v]) => [k, r3(v)])),
               declared, counts: cal.counts, fallbacks: cal.fallbacks },
      restRef: declared,
      defs: defRows.map(([nm, parent, a, b]) => [nm, parent, a, b]),
      defLen,
      sideSigns: Object.fromEntries(defRows.map(([nm]) => [nm, sgnFn(nm)])),
      rotLimits: { shoulder: 3.15, elbow: 2.4, hip: 0.9, knee: 2.0, ankle: 1.0, ...(sidecarV.rotLimits ?? {}) },
      period: { ...per.debug, chosen: +period.toFixed(4), mult: loop.mult,
                cyclesPrior: opt("cycles", null), anchorSec: +anchorSec.toFixed(3) },
      // 18.2: ALL articulated joints (onion-skin ghosts FK whole skeletons)
      cycles: { data: Object.fromEntries(ARTICULATED.filter((j) => cycles[0] && cycles[0]["th:" + j])
                  .map((j) => [j, cycles.map((c) => Array.from(c["th:" + j]).map(r3))])),
                kept, dropped },
      avg: Object.fromEntries(Object.entries(thetasAvg).map(([k, v]) => [k, Array.from(v).map(r3)])),
      distill: { keyPhases: kp, keyCount: table.keys.length, rms: +Math.sqrt(rmsAcc / Math.max(1, rmsN)).toFixed(3) },
      table: moveOut,
    };
    if (flag("explorer-json")) fs.writeFileSync(`${vBase}.explorer-data.json`, JSON.stringify(Dx));
    fs.writeFileSync(`${vBase}.explorer.html`, renderExplorer(Dx));
    console.log(`[mocap] wrote ${path.basename(vBase)}.explorer.html (${(fs.statSync(`${vBase}.explorer.html`).size / 1e6).toFixed(1)} MB)`);
  }

}

function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

// stage-3 gate: the natural view comes from frontness alone; a requested
// view only REINTERPRETS when it differs. Matched view = STRICT IDENTITY —
// in-plane channels untouched, twist from foreshortening only.
function viewDecision(frontRatio, vk) {
  const natural = frontRatio >= 0.35 ? "front" : "profile";
  return { natural, reinterpret: vk !== natural };
}

// stage-8 reinterpretation: rot keys become twist keys (clamped ±2); joints
// left with only in-plane channels (dx/dy) drop; travel (natural-plane) zeroes;
// contacts/ease pass through untouched.
function reinterpretKeys(keys) {
  return keys.map((k) => ({
    ...k,
    travel: 0,
    joints: Object.fromEntries(Object.entries(k.joints).flatMap(([nm, ch]) => {
      const tw = ch.rot != null ? Math.max(-2, Math.min(2, ch.rot)) : null;
      return tw != null && Math.abs(tw) > 0.02 ? [[nm, { twist: +tw.toFixed(3) }]] : [];
    })),
  }));
}

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
    // ── absolute-retarget suite (2026-09-28): reference = the PROFILE
    // shape's own geometry; facing canonicalized to +x upstream ──
    const rgP = buildRig(JSON.parse(fs.readFileSync(path.join(ROOT, "web/app/shapes/biped-profile.json"), "utf8")));
    const viewP = { profileFacing: 1 };
    // canonical profile synthetic: legs down, feet FORWARD (+x); optional
    // whole-leg swing forward; arms configurable (armAng absolute, rad)
    const prof = (lift, armAng = Math.PI / 2) => {
      const f = [];
      const leg = (s, dx) => {
        f[MP[`hip${s}`]] = [dx, 0.5]; f[MP[`knee${s}`]] = [dx, 0.75];
        f[MP[`ankle${s}`]] = [dx, 1.0]; f[MP[`heel${s}`]] = [dx - 0.01, 1.02];
        f[MP[`toe${s}`]] = [dx + 0.09, 1.02];               // feet point +x
      };
      leg("L", 0); leg("R", 0.02);
      if (lift) {
        f[MP[`knee${lift}`]] = [f[MP[`hip${lift}`]][0] + 0.16, 0.69];
        f[MP[`ankle${lift}`]] = [f[MP[`knee${lift}`]][0] + 0.05, 0.93];
        f[MP[`heel${lift}`]] = [f[MP[`ankle${lift}`]][0] - 0.01, 0.95];
        f[MP[`toe${lift}`]] = [f[MP[`ankle${lift}`]][0] + 0.09, 0.95];
      }
      for (const [s, dx] of [["L", 0], ["R", 0.02]]) {
        f[MP[`shoulder${s}`]] = [dx, 0.1];
        f[MP[`elbow${s}`]] = [dx + 0.14 * Math.cos(armAng), 0.1 + 0.14 * Math.sin(armAng)];
        f[MP[`wrist${s}`]] = [dx + 0.28 * Math.cos(armAng), 0.1 + 0.28 * Math.sin(armAng)];
      }
      f[MP.earL] = [0, 0]; f[MP.earR] = [0.02, 0]; f[MP.nose] = [0.05, 0.01];
      return f;
    };
    // profile feet vs reference (palsy-foot heir): forward feet retargeted
    // against the profile shape read near-flat; against the FRONT shape the
    // off-side foot reads ~π (why the reference must be the view's body)
    const stand = prof(null);
    const thProf = retargetFrame(stand, rgP, false, viewP);
    const thFront = retargetFrame(stand, rg, false);
    const maxProf = Math.max(Math.abs(thProf.ankleL), Math.abs(thProf.ankleR));
    const maxFront = Math.max(Math.abs(thFront.ankleL), Math.abs(thFront.ankleR));
    console.log(`[self-test] profile feet vs reference: |ankle| ${maxProf.toFixed(2)} rad on profile shape (front shape reads ${maxFront.toFixed(2)})`);
    if (maxProf > 0.5) fails.push(`profile ankle theta ${maxProf.toFixed(2)} rad — profile-shape reference not applied`);
    if (maxFront < 2) fails.push("front-shape control did not show the ~π off-side foot");
    // HABITUAL POSE SURVIVES (2026-09-28 root cause): a clip whose MEAN pose
    // is arms-FORWARD must retarget to arms-forward — NOT to the rig's rest.
    // (measured-rest calibration subtracted exactly this and collapsed the
    // arms; this is its anti-test.)
    {
      const fwd = prof(null, 0);                        // arms horizontal +x, all frames
      const clip = Array.from({ length: 12 }, () => fwd);
      const thF = clip.map((f) => retargetFrame(f, rgP, false, viewP));
      const mean = thF.reduce((a2, t) => a2 + t.shoulderL, 0) / thF.length;
      const poseF = fkPose(rgP, thF[0]);
      const armAbs = Math.atan2(poseF.elbowL[1] - poseF.shoulderL[1], poseF.elbowL[0] - poseF.shoulderL[0]);
      const ok = Math.abs(Math.atan2(Math.sin(armAbs), Math.cos(armAbs))) < 1e-6 && Math.abs(mean) > 1;
      console.log(`[self-test] habitual pose survives: arms-forward clip renders arm at ${(armAbs * 180 / Math.PI).toFixed(2)}° abs (want 0° = forward, NOT the rig's ~93° rest; mean shoulder theta ${mean.toFixed(2)} rad)`);
      if (!ok) fails.push("arms-forward clip must retarget to arms-forward, not the rig rest");
    }
    // measured rest as DIAGNOSTIC: on a static clip it must report the
    // observed angles exactly (it feeds the explorer comparison), fallbacks 0
    {
      const staticClip = Array.from({ length: 12 }, () => stand);
      const m = calibMasks(staticClip);
      const c = measureRest(staticClip, rgP, false, m);
      let worstD = 0;
      const angOf = (a, b) => Math.atan2(stand[b][1] - stand[a][1], stand[b][0] - stand[a][0]);
      for (const [nm, a, b] of [["hipL", MP.hipL, MP.kneeL], ["ankleR", MP.heelR, MP.toeR], ["shoulderL", MP.shoulderL, MP.elbowL]]) {
        const d = Math.abs(Math.atan2(Math.sin(c.rests[nm] - angOf(a, b)), Math.cos(c.rests[nm] - angOf(a, b))));
        if (d > worstD) worstD = d;
      }
      console.log(`[self-test] measured rest (diagnostic): reports observed angles within ${worstD.toExponential(2)} rad, fallbacks [${c.fallbacks}]`);
      if (worstD > 1e-9) fails.push("measured-rest diagnostic drifted from observed angles");
      if (c.fallbacks.length) fails.push(`measured-rest diagnostic fell back on [${c.fallbacks}]`);
    }
    // profile knee-lift, BOTH sides: under absolute retarget on the profile
    // shape every rendered bone's ABSOLUTE angle must equal the observed
    // absolute angle exactly (sideSigns = identity on a same-facing shape)
    for (const lift of ["L", "R"]) {
      const F = prof(lift);
      const th2 = retargetFrame(F, rgP, false, viewP);
      const pose2 = fkPose(rgP, th2);
      let worstS = 0, worstSB = "";
      for (const [pa, ch, a, b] of [[`hip${lift}`, `knee${lift}`, MP[`hip${lift}`], MP[`knee${lift}`]],
                                    [`knee${lift}`, `ankle${lift}`, MP[`knee${lift}`], MP[`ankle${lift}`]],
                                    [`ankle${lift}`, `foot${lift}`, MP[`heel${lift}`], MP[`toe${lift}`]],
                                    ["shoulderL", "elbowL", MP.shoulderL, MP.elbowL]]) {
        const obsA = Math.atan2(F[b][1] - F[a][1], F[b][0] - F[a][0]);
        const renA = Math.atan2(pose2[ch][1] - pose2[pa][1], pose2[ch][0] - pose2[pa][0]);
        const d = Math.abs(Math.atan2(Math.sin(renA - obsA), Math.cos(renA - obsA)));
        if (d > worstS) { worstS = d; worstSB = pa; }
      }
      console.log(`[self-test] profile knee-lift ${lift}: absolute-angle round-trip worst ${(worstS * 180 / Math.PI).toFixed(2)}° (${worstSB})`);
      if (worstS > Math.PI / 180) fails.push(`profile lift ${lift}: ${(worstS * 180 / Math.PI).toFixed(1)}° > 1°`);
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
  // 4b) cycle ALIGNMENT (19 3.1b): reps landing ±5 bins off the phase grid
  //     must average to full amplitude — unaligned they smear
  {
    const bins = 64;
    const mkS = (shift) => ({ a: Float64Array.from({ length: bins }, (_, b) => Math.sin(2 * Math.PI * ((b + shift) % bins) / bins)) });
    const cyc = [mkS(0), mkS(5), mkS(-5), mkS(3), mkS(-3)];
    const amp = (m) => Math.max(...m.a) - Math.min(...m.a);
    const aligned = averageCycles(cyc, { align: true });
    const unaligned = averageCycles(cyc, { align: false });
    console.log(`[self-test] cycle alignment: amp ${amp(aligned.mean).toFixed(3)} aligned vs ${amp(unaligned.mean).toFixed(3)} unaligned (true 2.0) · shifts [${aligned.shifts}]`);
    if (amp(aligned.mean) < 1.97) fails.push(`aligned amplitude ${amp(aligned.mean).toFixed(3)} < 1.97`);
    if (amp(unaligned.mean) > amp(aligned.mean) - 0.02) fails.push("alignment did not beat the unaligned mean");
    // half-loop swap (the runningman stride-loss case): alternate reps
    // sliced on the wrong half must snap back
    const asym = (shift) => ({ a: Float64Array.from({ length: bins }, (_, b) => {
      const u = ((b + shift) % bins) / bins;
      return u < 0.5 ? Math.sin(2 * Math.PI * u * 2) : 0.25 * Math.sin(2 * Math.PI * (u - 0.5) * 2);
    }) });
    const cyc2 = [asym(0), asym(bins / 2), asym(0)];
    const fixed = averageCycles(cyc2, { align: true });
    const broken = averageCycles(cyc2, { align: false });
    console.log(`[self-test] half-loop swap: amp ${amp(fixed.mean).toFixed(2)} aligned vs ${amp(broken.mean).toFixed(2)} unaligned (true 2.00) · shifts [${fixed.shifts}]`);
    if (amp(fixed.mean) < 1.9) fails.push(`half-loop swap not recovered: amp ${amp(fixed.mean).toFixed(2)}`);
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
        shoulderL: th(() => 0.8),                  // flat HABITUAL hold → constant keys
      },
      pelvisU: th((u) => 0.03 * Math.sin(2 * Math.PI * u)),
      footY: { L: th((u) => 0.9 - 0.05 * Math.max(0, Math.sin(2 * Math.PI * u))),
               R: th((u) => 0.9 - 0.05 * Math.max(0, -Math.sin(2 * Math.PI * u))) },
      footVX: { L: th(() => 0), R: th(() => 0) },
    };
    const t = distillMove(avg, { bins, bpl: 4, maxKeys: 12, errBudget: 0.04, name: "self-test" });
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
    // budget contract (19 3.1c): thinning is RMS-governed (0.04); the worst
    // POINTWISE sag of linear recon on a sine sits higher — sanity-bound it
    let rmsAcc2 = 0, rmsN2 = 0;
    for (const nm of ["kneeL", "ankleR"]) {
      const v = avg.thetas[nm];
      for (let b = 0; b < bins; b++) {
        const ph = b / bins;
        const th3 = t.keys; let i2 = th3.length - 1;
        for (let k = 0; k < th3.length; k++) if (th3[k].phase <= ph) i2 = k;
        const a2 = th3[i2], b2 = th3[(i2 + 1) % th3.length];
        const span = (((b2.phase - a2.phase) % 1) + 1) % 1 || 1;
        const u = ((((ph - a2.phase) % 1) + 1) % 1) / span;
        const interp = (a2.joints[nm]?.rot ?? 0) + ((b2.joints[nm]?.rot ?? 0) - (a2.joints[nm]?.rot ?? 0)) * u;
        rmsAcc2 += (v[b] - interp) ** 2; rmsN2++;
      }
    }
    const rms2 = Math.sqrt(rmsAcc2 / rmsN2);
    if (rms2 > 0.045) fails.push(`distill recon RMS ${rms2.toFixed(3)} rad > budget 0.045`);
    if (worst > 0.12) fails.push(`distill pointwise err ${worst.toFixed(3)} rad > 0.12 sanity bound`);
    if ("chest" in t.keys[0].joints) fails.push("sub-range joint not excluded");
    if (Math.abs((t.keys[0].joints.shoulderL?.rot ?? 0) - 0.8) > 0.01) fails.push("constant habitual channel dropped by distill");
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
  // 7) view gate + reinterpretation (2026-09-27/28): a PROFILE capture
  //    emitted as PROFILE is STRICT IDENTITY — in-plane keys untouched, no
  //    transfer into twist (its twist stays foreshortening-sourced). The
  //    SAME capture emitted as FRONT moves the sagittal deviations into
  //    twist and zeroes the in-plane channels.
  {
    const lift = 0.7; // same knee-lift magnitude as the round-trip pose (3)
    const foreTwist = 0.25; // foreshortening-sourced twist already on the key
    const profileKeys = [
      { beat: 0, joints: { kneeL: { rot: 0 }, hipL: { rot: 0 } },
        travel: -0.03, contacts: { L: 1, R: 1 } },
      { beat: 1, joints: { kneeL: { rot: lift, twist: foreTwist }, hipL: { rot: -0.55 }, ankleL: { dx: 0.1 } },
        travel: -0.03, contacts: { L: 0, R: 1 } },
    ];
    // matched view (profile clip, frontness 0.16, emitted profile) = identity
    const dM = viewDecision(0.16, "profile");
    const outM = dM.reinterpret ? reinterpretKeys(profileKeys) : profileKeys;
    const idOK = !dM.reinterpret && dM.natural === "profile" && outM === profileKeys &&
                 outM[1].joints.kneeL.rot === lift && outM[1].joints.kneeL.twist === foreTwist &&
                 outM[1].joints.ankleL.dx === 0.1 && outM[1].travel === -0.03;
    console.log(`[self-test] matched view (profile as profile): identity ${idOK} (rot ${outM[1].joints.kneeL.rot}, fore-twist ${outM[1].joints.kneeL.twist} — want ${lift}, ${foreTwist}, untouched)`);
    if (!idOK) fails.push("matched view must be strict identity — no reinterpretation, no twist transfer");
    // matched front (frontal clip, frontness 0.71, emitted front) = identity too
    const dF2 = viewDecision(0.71, "front");
    if (dF2.reinterpret || dF2.natural !== "front") fails.push("front-as-front must not reinterpret");
    // mismatched (same profile capture emitted front) = rot → twist
    const dF = viewDecision(0.16, "front");
    const out = dF.reinterpret ? reinterpretKeys(profileKeys) : profileKeys;
    const leak = out.some((k) => Object.values(k.joints).some(
      (ch) => ch.rot != null || ch.dx != null || ch.dy != null));
    const twKnee = out[1].joints.kneeL?.twist ?? 0;
    const ok = dF.reinterpret && !leak && Math.abs(twKnee - lift) < 1e-6 && out[1].travel === 0 &&
               out[1].contacts.L === 0 && !("kneeL" in out[0].joints);
    console.log(`[self-test] reinterpret front-from-profile: kneeL lift ${lift} → twist ${twKnee}, in-plane leak ${leak} (want twist ${lift}, no leak; fore-twist ${foreTwist} dropped, sign-ambiguous cross-plane)`);
    if (!ok) fails.push("reinterpretation must route sagittal deviations to twist, zero in-plane");
  }
  for (const f of fails) console.error(`[self-test] FAIL: ${f}`);
  console.log(`VERIFY:${fails.length ? "FAIL" : "PASS"} mocap-self-test`);
  process.exitCode = fails.length ? 1 : 0;
}
