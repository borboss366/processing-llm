#!/usr/bin/env node
/**
 * Beat-phase validation against REAL audio (brief 2, Task C.1): plays a file
 * through the actual render window in headless Chrome and samples the PLL.
 *
 *   node tools/beat-test-real.mjs --file /music/track.mp3 [--bpm 128]
 *                                 [--from 60] [--dur 90]
 *
 * With --bpm (ground truth) it PASS/FAILs on ±2. Without, it reports the
 * estimate, confidence, and beat-interval regularity (wrap-interval CV).
 * Needs `npm run server` and `npm run dev` running. Real-time: --dur seconds.
 */

import { assertStackRunning, launchBrowser, openRenderWithFile, sampleBeatState } from "./render-page.mjs";

const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
const file = flags.file;
const truthBpm = flags.bpm !== undefined ? Number(flags.bpm) : null;
const fromSec = Number(flags.from ?? 0);
const durSec = Number(flags.dur ?? 90);
if (!file) {
  console.error("usage: node tools/beat-test-real.mjs --file /music/track.mp3 [--bpm N] [--from sec] [--dur sec]");
  process.exit(1);
}

await assertStackRunning();
const browser = await launchBrowser();
try {
  const page = await openRenderWithFile(browser, file, { seekSec: fromSec });
  console.log(`[beat-real] ${file} from ${fromSec}s for ${durSec}s${truthBpm ? ` (truth ${truthBpm} BPM)` : ""}`);

  const SETTLE_S = 12;
  const samples = [];
  let prevPhase = null, lastWrapMs = null;
  const wrapIntervals = [];
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < durSec) {
    const s = await sampleBeatState(page);
    const wall = Date.now();
    if ((wall - t0) / 1000 > SETTLE_S) {
      samples.push(s);
      // Beat wall-clock intervals from phase wraps (sampled at 10 Hz, so a
      // wrap is seen within ±100 ms; the CV over many beats still separates
      // "locked" from "wandering").
      if (prevPhase !== null && s.phase < prevPhase - 0.5) {
        if (lastWrapMs !== null) wrapIntervals.push(wall - lastWrapMs);
        lastWrapMs = wall;
      }
      prevPhase = s.phase;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const bpms = samples.map((s) => s.bpm).sort((a, b) => a - b);
  const medBpm = bpms[Math.floor(bpms.length / 2)] ?? 0;
  const confs = samples.map((s) => s.conf);
  const meanConf = confs.reduce((a, b) => a + b, 0) / confs.length;
  const minConf = Math.min(...confs);
  const lowSpans = confs.filter((c) => c < 0.4).length / confs.length;
  const meanInt = wrapIntervals.reduce((a, b) => a + b, 0) / (wrapIntervals.length || 1);
  const cv = wrapIntervals.length > 3
    ? Math.sqrt(wrapIntervals.reduce((a, b) => a + (b - meanInt) ** 2, 0) / wrapIntervals.length) / meanInt
    : NaN;

  console.log(
    `[beat-real] bpm median ${medBpm.toFixed(2)}${truthBpm ? ` (Δ ${(medBpm - truthBpm).toFixed(2)})` : ""} · ` +
    `conf mean ${meanConf.toFixed(2)} min ${minConf.toFixed(2)} (<0.4 for ${(lowSpans * 100).toFixed(0)}% of samples) · ` +
    `${wrapIntervals.length} beats, interval ${meanInt.toFixed(0)}ms CV ${Number.isNaN(cv) ? "n/a" : cv.toFixed(3)}`,
  );
  if (truthBpm !== null) {
    const ok = Math.abs(medBpm - truthBpm) <= 2;
    console.log(`[beat-real] ${ok ? "PASS" : "FAIL"} (±2 BPM)`);
    process.exitCode = ok ? 0 : 1;
  }
} finally {
  await browser.close();
}
