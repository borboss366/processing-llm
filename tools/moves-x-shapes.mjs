#!/usr/bin/env node
/**
 * Moves × shapes matrix (brief 16 Task 2 done-bar / Task 4 acceptance):
 * every vocabulary table live on every biped shape. Per cell: joint NaN
 * scan + spike delta 0; per (shape, move): connected components must be 1.
 * On the captured table the hip channel must actually articulate on every
 * shape (all three carry hip joints since 16.1).
 *
 *   node tools/moves-x-shapes.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
// biped-front is the submit-service TEMPLATE (joints only, no PNG) — not a
// loadable stage shape; including it here is how we found the n=0 wedge
const SHAPES = ["biped-1", "biped-2"];
const MOVES = ["tstep-captured", "tstep-placeholder", "armwave-placeholder",
               "sidepunch-placeholder", "elbowcircles-placeholder", "armpump-placeholder"];
const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const osc = (address, value) => post("/osc", { address, value });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// same accum flood-fill as rotation-stress (harness-local by convention)
const componentsSnippet = () => {
  const c = window.__creatureAccum;
  const perf = window.__creaturePerf;
  if (!c || !perf) return -1;
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
  for (let s = 0; s < w * h; s++) {
    if (mask[s] !== 1) continue;
    let area = 0;
    stack.push(s); mask[s] = 2;
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
  return comps;
};

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
  await sleep(5000);

  for (const shape of SHAPES) {
    await osc("/creature/shape", shape);
    await sleep(4000);                              // rebuild + settle
    for (const mv of MOVES) {
      await osc("/creature/move", mv);
      await sleep(1500);                            // blend-in
      const s0 = await page.evaluate(() => window.__creatureBench?.spikesFlagged ?? -1);
      let maxHip = 0;
      for (let t = 0; t < 10; t++) {
        await sleep(550);
        const m = await page.evaluate(() => ({
          nan: (window.__creatureJoints ?? []).some((j) => !Number.isFinite(j.sx + j.sy + j.theta)),
          hip: Math.max(...(window.__creatureJoints ?? [])
            .filter((j) => /^hip/.test(j.name)).map((j) => Math.abs(j.theta ?? 0)), 0),
        }));
        if (m.nan) failures.push(`NaN: ${mv} on ${shape}`);
        maxHip = Math.max(maxHip, m.hip);
      }
      const s1 = await page.evaluate(() => window.__creatureBench?.spikesFlagged ?? -1);
      const comps = await page.evaluate(componentsSnippet);
      const hipNote = mv === "tstep-captured" ? ` hip|θ|max=${maxHip.toFixed(2)}` : "";
      console.log(`[mxs] ${shape} × ${mv}: spikes +${s1 - s0}, components ${comps}${hipNote}`);
      if (s1 - s0 !== 0) failures.push(`spikes +${s1 - s0}: ${mv} on ${shape}`);
      if (comps !== 1) failures.push(`components=${comps}: ${mv} on ${shape}`);
      if (mv === "tstep-captured" && maxHip < 0.05) {
        failures.push(`hip channel dead on ${shape} (max |θ| ${maxHip.toFixed(3)})`);
      }
    }
  }
  await osc("/creature/shape", "biped-1");
  await osc("/creature/move", "none");
} catch (e) {
  failures.push(String(e));
} finally {
  await browser.close();
}
for (const f of failures) console.error(`[mxs] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} moves-x-shapes`);
process.exitCode = failures.length ? 1 : 0;
