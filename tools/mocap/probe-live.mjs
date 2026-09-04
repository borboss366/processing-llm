#!/usr/bin/env node
// Quick health probe for a captured move table (brief 16 Task 2): load the
// creature headless, play the table live + scrub it, assert 0 spikes, finite
// joints, single component. Not the done-bar (the user judges that) — this
// catches NaN/spike regressions before the user ever sees the move.
//   node tools/mocap/probe-live.mjs <move-name> [seconds]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "../render-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const MOVE = process.argv[2] ?? "tstep-captured";
const SECS = +(process.argv[3] ?? 25);
const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const osc = (address, value) => post("/osc", { address, value });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await assertStackRunning();
const failures = [];
const browser = await launchBrowser();
try {
  const page = await openRenderWithFile(browser, MIX, { seekSec: 300 });
  await post("/browser-modules/load", { id: "creature" });
  await sleep(1500);
  await osc("/creature/entryConf", 0);
  await osc("/creature/behavior", "groove");
  await osc("/post/post", 0);
  await post("/browser-modules/trigger", { id: "creature" });
  await sleep(6000);
  await osc("/creature/move", MOVE);
  await sleep(SECS * 1000);
  const live = await page.evaluate(() => ({
    spikes: window.__creatureBench?.spikesFlagged ?? -1,
    move: window.__creatureBench?.move,
    comps: window.__creatureBench?.components ?? -1,
    badJoints: (window.__creatureJoints ?? []).filter((j) => !Number.isFinite(j.sx + j.sy + j.theta)).length,
  }));
  console.log(`[probe] live ${SECS}s: move=${live.move} spikes=${live.spikes} components=${live.comps} nonFiniteJoints=${live.badJoints}`);
  if (live.move !== MOVE) failures.push(`move is ${live.move}, wanted ${MOVE}`);
  if (live.spikes !== 0) failures.push(`spikes=${live.spikes}`);
  if (live.badJoints) failures.push(`${live.badJoints} non-finite joints`);
  // scrub pass: every 1/16 of the loop must produce finite joints
  await osc("/creature/clockMode", "manual");
  for (let s = 0; s < 1; s += 0.0625) {
    await osc("/creature/phaseScrub", s);
    await sleep(350);
    const bad = await page.evaluate(() =>
      (window.__creatureJoints ?? []).filter((j) => !Number.isFinite(j.sx + j.sy + j.theta)).length);
    if (bad) failures.push(`scrub ${s}: ${bad} non-finite joints`);
  }
  await osc("/creature/clockMode", "live");
  const end = await page.evaluate(() => window.__creatureBench?.spikesFlagged ?? -1);
  console.log(`[probe] after scrub pass: spikes=${end}`);
  if (end !== 0) failures.push(`spikes after scrub=${end}`);
} catch (e) {
  failures.push(String(e));
} finally {
  await browser.close();
}
for (const f of failures) console.error(`[probe] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} mocap-probe-live`);
process.exitCode = failures.length ? 1 : 0;
