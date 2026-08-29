#!/usr/bin/env node
/**
 * Puppet page acceptance (brief 13.2 Task 3): drives the 12.7 flow on the
 * REAL page — pick a shape, Enter, force behavior, force a move, Manual +
 * scrub, tweak a param, Snapshot — while recording a webm of the puppet.
 * Asserts each step landed in the render window and the snapshot reached
 * the WS stream.
 *
 *   node tools/puppet-check.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const require = createRequire("/Users/borboss366/WebstormProjects/processing-llm/web/app/package.json");
const { WebSocket } = require("ws");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";

await assertStackRunning();
const failures = [];
const browserA = await launchBrowser();
let browserB = null;
const ws = new WebSocket("ws://localhost:3000/ws");
await new Promise((r) => ws.on("open", r));
let snapshotSeen = null;
let creatureRS = null;          // creature row from the render window's render-state
const lifecycleSeen = new Set();
ws.on("message", (raw) => {
  try {
    const m = JSON.parse(String(raw));
    if (m.type === "puppet-snapshot") snapshotSeen = m.snapshot;
    if (m.type === "render-state") {
      const mod = (m.modules ?? []).find((x) => x.id === "creature");
      if (mod) {
        creatureRS = mod;
        if (mod.lifecycle?.state) lifecycleSeen.add(mod.lifecycle.state);
      }
    }
  } catch {}
});

try {
  const render = await openRenderWithFile(browserA, MIX, { seekSec: 300 });
  browserB = await launchBrowser();
  const puppet = await browserB.newPage();
  await puppet.setViewport({ width: 1100, height: 760 });
  await puppet.goto("http://localhost:5173/puppet.html", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2000));
  const rec = await puppet.screencast({ path: path.join(ROOT, "reports/puppet.webm") });

  // shape → Enter
  await puppet.select("#shape-sel", "biped-2");
  await puppet.click("#btn-enter");
  await new Promise((r) => setTimeout(r, 5000));
  const shape = await render.evaluate(() => window.__creaturePerf ? "drawing" : "missing");
  if (shape !== "drawing") failures.push("creature not drawing after Enter");

  // behavior groove
  await puppet.evaluate(() => [...document.querySelectorAll("#beh-btns button")].find((b) => b.textContent === "groove")?.click());
  await new Promise((r) => setTimeout(r, 1500));

  // force tstep + manual scrub
  await puppet.select("#mv-name", "tstep-placeholder");
  await new Promise((r) => setTimeout(r, 1500));
  await puppet.click("#mv-manual");
  await puppet.evaluate(() => {
    const s = document.getElementById("mv-scrub");
    s.value = "0.5";
    s.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 1500));
  const rig = await render.evaluate(() => ({
    move: window.__creatureBench?.move,
    loop: window.__creatureBench?.loopPhase,
  }));
  if (rig.move !== "tstep-placeholder") failures.push(`move not forced (${rig.move})`);
  if (Math.abs((rig.loop ?? 0) - 0.5) > 0.05) failures.push(`scrub not applied (loop ${rig.loop})`);

  // two param slider changes (12.7 acceptance), round-tripped against the
  // RENDER window's render-state broadcast, not just the puppet's mirror
  const setParam = (k, v) => puppet.evaluate((k2, v2) => {
    const inp = document.querySelector(`#params [data-k="${k2}"]`);
    if (!inp) return false;
    inp.value = String(v2);
    inp.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }, k, v);
  if (!await setParam("bounce", 2.4)) failures.push("bounce param control not enumerated");
  if (!await setParam("huePrimary", 40)) failures.push("huePrimary param control not enumerated");
  const hasSwatch = await puppet.evaluate(() => !!document.querySelector('#params [data-s="huePrimary"]'));
  if (!hasSwatch) failures.push("huePrimary missing its palette swatch");
  await new Promise((r) => setTimeout(r, 1500));
  if (Math.abs((creatureRS?.params?.bounce ?? 0) - 2.4) > 0.01)
    failures.push(`bounce did not reach the render window (${creatureRS?.params?.bounce})`);
  if (Math.abs((creatureRS?.params?.huePrimary ?? 0) - 40) > 0.01)
    failures.push(`huePrimary did not reach the render window (${creatureRS?.params?.huePrimary})`);

  // play from here + snapshot
  await puppet.click("#mv-play");
  await new Promise((r) => setTimeout(r, 1500));
  await puppet.click("#btn-snap");
  await new Promise((r) => setTimeout(r, 1200));
  if (!snapshotSeen) failures.push("snapshot never reached the WS stream");
  else if (!snapshotSeen.clockTier) failures.push("snapshot missing clockTier");

  // Exit goes THROUGH the fade (12.7): expect exiting → idle, not a vanish
  lifecycleSeen.clear();
  await puppet.click("#btn-exit");
  await new Promise((r) => setTimeout(r, 4000));
  if (!lifecycleSeen.has("exiting")) failures.push(`exit skipped the fade (saw: ${[...lifecycleSeen]})`);
  if (creatureRS?.lifecycle?.state !== "idle") failures.push(`exit never settled idle (${creatureRS?.lifecycle?.state})`);

  await rec.stop();
  await puppet.screenshot({ path: path.join(ROOT, "reports/puppet.png") });
  console.log(`[puppet] shape=${shape} move=${rig.move} loop@${rig.loop} snapshot tier=${snapshotSeen?.clockTier} shape=${snapshotSeen?.shape}`);
  console.log("[puppet] wrote reports/puppet.webm + puppet.png");
} catch (e) {
  failures.push(String(e));
} finally {
  ws.close();
  await browserA.close();
  await browserB?.close();
}
for (const f of failures) console.error(`[puppet] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} puppet-check`);
process.exitCode = failures.length ? 1 : 0;
