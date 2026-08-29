#!/usr/bin/env node
/**
 * Low-tempo band regression (60–95 BPM; brief 4 wishlist, landed with the
 * user's tracks 2026-08-30). Two PLL-tier runs:
 *
 *   Dr. Dre – Still D.R.E. (truth 93)  → strict ±2 gate (locks clean)
 *   Queen – We Will Rock You (truth 81) → OCTAVE-DOCUMENTED: the
 *     stomp-stomp-clap presents ~162 events/min and the 120-centred prior
 *     confidently takes the upper octave (measured 161.25 at conf 0.55).
 *     Gated mod-octave (±3 of 81 or 162) so a regression to anything else
 *     is caught; per the standing doctrine the prior is NOT tuned — the
 *     grid tier owns file playback (sidecar: 81.3 exact).
 *
 *   node tools/low-tempo-check.mjs
 */
import { spawnSync } from "node:child_process";

const RUNS = [
  { file: "/music/Dr. Dre - Still D.R.E. ft. Snoop Dogg - DrDreVEVO.mp3", truth: 93, octaveOk: false },
  { file: "/music/Queen - We Will Rock You [Lyrics] - GlyphoricVibes (1).mp3", truth: 81, octaveOk: true },
];

let failed = 0;
for (const r of RUNS) {
  const out = spawnSync("node", ["tools/beat-test-real.mjs", "--file", r.file, "--bpm", String(r.truth)],
    { encoding: "utf8" });
  const text = (out.stdout ?? "") + (out.stderr ?? "");
  const m = /confident ([\d.]+)/.exec(text);
  const bpm = m ? Number(m[1]) : NaN;
  const errs = [Math.abs(bpm - r.truth), ...(r.octaveOk ? [Math.abs(bpm - r.truth * 2), Math.abs(bpm - r.truth / 2)] : [])];
  const ok = Number.isFinite(bpm) && Math.min(...errs) <= (r.octaveOk ? 3 : 2);
  console.log(`[low-tempo] ${r.file.split("/").pop()}: confident ${bpm} vs truth ${r.truth}${r.octaveOk ? " (octave-documented)" : ""} → ${ok ? "ok" : "FAIL"}`);
  if (!ok) failed++;
}
console.log(`VERIFY:${failed ? "FAIL" : "PASS"} low-tempo tracks=${RUNS.length - failed}/${RUNS.length}`);
process.exitCode = failed ? 1 : 0;
