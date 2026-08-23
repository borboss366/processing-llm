#!/usr/bin/env node
/**
 * Beat-phase acceptance harness for core/audio.js (brief Task 3):
 * drives tick() with a synthetic clock + synthetic kick spectrum and checks
 *   - bpm reads within ±2 of truth
 *   - beatPhase stays locked (measured at every true beat) for 60 s
 * at both 60 Hz and 120 Hz tick rates, plus a non-integer-lag tempo.
 *
 *   node tools/beat-test.mjs
 *
 * Exits non-zero if any scenario fails.
 */

import { createAudio } from "../web/app/src/core/audio.js";

const BIN_COUNT = 512;
const KICK_DECAY_MS = 90;
const SETTLE_MS = 10_000;    // ignore the first 10 s (buffers filling, PLL locking)
const RUN_MS = 70_000;       // 10 s settle + 60 s measured

function runScenario({ bpm, tickHz }) {
  const audio = createAudio();
  const freq = new Float64Array(BIN_COUNT).fill(-80);
  audio._injectAnalyser({
    getFloatFrequencyData(arr) { for (let i = 0; i < BIN_COUNT; i++) arr[i] = freq[i]; },
  });

  const dt = 1000 / tickHz;
  const beatMs = 60000 / bpm;
  let kickEnv = 0;
  let nextBeatMs = 1000;      // first kick at t=1 s

  const bpmSamples = [];
  const phaseErrs = [];       // |phase error| in beats, sampled at each true beat
  let beatJustFired = false;

  for (let t = 0; t < RUN_MS; t += dt) {
    if (t >= nextBeatMs) {
      kickEnv = 1;
      nextBeatMs += beatMs;
      beatJustFired = true;
    } else {
      kickEnv *= Math.exp(-dt / KICK_DECAY_MS);
    }
    // kick: bins 0-5 punch up to -15 dB; steady mids with a little noise
    for (let i = 0; i < 6; i++)   freq[i] = -80 + kickEnv * 65;
    for (let i = 6; i < 60; i++)  freq[i] = -65 + (Math.random() - 0.5) * 3;
    for (let i = 60; i < BIN_COUNT; i++) freq[i] = -78 + (Math.random() - 0.5) * 2;

    const s = audio.tick(t);

    if (t >= SETTLE_MS) {
      if (beatJustFired) {
        // phase should be ~0 right after a true beat (≤1 tick of latency)
        const err = Math.min(s.beatPhase, 1 - s.beatPhase);
        phaseErrs.push(err);
      }
      bpmSamples.push(s.bpm);
    }
    beatJustFired = false;
  }

  bpmSamples.sort((a, b) => a - b);
  const medianBpm = bpmSamples[Math.floor(bpmSamples.length / 2)];
  const meanErr = phaseErrs.reduce((a, b) => a + b, 0) / phaseErrs.length;
  const maxErr = Math.max(...phaseErrs);
  // one tick of measurement latency is inherent — allow it on top of the bound
  const tickInBeats = dt / beatMs;
  const bpmOk = Math.abs(medianBpm - bpm) <= 2;
  const lockOk = maxErr <= 0.1 + tickInBeats;
  const conf = audio.state.beatConfidence;

  console.log(
    `${String(bpm).padStart(3)} BPM @ ${String(tickHz).padStart(3)} Hz · ` +
    `bpm ${medianBpm.toFixed(2).padStart(7)} (target ${bpm}, Δ ${(medianBpm - bpm).toFixed(2)}) ` +
    `· phase err mean ${meanErr.toFixed(3)} max ${maxErr.toFixed(3)} over ${phaseErrs.length} beats ` +
    `· conf ${conf.toFixed(2)} · ${bpmOk && lockOk ? "PASS" : "FAIL"}`,
  );
  return bpmOk && lockOk;
}

const scenarios = [
  { bpm: 120, tickHz: 60 },
  { bpm: 120, tickHz: 120 },
  { bpm: 128, tickHz: 60 },   // non-integer lag: exercises parabolic interpolation
  { bpm: 174, tickHz: 60 },   // drum'n'bass corner of the 60-180 range
];

let allOk = true;
const failed = [];
for (const sc of scenarios) {
  const ok = runScenario(sc);
  if (!ok) failed.push(`${sc.bpm}bpm@${sc.tickHz}hz`);
  allOk = ok && allOk;
}
console.log(allOk
  ? `VERIFY:PASS pll-synthetic scenarios=${scenarios.length}`
  : `VERIFY:FAIL pll-synthetic reason=${failed.join(",")}`);
process.exit(allOk ? 0 : 1);
