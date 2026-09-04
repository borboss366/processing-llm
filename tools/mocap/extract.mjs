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
 *     --min-cutoff F --beta F   One Euro tuning (default 1.2 / 0.35)
 *     --anchor F                extra phase shift 0..1 after auto-anchor
 *     --keep-drift              keep net pelvis drift in `travel` (single-side
 *                               captures of travelling moves; default removes it)
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
import { MP, buildRig, detectYSign, frameYaw, deYaw, retargetFrame, fkPose } from "./lib/retarget.mjs";
import { angularSpeed, detectPeriod, decideLoop, binCycles, averageCycles } from "./lib/timing.mjs";
import { distillMove } from "./lib/distill.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const RIG_HEIGHT_UNITS = 0.82;           // ground 0.905 → head top ≈ 0.085 in shape units
const ARTICULATED = ["chest", "neck", "shoulderL", "elbowL", "shoulderR", "elbowR",
                     "kneeL", "ankleL", "kneeR", "ankleR"];

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
                            "min-cutoff", "beta", "anchor", "max-keys"]);
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
const clipBase = video.replace(/\.[^.]+$/, "");
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
const raw = await new Promise((resolve, reject) => {
  const p = spawn(py, [path.join(HERE, "pose_worker.py"), video, String(winA), String(winB)]);
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
      else if (j.error) reject(new Error(j.error));
      else frames.push(j);
    }
  });
  p.stderr.on("data", (d) => { err += d; });
  p.on("close", (code) => code === 0 ? resolve({ meta, frames }) : reject(new Error(`worker exit ${code}\n${err.slice(-2000)}`)));
});
const detected = raw.frames.filter((f) => !f.miss);
const missed = raw.frames.length - detected.length;
console.log(`[mocap] frames: ${raw.frames.length} in window, ${detected.length} with pose (${missed} missed) @ ${raw.meta.fps.toFixed(2)} fps`);
if (detected.length < 30) { console.error("[mocap] too few pose frames — check the loop window / clip"); process.exit(1); }

// ── stage 2: One Euro on LANDMARK POSITIONS (world + image), then angles ──
const times = detected.map((f) => f.t);
const world = filterLandmarks(detected.map((f) => f.world), times, euro);
const img = filterLandmarks(detected.map((f) => f.img.map((l) => l.slice(0, 2))), times, euro);
const conf = detected.map((f) => f.img.reduce((a, l) => a + l[2], 0) / f.img.length);

// ── stage 3: de-yaw ───────────────────────────────────────────────────────
const ySign = detectYSign(world);
const worldN = ySign === 1 ? world : world.map((f) => f.map(([x, y, z]) => [x, -y, -z]));
const yaws = worldN.map((f) => frameYaw(f));
const frontal = worldN.map((f, i) => deYaw(f, yaws[i]));
console.log(`[mocap] world y-sign ${ySign > 0 ? "down (as-is)" : "up (flipped)"} · yaw median ${median(yaws.map((y) => y * 180 / Math.PI)).toFixed(0)}°`);

// ── stage 4: retarget to rig rotations ────────────────────────────────────
const thetaFrames = frontal.map((f) => retargetFrame(f, rig, mirror));

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
channels.pelvisU = uni(pelvisU);
for (const s of ["L", "R"]) {
  channels[`footY${s}`] = uni(footY[s]);
  const fx = uni(footX[s]);
  channels[`footVX${s}`] = fx.map((v, i) => i ? (v - fx[i - 1]) * fsHz : 0);
}

const speed = angularSpeed(thetaFrames, times, ARTICULATED);
const per = detectPeriod(speed, fsHz);
const signedCh = Object.fromEntries(ARTICULATED.map((nm) => [nm, channels[`th:${nm}`]]));
const loop = decideLoop(signedCh, fsHz, per.period);
let period = per.period * loop.mult;
let bpl = +opt("bpl", 4);
if (beatSec) {
  const beats = period / beatSec;
  bpl = [1, 2, 3, 4, 6, 8].reduce((a, b) => Math.abs(b - beats) < Math.abs(a - beats) ? b : a);
  period = bpl * beatSec;                     // lock the loop to the music exactly
}
console.log(`[mocap] base period ${per.period.toFixed(3)}s (ac ${per.strength.toFixed(2)}) ×${loop.mult}${loop.mult === 2 ? " (L/R halves differ)" : ""} route=${timingRoute} → bpl ${bpl}${beatSec ? ` @ ${(60 / beatSec).toFixed(1)} BPM, locked ${period.toFixed(3)}s` : ""}`);

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
const pelvisAvg = mean.pelvisU;
const pelvisMean = pelvisAvg.reduce((a, b) => a + b, 0) / BINS;
const table = distillMove({
  thetas: thetasAvg,
  pelvisU: pelvisAvg,
  footY: { L: mean.footYL, R: mean.footYR },
  footVX: { L: mean.footVXL, R: mean.footVXR },
}, { bins: BINS, bpl, maxKeys: +opt("max-keys", 16), name: moveName, keepDrift: flag("keep-drift") });
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
  source: path.basename(video), clipSha: clipHash,
  window: [winA, winB], mirror, rig: path.basename(rigPath),
  filter: euro, fps: raw.meta.fps,
  timing: { route: timingRoute, period: +period.toFixed(4), bpl,
            bpm: beatSec ? +(60 / beatSec).toFixed(2) : null,
            anchorSec: +anchorSec.toFixed(4), acStrength: +per.strength.toFixed(3),
            cycles: cycles.length, kept: kept.length, dropped },
  frames: detected.map((f, i) => ({
    t: +times[i].toFixed(4),
    yaw: +yaws[i].toFixed(4),
    conf: +conf[i].toFixed(3),
    thetas: Object.fromEntries(ARTICULATED.map((nm) => [nm, +thetaFrames[i][nm].toFixed(4)])),
    pelvisU: +pelvisU[i].toFixed(4),
  })),
};
fs.writeFileSync(`${clipBase}.poses.json`, JSON.stringify(poses));
const { _netDriftUnits, ...moveOut } = table;
moveOut.provenance = { clip: path.basename(video), clipSha: clipHash, window: [winA, winB],
                       mirror, cyclesKept: kept.length, cyclesDropped: dropped.length,
                       netDriftUnits: _netDriftUnits, pipeline: "tools/mocap/extract.mjs" };
