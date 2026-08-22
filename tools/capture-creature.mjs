#!/usr/bin/env node
/**
 * Creature capture harness (Brief 4, Task 2.8): plays the techno mix through
 * the render window, loads + triggers the creature module, and produces a
 * screenshot + ~20 s webm per shape into reports/, with fps + physics cost.
 *
 *   node tools/capture-creature.mjs [--seek 120] [--bg off]
 *
 * Needs `npm run server` and `npm run dev` running (Ollama not needed).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
const seek = Number(flags.seek ?? 120);
const bgOff = (flags.bg ?? "off") === "off";

const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());

await assertStackRunning();
const browser = await launchBrowser();
const ws = new WebSocket("ws://localhost:3000/ws");
await new Promise((res, rej) => { ws.on("open", res); ws.on("error", rej); });

try {
  const page = await openRenderWithFile(browser, MIX, { seekSec: seek });
  if (bgOff) ws.send(JSON.stringify({ type: "set-bg", on: false }));

  await post("/browser-modules/load", { id: "creature" });
  await new Promise((r) => setTimeout(r, 1500));   // module import + setup

  for (const shape of ["quadruped", "jelly"]) {
    await post("/osc", { address: "/creature/shape", value: shape });
    await post("/browser-modules/trigger", { id: "creature" });
    await new Promise((r) => setTimeout(r, 3000)); // enter + beat lock settle

    // fps + physics cost over 5 s before capturing
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
      `module ${perf.creature ? `${perf.creature.ms.toFixed(2)} ms/frame · ${perf.creature.nodes} nodes · ${perf.creature.edges} edges` : "n/a"}`);

    await page.screenshot({ path: path.join(ROOT, `reports/creature-${shape}.png`) });
    const rec = await page.screencast({ path: path.join(ROOT, `reports/creature-${shape}.webm`) });
    await new Promise((r) => setTimeout(r, 20_000));
    await rec.stop();
    console.log(`[capture] ${shape}: wrote reports/creature-${shape}.png + .webm`);
  }
} finally {
  ws.close();
  await browser.close();
}
