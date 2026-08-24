#!/usr/bin/env node
/**
 * Move workbench check (brief 12): drives the full authoring loop headless
 * and records it — force a move, enter manual, scrub poses, edit the JSON
 * on disk (hot-push through the watcher), play from here — then asserts:
 *
 *   - the hot edit actually reached the creature (table version bumped)
 *   - a JSON parse error is broadcast and does NOT reach the creature
 *   - manual→live re-entry is snap-free: 0 flagged joint-speed spikes
 *     across the whole session (metric on throughout)
 *
 * Writes reports/workbench.webm + scrub stills. Restores the move file.
 *
 *   node tools/workbench-check.mjs
 */

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const require = createRequire("/Users/borboss366/WebstormProjects/processing-llm/web/app/package.json");
const { WebSocket } = require("ws");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const MOVE_FILE = path.join(ROOT, "web/app/moves/groove.json");

const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const osc = (address, value) => post("/osc", { address, value });

await assertStackRunning();
const original = await fs.readFile(MOVE_FILE, "utf8");
const failures = [];
const browser = await launchBrowser();
const ws = new WebSocket("ws://localhost:3000/ws");
await new Promise((r) => ws.on("open", r));
const wsSeen = [];
ws.on("message", (raw) => { try { wsSeen.push(JSON.parse(String(raw)).type); } catch {} });

try {
  const page = await openRenderWithFile(browser, MIX, { seekSec: 300 });
  // bg stays ON (clean preset): a fully idle page runs rAF at 120 Hz in
  // headless Chrome and the PLL loses confidence at that rate — open
  // finding, logged in the report; not a workbench problem
  ws.send(JSON.stringify({ type: "load-preset-by-name", name: "Flexi - mindblob [shiny mix]", blendSec: 0 }));
  await post("/browser-modules/load", { id: "creature" });
  await new Promise((r) => setTimeout(r, 1500));
  await osc("/post/post", 0);
  await post("/browser-modules/trigger", { id: "creature" });
  // retry the trigger while waiting: on a cold vite start the module import
  // can outlast the first trigger, which then no-ops
  const t0 = Date.now();
  let lastKick = t0;
  while (Date.now() - t0 < 40_000) {
    if (await page.evaluate(() => window.__creaturePhase?.entryOk ?? false)) break;
    if (Date.now() - lastKick > 8000) {
      lastKick = Date.now();
      await post("/browser-modules/trigger", { id: "creature" });
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  const entered = await page.evaluate(() => window.__creaturePhase?.entryOk ?? false);
  if (!entered) throw new Error("creature never entered (entry gate)");
  await new Promise((r) => setTimeout(r, 4000));

  const rec = await page.screencast({ path: path.join(ROOT, "reports/workbench.webm") });

  // force + manual + scrub through the loop
  await osc("/creature/move", "groove");
  await osc("/creature/behavior", "groove");
  await new Promise((r) => setTimeout(r, 2500));
  await osc("/creature/clockMode", "manual");
  for (const s of [0, 0.25, 0.5, 0.75]) {
    await osc("/creature/phaseScrub", s);
    await new Promise((r) => setTimeout(r, 900));
    if (s === 0.25) await page.screenshot({ path: path.join(ROOT, "reports/workbench-scrub-025.png") });
  }

  // pose fingerprint before the edit, at scrub 0.25 (the key we edit)
  await osc("/creature/phaseScrub", 0.25);
  await new Promise((r) => setTimeout(r, 900));
  const poseBefore = await page.evaluate(() =>
    window.__creatureJoints?.find((j) => j.name === "pelvis")?.ay ?? null);

  // hot edit: double the pelvis dip at phase 0.25
  const edited = JSON.parse(original);
  const key = edited.keys.find((k) => k.phase === 0.25);
  key.joints.pelvis = { dy: -0.09 };
  await fs.writeFile(MOVE_FILE, JSON.stringify(edited, null, 2));
  await new Promise((r) => setTimeout(r, 2500));      // watcher debounce + fetch + springs settle
  const poseAfter = await page.evaluate(() =>
    window.__creatureJoints?.find((j) => j.name === "pelvis")?.ay ?? null);
  const moved = poseBefore != null && poseAfter != null && Math.abs(poseAfter - poseBefore) > 0.02;
  console.log(`[workbench] hot edit: pelvis.ay ${poseBefore} → ${poseAfter} (${moved ? "applied" : "NOT applied"})`);
  if (!moved) failures.push("hot edit did not reach the pose");
  await page.screenshot({ path: path.join(ROOT, "reports/workbench-scrub-025-edited.png") });

  // parse error: broadcast as moves-error, creature keeps the last table
  await fs.writeFile(MOVE_FILE, "{ this is not json");
  await new Promise((r) => setTimeout(r, 1200));
  if (!wsSeen.includes("moves-error")) failures.push("parse error not broadcast");
  const poseBroken = await page.evaluate(() =>
    window.__creatureJoints?.find((j) => j.name === "pelvis")?.ay ?? null);
  if (poseBroken == null || Math.abs(poseBroken - poseAfter) > 0.02) {
    failures.push("creature lost its table on a parse error");
  }
  console.log(`[workbench] parse error: broadcast=${wsSeen.includes("moves-error")}, pose held at ${poseBroken}`);
  await fs.writeFile(MOVE_FILE, original);            // restore before going live
  await new Promise((r) => setTimeout(r, 1200));

  // play from here — live re-entry must be snap-free
  await osc("/creature/clockMode", "live");
  await new Promise((r) => setTimeout(r, 6000));
  await rec.stop();

  const jm = await page.evaluate(() => ({
    all: window.__creaturePerf?.spikesAll ?? -1,
    flagged: window.__creaturePerf?.spikesFlagged ?? -1,
    log: window.__creaturePerf?.spikeLog ?? [],
  }));
  console.log(`[workbench] spikes all=${jm.all} flagged=${jm.flagged}${jm.log.length ? ` log=${JSON.stringify(jm.log)}` : ""}`);
  if (jm.flagged !== 0) failures.push(`manual→live spiked: ${jm.flagged}`);
  console.log("[workbench] wrote reports/workbench.webm + scrub stills");
} catch (e) {
  failures.push(String(e));
  console.error("[workbench]", e);
} finally {
  await fs.writeFile(MOVE_FILE, original);
  ws.close();
  await browser.close();
}

for (const f of failures) console.error(`[workbench] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} workbench`);
process.exitCode = failures.length ? 1 : 0;
