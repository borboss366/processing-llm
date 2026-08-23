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
// pinned preset: the default (first Geiss match) draws wiry waveform
// scribbles that read as debris around the figure (brief 8.2 Task 1 —
// confirmed present with the creature unloaded)
const CLEAN_PRESET = "Flexi - mindblob [shiny mix]";
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
  await post("/browser-modules/load", { id: "creature" });

  for (const shape of shapes) {
    // fresh page per shape: probe-phase readbacks demote the accum canvas
    // for the whole page session, which polluted the next shape's clean
    // budget phase (measured: biped-2 read 6.3 ms after biped-1's probes).
    // The server replays module-load on WS connect, so the module re-arms.
    const page = await openRenderWithFile(browser, MIX, { seekSec: seek });
    ws.send(JSON.stringify({ type: "load-preset-by-name", name: CLEAN_PRESET, blendSec: 0 }));
    if (bgOff) ws.send(JSON.stringify({ type: "set-bg", on: false }));
    await new Promise((r) => setTimeout(r, 1500));   // module import + setup
    await post("/osc", { address: "/creature/shape", value: shape });
    if (flags.bonesplats !== undefined) {
      await post("/osc", { address: "/creature/boneSplats", value: Number(flags.bonesplats) });
    }
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
    // phase 1 (above) ran with ZERO readbacks — budget is judged on it.
    // phase 2 (timeline below) turns on probes + component reads, which
    // demote the accum canvas to CPU for the session; its ms is diagnostic.
    const phase1Ms = perf.creature?.ms ?? Infinity;
    await post("/osc", { address: "/creature/densityProbe", value: 1 });
    console.log(`[capture] ${shape}: ${perf.fps.toFixed(1)} fps (headless swiftshader), ` +
      `module ${perf.creature ? `${perf.creature.ms.toFixed(2)} ms/frame · ${perf.creature.nodes} nodes · ${perf.creature.edges} edges` : "n/a"}` +
      (perf.creature?.passMs !== undefined
        ? ` · shade pass ${perf.creature.passMs} ms wall${perf.creature.gpuMs ? ` / ${perf.creature.gpuMs} ms GPU` : " (no GPU timer ext)"}`
        : ""));

    const rec = verify ? null : await (async () => {
      await page.screenshot({ path: path.join(ROOT, `reports/creature4-${shape}.png`) });
      return page.screencast({ path: path.join(ROOT, `reports/creature4-${shape}.webm`) });
    })();

    // behaviour state + foot slide + connected-components timeline.
    // Components: threshold the density accum at d0, flood-fill count blobs
    // ≥4 px — must be exactly 1 (the shadow is a separate layer). >1 means
    // a limb severed (brief 8.1 acceptance).
    const timeline = [];
    for (let s = 0; s < seconds; s++) {
      await new Promise((r) => setTimeout(r, 1000));
      const cp = await page.evaluate(() => {
        const perf = window.__creaturePerf ?? null;
        const c = window.__creatureAccum;
        if (!perf || !c) return perf;
        // never getImageData the live accum (flips it to readback mode and
        // costs ~6 ms/frame for the rest of the session) — copy first
        if (!window.__accumScratch) {
          window.__accumScratch = document.createElement("canvas");
          window.__accumScratchG = window.__accumScratch.getContext("2d", { willReadFrequently: true });
        }
        const w = c.width, h = c.height;
        if (window.__accumScratch.width !== w || window.__accumScratch.height !== h) {
          window.__accumScratch.width = w; window.__accumScratch.height = h;
        }
        window.__accumScratchG.clearRect(0, 0, w, h);
        window.__accumScratchG.drawImage(c, 0, 0);
        const a = window.__accumScratchG.getImageData(0, 0, w, h).data;
        const thr = (perf.d0 ?? 0.18) * 255;
        const mask = new Uint8Array(w * h);
        for (let i = 0; i < w * h; i++) mask[i] = a[i * 4 + 3] >= thr ? 1 : 0;
        let comps = 0;
        const stack = [];
        for (let s2 = 0; s2 < w * h; s2++) {
          if (mask[s2] !== 1) continue;
          let area = 0;
          stack.push(s2); mask[s2] = 2;
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
        return { ...perf, components: comps };
      });
      if (cp) timeline.push(cp);
    }
    if (rec) await rec.stop();

    const states = timeline.map((c) => c.state);
    const runs = states.filter((s, i) => i === 0 || s !== states[i - 1]);
    const maxSlide = timeline.length ? Math.max(...timeline.map((c) => c.slidePx ?? 0)) : 0;
    const maxMs = phase1Ms;   // pre-readback measurement (see phase note)
    const maxComps = timeline.length ? Math.max(...timeline.map((c) => c.components ?? 1)) : 0;
    const boneRot = timeline.length ? Math.max(...timeline.map((c) => c.boneDevRot ?? 0)) : 0;
    const boneGnd = timeline.length ? Math.max(...timeline.map((c) => c.boneDevGround ?? 0)) : 0;
    const dens = timeline.at(-1)?.limbDensity ?? {};
    const spikesAll = timeline.at(-1)?.spikesAll ?? 0;
    const spikesFlagged = timeline.at(-1)?.spikesFlagged ?? 0;
    console.log(`[capture] ${shape}: states ${runs.join(" → ") || "n/a"} · max stance slide ${maxSlide.toFixed(2)} px · clean-path ${maxMs === Infinity ? "n/a" : maxMs.toFixed(2)} ms/frame`);
    console.log(`[capture] ${shape}: components max ${maxComps} · bone dev rot ${(boneRot * 100).toFixed(1)}% / ground ${(boneGnd * 100).toFixed(1)}% · limb min density ${JSON.stringify(dens)}`);
    console.log(`[capture] ${shape}: joint-speed spikes all=${spikesAll} flagged(outside windows)=${spikesFlagged}`);
    const slog = timeline.at(-1)?.spikeLog ?? [];
    if (slog.length) console.log(`[capture] ${shape}: spike log ${JSON.stringify(slog)}`);

    if (maxMs > MS_BUDGET) failures.push(`${shape}:ms=${maxMs.toFixed(1)}`);
    if (states.includes("walk") && maxSlide > SLIDE_BUDGET) failures.push(`${shape}:slide=${maxSlide.toFixed(1)}`);
    if (maxComps > 1) failures.push(`${shape}:components=${maxComps}`);
    if (boneRot >= 0.03) failures.push(`${shape}:boneDev=${(boneRot * 100).toFixed(1)}%`);
    if (spikesFlagged > 0) failures.push(`${shape}:spikes=${spikesFlagged}`);
    if (!timeline.length) failures.push(`${shape}:no-perf-samples`);

    if (!verify) {
      // secondary diagnostic: same pose family on black + palette swatches
      ws.send(JSON.stringify({ type: "set-bg", on: false }));
      await post("/osc", { address: "/creature/swatches", value: 1 });
      await new Promise((r) => setTimeout(r, 400));
      await page.screenshot({ path: path.join(ROOT, `reports/creature4-${shape}-diag.png`) });
      await post("/osc", { address: "/creature/swatches", value: 0 });
      if (!bgOff) ws.send(JSON.stringify({ type: "set-bg", on: true }));
      await new Promise((r) => setTimeout(r, 400));
      console.log(`[capture] ${shape}: wrote reports/creature4-${shape}.png/.webm + -diag.png`);
    }
    await page.close();
  }
} finally {
  ws.close();
  await browser.close();
}

console.log(failures.length
  ? `VERIFY:FAIL creature-capture reason=${failures.join(",")}`
  : `VERIFY:PASS creature-capture shapes=${shapes.length} seconds=${seconds}`);
process.exitCode = failures.length ? 1 : 0;
