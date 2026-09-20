#!/usr/bin/env node
/**
 * Root-frame diagnostic (2026-09-20 screenshot analysis): are the pelvis/
 * chest root orientations stable in profile view?
 *
 * Per frame: projected LATERAL vector lengths (hipL→hipR, shoulderL→
 * shoulderR), the SPINE-derived chest angle (the actual code path:
 * hipMid→shoulderMid), and the HYPOTHETICAL lateral-derived pelvis/chest
 * angles (what the angles would be if roots were computed from the lateral
 * vectors). Plus a real-data round-trip: rendered stickman bone angle vs
 * observed bone angle, max |diff| over non-ankle bones (ankles are
 * stance-recentered by design).
 *
 *   node tools/mocap/root-diag.mjs <video> --loop-window A-B [--view as-filmed] [--mirror]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sgLandmarks } from "./lib/smooth.mjs";
import { MP, buildRig, detectYSign, frameYaw, deYaw, retargetFrame, fkPose, calibMasks, measureRest } from "./lib/retarget.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const video = argv.find((a) => a.endsWith(".mp4"));
const [winA, winB] = opt("loop-window", "0-99999").split(/[-–]/).map(Number);
const viewMode = opt("view", "frontal");
const mirror = flag("mirror");

const sidecar = JSON.parse(fs.readFileSync(path.join(ROOT, "web/app/shapes/biped-1.json"), "utf8"));
const rig = buildRig(sidecar);
const py = path.join(HERE, ".venv/bin/python");

const raw = await new Promise((resolve, reject) => {
  const p = spawn(py, [path.join(HERE, "pose_worker.py"), video, String(winA), String(winB), "on"]);
  let buf = "", err = "";
  const frames = [];
  p.stdout.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const j = JSON.parse(line);
      if (!j.meta && !j.error && !j.miss) frames.push(j);
    }
  });
  p.stderr.on("data", (d) => { err += d; });
  p.on("close", (c) => c === 0 ? resolve(frames) : reject(new Error(err.slice(-400))));
});

const times = raw.map((f) => f.t);
const world = sgLandmarks(raw.map((f) => f.world), { window: 9, order: 3 });
const ySign = detectYSign(world);
const worldN = ySign === 1 ? world : world.map((f) => f.map(([x, y, z]) => [x, -y, -z]));
const frontal = worldN.map((f) => deYaw(f, viewMode === "as-filmed" ? 0 : frameYaw(f)));

const ang = (a, b) => Math.atan2(b[1] - a[1], b[0] - a[0]);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const deg = (r) => r * 180 / Math.PI;

// body scale for normalizing lateral lengths: spine length per frame
const rows = frontal.map((f, i) => {
  const hipM = mid(f[MP.hipL], f[MP.hipR]);
  const shM = mid(f[MP.shoulderL], f[MP.shoulderR]);
  const spineLen = Math.hypot(shM[0] - hipM[0], shM[1] - hipM[1]);
  const latHip = Math.hypot(f[MP.hipR][0] - f[MP.hipL][0], f[MP.hipR][1] - f[MP.hipL][1]);
  const latSh = Math.hypot(f[MP.shoulderR][0] - f[MP.shoulderL][0], f[MP.shoulderR][1] - f[MP.shoulderL][1]);
  return {
    t: times[i],
    latHip: latHip / spineLen, latSh: latSh / spineLen,        // spine-normalized
    chestSpine: deg(ang(hipM, shM)),                            // ACTUAL code path
    pelvisLat: deg(ang(f[MP.hipL], f[MP.hipR])),                // HYPOTHETICAL lateral roots
    chestLat: deg(ang(f[MP.shoulderL], f[MP.shoulderR])),
  };
});

// profile-view rest set (same estimation as extract.mjs)
let view = null;
if (viewMode === "as-filmed") {
  let s = 0;
  for (const f of frontal) s += (f[MP.toeL][0] - f[MP.heelL][0]) + (f[MP.toeR][0] - f[MP.heelR][0]);
  view = { profileFacing: s < 0 ? -1 : 1 };
  console.log(`[root-diag] profile rest set: facing ${view.profileFacing < 0 ? "left" : "right"}`);
}

// measured-rest calibration (same mechanism as extract.mjs)
const masks = calibMasks(frontal);
const cal = measureRest(frontal, rig, mirror, view, masks);
if (cal.fallbacks.length) console.log(`[root-diag] rest fallback to declared: [${cal.fallbacks}]`);

// round-trip on real data, RIG-ANCHORED identity (incl. FOOT bones):
// rendered bone angle − rigRest must equal obs − measured human rest —
// catches any rest/side/name mix-up (the mirror-rest bug class) without
// requiring rendered == observed (they differ by humanRest − rigRest by
// design: the calibration pose renders as the rig's rest pose)
// chest is checked via chest→neck: in FK a bone rotates by its PARENT
// joint's acc, so pelvis→chest is rest-fixed and chest's theta shows on
// its children — checking pelvis→chest would just re-measure the
// single-bend chest semantics as a fake error
const CHECK = [["shoulderL", "elbowL"], ["elbowL", "handL"], ["hipL", "kneeL"], ["kneeL", "ankleL"],
               ["hipR", "kneeR"], ["kneeR", "ankleR"], ["ankleL", "footL"], ["ankleR", "footR"],
               ["chest", "neck"]];
const defNameOf = (pa, ch) => pa;
// observed endpoints straight from the def rows (mirror/view already applied)
const defRows = Object.fromEntries(rig.defs(mirror, view).map((d) => [d[0], d]));
// rotLimit clamp count on the final thetas
const lim = { shoulder: 3.15, elbow: 2.4, hip: 0.9, knee: 2.0, ankle: 1.0,
              ...(sidecar.rotLimits ?? {}) };
const clampHits = {};
let worstRT = 0, worstBone = "";
const point2 = (f, key) => typeof key === "number" ? f[key]
  : key === "hipMid" ? mid(f[MP.hipL], f[MP.hipR])
  : key === "shoulderMid" ? mid(f[MP.shoulderL], f[MP.shoulderR])
  : mid(f[MP.earL], f[MP.earR]);
for (let i = 0; i < frontal.length; i++) {
  const th = retargetFrame(frontal[i], rig, mirror, view, cal.rests);
  for (const [nm, v] of Object.entries(th)) {
    const l = lim[nm.replace(/[LR]$/, "")];
    if (l && Math.abs(v) > l) clampHits[nm] = (clampHits[nm] ?? 0) + 1;
  }
  const pose = fkPose(rig, th);
  for (const [pa, ch] of CHECK) {
    const nm = defNameOf(pa, ch);
    const [, , a, b] = defRows[nm];
    const observed = ang(point2(frontal[i], a), point2(frontal[i], b));
    const rendered = ang(pose[pa], pose[ch]);
    const rigRest = ang([rig.joints[pa].x, rig.joints[pa].y], [rig.joints[ch].x, rig.joints[ch].y]);
    const lhs = rendered - rigRest, rhs = observed - cal.rests[nm];
    const d = Math.abs(Math.atan2(Math.sin(lhs - rhs), Math.cos(lhs - rhs)));
    if (d > worstRT) { worstRT = d; worstBone = `${pa}→${ch}@${times[i].toFixed(2)}s`; }
  }
}

const stats = (vals) => {
  const s = [...vals].sort((a, b) => a - b);
  const q = (p) => s[Math.floor(p * (s.length - 1))];
  return `median ${q(0.5).toFixed(2)} p10 ${q(0.1).toFixed(2)} p90 ${q(0.9).toFixed(2)}`;
};
const sd = (vals) => {
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  return Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length);
};
console.log(`[root-diag] ${path.basename(video)} ${winA}-${winB}s view=${viewMode} mirror=${mirror} frames=${rows.length}`);
console.log(`[root-diag] lateral |hipL→hipR| / spine: ${stats(rows.map((r) => r.latHip))}`);
console.log(`[root-diag] lateral |shL→shR|  / spine: ${stats(rows.map((r) => r.latSh))}`);
console.log(`[root-diag] chest angle SPINE-derived (actual): ${stats(rows.map((r) => r.chestSpine))}° sd ${sd(rows.map((r) => r.chestSpine)).toFixed(1)}°`);
console.log(`[root-diag] pelvis angle LATERAL-derived (hypothetical): sd ${sd(rows.map((r) => r.pelvisLat)).toFixed(1)}°`);
console.log(`[root-diag] chest angle LATERAL-derived (hypothetical): sd ${sd(rows.map((r) => r.chestLat)).toFixed(1)}°`);
console.log(`[root-diag] round-trip rendered-vs-observed (incl. feet): worst ${(worstRT * 180 / Math.PI).toFixed(2)}° (${worstBone})`);
console.log(`[root-diag] rotLimit clamp hits: ${Object.keys(clampHits).length ? JSON.stringify(clampHits) + " — REST-REFERENCE SMELL" : "0"}`);
