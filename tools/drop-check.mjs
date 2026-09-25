#!/usr/bin/env node
/**
 * Drop reactivity acceptance (brief 17 C): over the gridded Darude track,
 * the audio layer must precompute drops; approaching one, the creature
 * PRE-ARMS (bench.dropArmed) and at the boundary FIRES: dropsFired
 * increments, an immediate move re-pick happens (move changes without
 * waiting out moveHoldBars), spikes stay 0 (fillKey snap is declared).
 *
 *   node tools/drop-check.mjs
 */
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const TRACK = "/music/Y2Mate.is - Darude - Sandstorm.mp3";
const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const osc = (address, value) => post("/osc", { address, value });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await assertStackRunning();
const failures = [];
const browser2 = await launchBrowser();
try {
  const page = await openRenderWithFile(browser2, TRACK, { seekSec: 0 });
  const dropLine = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 20000);
    page.on("console", (m) => {
      const t = m.text();
      if (t.includes("drops precomputed")) { clearTimeout(timer); resolve(t); }
    });
  });
  console.log(`[drop] ${dropLine ?? "NO precompute line within 20 s"}`);
  if (!dropLine) { failures.push("drops never precomputed"); throw new Error("no drops"); }
  const times = [...dropLine.matchAll(/(\d+\.\d)s/g)].map((m) => +m[1]);
  if (!times.length) { failures.push("drop list empty"); throw new Error("empty"); }
  const target = times.find((t) => t > 30) ?? times[0];
  console.log(`[drop] ${times.length} drops; targeting ${target}s`);

  await post("/browser-modules/load", { id: "creature" });
  await sleep(1500);
  await osc("/creature/entryConf", 0);
  await osc("/creature/behavior", "groove");
  await osc("/post/post", 0);
  await post("/browser-modules/trigger", { id: "creature" });
  await sleep(4000);
  await page.evaluate((t) => { document.querySelector("audio,video")?.fastSeek?.(t); const el = document.querySelector("audio,video"); if (el) el.currentTime = t; }, target - 12);
  await sleep(3000);

  let armed = false, fired = 0, moveAtArm = null, moveAfter = null, spikes = -1, firedAtMs = 0;
  for (let t = 0; t < 60; t++) {
    await sleep(300);
    const s = await page.evaluate(() => ({
      nd: window.__creatureBench?.nextDropInBeats, armed: window.__creatureBench?.dropArmed,
      fired: window.__creatureBench?.dropsFired, move: window.__creatureBench?.move,
      spikes: window.__creatureBench?.spikesFlagged,
    }));
    if (s.armed && !armed) { armed = true; moveAtArm = s.move; console.log(`[drop] PRE-ARM at nextDrop ${s.nd} beats (move=${s.move})`); }
    if ((s.fired ?? 0) > fired) { fired = s.fired; firedAtMs = Date.now(); console.log(`[drop] FIRED (#${fired})`); }
    if (fired) console.log(`[drop]   +${((Date.now() - firedAtMs) / 1000).toFixed(1)}s move=${s.move} nd=${s.nd}`);
    if (fired && Date.now() - firedAtMs > 4000) { moveAfter = s.move; spikes = s.spikes; break; }
  }
  console.log(`[drop] armed=${armed} fired=${fired} move ${moveAtArm} → ${moveAfter} spikes=${spikes}`);
  if (!armed) failures.push("never pre-armed");
  if (!fired) failures.push("never fired");
  if (fired && moveAfter === moveAtArm) failures.push(`no re-pick after drop (still ${moveAfter})`);
  if (spikes !== 0) failures.push(`spikes=${spikes}`);
} catch (e) {
  if (!failures.length) failures.push(String(e));
} finally {
  await browser2.close();
}
for (const f of failures) console.error(`[drop] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} drop-check`);
process.exitCode = failures.length ? 1 : 0;
