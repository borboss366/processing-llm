#!/usr/bin/env node
/**
 * Beat-phase validation against REAL audio: plays a file through the actual
 * render window in headless Chrome and samples the PLL.
 *
 * Single track:
 *   node tools/beat-test-real.mjs --file /music/track.mp3 [--bpm 128]
 *                                 [--from 60] [--dur 90]
 * Genre matrix (the 4 reference tracks; missing files are skipped):
 *   node tools/beat-test-real.mjs --verify
 *
 * BPM judged as the median over samples with beatConfidence ≥ 0.5 (breakdown
 * sag is by-design and confidence says so); PASS bound ±2 vs --bpm truth.
 * Needs `npm run server` and `npm run dev` running. Real-time.
 *
 * Run ONE instance at a time: parallel headless browsers contend for CPU and
 * skew the estimate low (measured: -3.5 BPM under 3-way load, -0.0 solo).
 * To establish a new file's true BPM: afconvert to mono WAV, then
 * `node tools/wav-tempo.mjs <file.wav> [fromSec] [durSec]`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile, sampleBeatState } from "./render-page.mjs";
import { parseArgs } from "./args.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The validated genre matrix (reports/2026-08-22-pll-genre-matrix.md).
// tol: pass bound in BPM. The syncopated 2-step is genuinely marginal —
// confident-median wanders ±2.5 across runs (low confident-sample fraction),
// so it gets a longer window and a documented ±3.
const MATRIX = [
  { name: "techno-4x4", file: "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3", bpm: 125, from: 120, dur: 60 },
  { name: "2step-sync", file: "/music/Y2Mate.is - MJ Cole - Sincere - Original UK Garage.mp3", bpm: 134, from: 40, dur: 100, tol: 3 },
  { name: "dnb-174", file: "/music/Y2Mate.is - Pendulum - Hold your Colour.mp3", bpm: 174, from: 100, dur: 75 },
  { name: "breakdowns", file: "/music/Y2Mate.is - Darude - Sandstorm.mp3", bpm: 136, from: 30, dur: 75 },
];

async function runTrack(browser, { file, bpm = null, from = 0, dur = 90, tol = 2 }) {
  const page = await openRenderWithFile(browser, file, { seekSec: from, extra: "clock=pll" });   // grids exist for all tracks now — this matrix measures the PLL tier
  console.log(`[beat-real] ${file} from ${from}s for ${dur}s${bpm ? ` (truth ${bpm} BPM)` : ""}`);

  const SETTLE_S = 12;
  const samples = [];
  let prevPhase = null, lastWrapMs = null;
  const wrapIntervals = [];
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < dur) {
    const s = await sampleBeatState(page);
    const wall = Date.now();
    if ((wall - t0) / 1000 > SETTLE_S) {
      samples.push(s);
      if (prevPhase !== null && s.phase < prevPhase - 0.5) {
        if (lastWrapMs !== null) wrapIntervals.push(wall - lastWrapMs);
        lastWrapMs = wall;
      }
      prevPhase = s.phase;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.close();

  const bpms = samples.map((s) => s.bpm).sort((a, b) => a - b);
  const medBpm = bpms[Math.floor(bpms.length / 2)] ?? 0;
  const confBpms = samples.filter((s) => s.conf >= 0.5).map((s) => s.bpm).sort((a, b) => a - b);
  const medConfBpm = confBpms[Math.floor(confBpms.length / 2)] ?? medBpm;
  const confs = samples.map((s) => s.conf);
  const meanConf = confs.reduce((a, b) => a + b, 0) / (confs.length || 1);
  const minConf = confs.length ? Math.min(...confs) : 0;
  const lowFrac = confs.filter((c) => c < 0.4).length / (confs.length || 1);
  const meanInt = wrapIntervals.reduce((a, b) => a + b, 0) / (wrapIntervals.length || 1);
  const cv = wrapIntervals.length > 3
    ? Math.sqrt(wrapIntervals.reduce((a, b) => a + (b - meanInt) ** 2, 0) / wrapIntervals.length) / meanInt
    : NaN;

  console.log(
    `[beat-real] bpm median ${medBpm.toFixed(2)} / confident ${medConfBpm.toFixed(2)}` +
    `${bpm ? ` (Δ ${(medConfBpm - bpm).toFixed(2)} vs truth)` : ""} · ` +
    `conf mean ${meanConf.toFixed(2)} min ${minConf.toFixed(2)} (<0.4 for ${(lowFrac * 100).toFixed(0)}%) · ` +
    `${wrapIntervals.length} beats, interval ${meanInt.toFixed(0)}ms CV ${Number.isNaN(cv) ? "n/a" : cv.toFixed(3)}`,
  );
  return { medConfBpm, pass: bpm === null ? null : Math.abs(medConfBpm - bpm) <= tol };
}

const { flags } = parseArgs(process.argv.slice(2));

await assertStackRunning();
const browser = await launchBrowser();
try {
  if (flags.verify) {
    const results = [];
    let skipped = 0;
    for (const t of MATRIX) {
      const local = path.join(ROOT, t.file.replace(/^\/music\//, "music/"));
      if (!fs.existsSync(local)) { console.log(`[beat-real] skip ${t.name}: ${t.file} missing`); skipped++; continue; }
      // fresh browser per track + a 15 s cool-down (reused swiftshader
      // processes accumulate jank; measured −5 BPM on DnB once). KNOWN
      // RESIDUAL FLAKE, 2026-08-23: dnb-174 is BISTABLE across runs — it
      // either locks 174 (Δ<0.5) or settles a confidently-wrong attractor
      // (~154, CV 0.33): the octave hysteresis in core/audio.js makes early
      // wrong locks sticky (174/154 ≈ 1.13 is outside its half/double
      // correction windows) and refinePeriod self-confirms them. Needs a
      // dedicated PLL work item; do not paper over with tolerance.
      await new Promise((res) => setTimeout(res, 15_000));
      const b = await launchBrowser();
      let r;
      try { r = await runTrack(b, t); } finally { await b.close(); }
      results.push({ name: t.name, ...r });
    }
    const failed = results.filter((r) => r.pass === false).map((r) => r.name);
    const ok = results.length > 0 && failed.length === 0;
    console.log(ok
      ? `VERIFY:PASS pll-real-tracks tracks=${results.length} skipped=${skipped}`
      : `VERIFY:FAIL pll-real-tracks reason=${results.length ? failed.join(",") : "no-tracks"}`);
    process.exitCode = ok ? 0 : 1;
  } else {
    const file = typeof flags.file === "string" ? flags.file : null;
    if (!file) {
      console.error("usage: node tools/beat-test-real.mjs --file /music/track.mp3 [--bpm N] [--from s] [--dur s] | --verify");
      process.exit(1);
    }
    const r = await runTrack(browser, {
      file,
      bpm: flags.bpm !== undefined ? Number(flags.bpm) : null,
      from: Number(flags.from ?? 0),
      dur: Number(flags.dur ?? 90),
    });
    if (r.pass !== null) {
      console.log(`VERIFY:${r.pass ? "PASS" : "FAIL"} pll-real-track bpm=${r.medConfBpm.toFixed(2)}`);
      process.exitCode = r.pass ? 0 : 1;
    }
  }
} finally {
  await browser.close();
}
