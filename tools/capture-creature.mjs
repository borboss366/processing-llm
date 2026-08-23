#!/usr/bin/env node
/**
 * Creature capture harness: plays the techno mix through the render window,
 * loads + triggers the creature module, and produces a screenshot + webm per
 * shape into reports/, with fps, physics cost, behaviour-state timeline, and
 * stance foot slide.
 *
 *   node tools/capture-creature.mjs [--seek 120] [--bg off]
 *                                   [--shape quadruped|jelly|both]
 *                                   [--seconds 30]
 *   node tools/capture-creature.mjs --verify [--shape quadruped] [--seconds 5]
 *
 * --verify: no files written — runs the module headless, checks the frame
 * cost stays under budget (≤6 ms) and stance slide ≤5 px, prints a
 * VERIFY:PASS/FAIL line.
 *
 * Needs `npm run server` and `npm run dev` running (Ollama not needed).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";
import { parseArgs } from "./args.mjs";

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const MS_BUDGET = 6;      // module physics+draw budget per frame (brief 6)
const SLIDE_BUDGET = 5;   // px of stance foot slide considered "planted"

const { flags } = parseArgs(process.argv.slice(2));
const seek = Number(flags.seek ?? 120);
const bgOff = flags.bg === "off";               // primary captures: Butterchurn ON
const verify = !!flags.verify;
const seconds = Number(flags.seconds ?? (verify ? 5 : 30));
const shapes = flags.shape && flags.shape !== "both" ? [String(flags.shape)] : ["biped-1", "biped-2"];

const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());

await assertStackRunning();
const browser = await launchBrowser();
const ws = new WebSocket("ws://localhost:3000/ws");
await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });

const failures = [];
try {
  const page = await openRenderWithFile(browser, MIX, { seekSec: seek });
  if (bgOff) ws.send(JSON.stringify({ type: "set-bg", on: false }));

  await post("/browser-modules/load", { id: "creature" });
  await new Promise((r) => setTimeout(r, 1500));   // module import + setup

  for (const shape of shapes) {
    await post("/osc", { address: "/creature/shape", value: shape });
    await post("/browser-modules/trigger", { id: "creature" });
    // enter + beat settle. The BPM estimate swings while its buffers fill in
    // the first ~8 s after audio start; walking during that transient slides
    // feet (stride tracks the estimate), so measurement waits it out.
    await new Promise((r) => setTimeout(r, verify ? 10_000 : 3000));

    const perf = await page.evaluate(async () => {
      const t0 = performance.now();
      let frames = 0;
      await new Promise((done) => {
        const cnt = () => { frames++; (performance.now() - t0 < 5000) ? requestAnimationFrame(cnt) : done(); };
        requestAnimationFrame(cnt);
      });
      return { fps: frames / 5, creature: window.__creaturePerf ?? null };
    });
    console.log(`[capture] ${shape}: ${perf.fps.toFixed(1)} fps (headless swiftshader), ` +
      `module ${perf.creature ? `${perf.creature.ms.toFixed(2)} ms/frame · ${perf.creature.nodes} nodes · ${perf.creature.edges} edges` : "n/a"}` +
      (perf.creature?.passMs !== undefined
        ? ` · shade pass ${perf.creature.passMs} ms wall${perf.creature.gpuMs ? ` / ${perf.creature.gpuMs} ms GPU` : " (no GPU timer ext)"}`
        : ""));

    const rec = verify ? null : await (async () => {
      await page.screenshot({ path: path.join(ROOT, `reports/creature4-${shape}.png`) });
      return page.screencast({ path: path.join(ROOT, `reports/creature4-${shape}.webm`) });
    })();

    // behaviour state + foot slide timeline over the capture window
    const timeline = [];
    for (let s = 0; s < seconds; s++) {
      await new Promise((r) => setTimeout(r, 1000));
      const cp = await page.evaluate(() => window.__creaturePerf ?? null);
      if (cp) timeline.push(cp);
    }
    if (rec) await rec.stop();

    const states = timeline.map((c) => c.state);
    const runs = states.filter((s, i) => i === 0 || s !== states[i - 1]);
    const maxSlide = timeline.length ? Math.max(...timeline.map((c) => c.slidePx ?? 0)) : 0;
    const maxMs = timeline.length ? Math.max(...timeline.map((c) => c.ms ?? 0)) : Infinity;
    console.log(`[capture] ${shape}: states ${runs.join(" → ") || "n/a"} · max stance slide ${maxSlide.toFixed(2)} px · max ${maxMs === Infinity ? "n/a" : maxMs.toFixed(2)} ms/frame`);

    if (maxMs > MS_BUDGET) failures.push(`${shape}:ms=${maxMs.toFixed(1)}`);
    if (states.includes("walk") && maxSlide > SLIDE_BUDGET) failures.push(`${shape}:slide=${maxSlide.toFixed(1)}`);
    if (!timeline.length) failures.push(`${shape}:no-perf-samples`);

    if (!verify) {
      // secondary diagnostic: same pose family on black
      ws.send(JSON.stringify({ type: "set-bg", on: false }));
      await new Promise((r) => setTimeout(r, 400));
      await page.screenshot({ path: path.join(ROOT, `reports/creature4-${shape}-diag.png`) });
      if (!bgOff) ws.send(JSON.stringify({ type: "set-bg", on: true }));
      await new Promise((r) => setTimeout(r, 400));
      console.log(`[capture] ${shape}: wrote reports/creature4-${shape}.png/.webm + -diag.png`);
    }
  }
} finally {
  ws.close();
  await browser.close();
}

console.log(failures.length
  ? `VERIFY:FAIL creature-capture reason=${failures.join(",")}`
  : `VERIFY:PASS creature-capture shapes=${shapes.length} seconds=${seconds}`);
process.exitCode = failures.length ? 1 : 0;
