#!/usr/bin/env node
/**
 * Measured preset tags (brief 13.2 Task 1, per 12.5): capture ~2 s
 * (8 frames) of every catalogue preset over live audio, compute
 *
 *   mean luminance      → brightness
 *   RMS chroma          → energy
 *   Sobel edge density  → complexity
 *   mean |frame diff|   → motion
 *
 * normalise each to 1–5 quantiles across the catalogue, and REPLACE the
 * vision-judged values in preset-descriptions/*.md frontmatter (prose,
 * density, geometry, colors untouched; `source: measured` + date stamped).
 *
 * Rerunnable — skips already-measured presets unless --redo. Refuses while
 * any browser is connected to the controller (KV-cache eviction risk)
 * unless --force.
 *
 *   node tools/preset-measure.mjs [--redo] [--force]
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";
import { parseArgs } from "./args.mjs";

const require = createRequire("/Users/borboss366/WebstormProjects/processing-llm/web/app/package.json");
const { WebSocket } = require("ws");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DESC_DIR = path.join(ROOT, "web/app/preset-descriptions");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const { flags } = parseArgs(process.argv.slice(2));

await assertStackRunning();
const status = await fetch("http://localhost:3000/status").then((r) => r.json()).catch(() => null);
if (status && status.browsers > 0 && !flags.force) {
  console.error(`[measure] REFUSING: ${status.browsers} browser(s) connected — a live set's KV cache would be evicted. --force to override.`);
  console.log("VERIFY:FAIL preset-measure reason=controller-live");
  process.exit(1);
}

const files = (await fs.readdir(DESC_DIR)).filter((f) => f.endsWith(".md")).sort();
const presets = [];
for (const f of files) {
  const raw = await fs.readFile(path.join(DESC_DIR, f), "utf8");
  const name = /^name:\s*"(.*)"/m.exec(raw)?.[1];
  const measured = /^measured:/m.test(raw);
  if (name) presets.push({ f, name, raw, skip: measured && !flags.redo });
}
const todo = presets.filter((p) => !p.skip);
console.log(`[measure] catalogue ${presets.length} presets, measuring ${todo.length}${flags.redo ? " (redo)" : ""}`);

const oldTags = { brightness: {}, energy: {}, complexity: {}, motion: {} };
for (const p of presets) {
  for (const k of ["brightness", "energy", "motion"]) {
    const v = new RegExp(`^${k}:\\s*(.+)$`, "m").exec(p.raw)?.[1]?.trim();
    if (v) oldTags[k][v] = (oldTags[k][v] ?? 0) + 1;
  }
  const c = /^complexity:\s*(\d)/m.exec(p.raw)?.[1];
  if (c) oldTags.complexity[c] = (oldTags.complexity[c] ?? 0) + 1;
}

const measure = async () => {
  const browser = await launchBrowser();
  const ws = new WebSocket("ws://localhost:3000/ws");
  await new Promise((r) => ws.on("open", r));
  const page = await openRenderWithFile(browser, MIX, { seekSec: 300 });
  await new Promise((r) => setTimeout(r, 1500));
  const out = new Map();
  try {
    for (let i = 0; i < todo.length; i++) {
      const p = todo[i];
      ws.send(JSON.stringify({ type: "load-preset-by-name", name: p.name, blendSec: 0 }));
      await new Promise((r) => setTimeout(r, 1200));   // settle after the cut
      const m = await page.evaluate(async () => {
        const bg = document.getElementById("bg");
        const W = 160, H = 90;
        const c = document.createElement("canvas");
        c.width = W; c.height = H;
        const g = c.getContext("2d", { willReadFrequently: true });
        let prevLuma = null;
        const acc = { luma: 0, chroma: 0, edges: 0, diff: 0, frames: 0, diffFrames: 0 };
        for (let f = 0; f < 8; f++) {
          await new Promise((r) => setTimeout(r, 250));
          g.drawImage(bg, 0, 0, W, H);
          const d = g.getImageData(0, 0, W, H).data;
          const luma = new Float32Array(W * H);
          let sumL = 0, sumC2 = 0;
          for (let i2 = 0; i2 < W * H; i2++) {
            const r = d[i2 * 4], gg = d[i2 * 4 + 1], b = d[i2 * 4 + 2];
            const L = 0.2126 * r + 0.7152 * gg + 0.0722 * b;
            luma[i2] = L;
            sumL += L;
            const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
            sumC2 += (mx - mn) * (mx - mn);
          }
          acc.luma += sumL / (W * H) / 255;
          acc.chroma += Math.sqrt(sumC2 / (W * H)) / 255;
          let edgy = 0;
          for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
              const i2 = y * W + x;
              const gx = luma[i2 + 1] - luma[i2 - 1] + 2 * 0; // sobel-lite: central diff
              const gy = luma[i2 + W] - luma[i2 - W];
              if (Math.hypot(gx, gy) > 24) edgy++;
            }
          }
          acc.edges += edgy / ((W - 2) * (H - 2));
          if (prevLuma) {
            let dd = 0;
            for (let i2 = 0; i2 < W * H; i2++) dd += Math.abs(luma[i2] - prevLuma[i2]);
            acc.diff += dd / (W * H) / 255;
            acc.diffFrames++;
          }
          prevLuma = luma;
          acc.frames++;
        }
        return {
          luma: acc.luma / acc.frames,
          chroma: acc.chroma / acc.frames,
          edges: acc.edges / acc.frames,
          diff: acc.diffFrames ? acc.diff / acc.diffFrames : 0,
        };
      });
      out.set(p.f, m);
      if (i % 10 === 9) console.log(`[measure] ${i + 1}/${todo.length}`);
    }
  } finally {
    ws.close();
    await browser.close();
  }
  return out;
};

const metrics = await measure();

// quantile rank 1–5 (equal-count over the MEASURED set)
const rank = (key) => {
  const vals = [...metrics.values()].map((m) => m[key]).sort((a, b) => a - b);
  return (v) => {
    let idx = vals.findIndex((x) => x >= v);
    if (idx < 0) idx = vals.length - 1;
    return 1 + Math.min(4, Math.floor((idx / vals.length) * 5));
  };
};
const qB = rank("luma"), qE = rank("chroma"), qC = rank("edges"), qM = rank("diff");

const stamp = new Date().toISOString().slice(0, 10);
const newHist = { brightness: {}, energy: {}, complexity: {}, motion: {} };
for (const [f, m] of metrics) {
  const p = presets.find((x) => x.f === f);
  const tags = { brightness: qB(m.luma), energy: qE(m.chroma), complexity: qC(m.edges), motion: qM(m.diff) };
  for (const k of Object.keys(tags)) newHist[k][tags[k]] = (newHist[k][tags[k]] ?? 0) + 1;
  let s = p.raw;
  for (const [k, v] of Object.entries(tags)) {
    s = new RegExp(`^${k}:`, "m").test(s)
      ? s.replace(new RegExp(`^${k}:.*$`, "m"), `${k}: ${v}`)
      : s.replace(/^---\n/m, `---\n${k}: ${v}\n`);
  }
  s = s.replace(/^source:.*$/m, "source: measured");
  s = /^measured:/m.test(s)
    ? s.replace(/^measured:.*$/m, `measured: ${stamp}`)
    : s.replace(/^source: measured$/m, `source: measured\nmeasured: ${stamp}`);
  await fs.writeFile(path.join(DESC_DIR, f), s);
}

console.log("[measure] tag histograms (old → new):");
for (const k of ["brightness", "energy", "complexity", "motion"]) {
  console.log(`  ${k}: ${JSON.stringify(oldTags[k])} → ${JSON.stringify(newHist[k])}`);
}
console.log(`[measure] wrote ${metrics.size} descriptions · REMEMBER: restart the server to reload + re-warm the prompt`);
console.log(`VERIFY:PASS preset-measure presets=${metrics.size}`);
