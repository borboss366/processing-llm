#!/usr/bin/env node
/**
 * Dance-robustness torture run (brief 13 Task 3): tempo step (playbackRate
 * 1.08), a 1 s silence gap, and a 4 s confidence collapse/re-acquire —
 * while sampling the creature's level envelope, slewed bpm and per-frame
 * applied phase. Gate: 0 flagged joint-speed spikes. Emits an SVG plot of
 * the envelope + move-clock rate through the events for the report.
 *
 *   node tools/torture-check.mjs --tier grid|pll [--label x]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";
import { parseArgs } from "./args.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const { flags } = parseArgs(process.argv.slice(2));
const tier = String(flags.tier ?? "grid");

const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());

await assertStackRunning();
const failures = [];
const browser = await launchBrowser();
try {
  const page = await openRenderWithFile(browser, MIX, {
    seekSec: 300, extra: tier === "pll" ? "clock=pll" : "",
  });
  await post("/browser-modules/load", { id: "creature" });
  await new Promise((r) => setTimeout(r, 1500));
  await post("/osc", { address: "/creature/entryConf", value: 0 });
  await post("/osc", { address: "/creature/behavior", value: "groove" });
  await post("/osc", { address: "/post/post", value: 0 });
  await post("/browser-modules/trigger", { id: "creature" });
  await new Promise((r) => setTimeout(r, 8000));

  const gotTier = await page.evaluate(() => window.__audio?.state?.clockTier);
  if (gotTier !== tier) failures.push(`tier is ${gotTier}, wanted ${tier}`);

  const samples = [];
  const events = [];
  const t0 = Date.now();
  const mark = (name) => { events.push({ t: (Date.now() - t0) / 1000, name }); console.log(`[torture] ${name}`); };
  const el = (js) => page.evaluate(js);

  const sampler = setInterval(async () => {
    const s = await page.evaluate(() => ({
      c: window.__creatureBench ?? null,
      conf: +(window.__audio?.state?.beatConfidence ?? 0).toFixed(2),
    })).catch(() => null);
    if (s?.c) samples.push({ t: (Date.now() - t0) / 1000, ...s.c, conf: s.conf });
  }, 200);

  await new Promise((r) => setTimeout(r, 10_000));
  mark("tempo step ×1.08");
  await el("window.__audio.fileElement.playbackRate = 1.08");
  await new Promise((r) => setTimeout(r, 10_000));
  mark("tempo back ×1.0");
  await el("window.__audio.fileElement.playbackRate = 1.0");
  await new Promise((r) => setTimeout(r, 5000));
  mark("1 s silence gap");
  await el("window.__audio.fileElement.muted = true");
  await new Promise((r) => setTimeout(r, 1000));
  await el("window.__audio.fileElement.muted = false");
  await new Promise((r) => setTimeout(r, 7000));
  mark("confidence collapse (4 s mute)");
  await el("window.__audio.fileElement.muted = true");
  await new Promise((r) => setTimeout(r, 4000));
  await el("window.__audio.fileElement.muted = false");
  mark("re-acquire");
  await new Promise((r) => setTimeout(r, 12_000));
  clearInterval(sampler);

  const spikes = await page.evaluate(() => window.__creatureBench?.spikesFlagged ?? -1);
  console.log(`[torture] tier=${tier} samples=${samples.length} spikesFlagged=${spikes}`);
  if (spikes !== 0) failures.push(`spikes=${spikes}`);
  if (samples.length < 100) failures.push(`too few samples (${samples.length})`);

  // SVG plot: level envelope (green), applied phase per frame (blue,
  // scaled), confidence (grey); event markers as vertical lines
  const W = 900, H = 260, tMax = samples.at(-1)?.t ?? 1;
  const X = (t) => 40 + (t / tMax) * (W - 60);
  const line = (sel, scale, color) => {
    const pts = samples.map((s) => `${X(s.t).toFixed(1)},${(H - 30 - sel(s) * scale * (H - 60)).toFixed(1)}`).join(" ");
    return `<polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/>`;
  };
  const maxApplied = Math.max(...samples.map((s) => s.moveApplied ?? 0), 0.01);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#0c0c16">
  <text x="40" y="16" fill="#889" font-family="monospace" font-size="11">torture ${tier}: lvlEnv (green) · moveApplied/frame ÷${maxApplied.toFixed(3)} (blue) · beatConfidence (grey)</text>
  ${events.map((e) => `<line x1="${X(e.t)}" y1="20" x2="${X(e.t)}" y2="${H - 20}" stroke="#553" stroke-dasharray="3"/>
  <text x="${X(e.t) + 3}" y="${30 + events.indexOf(e) * 12}" fill="#aa7" font-family="monospace" font-size="10">${e.name}</text>`).join("")}
  ${line((s) => s.conf, 1, "#555a77")}
  ${line((s) => s.lvlEnv, 1, "#5ee89a")}
  ${line((s) => (s.moveApplied ?? 0) / maxApplied, 1, "#8fa7ff")}
</svg>`;
  await fs.writeFile(path.join(ROOT, `reports/torture-${tier}.svg`), svg);
  console.log(`[torture] wrote reports/torture-${tier}.svg`);
} catch (e) {
  failures.push(String(e));
} finally {
  await browser.close();
}
for (const f of failures) console.error(`[torture] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} torture tier=${tier}`);
process.exitCode = failures.length ? 1 : 0;
