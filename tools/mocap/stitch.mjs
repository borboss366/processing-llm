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
import { scaleToAngles } from "./lib/channel-scale.mjs";

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
  ...(k.weight !== undefined ? { weight: k.weight == null ? null : -k.weight } : {}),   // 17.6: L↔R support
  joints: Object.fromEntries(Object.entries(k.joints).map(([nm, ch]) => [swapSide(nm), {
    ...(ch.rot != null ? { rot: -ch.rot } : {}),
    ...(ch.dx != null ? { dx: -ch.dx } : {}),
    ...(ch.dy != null ? { dy: ch.dy } : {}),
    // x-reflection: twist = atan2(dz, planar) with planar ≥ 0 — sign holds;
    // yaw rotates about the vertical axis — sign flips
    ...(ch.twist != null ? { twist: ch.twist } : {}),
    ...(ch.depth != null ? { depth: ch.depth } : {}),     // toward/away holds under x-reflection
    ...(ch.yaw != null ? { yaw: -ch.yaw } : {}),
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
      ...(ch.twist != null ? { twist: +(ch.twist * f).toFixed(3) } : {}),
      ...(ch.depth != null ? { depth: +Math.max(-1, Math.min(1, ch.depth * f)).toFixed(4) } : {}),
      ...(ch.dx != null ? { dx: +(ch.dx * f).toFixed(4) } : {}),
      ...(ch.dy != null ? { dy: +(ch.dy * f).toFixed(4) } : {}),
    }];
  })),
};
// symmetrize (17 A7, user option b): an occluded-side capture can carry a
// weak half (runningman kneeL 0.35 vs kneeR 1.49) — rebuild the loop as
// strongHalf + side-swapped strongHalf. PROFILE semantics: both legs swing
// with the SAME screen sign (the per-side sign is baked in at retarget),
// so the swap does NOT negate. A rot-carrying FRONT table would need the
// negating mirror — refuse rather than silently produce garbage; a
// REINTERPRETED front table (twist-only) is fine: twist holds its sign
// under x-reflection.
const symmetrize = opt("symmetrize", null);   // 'L' | 'R' | 'auto'
function symmetrizeLoop(keys, view, pick) {
  const twistOnly = keys.every((k) => Object.values(k.joints).every(
    (ch) => ch.rot == null && ch.dx == null && ch.dy == null));
  if (view !== "profile" && !twistOnly) throw new Error("--symmetrize implemented for profile and reinterpreted (twist-only) tables (a rot-carrying front table needs the negating mirror)");
  const amp = (side) => Math.max(...keys.map((k) =>
    Math.abs(k.joints[`knee${side}`]?.rot ?? k.joints[`knee${side}`]?.depth ?? k.joints[`knee${side}`]?.twist ?? 0) +
    Math.abs(k.joints[`hip${side}`]?.rot ?? k.joints[`hip${side}`]?.depth ?? k.joints[`hip${side}`]?.twist ?? 0)));
  const strong = pick === "auto" ? (amp("R") >= amp("L") ? "R" : "L") : pick;
  const inWin = (p, s0) => ((p - s0 + 1) % 1) < 0.5;
  let best = 0, bestScore = -1;
  for (const cand of keys.map((k) => k.phase)) {
    let sc = 0;
    for (const k of keys) {
      if (inWin(k.phase, cand)) sc += Math.abs(k.joints[`knee${strong}`]?.rot ?? k.joints[`knee${strong}`]?.depth ?? k.joints[`knee${strong}`]?.twist ?? 0) + Math.abs(k.joints[`hip${strong}`]?.rot ?? k.joints[`hip${strong}`]?.depth ?? k.joints[`hip${strong}`]?.twist ?? 0);
    }
    if (sc > bestScore) { bestScore = sc; best = cand; }
  }
  const half = keys.filter((k) => inWin(k.phase, best))
    .map((k) => ({ ...k, phase: +(((k.phase - best + 1) % 1)).toFixed(5) }))
    .sort((a, b) => a.phase - b.phase);
  const swapped = half.map((k) => ({
    ...k,
    ...(k.weight !== undefined ? { weight: k.weight == null ? null : -k.weight } : {}),   // 17.6
    phase: +(k.phase + 0.5).toFixed(5),
    joints: Object.fromEntries(Object.entries(k.joints).map(([nm, ch]) => [swapSide(nm), { ...ch }])),
    contacts: (k.contacts ?? []).map(swapSide),
  }));
  console.log(`[stitch] symmetrized from ${strong} half @${best} (knee+hip amp L ${amp("L").toFixed(2)} / R ${amp("R").toFixed(2)})`);
  return [...half, ...swapped];
}

// owner-written header fields (clampWhitelist + reason, followWn) live in
// the STAGE table, not the extraction — a rebuild must carry them forward
// (2026-10-13: a tstep rebuild silently dropped its whitelist)
const KEEP_HEADER = ["clampWhitelist", "clampWhitelistReason", "followWn"];
const carried = (() => {
  try {
    const prev = JSON.parse(fs.readFileSync(outPath, "utf8"));
    return Object.fromEntries(KEEP_HEADER.filter((k) => prev[k] != null).map((k) => [k, prev[k]]));
  } catch { return {}; }
})();
if (Object.keys(carried).length) console.log(`[stitch] carrying header fields from the existing table: ${Object.keys(carried).join(", ")}`);

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
  fs.writeFileSync(outPath, JSON.stringify({ ...table, ...carried }, null, 2));
  const net1 = table.keys.reduce((s, k) => s + (k.travel ?? 0), 0) / table.keys.length;
  console.log(`[stitch] wrote ${outPath}: bpl ${table.beatsPerLoop}, ${table.keys.length} keys, mean travel ${net1.toFixed(4)} u/beat (single-table mode)`);
  process.exit(0);
}