fs.writeFileSync(`${clipBase}.move.json`, JSON.stringify(moveOut, null, 2));
console.log(`[mocap] wrote ${path.basename(clipBase)}.poses.json + .move.json (clip sha ${clipHash})`);

// ── stage 9: QA video ─────────────────────────────────────────────────────
if (!flag("no-qa")) {
  const bones = sidecar.joints.filter((j) => j.parent).map((j) => [j.name, j.parent]);
  const spec = {
    video: path.resolve(video), out: `${clipBase}.qa.mp4`,
    w: raw.meta.w, h: raw.meta.h, fps: raw.meta.fps,
    period, anchorSec, t0: times[0], bpl, beatSec,
    droppedCycles: dropped, bones,
    frames: detected.map((f, i) => {
      const pose = fkPose(rig, thetaFrames[i]);
      return {
        i: f.i, t: +times[i].toFixed(4),
        img: img[i].map(([x, y]) => [+(x).toFixed(4), +(y).toFixed(4)]),
        rig: Object.fromEntries(Object.entries(pose).map(([nm, [x, y]]) => [nm, [+x.toFixed(4), +y.toFixed(4)]])),
      };
    }),
  };
  const specPath = `${clipBase}.qa-spec.json`;
  fs.writeFileSync(specPath, JSON.stringify(spec));
  console.log("[mocap] rendering QA video…");
  await new Promise((resolve, reject) => {
    const p = spawn(py, [path.join(HERE, "qa_render.py"), specPath], { stdio: "inherit" });
    p.on("close", (c) => c === 0 ? resolve() : reject(new Error(`qa_render exit ${c}`)));
  });
  fs.unlinkSync(specPath);
  console.log(`[mocap] wrote ${path.basename(clipBase)}.qa.mp4`);
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
                    shoulderR: -0.3, elbowR: -0.5, kneeL: 0.7, ankleL: -0.25,
                    kneeR: -0.2, ankleR: 0.22 };
    const pose = fkPose(rg, truth);
    // build a fake de-yawed frame: place MP landmarks at the rig joint
    // positions the observed segments read from
    const fake = [];
    fake[MP.hipL] = pose.pelvis; fake[MP.hipR] = pose.pelvis;
    fake[MP.shoulderL] = pose.shoulderL; fake[MP.shoulderR] = pose.shoulderR;
    fake[MP.elbowL] = pose.elbowL; fake[MP.elbowR] = pose.elbowR;
    fake[MP.wristL] = pose.handL; fake[MP.wristR] = pose.handR;
    fake[MP.kneeL] = pose.kneeL; fake[MP.kneeR] = pose.kneeR;
    fake[MP.ankleL] = pose.ankleL; fake[MP.ankleR] = pose.ankleR;
    fake[MP.toeL] = pose.footL; fake[MP.toeR] = pose.footR;
    fake[MP.earL] = pose.neck; fake[MP.earR] = pose.neck;
    // chest observation is hipMid→shoulderMid, which the rig bends at chest —
    // it cannot round-trip exactly (documented DOF projection); check the
    // arm/leg chains, which must be exact
    const rec = retargetFrame(fake, rg, false);
    let worst = 0, worstName = "";
    for (const nm of ["shoulderL", "elbowL", "shoulderR", "elbowR", "kneeL", "ankleL", "kneeR", "ankleR"]) {
      // arm chain parent is chest: recovered accRot is exact, theta differs
      // by the chest projection error — compare CHAIN-ACCUMULATED rotation
      const chain = (th, names2) => names2.reduce((a, n2) => a + (th[n2] ?? 0), 0);
      const pairs = {
        shoulderL: ["chest", "shoulderL"], elbowL: ["chest", "shoulderL", "elbowL"],
        shoulderR: ["chest", "shoulderR"], elbowR: ["chest", "shoulderR", "elbowR"],
        kneeL: ["kneeL"], ankleL: ["kneeL", "ankleL"], kneeR: ["kneeR"], ankleR: ["kneeR", "ankleR"],
      };
      const d = Math.abs(chain(rec, pairs[nm]) - chain(truth, pairs[nm]));
      if (d > worst) { worst = d; worstName = nm; }
    }
    console.log(`[self-test] retarget round-trip: worst chain-accRot err ${worst.toExponential(2)} rad (${worstName})`);
    if (worst > 1e-9) fails.push(`round-trip err ${worst} rad`);
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
  }
  for (const f of fails) console.error(`[self-test] FAIL: ${f}`);
  console.log(`VERIFY:${fails.length ? "FAIL" : "PASS"} mocap-self-test`);
  process.exitCode = fails.length ? 1 : 0;
}
