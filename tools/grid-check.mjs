#!/usr/bin/env node
/**
 * GridClock acceptance (brief 13 Task 1): with a beatgrid sidecar present,
 * file playback must run on the grid tier and the bench click must sit on
 * the grid — median |click − nearest grid beat| < 15 ms. Wall→media mapping
 * comes from 1 Hz (wallMs, element.currentTime) samples off the render
 * page, so the measurement is against the sidecar itself, not the PLL.
 *
 *   node tools/grid-check.mjs [--track "<file>"] [--seconds 40] [--seek 300]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";
import { parseArgs } from "./args.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { flags } = parseArgs(process.argv.slice(2));
const track = String(flags.track ?? "Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3");
const seconds = Number(flags.seconds ?? 40);
const seek = Number(flags.seek ?? 300);

const grid = JSON.parse(await fs.readFile(path.join(ROOT, "music", `${track}.beatgrid.json`), "utf8"));
const beats = grid.beats ?? null;
const nearestBeatMs = (mediaMs) => {
  if (beats) {
    let lo = 0, hi = beats.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (beats[mid] <= mediaMs) lo = mid; else hi = mid; }
    return Math.min(Math.abs(mediaMs - beats[lo]), Math.abs(mediaMs - beats[hi]));
  }
  const beatMs = 60000 / grid.bpm;
  const k = (mediaMs - grid.firstBeatMs) / beatMs;
  return Math.abs(k - Math.round(k)) * beatMs;
};

await assertStackRunning();
const failures = [];
const browser = await launchBrowser();
let benchBrowser = null;

try {
  const render = await openRenderWithFile(browser, `/music/${track}`, { seekSec: seek });
  await new Promise((r) => setTimeout(r, 2000));
  const tier = await render.evaluate(() => window.__audio?.state?.clockTier);
  if (tier !== "grid") failures.push(`clock tier is '${tier}', expected 'grid' (sidecar not picked up)`);

  benchBrowser = await launchBrowser();
  const bench = await benchBrowser.newPage();
  await bench.goto("http://localhost:5173/bench.html", { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2000));
  await bench.click("#click-toggle");

  const pairs = [];
  for (let s = 0; s < seconds; s++) {
    await new Promise((r) => setTimeout(r, 1000));
    pairs.push(await render.evaluate(() => ({ w: window.__audio?.state?.mediaWallMs ?? Date.now(), m: window.__audio?.state?.mediaMs ?? 0 })));
  }
  const clicks = await bench.evaluate(() => window.__benchClicks ?? []);
  if (clicks.length < 20) failures.push(`too few clicks (${clicks.length})`);

  const errs = [];
  for (const c of clicks) {
    let best = null;
    for (const p2 of pairs) if (!best || Math.abs(p2.w - c) < Math.abs(best.w - c)) best = p2;
    if (!best || Math.abs(best.w - c) > 2000) continue;
    errs.push(nearestBeatMs(best.m + (c - best.w)));
  }
  errs.sort((a, b) => a - b);
  const med = errs.length ? errs[(errs.length / 2) | 0] : Infinity;
  console.log(`[grid-check] ${track}: tier=${tier} clicks=${clicks.length} median|click−gridbeat|=${med.toFixed(1)} ms (p90=${errs.length ? errs[(errs.length * 0.9) | 0].toFixed(1) : "-"} ms)`);
  if (med >= 15) failures.push(`median click error ${med.toFixed(1)} ms ≥ 15 ms`);
} catch (e) {
  failures.push(String(e));
  console.error("[grid-check]", e);
} finally {
  await browser.close();
  await benchBrowser?.close();
}

for (const f of failures) console.error(`[grid-check] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} grid-check`);
process.exitCode = failures.length ? 1 : 0;
