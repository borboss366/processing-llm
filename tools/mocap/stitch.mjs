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
 *        [--exaggerate F]  scale all joint rot/dx by F (stage-read pass:
 *                          capture is often understated at distance; travel
 *                          and contacts stay as captured)
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
const files = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--name" && argv[i - 1] !== "--out");

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

const exag = +opt("exaggerate", 1);
const scaleKey = (k) => exag === 1 ? k : {
  ...k,
  joints: Object.fromEntries(Object.entries(k.joints).map(([nm, ch]) => [nm, {
    ...(ch.rot != null ? { rot: +(ch.rot * exag).toFixed(3) } : {}),
    ...(ch.dx != null ? { dx: +(ch.dx * exag).toFixed(4) } : {}),
    ...(ch.dy != null ? { dy: +(ch.dy * exag).toFixed(4) } : {}),
  }])),
};
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
    exaggerate: exag,
    L: L.provenance ?? null,
    pipeline: "tools/mocap/stitch.mjs",
  },
};
const net = table.keys.reduce((s, k) => s + (k.travel ?? 0), 0) / table.keys.length;
fs.writeFileSync(outPath, JSON.stringify(table, null, 2));
console.log(`[stitch] wrote ${outPath}: bpl ${table.beatsPerLoop}, ${table.keys.length} keys, mean travel ${net.toFixed(4)} u/beat (mirror mode nets ~0 by construction)`);
