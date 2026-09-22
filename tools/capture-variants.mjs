#!/usr/bin/env node
/**
 * Variant judging aid (brief 17 A7 — live A/B switching judged "poor"):
 * capture each named move table to its own webm over the gridded mix so
 * variants can be scrubbed and compared side by side as FILES instead of
 * live OSC switching. Not an assert harness — a capture tool; spikes are
 * still reported per variant.
 *
 *   node tools/capture-variants.mjs <move1> <move2> ... [--seconds 15]
 * Writes reports/variant-<move>.webm
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const argv = process.argv.slice(2);
const secIdx = argv.indexOf("--seconds");
const SECONDS = secIdx >= 0 ? +argv[secIdx + 1] : 15;
const MOVES = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--seconds");
if (!MOVES.length) { console.error("usage: node tools/capture-variants.mjs <move1> <move2> ... [--seconds 15]"); process.exit(1); }
const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const osc = (address, value) => post("/osc", { address, value });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await assertStackRunning();
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
  for (const mv of MOVES) {
    await osc("/creature/move", mv);
    await sleep(6000);                                    // view switch + blend fully in
    const s0 = await page.evaluate(() => window.__creatureBench?.spikesFlagged ?? -1);
    const rec = await page.screencast({ path: path.join(ROOT, `reports/variant-${mv}.webm`) });
    await sleep(SECONDS * 1000);
    await rec.stop();
    const s1 = await page.evaluate(() => window.__creatureBench?.spikesFlagged ?? -1);
    const view = await page.evaluate(() => window.__creatureBench?.view);
    console.log(`[variants] ${mv}: ${SECONDS}s captured (view=${view}, spikes +${s1 - s0}) → reports/variant-${mv}.webm`);
  }
  await osc("/creature/move", "none");
  await osc("/creature/view", "auto");
} finally {
  await browser.close();
}
console.log("[variants] done");
