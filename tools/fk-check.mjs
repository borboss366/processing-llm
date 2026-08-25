#!/usr/bin/env node
/**
 * FK propagation acceptance (brief 13 Task 5): with hierarchical pose
 * application, scrubbing tstep's kick key must CARRY THE ANKLE through
 * space, and armwave's rotations must peak sequentially down the chain
 * (shoulder before wrist — a travelling wave, not a flap).
 *
 * Produces scrub stills (kick vs return) + a 16 s armwave webm, and
 * asserts: ankle travel ≥ 25 px between kick and return keys; handL's
 * peak rotation phase lags elbowL's; joint-speed spikes 0.
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
  console.log(`[fk] tstep ankle travel kick→return: ${travel.toFixed(0)} px (kick accRot=${kick?.accRot})`);
  if (travel < 25) failures.push(`ankle travel ${travel.toFixed(0)} px < 25`);

  // ── armwave: rotation peaks must travel down the chain ─────────────────
  await osc("/creature/move", "armwave-placeholder");
  await new Promise((r) => setTimeout(r, 1500));
  const phases = [], elbow = [], hand = [];
  for (let s = 0; s < 1; s += 0.0625) {
    await osc("/creature/phaseScrub", s);
    await new Promise((r) => setTimeout(r, 500));
    const e = await joint("elbowL"), h = await joint("handL");
    phases.push(s); elbow.push(e?.theta ?? 0); hand.push(h?.theta ?? 0);
  }
  const argmax = (a) => a.indexOf(Math.max(...a));
  const eMax = phases[argmax(elbow)], hMax = phases[argmax(hand)];
  const lag = ((hMax - eMax) + 1) % 1;
  console.log(`[fk] armwave peaks: elbowL@${eMax.toFixed(2)} handL@${hMax.toFixed(2)} (lag ${lag.toFixed(2)} of loop)`);
  if (lag <= 0 || lag > 0.5) failures.push(`wave does not travel outward (lag ${lag.toFixed(2)})`);

  // ── live armwave webm + spike gate ─────────────────────────────────────
  await osc("/creature/clockMode", "live");
  const rec = await page.screencast({ path: path.join(ROOT, "reports/fk-armwave.webm") });
  await new Promise((r) => setTimeout(r, 16_000));
  await rec.stop();
  const spikes = await page.evaluate(() => window.__creatureBench?.spikesFlagged ?? -1);
  console.log(`[fk] spikesFlagged=${spikes} · wrote fk-tstep-{kick,return}.png + fk-armwave.webm`);
  if (spikes !== 0) failures.push(`spikes=${spikes}`);
} catch (e) {
  failures.push(String(e));
} finally {
  await browser.close();
}
for (const f of failures) console.error(`[fk] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} fk-check`);
process.exitCode = failures.length ? 1 : 0;
