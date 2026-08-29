#!/usr/bin/env node
/**
 * Occlusion survival check (brief 13.1 Task 3): 20 randomized real gaps
 * (2–8 s) over ~5 min against FSM-auto + file audio (grid tier). Gaps are
 * real to the module: synchronous main-thread busy-loops — no rAF, no
 * timers, then one giant dt on resume, exactly the throttled-occlusion
 * shape. (CDP 'frozen' was tried and rejected: it back-forward-caches the
 * page, killing its WebSockets — navigation freezing, not occlusion.) After every gap the creature must
 * resume moving; at the end: components 1, zero unrecovered module
 * errors, 0 flagged spikes outside the declared resume re-anchors.
 *
 * Also reports the ACTUAL error thrown on giant dt, if any — the live
 * session's silent death diagnosis check.
 *
 *   node tools/occlusion-check.mjs [--gaps 20]
 */
import { createRequire } from "node:module";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";
import { parseArgs } from "./args.mjs";

const require = createRequire("/Users/borboss366/WebstormProjects/processing-llm/web/app/package.json");
const { WebSocket } = require("ws");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const { flags } = parseArgs(process.argv.slice(2));
const N = Number(flags.gaps ?? 20);

const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());

await assertStackRunning();
const failures = [];
const browser = await launchBrowser();
const ws = new WebSocket("ws://localhost:3000/ws");
await new Promise((r) => ws.on("open", r));
const events = { "module-error": [], "module-recovered": [], "creature-resume": [], "resume-after-gap": [] };
ws.on("message", (raw) => {
  try {
    const m = JSON.parse(String(raw));
    if (events[m.type]) events[m.type].push(m);
  } catch {}
});

try {
  const page = await openRenderWithFile(browser, MIX, { seekSec: 120 });
  const errors = new Set();
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error" && !/favicon/.test(t)) errors.add(t.slice(0, 250));
  });
  await post("/browser-modules/load", { id: "creature" });
  await new Promise((r) => setTimeout(r, 1500));
  await post("/osc", { address: "/post/post", value: 0 });
  await post("/browser-modules/trigger", { id: "creature" });
  await new Promise((r) => setTimeout(r, 6000));

  let resumed = 0;
  for (let g = 0; g < N; g++) {
    const ms = 2000 + Math.floor(Math.random() * 6000);
    const mode = "busy";
    await page.evaluate((m) => { const t = performance.now(); while (performance.now() - t < m) {} }, ms);
    // creature must be moving again within 5 s
    await new Promise((r) => setTimeout(r, 1500));
    const a = await page.evaluate(() => window.__creatureBench?.loopPhase ?? null);
    await new Promise((r) => setTimeout(r, 1200));
    const b = await page.evaluate(() => window.__creatureBench?.loopPhase ?? null);
    const moving = a !== null && b !== null && a !== b;
    if (moving) resumed++;
    else failures.push(`gap ${g + 1} (${mode} ${ms}ms): creature not moving after resume`);
    console.log(`[occl] gap ${g + 1}/${N} ${mode} ${ms}ms → ${moving ? "resumed" : "DEAD"}`);
    await new Promise((r) => setTimeout(r, 3000));
  }

  const final = await page.evaluate(() => {
    const perf = window.__creaturePerf, c = window.__creatureAccum;
    if (!perf || !c) return null;
    const sc = document.createElement("canvas");
    sc.width = c.width; sc.height = c.height;
    const g2 = sc.getContext("2d", { willReadFrequently: true });
    g2.drawImage(c, 0, 0);
    const a2 = g2.getImageData(0, 0, sc.width, sc.height).data;
    const thr = (perf.d0 ?? 0.18) * 255;
    const mask = new Uint8Array(sc.width * sc.height);
    for (let i = 0; i < mask.length; i++) mask[i] = a2[i * 4 + 3] >= thr ? 1 : 0;
    let comps = 0;
    const stack = [];
    for (let s2 = 0; s2 < mask.length; s2++) {
      if (mask[s2] !== 1) continue;
      let area = 0;
      stack.push(s2); mask[s2] = 2;
      while (stack.length) {
        const q = stack.pop(); area++;
        const qx = q % sc.width, qy = (q / sc.width) | 0;
        for (const [dx2, dy2] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = qx + dx2, ny = qy + dy2;
          if (nx < 0 || nx >= sc.width || ny < 0 || ny >= sc.height) continue;
          const ni = ny * sc.width + nx;
          if (mask[ni] === 1) { mask[ni] = 2; stack.push(ni); }
        }
      }
      if (area >= 4) comps++;
    }
    return { comps, spikes: perf.spikesFlagged ?? -1, ms: perf.ms };
  });
  const unrecovered = events["module-error"].length - events["module-recovered"].length;
  console.log(`[occl] resumed ${resumed}/${N} · components=${final?.comps} · spikesFlagged=${final?.spikes} · module-errors=${events["module-error"].length} recovered=${events["module-recovered"].length} · creature-resumes=${events["creature-resume"].length}`);
  if (events["module-error"].length) {
    console.log(`[occl] error messages (diagnosis evidence): ${[...new Set(events["module-error"].map((e) => e.message))].join(" | ")}`);
  }
  if (errors.size) console.log(`[occl] console errors: ${[...errors].slice(0, 4).join(" | ")}`);
  if (!final || final.comps !== 1) failures.push(`components=${final?.comps}`);
  if (final && final.spikes !== 0) failures.push(`spikes=${final.spikes}`);
  if (unrecovered > 0) failures.push(`${unrecovered} unrecovered module errors`);
} catch (e) {
  failures.push(String(e));
} finally {
  ws.close();
  await browser.close();
}
for (const f of failures) console.error(`[occl] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} occlusion gaps=${N}`);
process.exitCode = failures.length ? 1 : 0;
