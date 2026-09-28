#!/usr/bin/env node
/**
 * R1 rung (brief 19 Task 3.1): per-bone RMS of the DISTILLED TABLE played
 * at each frame's loop phase vs the RAW per-frame retarget — the honest
 * measure of what averaging + key thinning cost (overlay 8 vs overlay 1).
 *
 * Total = AVERAGING FLOOR (rep-to-rep variation — irreducible for any loop
 * table) + what DISTILL adds (the controllable rung). With the optional
 * explorer-data arg the two are separated and the VERDICT applies to the
 * distill component (≤ 0.05 rad); without it only the total is reported.
 *
 *   node tools/mocap/table-vs-raw.mjs <clip>.poses.json <clip>.move.json [<clip>.explorer-data.json]
 */
import fs from "node:fs";
import { sampleTableAt } from "./lib/distill.mjs";

const [posesPath, movePath] = process.argv.slice(2);
if (!posesPath || !movePath) {
  console.error("usage: node tools/mocap/table-vs-raw.mjs <poses.json> <move.json>");
  process.exit(1);
}
const P = JSON.parse(fs.readFileSync(posesPath, "utf8"));
const T = JSON.parse(fs.readFileSync(movePath, "utf8"));
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

const anchor = P.timing?.anchorSec ?? 0;
const loopSec = P.timing?.period ?? 1;      // full-loop seconds (extract's `period`)
const t0 = P.frames[0].t;

const acc = {}, n = {};
for (const f of P.frames) {
  const phase = ((((f.t - t0 - anchor) / loopSec) % 1) + 1) % 1;
  const th = sampleTableAt(T, phase);
  for (const [nm, raw] of Object.entries(f.thetas)) {
    const e = wrap((th[nm] ?? 0) - raw);
    acc[nm] = (acc[nm] ?? 0) + e * e;
    n[nm] = (n[nm] ?? 0) + 1;
  }
}
const rows = Object.keys(acc).map((nm) => [nm, Math.sqrt(acc[nm] / n[nm])]);
rows.sort((a, b) => b[1] - a[1]);
let total = 0, k = 0;
for (const [, v] of rows) { total += v * v; k++; }
const all = Math.sqrt(total / k);
console.log(`R1 table-vs-raw · ${T.name} · keys ${T.keys.length} · frames ${P.frames.length}`);
for (const [nm, v] of rows) console.log(`  ${nm.padEnd(10)} ${v.toFixed(4)} rad${v > 0.05 ? "  ← over 0.05" : ""}`);
console.log(`  ${"ALL(rms)".padEnd(10)} ${all.toFixed(4)} rad total`);
const dataPath = process.argv[4];
if (dataPath) {
  const D = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const BINS = Object.values(D.avg)[0].length;
  let fAcc = 0, fN = 0;
  for (const f of P.frames) {
    const phase = ((((f.t - t0 - anchor) / loopSec) % 1) + 1) % 1;
    const b = Math.min(BINS - 1, Math.floor(phase * BINS));
    for (const [nm, raw] of Object.entries(f.thetas)) {
      if (!D.avg[nm]) continue;
      fAcc += wrap(D.avg[nm][b] - raw) ** 2; fN++;
    }
  }
  const floor = Math.sqrt(fAcc / fN);
  const distill = all - floor;
  console.log(`  averaging floor ${floor.toFixed(4)} rad (rep-to-rep, irreducible) · distill adds ${distill.toFixed(4)} (budget 0.05)`);
  console.log(`VERIFY:${distill <= 0.05 ? "PASS" : "FAIL"} table-vs-raw(distill) ${T.name}`);
} else {
  console.log(`  (no explorer-data arg — floor/distill split unavailable; total includes irreducible rep variation)`);
  console.log(`VERIFY:${all <= 0.05 ? "PASS" : "FAIL"} table-vs-raw(total) ${T.name}`);
}
