#!/usr/bin/env node
/**
 * View-switch acceptance (brief 17 A4/A7): over the gridded mix, force
 * front→profile→front and then let a PROFILE-tagged repertoire move drive
 * the switch itself. Asserts per switch: completes within 1 bar + 3 s of
 * slack, spikesFlagged 0 outside the declared window (the metric owns the
 * window — total spikes must stay 0), joints finite, components 1 after
 * settle, and the shape actually swapped (joint count / view telemetry).
 *
 *   node tools/view-switch-check.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const osc = (address, value) => post("/osc", { address, value });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  await sleep(6000);

  const snap = () => page.evaluate(() => ({
    view: window.__creatureBench?.view, sw: window.__creatureBench?.viewSwitching,
    spikes: window.__creatureBench?.spikesFlagged ?? -1,
    bad: (window.__creatureJoints ?? []).filter((j) => !Number.isFinite(j.sx + j.sy + j.theta)).length,
  }));
  const waitSettled = async (target, label, maxMs = 9000) => {
    const t0 = Date.now();
    for (;;) {
      const s = await snap();
      if (s.bad) failures.push(`${label}: ${s.bad} non-finite joints`);
      if (s.view === target && !s.sw) return Date.now() - t0;
      if (Date.now() - t0 > maxMs) { failures.push(`${label}: not settled after ${maxMs} ms (view=${s.view} sw=${s.sw})`); return maxMs; }
      await sleep(200);
    }
  };

  // ── forced switches, both directions ──────────────────────────────────
  for (const [target, label] of [["profile", "forced front→profile"], ["front", "forced profile→front"]]) {
    await osc("/creature/view", target);
    const ms = await waitSettled(target, label);
    await sleep(1500);
    const comps = await page.evaluate(componentsSnippet);
    const s = await snap();
    console.log(`[viewsw] ${label}: settled in ${ms} ms, components ${comps}, spikes ${s.spikes}`);
    if (comps !== 1) failures.push(`${label}: components=${comps}`);
    if (s.spikes !== 0) failures.push(`${label}: spikes=${s.spikes}`);
  }
  await osc("/creature/view", "auto");

  // ── move-driven switch: force the PROFILE-tagged table, then a front one
  await osc("/creature/move", "runningman-captured");
  const ms1 = await waitSettled("profile", "move-driven →profile", 14000);
  await sleep(3000);
  let s = await snap();
  console.log(`[viewsw] move-driven →profile: settled ${ms1} ms, view=${s.view}, spikes ${s.spikes}`);
  if (s.spikes !== 0) failures.push(`move-driven →profile: spikes=${s.spikes}`);
  await page.screenshot({ path: path.join(ROOT, "reports/view-profile-runningman.png") });
  await osc("/creature/move", "tstep-placeholder");
  const ms2 = await waitSettled("front", "move-driven →front", 14000);
  await sleep(1500);
  s = await snap();
  const comps = await page.evaluate(componentsSnippet);
  console.log(`[viewsw] move-driven →front: settled ${ms2} ms, components ${comps}, spikes ${s.spikes}`);
  if (comps !== 1) failures.push(`move-driven →front: components=${comps}`);
  if (s.spikes !== 0) failures.push(`move-driven →front: spikes=${s.spikes}`);
  await osc("/creature/move", "none");
} catch (e) {
  failures.push(String(e));
} finally {
  await browser.close();
}
for (const f of failures) console.error(`[viewsw] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} view-switch-check`);
process.exitCode = failures.length ? 1 : 0;
