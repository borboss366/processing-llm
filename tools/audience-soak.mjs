#!/usr/bin/env node
/**
 * Audience soak + perform gate (brief 11 Task 5): with the full stack up
 * (controller 3000, vite 5173, submit service 3210), this:
 *
 *   1. submits a synthetic good drawing, approves it, and PERFORMS it —
 *      the creature renders shape audience:<id> over Butterchurn
 *      (validates proxy, loadShape prefix, template sidecar, hot-swap);
 *      still saved to reports/audience-stage.png
 *   2. measures the module's baseline frame cost, then fires N scripted
 *      submissions spread over the soak window while the set keeps
 *      playing, sampling frame cost throughout
 *
 * PASS: perform works (creature visible, components sane) AND the frame
 * budget is unaffected (soak mean ms ≤ baseline + 1 ms and ≤ 6 ms).
 *
 *   node tools/audience-soak.mjs --token <event-token> [--n 50] [--minutes 10]
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";
import { parseArgs } from "./args.mjs";

const require = createRequire("/Users/borboss366/WebstormProjects/processing-llm/web/app/package.json");
const { WebSocket } = require("ws");
const UPNG = require("upng-js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const SUBMIT = "http://localhost:3210";
const { flags } = parseArgs(process.argv.slice(2));
const token = String(flags.token ?? process.env.SUBMIT_TOKEN ?? "");
const N = Number(flags.n ?? 50);
const minutes = Number(flags.minutes ?? 10);
if (!token) { console.error("need --token <event token> (printed by npm run submit)"); process.exit(1); }

const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());

// ── synthetic drawing: white capsules along the template bones ───────────
async function makeDrawing() {
  const tpl = await (await fetch(`${SUBMIT}/api/template`)).json();
  const S = 512;
  const J = {}; tpl.joints.forEach((j) => (J[j.name] = j));
  const segs = [
    ["pelvis", "chest", 0.085], ["chest", "neck", 0.07],
    ["pelvis", "kneeL", 0.055], ["kneeL", "footL", 0.055],
    ["pelvis", "kneeR", 0.055], ["kneeR", "footR", 0.055],
    ["chest", "elbowL", 0.055], ["elbowL", "handL", 0.055],
    ["chest", "elbowR", 0.055], ["elbowR", "handR", 0.055],
  ].map(([a, b, r]) => ({ ax: J[a].x, ay: J[a].y, bx: J[b].x, by: J[b].y, r }));
  const head = { x: 0.5, y: 0.14, r: 0.11 };
  const rgba = new Uint8Array(S * S * 4);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S, v = y / S;
      let ink = (u - head.x) ** 2 + (v - head.y) ** 2 < head.r ** 2;
      for (const s of segs) {
        if (ink) break;
        const dx = s.bx - s.ax, dy = s.by - s.ay;
        const t = Math.max(0, Math.min(1, ((u - s.ax) * dx + (v - s.ay) * dy) / (dx * dx + dy * dy)));
        ink = (u - s.ax - t * dx) ** 2 + (v - s.ay - t * dy) ** 2 < s.r ** 2;
      }
      const i = (y * S + x) * 4;
      const c = ink ? 255 : 0;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = c; rgba[i + 3] = 255;
    }
  }
  const png = Buffer.from(UPNG.encode([rgba.buffer], S, S, 0));
  return `data:image/png;base64,${png.toString("base64")}`;
}

const PALETTES = [
  { primary: "#4dd9e8", secondary: "#5ee89a", accent: "#ff5d7e" },
  { primary: "#ff8b4d", secondary: "#ffd24d", accent: "#8b5dff" },
  { primary: "#e84dd9", secondary: "#5d8bff", accent: "#5ee89a" },
];
const submitOne = (png, i) => fetch(`${SUBMIT}/api/submit`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token, png, palette: PALETTES[i % PALETTES.length] }),
});

await assertStackRunning();
const failures = [];
const browser = await launchBrowser();
const ws = new WebSocket("ws://localhost:3000/ws");
await new Promise((r) => ws.on("open", r));

try {
  // 1. submit + approve + perform
  const png = await makeDrawing();
  const sub = await (await submitOne(png, 0)).json();
  if (!sub.ok) throw new Error(`seed submission rejected: ${sub.reason}`);
  const mod = await fetch(`${SUBMIT}/api/moderate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: sub.id, verdict: "approve" }),
  });
  if (!mod.ok) throw new Error("approve failed");
  console.log(`[soak] performing audience:${sub.id}`);

  const page = await openRenderWithFile(browser, MIX, { seekSec: 300 });
  await post("/browser-modules/load", { id: "creature" });
  await new Promise((r) => setTimeout(r, 1500));
  await post("/osc", { address: "/creature/shape", value: `audience:${sub.id}` });
  await post("/osc", { address: "/post/post", value: 0 });   // stable frame metrics
  await post("/browser-modules/trigger", { id: "creature" });
  const t0 = Date.now();
  while (Date.now() - t0 < 25_000) {
    if (await page.evaluate(() => window.__creaturePhase?.entryOk ?? false)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 6000));
  const built = await page.evaluate(() => ({
    ms: window.__creaturePerf?.ms ?? null,
    nodes: window.__creaturePerf?.nodes ?? 0,
  }));
  if (!built.ms || built.nodes < 100) failures.push(`audience shape did not build (nodes=${built.nodes})`);
  await page.screenshot({ path: path.join(ROOT, "reports/audience-stage.png") });
  console.log(`[soak] audience creature: ${built.nodes} nodes · ${built.ms?.toFixed(2)} ms/frame — reports/audience-stage.png`);

  // 2. baseline, then soak
  const sample = () => page.evaluate(() => window.__creaturePerf?.ms ?? null);
  const baseline = await sample();
  console.log(`[soak] baseline ${baseline?.toFixed(2)} ms/frame · firing ${N} submissions over ${minutes} min`);
  const gapMs = (minutes * 60_000) / N;
  const samples = [];
  let accepted = 0, limited = 0;
  for (let i = 0; i < N; i++) {
    const r = await submitOne(png, i).catch(() => null);
    if (r?.status === 200) accepted++;
    else if (r?.status === 429) limited++;
    if (i % 5 === 4 || i === N - 1) {
      const ms = await sample();
      if (ms) samples.push(ms);
      console.log(`[soak] ${i + 1}/${N} submitted (ok=${accepted} 429=${limited}) · module ${ms?.toFixed(2)} ms`);
    }
    await new Promise((r2) => setTimeout(r2, gapMs));
  }
  if (!samples.length) failures.push("no frame samples collected");
  const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
  console.log(`[soak] done: ${accepted} accepted, ${limited} rate-limited · module mean ${mean.toFixed(2)} ms vs baseline ${baseline?.toFixed(2)} ms`);
  if (accepted + limited < N) failures.push(`submissions lost: ${accepted + limited}/${N} answered`);
  if (mean > (baseline ?? 6) + 1) failures.push(`frame cost rose: ${mean.toFixed(2)} vs ${baseline?.toFixed(2)}`);
  if (mean > 6) failures.push(`frame budget busted: ${mean.toFixed(2)} > 6 ms`);
} catch (e) {
  failures.push(String(e));
  console.error("[soak]", e);
} finally {
  ws.close();
  await browser.close();
}

for (const f of failures) console.error(`[soak] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} audience-soak`);
process.exitCode = failures.length ? 1 : 0;