// SEAM (17.6 addendum A): each half is a closed loop (cycle-averaged: it
// ends where it starts), so the joins are L[cut] → R[cut] and back. The old
// alignment rotated R to start at mirror(L[0]) — but L ends at L[0], not at
// its mirror, so any lateral lean popped at both joins (tstep: 0.82 rad rms
// across the body and weight −0.97 → +1 in one key step, 9× a normal step).
// Now BOTH rings are cut where the two halves are most alike: angles plus
// weight as a GATE: a pose match with the weight on the other foot is not a
// match (scored as one channel among 13 the weight barely counted, and the
// first rebuild cut tstep mid-transfer: −0.98 → +0.73). Candidates must keep
// |Δweight| ≤ SEAM_DW; among them the angles (+ weight on their scale) pick.
const Rsrc = flag("mirror") ? L.keys.map(mirrorKey) : JSON.parse(fs.readFileSync(files[1], "utf8")).keys;
const jointNames = [...new Set([...L.keys, ...Rsrc].flatMap((k) => Object.keys(k.joints)))];
const wScale = scaleToAngles(
  jointNames.map((nm) => [...L.keys, ...Rsrc].map((k) => k.joints[nm]?.rot ?? 0)),
  [...L.keys, ...Rsrc].map((k) => k.weight));
const seamDist = (a, b) => {
  let s2 = 0;
  for (const nm of jointNames) s2 += ((a.joints[nm]?.rot ?? 0) - (b.joints[nm]?.rot ?? 0)) ** 2;
  if (a.weight != null && b.weight != null) s2 += (wScale * (a.weight - b.weight)) ** 2;
  return Math.sqrt(s2 / (jointNames.length + 1));
};
const SEAM_DW = 0.5;
const dW = (a, b) => (a.weight == null || b.weight == null ? 0 : Math.abs(a.weight - b.weight));
let cutL = 0, cutR = 0, bestD = Infinity;
for (const gated of [true, false]) {          // no candidate inside the gate → best overall, said loudly
  for (let i = 0; i < L.keys.length; i++) for (let r = 0; r < Rsrc.length; r++) {
    if (gated && dW(L.keys[i], Rsrc[r]) > SEAM_DW) continue;
    const d = seamDist(L.keys[i], Rsrc[r]);
    if (d < bestD) { bestD = d; cutL = i; cutR = r; }
  }
  if (bestD < Infinity) break;
  console.warn(`[stitch] WARNING: no seam keeps |Δweight| ≤ ${SEAM_DW} — the join transfers weight in one key step`);
}
const ring = (keys, at) => {
  const shift = keys[at].phase;
  return keys.map((_, i) => ({ ...keys[(at + i) % keys.length] }))
    .map((k) => ({ ...k, phase: +((((k.phase - shift) % 1) + 1) % 1).toFixed(5) }))
    .sort((a, b) => a.phase - b.phase);
};
const Lkeys = ring(L.keys, cutL);
const Rkeys = ring(Rsrc, cutR);
console.log(`[stitch] seam: cut L @${L.keys[cutL].phase} · R @${Rsrc[cutR].phase} · seam distance ${bestD.toFixed(3)} rad rms (weight ×${wScale.toFixed(2)}; weight ${L.keys[cutL].weight ?? "—"} → ${Rsrc[cutR].weight ?? "—"})`);

const half = (keys, offset) => keys.map((k) => ({ ...scaleKey(k), phase: +(offset + k.phase / 2).toFixed(5) }));
const table = {
  name,
  view: L.view ?? 'front',
  beatsPerLoop: (L.beatsPerLoop ?? 2) * 2,
  overlay: L.overlay ?? 0.3,
  verticalContent: L.verticalContent ?? 0.7,
  keys: [...half(Lkeys, 0), ...half(Rkeys, 0.5)],
  provenance: {
    halves: files.map((f) => path.basename(f)),
    mode: flag("mirror") ? "L + mirror(L)" : "L + aligned real R",
    seam: { cutL: L.keys[cutL].phase, cutR: Rsrc[cutR].phase, dist: +bestD.toFixed(4) },
    exaggerate: exagMap ?? exag,
    L: L.provenance ?? null,
    pipeline: "tools/mocap/stitch.mjs",
  },
};
const net = table.keys.reduce((s, k) => s + (k.travel ?? 0), 0) / table.keys.length;
fs.writeFileSync(outPath, JSON.stringify({ ...table, ...carried }, null, 2));
console.log(`[stitch] wrote ${outPath}: bpl ${table.beatsPerLoop}, ${table.keys.length} keys, mean travel ${net.toFixed(4)} u/beat (mirror mode nets ~0 by construction)`);
