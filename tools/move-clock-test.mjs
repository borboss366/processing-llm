#!/usr/bin/env node
/**
 * Move-clock hardening test (brief 9 Task 0b acceptance): drives the
 * creature's exported stepMoveClock frame-by-frame — no browser — through
 * the PLL scenarios that used to snap the pose:
 *
 *   1. steady lock            → applied tracks nominal, no debt build-up
 *   2. +0.46 acquisition snap → per-frame delta NEVER exceeds the 1.45×
 *      nominal cap and the jump drains over ≥ 1 beat of wall time
 *   3. backward snap (−0.46)  → clock holds, never rewinds
 *   4. BPM re-estimate 120→174 → the beat length move consumers see is
 *      low-passed (max per-frame step ≪ the raw jump)
 *
 * Prints VERIFY:PASS/FAIL move-clock.
 */

import { stepMoveClock } from "../web/app/loaded-modules/creature.js";

const failures = [];
const FPS = 60, DT = 1 / FPS;

// ── 1+2: steady lock, then a +0.46 acquisition snap ────────────────────────
{
  const state = {};
  const beatSec = 0.5;                      // 120 BPM
  let phase = 0;
  const nominal = DT / beatSec;
  for (let f = 0; f < 120; f++) {           // 2 s steady
    phase = (phase + nominal) % 1;
    stepMoveClock(state, phase, DT, beatSec);
  }
  if (state.phaseDebt > 1e-6) failures.push(`steady lock builds debt: ${state.phaseDebt}`);
  const preMax = state.mvMaxApplied;
  if (preMax > nominal * 1.001) failures.push(`steady applied ${preMax} exceeds nominal ${nominal}`);

  phase = (phase + nominal + 0.46) % 1;     // the observed acquisition snap
  stepMoveClock(state, phase, DT, beatSec);
  let frames = 1;
  while (state.phaseDebt > 1e-4 && frames < 10_000) {
    phase = (phase + nominal) % 1;
    stepMoveClock(state, phase, DT, beatSec);
    frames++;
  }
  const cap = nominal * 1.45;
  const spreadBeats = (frames * DT) / beatSec;
  if (state.mvMaxRaw < 0.45) failures.push(`snap not seen raw: maxRaw=${state.mvMaxRaw}`);
  if (state.mvMaxApplied > cap * 1.001) failures.push(`applied ${state.mvMaxApplied.toFixed(4)} exceeds cap ${cap.toFixed(4)}`);
  if (spreadBeats < 1) failures.push(`0.46 snap drained in ${spreadBeats.toFixed(2)} beats (< 1)`);
  console.log(`[move-clock] +0.46 snap: maxRaw=${state.mvMaxRaw.toFixed(3)} maxApplied=${state.mvMaxApplied.toFixed(4)} (cap ${cap.toFixed(4)}) spread=${spreadBeats.toFixed(2)} beats over ${frames} frames`);
}

// ── 3: backward snap holds, never rewinds ──────────────────────────────────
{
  const state = {};
  const beatSec = 0.5;
  let phase = 0.8;
  stepMoveClock(state, phase, DT, beatSec);
  const before = state.moveAcc;
  phase = 0.34;                             // −0.46: not a wrap (< −0.5 would be)
  stepMoveClock(state, phase, DT, beatSec);
  if (state.moveAcc < before) failures.push(`backward snap rewound the clock`);
  if (state.moveApplied !== 0) failures.push(`backward snap advanced by ${state.moveApplied} (expected hold)`);
  console.log(`[move-clock] −0.46 snap: clock held (applied=${state.moveApplied}), no rewind`);
}

// ── 4: BPM re-estimate reaches consumers low-passed ────────────────────────
{
  const state = {};
  let phase = 0;
  for (let f = 0; f < 60; f++) {
    phase = (phase + DT / 0.5) % 1;
    stepMoveClock(state, phase, DT, 0.5);   // 120 BPM
  }
  let maxStep = 0, prev = state.beatSecS;
  for (let f = 0; f < 240; f++) {
    phase = (phase + DT / 0.345) % 1;
    const s = stepMoveClock(state, phase, DT, 0.345);  // 174 BPM
    maxStep = Math.max(maxStep, Math.abs(s - prev));
    prev = s;
  }
  const rawJump = 0.5 - 0.345;
  if (maxStep > rawJump * 0.05) failures.push(`beatSec stepped ${maxStep.toFixed(4)} s in one frame (raw jump ${rawJump})`);
  if (Math.abs(state.beatSecS - 0.345) > 0.01) failures.push(`beatSec never converged: ${state.beatSecS}`);
  console.log(`[move-clock] 120→174 BPM: max per-frame beatSec step ${(maxStep * 1000).toFixed(1)} ms (raw jump ${rawJump * 1000} ms), converged to ${state.beatSecS.toFixed(3)} s`);
}

for (const f of failures) console.error(`[move-clock] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} move-clock scenarios=4`);
process.exitCode = failures.length ? 1 : 0;
