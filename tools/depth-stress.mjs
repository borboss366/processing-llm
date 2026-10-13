#!/usr/bin/env node
/**
 * Depth-cue render stress (brief 17.5 Task 3): every limb's `depth` sweeps
 * −1 → +1 → −1 at three speeds (slow · beat · snap). Asserts, per mode:
 *   - spikesFlagged +0, components 1, no NaN joint
 *   - no pop at zero: wherever |depth| < 0.05 the size factor stays within
 *     gain·0.05·dial of 1, and the factor always equals its formula
 *     (continuous in depth by construction — this proves the wiring)
 *   - overlap never oscillates: ≤ 4 arm draw-order flips per loop
 *     (behind → neutral → front → neutral → behind); more = chatter
 *
 *   node tools/depth-stress.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOVES = path.join(ROOT, "web/app/moves");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const osc = (address, value) => post("/osc", { address, value });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const LIMB_BONES = ["shoulderL", "elbowL", "shoulderR", "elbowR", "hipL", "kneeL", "ankleL", "hipR", "kneeR", "ankleR"];
const sweep = (d) => Object.fromEntries(LIMB_BONES.map((b) => [b, { depth: d }]));
const MODES = [
  { mode: "slow", bpl: 8, ease: "smooth", seconds: 9 },
  { mode: "beat", bpl: 1, ease: "smooth", seconds: 5 },
  { mode: "snap", bpl: 1, ease: "snap", seconds: 5 },
];
const tableFor = (m) => ({
  name: `depth-stress-${m.mode}`, beatsPerLoop: m.bpl, overlay: 0,
  keys: [
    { phase: 0, joints: sweep(-1), contacts: [], ease: m.ease },
    { phase: 0.5, joints: sweep(1), contacts: [], ease: m.ease },
  ],
});

const componentsSnippet = () => {
  const c = window.__creatureAccum, perf = window.__creaturePerf;
  if (!c || !perf) return -1;
  if (!window.__dsScratch) {
    window.__dsScratch = document.createElement("canvas");
    window.__dsScratchG = window.__dsScratch.getContext("2d", { willReadFrequently: true });
  }
  const w = c.width, h = c.height;
  if (window.__dsScratch.width !== w || window.__dsScratch.height !== h) { window.__dsScratch.width = w; window.__dsScratch.height = h; }
  window.__dsScratchG.clearRect(0, 0, w, h);
  window.__dsScratchG.drawImage(c, 0, 0);
  const a = window.__dsScratchG.getImageData(0, 0, w, h).data;
  const thr = (perf.d0 ?? 0.18) * 255;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = a[i * 4 + 3] >= thr ? 1 : 0;
  let comps = 0;
  const stack = [];
  for (let s = 0; s < w * h; s++) {
    if (mask[s] !== 1) continue;
    let area = 0; stack.push(s); mask[s] = 2;
    while (stack.length) {
      const q = stack.pop(); area++;
      const qx = q % w, qy = (q / w) | 0;
      if (qx > 0 && mask[q - 1] === 1) { mask[q - 1] = 2; stack.push(q - 1); }
      if (qx < w - 1 && mask[q + 1] === 1) { mask[q + 1] = 2; stack.push(q + 1); }
      if (qy > 0 && mask[q - w] === 1) { mask[q - w] = 2; stack.push(q - w); }
      if (qy < h - 1 && mask[q + w] === 1) { mask[q + w] = 2; stack.push(q + w); }
    }
    if (area >= 4) comps++;
  }
  return comps;
};
const sampleSnippet = () => {
  const s = window.__creatureStateDbg;
  if (!s?.cueSize) return null;
  return {
    nan: s.joints.some((j) => !Number.isFinite(j.ax + j.ay + (j.depth ?? 0))),
    dial: s.cueK,
    gains: s.depthCues.gains, floor: s.depthCues.sizeFloor,
    bones: s.bones.map((B, bi) => ({ role: B.cueRole, d: s.joints[B.p].depth ?? 0, size: s.cueSize[bi] })),
    flips: { ...(s.ovlFlips ?? {}) },
    moveAcc: s.moveAcc, bpl: s.activeMoveBpl ?? 1,
    spikes: window.__creatureBench?.spikesFlagged ?? 0,
  };
};

await assertStackRunning();
for (const m of MODES) await fs.writeFile(path.join(MOVES, `depth-stress-${m.mode}.json`), JSON.stringify(tableFor(m)));
const failures = [];
const browser = await launchBrowser();
try {
  const page = await openRenderWithFile(browser, MIX, { seekSec: 300 });
  await post("/browser-modules/load", { id: "creature" });
  await sleep(1500);
  await osc("/creature/entryConf", 0); await osc("/creature/behavior", "groove"); await osc("/post/post", 0);
  await post("/browser-modules/trigger", { id: "creature" });
  await sleep(5000);
  for (const m of MODES) {
    await osc("/creature/move", `depth-stress-${m.mode}`);
    await sleep(5000);                                   // crossfade fully in
    const first = await page.evaluate(sampleSnippet);
    let worstZero = 0, worstFormula = 0, nan = false, comps = new Set(), last = first;
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < m.seconds * 1000) {
      await sleep(100);
      const s = await page.evaluate(sampleSnippet);
      if (!s) continue;
      last = s;
      if (s.nan) nan = true;
      for (const b of s.bones) {
        const g = s.gains[b.role] ?? 0;
        const want = Math.max(s.floor, 1 + g * b.d * s.dial);
        worstFormula = Math.max(worstFormula, Math.abs(b.size - want));
        if (Math.abs(b.d) < 0.05) worstZero = Math.max(worstZero, Math.abs(b.size - 1) - g * 0.05 * s.dial);
      }
      if (i++ % 6 === 0) comps.add(await page.evaluate(componentsSnippet));
    }
    const loops = Math.max(1, (last.moveAcc - first.moveAcc) / last.bpl);
    const flipsL = (last.flips.limb2 ?? 0) - (first.flips.limb2 ?? 0);
    const flipsR = (last.flips.limb3 ?? 0) - (first.flips.limb3 ?? 0);
    const spikes = last.spikes - first.spikes;
    const perLoop = Math.max(flipsL, flipsR) / loops;
    // a sampling window cuts loops mid-way: each loop STARTED may complete
    // its 4 transitions, so the bound is 4 × ⌈loops⌉, not 4 × loops
    const maxFlips = 4 * Math.ceil(loops);
    console.log(`[depth-stress] ${m.mode.padEnd(4)}: loops ${loops.toFixed(1)} · overlap flips L ${flipsL} R ${flipsR} (${perLoop.toFixed(2)}/loop; bound ${maxFlips}) · zero-crossing excess ${Math.max(0, worstZero).toExponential(1)} · formula err ${worstFormula.toExponential(1)} · components ${[...comps].join(",")} · spikes +${spikes} · NaN ${nan}`);
    if (spikes !== 0) failures.push(`${m.mode}: spikes +${spikes}`);
    if (nan) failures.push(`${m.mode}: NaN joint`);
    if ([...comps].some((c) => c !== 1)) failures.push(`${m.mode}: components ${[...comps]}`);
    if (worstZero > 1e-6) failures.push(`${m.mode}: size pops at the zero crossing (${worstZero.toFixed(4)})`);
    if (worstFormula > 1e-4) failures.push(`${m.mode}: size factor off its formula by ${worstFormula.toFixed(4)}`);
    if (Math.max(flipsL, flipsR) > maxFlips) failures.push(`${m.mode}: overlap chatters (${Math.max(flipsL, flipsR)} flips > ${maxFlips} for ${loops.toFixed(1)} loops)`);
  }
  await osc("/creature/move", "none");
} catch (e) {
  failures.push(String(e));
} finally {
  await browser.close();
  for (const m of MODES) await fs.rm(path.join(MOVES, `depth-stress-${m.mode}.json`), { force: true });
}
for (const f of failures) console.error(`[depth-stress] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} depth-stress`);
process.exitCode = failures.length ? 1 : 0;
