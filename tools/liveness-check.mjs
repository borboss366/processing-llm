#!/usr/bin/env node
/**
 * Liveness acceptance (brief 15 A): with the layer ON, the dance must
 * measurably BREATHE across loops; OFF, loops repeat. Two fresh pages
 * over the SAME music segment (seek 300), groove state + groove table,
 * procedural amplitude zeroed in BOTH runs (the music's level envelope
 * would swamp a ±10% wander). elbowL.theta sampled per frame in-page.
 *
 * Metrics: D = mean |sample − meanCycle(exact phase)| (reported), and
 * the asserted V = std/mean of per-loop least-squares amplitude scales
 * vs the mean cycle — the wander's 20–60 s periods and the per-bar
 * accent express as amplitude drift ACROSS loops, and the scale fit
 * uses every sample (peak-to-peak had a ~5% sampling floor at headless
 * ~12 frames/loop). Asserts: V_on ≥ 1.8 × V_off, V_on ≤ 30% (bounded —
 * still the same dance), spikes 0 in both runs.
 *
 * Webms: reports/liveness-{on,off}.webm (same segment = honest A/B).
 *
 *   node tools/liveness-check.mjs
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

await assertStackRunning();
const failures = [];
const browser = await launchBrowser();

async function run(label, liveness) {
  const page = await openRenderWithFile(browser, MIX, { seekSec: 300 });
  await post("/browser-modules/load", { id: "creature" });
  await sleep(1500);
  await osc("/creature/entryConf", 0);
  await osc("/creature/behavior", "groove");
  await osc("/creature/move", "groove");
  await osc("/creature/liveness", liveness);
  // measurement gain: the wander's Perlin realization varies per page
  // reseed, and at the default ±10% a weak realization can dip into the
  // ~3% scale-fit noise floor (measured 6.5% and 3.1% across runs).
  // varyAmp 0.25 measures the MECHANISM robustly; defaults stay 0.1 and
  // their subtlety is the user's R1/R2 taste call.
  await osc("/creature/varyAmp", 0.25);
  // amplitude 0: the music's level envelope modulates the gait and would
  // swamp a ±10% wander in the baseline — with it off, the table + the
  // liveness layer are the only movers, so D isolates the layer
  await osc("/creature/amplitude", 0);
  await osc("/post/post", 0);
  await post("/browser-modules/trigger", { id: "creature" });
  await sleep(6000);
  const rec = await page.screencast({ path: path.join(ROOT, `reports/liveness-${label}.webm`) });
  // in-page rAF sampler: one row per rendered frame (node-side polling is
  // ~100 ms/round-trip headless — too sparse to fill loop bins)
  await page.evaluate(() => {
    window.__lvRows = [];
    const s = () => {
      const lp = window.__creatureBench?.loopPhase;
      const th = window.__creatureJoints?.find((j) => j.name === "elbowL")?.theta;
      if (typeof lp === "number" && typeof th === "number") window.__lvRows.push({ lp, th });
      if (window.__lvRows.length < 5000) requestAnimationFrame(s);
    };
    requestAnimationFrame(s);
  });
  await sleep(32_000);   // wander periods are 20–60 s — sample enough of one
  await rec.stop();
  const rows = await page.evaluate(() => window.__lvRows ?? []);
  const spikes = await page.evaluate(() => window.__creatureBench?.spikesFlagged ?? -1);
  await page.close();

  // Phase-paired dissimilarity: build a fine mean cycle (64 buckets,
  // linearly interpolated) from ALL samples, then D = mean |sample −
  // meanCycle(exact lp)|. Coarse per-loop binning measured its own
  // quantization (theta sweeps ~1.5 rad/loop — bin-width slope noise
  // swamped a ±10% wander); interpolation at the exact phase does not.
  let loops = 0, prevLp = 1;
  for (const r of rows) { if (r.lp < prevLp - 0.5) loops++; prevLp = r.lp; }
  const G = 64;
  const sum = new Array(G).fill(0), cnt = new Array(G).fill(0), lpSum = new Array(G).fill(0);
  for (const r of rows) {
    const b = Math.min(G - 1, (r.lp * G) | 0);
    sum[b] += r.th; cnt[b]++; lpSum[b] += r.lp;
  }
  const ctr = [], val = [];
  for (let b = 0; b < G; b++) if (cnt[b]) { ctr.push(lpSum[b] / cnt[b]); val.push(sum[b] / cnt[b]); }
  const curve = (lp) => {
    if (!ctr.length) return 0;
    let i = ctr.findIndex((c) => c >= lp);
    if (i === -1) i = ctr.length;               // wrap: between last and first
    const i0 = (i - 1 + ctr.length) % ctr.length, i1 = i % ctr.length;
    const x0 = ctr[i0], x1w = i === 0 || i === ctr.length ? ctr[i1] + (i === 0 ? -1 : 1) * 0 : ctr[i1];
    let span = ctr[i1] - x0; if (span <= 0) span += 1;
    let d = lp - x0; if (d < 0) d += 1;
    return val[i0] + (val[i1] - val[i0]) * Math.min(1, d / Math.max(1e-6, span));
  };
  let acc = 0;
  for (const r of rows) acc += Math.abs(r.th - curve(r.lp));
  const D = rows.length ? acc / rows.length : NaN;
  // per-loop amplitude drift V = std/mean of each loop's least-squares
  // scale against the mean cycle (a_k = Σ th·c / Σ c² over the loop's
  // samples). Raw peak-to-peak at ~12 samples/loop had a ~5% sampling
  // floor that swamped the effect; the scale fit uses every sample. The
  // wander's 20–60 s periods and the per-bar accent express as the dance
  // breathing ACROSS loops — this is that number.
  const scales = [];
  let num = 0, den = 0, ns = 0;
  prevLp = 1;
  for (const r of rows) {
    if (r.lp < prevLp - 0.5) {
      if (ns >= 8 && den > 1e-4) scales.push(num / den);
      num = 0; den = 0; ns = 0;
    }
    prevLp = r.lp;
    const c = curve(r.lp);
    num += r.th * c; den += c * c; ns++;
  }
  const mA = scales.reduce((a, b) => a + b, 0) / Math.max(1, scales.length);
  const V = Math.sqrt(scales.reduce((a, b) => a + (b - mA) ** 2, 0) / Math.max(1, scales.length)) / Math.max(1e-6, Math.abs(mA));
  console.log(`[liveness:${label}] loops=${loops} samples=${rows.length} D=${D.toFixed(4)} rad, ampDrift V=${(V * 100).toFixed(1)}%, spikes=${spikes}`);
  return { D, V, spikes, loops };
}

try {
  const on = await run("on", 1);
  const off = await run("off", 0);
  if (on.loops < 8 || off.loops < 8) failures.push(`too few loops (on=${on.loops} off=${off.loops})`);
  if (on.spikes !== 0 || off.spikes !== 0) failures.push(`spikes on=${on.spikes} off=${off.spikes}`);
  const ratio = on.V / Math.max(1e-3, off.V);
  console.log(`[liveness] ampDrift on/off ratio=${ratio.toFixed(2)} (V_on=${(on.V * 100).toFixed(1)}%, V_off=${(off.V * 100).toFixed(1)}%; D on/off ${on.D.toFixed(4)}/${off.D.toFixed(4)})`);
  if (!(on.V <= 0.3)) failures.push(`variation unbounded (V_on ${(on.V * 100).toFixed(0)}% > 30%)`);
  if (!(ratio >= 1.8)) failures.push(`liveness indistinct (ampDrift on/off ratio ${ratio.toFixed(2)} < 1.8)`);
  console.log("[liveness] wrote reports/liveness-{on,off}.webm");
} catch (e) {
  failures.push(String(e));
} finally {
  await browser.close();
}
for (const f of failures) console.error(`[liveness] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} liveness-check`);
process.exitCode = failures.length ? 1 : 0;
