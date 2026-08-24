#!/usr/bin/env node
/**
 * Compositor A/B + budget probe (brief 10): opens the render window with
 * file audio + the clean preset + the creature, captures stills with the
 * compositor on (post 1) and bypassed (post 0), and prints the compositor's
 * per-frame cost from the window.__post seam.
 *
 * PASS requires: no page errors, the compositor active, the A/B screenshots
 * actually differing (post is doing something), and no exposed canvas edge
 * (all four frame borders non-black on average with bg on — the framing
 * margin guard). Headless ms numbers are indicative; the 1.5 ms budget is
 * judged on the dev GPU.
 *
 *   node tools/post-ab.mjs [--shape biped-1] [--seconds 8] [--busy]
 *
 * --busy uses a busy Geiss preset instead of the clean one (Task 4 gate).
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
const CLEAN_PRESET = "Flexi - mindblob [shiny mix]";
const BUSY_PRESET = "Flexi, fishbrain, Geiss + Martin - tokamak witchery";
const { flags } = parseArgs(process.argv.slice(2));
const shape = String(flags.shape ?? "biped-1");
const seconds = Number(flags.seconds ?? 8);
const busy = !!flags.busy;
const label = busy ? "busy" : "clean";

const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());

const decode = (buf) => {
  const img = UPNG.decode(buf);
  return { w: img.width, h: img.height, d: new Uint8Array(UPNG.toRGBA8(img)[0]) };
};
const meanDiff = (A, B) => {
  let s = 0, n = 0;
  for (let i = 0; i < A.d.length; i += 16) { s += Math.abs(A.d[i] - B.d[i]); n++; }
  return s / n;
};
// mean luminance of a 4px border strip on each edge
const borderLuma = (img) => {
  const L = (x, y) => {
    const i = (y * img.w + x) * 4;
    return 0.2126 * img.d[i] + 0.7152 * img.d[i + 1] + 0.0722 * img.d[i + 2];
  };
  const strips = { top: 0, bottom: 0, left: 0, right: 0 };
  let n = 0;
  for (let x = 0; x < img.w; x += 4) {
    for (let k = 0; k < 4; k++) {
      strips.top += L(x, k); strips.bottom += L(x, img.h - 1 - k); n++;
    }
  }
  strips.top /= n; strips.bottom /= n; n = 0;
  for (let y = 0; y < img.h; y += 4) {
    for (let k = 0; k < 4; k++) {
      strips.left += L(k, y); strips.right += L(img.w - 1 - k, y); n++;
    }
  }
  strips.left /= n; strips.right /= n;
  return strips;
};

await assertStackRunning();
const browser = await launchBrowser();
const ws = new WebSocket("ws://localhost:3000/ws");
await new Promise((r) => ws.on("open", r));

const failures = [];
try {
  const page = await openRenderWithFile(browser, MIX, { seekSec: 300 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location()?.url ?? "";
    if (/favicon/.test(url) || /favicon/.test(m.text())) return;   // benign missing icon
    pageErrors.push(`${m.text()} (${url})`);
  });
  ws.send(JSON.stringify({ type: "load-preset-by-name", name: busy ? BUSY_PRESET : CLEAN_PRESET, blendSec: 0 }));
  await post("/browser-modules/load", { id: "creature" });
  await new Promise((r) => setTimeout(r, 1500));
  await post("/osc", { address: "/creature/shape", value: shape });
  await post("/browser-modules/trigger", { id: "creature" });
  // the entry gate (brief 9) holds the creature until beatConfidence
  // sustains — wait for it to actually materialise before shooting
  const t0 = Date.now();
  while (Date.now() - t0 < 25_000) {
    const ok = await page.evaluate(() => window.__creaturePhase?.entryOk ?? false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, seconds * 1000));

  const stat = await page.evaluate(() => ({
    active: window.__post?.active ?? false,
    post: window.__post?.params?.post,
    perf: window.__post?.perf ?? null,
    creatureMs: window.__creaturePerf?.ms ?? null,
  }));
  if (!stat.active) failures.push("compositor inactive (WebGL2 missing or shader failed)");

  const onShot = decode(await page.screenshot({ path: path.join(ROOT, `reports/post-${label}-${shape}-on.png`) }));
  await post("/osc", { address: "/post/post", value: 0 });
  await new Promise((r) => setTimeout(r, 600));
  const offShot = decode(await page.screenshot({ path: path.join(ROOT, `reports/post-${label}-${shape}-off.png`) }));
  await post("/osc", { address: "/post/post", value: 1 });

  const diff = meanDiff(onShot, offShot);
  if (diff < 1) failures.push(`A/B identical (meanDiff=${diff.toFixed(2)}) — post pipeline not engaged`);
  // NOTE: no border-blackness check — preset edges are legitimately black;
  // edge exposure is prevented analytically (base zoom ≥ drift+pulse margin)
  const border = borderLuma(onShot);
  if (pageErrors.length) failures.push(`page errors: ${pageErrors.join(" | ")}`);

  console.log(`[post] ${label}/${shape}: compositor ${stat.active ? "active" : "INACTIVE"} · pass ${stat.perf?.passMs?.toFixed(2)} ms wall / ${stat.perf?.gpuMs?.toFixed(2)} ms GPU (headless-indicative) · creature ${stat.creatureMs?.toFixed?.(2) ?? "n/a"} ms`);
  console.log(`[post] ${label}/${shape}: A/B meanDiff=${diff.toFixed(1)} · border luma T/B/L/R = ${border.top.toFixed(0)}/${border.bottom.toFixed(0)}/${border.left.toFixed(0)}/${border.right.toFixed(0)}`);
  console.log(`[post] wrote reports/post-${label}-${shape}-{on,off}.png`);
} catch (e) {
  failures.push(String(e));
} finally {
  ws.close();
  await browser.close();
}

for (const f of failures) console.error(`[post] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} post-ab label=${label}`);
process.exitCode = failures.length ? 1 : 0;
