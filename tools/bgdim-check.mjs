#!/usr/bin/env node
/**
 * bgDim acceptance (brief 14 Task 3): over a measured-brightness-5 preset,
 * the background must step down while the creature is up (brightness
 * ×0.45 / saturation ×0.7 at full fade weight) and restore on exit.
 *
 * Measures mean luminance of the left+right 12% screen strips (the
 * creature idles at centre) on the COMPOSITE canvas, A/B toggling
 * /post/bgDim over 3 cycles (adjacent windows cancel preset drift), then
 * exits the creature and checks restoration. Stills: bgdim-{on,off}.png.
 *
 *   node tools/bgdim-check.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const require = createRequire("/Users/borboss366/WebstormProjects/processing-llm/web/app/package.json");
const { WebSocket } = require("ws");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const BRIGHT = "An AdamFX n Martin Infusion 2 flexi - Why The Sky Looks Diffrent Today - AdamFx n Martin Infusion - Tack Tile Disfunction B";
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

  const ws = new WebSocket("ws://localhost:3000/ws");
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "apply-pick", name: BRIGHT, blendSec: 0.5 }));
  await sleep(4000);   // commits at the next bar wrap

  await post("/browser-modules/load", { id: "creature" });
  await sleep(1500);
  await osc("/creature/entryConf", 0);
  await osc("/creature/behavior", "idle");   // stays centred, strips stay bg-only
  await post("/browser-modules/trigger", { id: "creature" });
  await sleep(7000);   // entry + entry-env fades fully done (alpha → 1); the
                       // first headless seconds are also the slowest frames

  // Per sample, read the corner-strip luminance of the COMPOSITE and of
  // the raw #bg canvas in the SAME rAF (after the compositor draws, before
  // present — the only window a non-preserveDrawingBuffer WebGL canvas is
  // drawImage-readable). The comp/bg ratio cancels the preset's huge
  // audio-reactive luminance swings exactly — only the pipeline's own
  // attenuation (vignette, knee, and the dim under test) remains.
  const stripPair = () => page.evaluate(() => new Promise((res) => {
    requestAnimationFrame(() => {
      const read = (src) => {
        if (!src || !src.width) return null;
        const c = (window.__dimProbe ??= document.createElement("canvas"));
        c.width = 160; c.height = 90;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(src, 0, 0, 160, 90);
        const strip = (x0, x1) => {
          const d = g.getImageData(x0, 0, x1 - x0, 90).data;
          let s = 0;
          for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          return s / (d.length / 4);
        };
        return (strip(0, 19) + strip(141, 160)) / 2;
      };
      res({ comp: read(document.getElementById("composite")), bg: read(document.getElementById("bg")) });
    });
  }));
  const meanFactor = async (ms) => {
    const xs = [];
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const v = await stripPair();
      if (v?.comp !== null && v?.bg > 3) xs.push(v.comp / v.bg);
      await sleep(150);
    }
    return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  };

  // ── A/B cycles: dim on vs off with the creature up ────────────────────
  const ratios = [];
  let offFactor = 0;
  for (let cy = 0; cy < 3; cy++) {
    await osc("/post/bgDim", 1); await sleep(800);
    const on = await meanFactor(1500);
    if (cy === 0) await page.screenshot({ path: path.join(ROOT, "reports/bgdim-on.png") });
    await osc("/post/bgDim", 0); await sleep(800);
    const off = await meanFactor(1500);
    if (cy === 0) await page.screenshot({ path: path.join(ROOT, "reports/bgdim-off.png") });
    offFactor += off / 3;
    ratios.push(on / Math.max(0.01, off));
  }
  const ratio = ratios.slice().sort((a, b) => a - b)[1];   // median of 3
  console.log(`[bgdim] step-down (dim vs undim comp/bg factor) per cycle: ${ratios.map((r) => r.toFixed(2)).join(" ")} (median ${ratio.toFixed(2)}, undimmed factor ${offFactor.toFixed(2)})`);
  if (ratio > 0.75) failures.push(`background does not step down (ratio ${ratio.toFixed(2)} > 0.75)`);
  if (ratio < 0.25) failures.push(`dim implausibly deep (ratio ${ratio.toFixed(2)} < 0.25 — probe broken?)`);

  // ── restore on exit ───────────────────────────────────────────────────
  await osc("/post/bgDim", 1); await sleep(800);
  await post("/browser-modules/exit", { id: "creature" });
  await sleep(2500);                          // 900 ms exit fade + margin
  const after = await meanFactor(1500);
  const restore = after / Math.max(0.01, offFactor);
  console.log(`[bgdim] restore on exit: ${restore.toFixed(2)} of undimmed factor (undimmed ${offFactor.toFixed(2)}, after exit ${after.toFixed(2)})`);
  if (restore < 0.8) failures.push(`background did not restore on exit (${restore.toFixed(2)} < 0.8)`);
  console.log("[bgdim] wrote reports/bgdim-{on,off}.png");
  ws.close();
} catch (e) {
  failures.push(String(e));
} finally {
  await browser.close();
}
for (const f of failures) console.error(`[bgdim] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} bgdim-check`);
process.exitCode = failures.length ? 1 : 0;
