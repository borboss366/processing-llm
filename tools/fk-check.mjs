#!/usr/bin/env node
/**
 * FK propagation acceptance (brief 13 Task 5): with hierarchical pose
 * application, scrubbing tstep's kick key must CARRY THE ANKLE through
 * space, and armwave's rotations must peak sequentially down the chain
 * (shoulder before wrist — a travelling wave, not a flap).
 *
 * Produces scrub stills (kick, return, heel pivot) + a live webm cycling
 * all three re-authored moves, and asserts: kick-foot travel ≥ 25 px
 * between keys; heel pivot = planted toe drifts ≤ 6 px while its ankle
 * swings ≥ 4 px (brief 14); rotation peaks migrate shoulder→elbow→wrist;
 * joint-speed spikes 0.
 *
 *   node tools/fk-check.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const osc = (address, value) => post("/osc", { address, value });

await assertStackRunning();
const failures = [];
const browser = await launchBrowser();
try {
  const page = await openRenderWithFile(browser, MIX, { seekSec: 300 });
  await post("/browser-modules/load", { id: "creature" });
  await new Promise((r) => setTimeout(r, 1500));
  await osc("/creature/entryConf", 0);
  await osc("/creature/behavior", "groove");
  await osc("/post/post", 0);
  await post("/browser-modules/trigger", { id: "creature" });
  await new Promise((r) => setTimeout(r, 8000));

  const joint = (name) => page.evaluate((n) =>
    window.__creatureJoints?.find((j) => j.name === n) ?? null, name);

  // ── tstep kick: ankle must travel with the hip/knee rotations ──────────
  await osc("/creature/move", "tstep-placeholder");
  await new Promise((r) => setTimeout(r, 2500));
  await osc("/creature/clockMode", "manual");
  await osc("/creature/phaseScrub", 0);          // kick key
  await new Promise((r) => setTimeout(r, 1200));
  const kick = await joint("footL");
  await page.screenshot({ path: path.join(ROOT, "reports/fk-tstep-kick.png") });
  await osc("/creature/phaseScrub", 0.25);       // return key
  await new Promise((r) => setTimeout(r, 1200));
  const ret = await joint("footL");
  await page.screenshot({ path: path.join(ROOT, "reports/fk-tstep-return.png") });
  const travel = kick && ret ? Math.hypot(kick.sx - ret.sx, kick.sy - ret.sy) : 0;
  console.log(`[fk] tstep kick-foot travel kick→return: ${travel.toFixed(0)} px (kick accRot=${kick?.accRot})`);
  if (travel < 25) failures.push(`kick-foot travel ${travel.toFixed(0)} px < 25`);

  // ── heel pivot (brief 14): weight-side toe stays PLANTED while its ankle
  //    swings about it (ankleR rot 0.35 → 0.08 between the two keys)
  await osc("/creature/phaseScrub", 0);
  await new Promise((r) => setTimeout(r, 1200));
  const [toe0, ank0] = [await joint("footR"), await joint("ankleR")];
  await osc("/creature/phaseScrub", 0.25);
  await new Promise((r) => setTimeout(r, 1200));
  const [toe1, ank1] = [await joint("footR"), await joint("ankleR")];
  const toeDrift = toe0 && toe1 ? Math.hypot(toe0.sx - toe1.sx, toe0.sy - toe1.sy) : 999;
  const ankSwing = ank0 && ank1 ? Math.hypot(ank0.sx - ank1.sx, ank0.sy - ank1.sy) : 0;
  console.log(`[fk] heel pivot: toe drift ${toeDrift.toFixed(1)} px, ankle swing ${ankSwing.toFixed(1)} px`);
  if (toeDrift > 6) failures.push(`planted toe drifted ${toeDrift.toFixed(1)} px > 6`);
  if (ankSwing < 4) failures.push(`ankle swing ${ankSwing.toFixed(1)} px < 4 — no pivot`);
  await page.screenshot({ path: path.join(ROOT, "reports/fk-heel-pivot.png") });

  // ── armwave: rotation peaks must travel down the chain ─────────────────
  await osc("/creature/move", "armwave-placeholder");
  await new Promise((r) => setTimeout(r, 1500));
  const phases = [], shoulder = [], elbow = [], hand = [];
  for (let s = 0; s < 1; s += 0.0625) {
    await osc("/creature/phaseScrub", s);
    await new Promise((r) => setTimeout(r, 500));
    const sh = await joint("shoulderL"), e = await joint("elbowL"), h = await joint("handL");
    phases.push(s); shoulder.push(sh?.theta ?? 0); elbow.push(e?.theta ?? 0); hand.push(h?.theta ?? 0);
  }
  // first-harmonic phase (f = 2 oscillations/loop): argmax on a 1/16 scrub
  // grid cannot resolve the 0.025-loop per-link lag — project onto the
  // fundamental instead and read a continuous phase per joint
  const F = 2;
  const harmPhase = (vals) => {
    let cs = 0, sn = 0;
    for (let i = 0; i < vals.length; i++) {
      cs += vals[i] * Math.cos(2 * Math.PI * F * phases[i]);
      sn += vals[i] * Math.sin(2 * Math.PI * F * phases[i]);
    }
    return Math.atan2(cs, sn) / (2 * Math.PI * F);   // loop units, peak offset
  };
  const sPh = harmPhase(shoulder), ePh = harmPhase(elbow), hPh = harmPhase(hand);
  const HALF = 1 / (2 * F);                          // half an oscillation period
  // atan2(cs,sn) of sin(x−φ₀) returns −φ₀, so a joint lagging in TIME reads
  // a SMALLER harmonic phase — outward travel is a→b DECREASING
  const lagOf = (a, b) => ((a - b) % HALF + HALF) % HALF;
  const lagSE = lagOf(sPh, ePh), lagEH = lagOf(ePh, hPh);
  console.log(`[fk] armwave harmonic phases: shoulderL@${sPh.toFixed(3)} elbowL@${ePh.toFixed(3)} handL@${hPh.toFixed(3)} (lags ${lagSE.toFixed(3)}/${lagEH.toFixed(3)} of loop, authored 0.025)`);
  if (lagSE < 0.008 || lagSE > 0.1) failures.push(`wave does not travel shoulder→elbow (lag ${lagSE.toFixed(3)})`);
  if (lagEH < 0.008 || lagEH > 0.1) failures.push(`wave does not travel elbow→wrist (lag ${lagEH.toFixed(3)})`);

  // ── live webm of all three re-authored moves + spike gate (brief 14) ───
  await osc("/creature/clockMode", "live");
  const rec = await page.screencast({ path: path.join(ROOT, "reports/fk-moves.webm") });
  for (const mv of ["armwave-placeholder", "tstep-placeholder", "groove"]) {
    await osc("/creature/move", mv);
    await new Promise((r) => setTimeout(r, 8000));
  }
  await rec.stop();
  const spikes = await page.evaluate(() => window.__creatureBench?.spikesFlagged ?? -1);
  console.log(`[fk] spikesFlagged=${spikes} · wrote fk-tstep-{kick,return}.png + fk-heel-pivot.png + fk-moves.webm`);
  if (spikes !== 0) failures.push(`spikes=${spikes}`);
} catch (e) {
  failures.push(String(e));
} finally {
  await browser.close();
}
for (const f of failures) console.error(`[fk] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} fk-check`);
process.exitCode = failures.length ? 1 : 0;
