#!/usr/bin/env node
/**
 * Stitch two single-side capture halves into one full move table (brief 16
 * Task 2). The T-step tutorial demos each lead side separately (turnaround
 * between), so extract.mjs produces two bpl-2 halves; the rig's table wants
 * one bpl-4 loop with sides swapping at phase 0.5 (like the authored one).
 *
 *   node tools/mocap/stitch.mjs <L.move.json> [R.move.json] --name tstep-captured
 *        [--mirror]        derive the R half by mirroring L (exact: the rig
 *                          rest pose is symmetric — swap L/R suffixes, negate
 *                          rot/dx/travel, swap contacts). Used when the real
 *                          R window is too thin or off-move.
 *        [--out <path>]    output (default web/app/moves/<name>.json)
 *        [--exag-map <sidecar.json>]  per-part exaggeration from the shape
 *                          sidecar's `captureExag` map (feet/legs/arms/head/
 *                          spine scaled separately — 16.2, replaces the old
 *                          global --exaggerate F; travel and contacts stay
 *                          as captured)
 *        [--exaggerate F]  legacy uniform scale (kept for comparisons)
 *
 * With a real R half, its keys are phase-rotated to best match the mirror of
 * the L half at the seam (the two extractions anchor independently).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const VALUED = new Set(["--name", "--out", "--exaggerate", "--exag-map", "--symmetrize"]);
const files = argv.filter((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1]));

const name = opt("name", "stitched");
const outPath = opt("out", path.join(ROOT, "web/app/moves", `${name}.json`));
const L = JSON.parse(fs.readFileSync(files[0], "utf8"));

const swapSide = (nm) => nm.endsWith("L") ? `${nm.slice(0, -1)}R` : nm.endsWith("R") ? `${nm.slice(0, -1)}L` : nm;
const mirrorKey = (k) => ({
  phase: k.phase,
  joints: Object.fromEntries(Object.entries(k.joints).map(([nm, ch]) => [swapSide(nm), {
    ...(ch.rot != null ? { rot: -ch.rot } : {}),
    ...(ch.dx != null ? { dx: -ch.dx } : {}),
    ...(ch.dy != null ? { dy: ch.dy } : {}),
  }])),
  contacts: (k.contacts ?? []).map(swapSide),
  ease: k.ease,
  travel: -(k.travel ?? 0),
});

const exag = +opt("exaggerate", 1);
// joint → sidecar captureExag group (16.2): per-part scaling — a stage read
// wants big feet and calm head, which one global factor can't express
const groupOf = (nm) =>
  /^ankle/.test(nm) ? "feet"
  : /^(hip|knee)/.test(nm) ? "legs"
  : /^(shoulder|elbow|hand)/.test(nm) ? "arms"
  : nm === "neck" ? "head"
  : "spine";                                   // chest, pelvis dx
const exagMapPath = opt("exag-map", null);
const exagMap = exagMapPath ? (JSON.parse(fs.readFileSync(exagMapPath, "utf8")).captureExag ?? null) : null;
if (exagMapPath && !exagMap) throw new Error(`${exagMapPath} has no captureExag map`);
const factorOf = (nm) => exagMap ? (exagMap[groupOf(nm)] ?? 1) : exag;
const scaleKey = (k) => (!exagMap && exag === 1) ? k : {
  ...k,
  joints: Object.fromEntries(Object.entries(k.joints).map(([nm, ch]) => {
    const f = factorOf(nm);
    return [nm, {
      ...(ch.rot != null ? { rot: +(ch.rot * f).toFixed(3) } : {}),
      ...(ch.dx != null ? { dx: +(ch.dx * f).toFixed(4) } : {}),
      ...(ch.dy != null ? { dy: +(ch.dy * f).toFixed(4) } : {}),
    }];
  })),
};
// symmetrize (17 A7, user option b): an occluded-side capture can carry a
// weak half (runningman kneeL 0.35 vs kneeR 1.49) — rebuild the loop as
// strongHalf + side-swapped strongHalf. PROFILE semantics: both legs swing
// with the SAME screen sign (the per-side sign is baked in at retarget),
// so the swap does NOT negate; a front table would need the negating
// mirror — refuse rather than silently produce garbage.
const symmetrize = opt("symmetrize", null);   // 'L' | 'R' | 'auto'
function symmetrizeLoop(keys, view, pick) {
  if (view !== "profile") throw new Error("--symmetrize implemented for profile tables only (front needs the negating mirror)");
  const amp = (side) => Math.max(...keys.map((k) =>
    Math.abs(k.joints[`knee${side}`]?.rot ?? 0) + Math.abs(k.joints[`hip${side}`]?.rot ?? 0)));
  const strong = pick === "auto" ? (amp("R") >= amp("L") ? "R" : "L") : pick;
  const inWin = (p, s0) => ((p - s0 + 1) % 1) < 0.5;
  let best = 0, bestScore = -1;
  for (const cand of keys.map((k) => k.phase)) {
    let sc = 0;
    for (const k of keys) {
      if (inWin(k.phase, cand)) sc += Math.abs(k.joints[`knee${strong}`]?.rot ?? 0) + Math.abs(k.joints[`hip${strong}`]?.rot ?? 0);
    }
    if (sc > bestScore) { bestScore = sc; best = cand; }
  }
  const half = keys.filter((k) => inWin(k.phase, best))
    .map((k) => ({ ...k, phase: +(((k.phase - best + 1) % 1)).toFixed(5) }))
    .sort((a, b) => a.phase - b.phase);
  const swapped = half.map((k) => ({
    ...k,
    phase: +(k.phase + 0.5).toFixed(5),
    joints: Object.fromEntries(Object.entries(k.joints).map(([nm, ch]) => [swapSide(nm), { ...ch }])),
    contacts: (k.contacts ?? []).map(swapSide),
  }));
  console.log(`[stitch] symmetrized from ${strong} half @${best} (knee+hip amp L ${amp("L").toFixed(2)} / R ${amp("R").toFixed(2)})`);
  return [...half, ...swapped];
}

// single-table mode (16.2 move #2): one input, no --mirror — the clip's
// window already covers the full alternating loop; just rename/scale
if (files.length === 1 && !flag("mirror")) {
  const baseKeys = symmetrize ? symmetrizeLoop(L.keys, L.view, symmetrize) : L.keys;
  const table = {
    ...L, name,
    keys: baseKeys.map((k) => scaleKey(k)),
    provenance: { ...(L.provenance ?? {}), mode: "single full loop",
                  exaggerate: exagMap ?? exag, pipeline: "tools/mocap/stitch.mjs" },
  };
  fs.writeFileSync(outPath, JSON.stringify(table, null, 2));
  const net1 = table.keys.reduce((s, k) => s + (k.travel ?? 0), 0) / table.keys.length;
  console.log(`[stitch] wrote ${outPath}: bpl ${table.beatsPerLoop}, ${table.keys.length} keys, mean travel ${net1.toFixed(4)} u/beat (single-table mode)`);
  process.exit(0);
}

let Rkeys;
if (flag("mirror")) {
  Rkeys = L.keys.map(mirrorKey);
} else {
  const R = JSON.parse(fs.readFileSync(files[1], "utf8"));
  // align: rotate R's key ring so its start best matches mirror(L) at phase 0
  // (both extractions anchored independently at their own calm point)
  const target = mirrorKey(L.keys[0]);
  const dist = (a, b) => {
    const names = new Set([...Object.keys(a.joints), ...Object.keys(b.joints)]);
    let s = 0;
    for (const nm of names) s += ((a.joints[nm]?.rot ?? 0) - (b.joints[nm]?.rot ?? 0)) ** 2;
    return s;
  };
  let best = 0, bestD = Infinity;
  for (let r = 0; r < R.keys.length; r++) {
    const d = dist(R.keys[r], target);
    if (d < bestD) { bestD = d; best = r; }
  }
  const shift = R.keys[best].phase;
  Rkeys = R.keys.map((k, i) => ({ ...R.keys[(best + i) % R.keys.length] }))
    .map((k) => ({ ...k, phase: +((((k.phase - shift) % 1) + 1) % 1).toFixed(5) }))
    .sort((a, b) => a.phase - b.phase);
  console.log(`[stitch] aligned R half: rotated by ${shift} (key ${best}, dist ${bestD.toFixed(3)})`);
}

const half = (keys, offset) => keys.map((k) => ({ ...scaleKey(k), phase: +(offset + k.phase / 2).toFixed(5) }));
const table = {
  name,
  beatsPerLoop: (L.beatsPerLoop ?? 2) * 2,
  overlay: L.overlay ?? 0.3,
  verticalContent: L.verticalContent ?? 0.7,
  keys: [...half(L.keys, 0), ...half(Rkeys, 0.5)],
  provenance: {
    halves: files.map((f) => path.basename(f)),
    mode: flag("mirror") ? "L + mirror(L)" : "L + aligned real R",
    exaggerate: exagMap ?? exag,
    L: L.provenance ?? null,
    pipeline: "tools/mocap/stitch.mjs",
  },
};
const net = table.keys.reduce((s, k) => s + (k.travel ?? 0), 0) / table.keys.length;
fs.writeFileSync(outPath, JSON.stringify(table, null, 2));
console.log(`[stitch] wrote ${outPath}: bpl ${table.beatsPerLoop}, ${table.keys.length} keys, mean travel ${net.toFixed(4)} u/beat (mirror mode nets ~0 by construction)`);
