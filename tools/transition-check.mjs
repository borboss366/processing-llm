#!/usr/bin/env node
/**
 * Transition-quality acceptance (brief 14 Task 2): scripted sequence
 * walk → turn(s) → groove → armwave → tstep → walk → idle over the
 * gridded mix, sampling bench observables + key joints at ~35 ms.
 *
 * Metrics & asserts (skipped with --no-assert, for before/after runs):
 *  - turn carry: during each facingVis sweep the |worldX velocity| may
 *    pass through zero but a NEAR-ZERO PLATEAU ≤ 250 ms (the pre-14 halt
 *    was the full 400 ms + blends); ≥ 1 turn must occur
 *  - no glide: after walk→idle, once the feet stop cycling the body
 *    stops too (|ΔworldX| ≤ 4 px after last foot oscillation); while the
 *    body moves ≥ 15 px/s the feet must be cycling (≥ 2 px osc range)
 *  - rhythm ramp: after the groove→armwave switch the shoulderL
 *    oscillation envelope at +1 s is < 75% of its settled value at +5 s
 *    (instant switch = flat envelope = fail)
 *  - spikesFlagged === 0 across the whole script
 *
 * Writes reports/transition.webm + prints one metrics line per fix.
 *
 *   node tools/transition-check.mjs [--label after] [--no-assert]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const LABEL = process.argv.includes("--label") ? process.argv[process.argv.indexOf("--label") + 1] : "after";
const NO_ASSERT = process.argv.includes("--no-assert");
const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const osc = (address, value) => post("/osc", { address, value });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await assertStackRunning();
const failures = [];
const browser = await launchBrowser();
try {
  const page = await openRenderWithFile(browser, MIX, { seekSec: 300 });
  await post("/browser-modules/load", { id: "creature" });
  await sleep(1500);
  await osc("/creature/entryConf", 0);
  await osc("/post/post", 0);
  await osc("/creature/behavior", "walk");
  await osc("/creature/speed", 0.7);
  await post("/browser-modules/trigger", { id: "creature" });
  await sleep(6000);

  // ── sampler: bench observables + key joints, node-side ~35 ms loop ────
  const rows = [];
  const marks = {};
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      try {
        const r = await page.evaluate(() => ({
          t: performance.now(),
          b: window.__creatureBench ?? null,
          j: Object.fromEntries((window.__creatureJoints ?? [])
            .filter((x) => ["pelvis", "footL", "shoulderL", "handL"].includes(x.name))
            .map((x) => [x.name, { sx: x.sx, sy: x.sy, th: x.theta }])),
        }));
        if (r.b) rows.push(r);
      } catch { /* page busy */ }
      await sleep(35);
    }
  })();
  const mark = (name) => { marks[name] = rows.at(-1)?.t ?? 0; };

  const rec = await page.screencast({ path: path.join(ROOT, "reports/transition.webm") });
  mark("walk");            await sleep(22_000);                    // ≥1 edge turn at speed 0.7
  await osc("/creature/speed", 0.35);
  mark("groove");          await osc("/creature/behavior", "groove"); await sleep(7000);
  mark("armwave");         await osc("/creature/move", "armwave-placeholder"); await sleep(9000);
  mark("tstep");           await osc("/creature/move", "tstep-placeholder");   await sleep(7000);
  await osc("/creature/move", "none");
  mark("walk2");           await osc("/creature/behavior", "walk");  await sleep(7000);
  mark("idle");            await osc("/creature/behavior", "idle");  await sleep(9000);
  await rec.stop();
  sampling = false;
  await sampler;

  // ── metric helpers ────────────────────────────────────────────────────
  const between = (a, b) => rows.filter((r) => r.t >= a && r.t < b);
  const vel = (seq, key) => {
    const out = [];
    for (let i = 2; i < seq.length; i++) {
      const dt = (seq[i].t - seq[i - 2].t) / 1000;
      if (dt > 0.02) out.push({ t: seq[i].t, v: (key(seq[i]) - key(seq[i - 2])) / dt });
    }
    return out;
  };

  // 1) turn carry — facingVis sweeps inside the walk window
  const walkRows = between(marks.walk, marks.groove);
  const turns = [];
  let cur = null;
  for (const r of walkRows) {
    const sweeping = Math.abs(r.b.facingVis ?? 1) < 0.999;
    if (sweeping && !cur) cur = { a: r.t };
    if (!sweeping && cur) { cur.b = r.t; turns.push(cur); cur = null; }
  }
  let worstPlateau = 0;
  for (const tw of turns) {
    const pre = vel(between(tw.a - 1200, tw.a), (r) => r.b.worldX).map((s) => Math.abs(s.v));
    const vRef = pre.sort((x, y) => x - y)[Math.floor(pre.length / 2)] ?? 0;
    const inTurn = vel(between(tw.a - 100, tw.b + 100), (r) => r.b.worldX);
    let span = 0, spanStart = null;
    for (const s of inTurn) {
      if (Math.abs(s.v) < Math.max(8, 0.15 * vRef)) { spanStart ??= s.t; span = Math.max(span, s.t - spanStart); }
      else spanStart = null;
    }
    worstPlateau = Math.max(worstPlateau, span);
  }
  console.log(`[transition:${LABEL}] turns=${turns.length} worst near-zero plateau=${worstPlateau.toFixed(0)} ms (turn spans: ${turns.map((t2) => (t2.b - t2.a).toFixed(0)).join("/")} ms)`);
  if (!NO_ASSERT && turns.length < 1) failures.push("no turn observed in the walk window");
  if (!NO_ASSERT && worstPlateau > 250) failures.push(`turn halts: near-zero plateau ${worstPlateau.toFixed(0)} ms > 250`);

  // 2) walk→idle glide — feet stop ⇒ body stops
  const idleRows = between(marks.idle, Infinity);
  const footOsc = (win) => {
    const rel = win.map((r) => (r.j.footL?.sx ?? 0) - (r.j.pelvis?.sx ?? 0));
    return rel.length ? Math.max(...rel) - Math.min(...rel) : 0;
  };
  let tFeetStop = null;
  for (let t = marks.idle; t < (rows.at(-1)?.t ?? 0) - 700; t += 200) {
    if (footOsc(between(t, t + 700)) < 2) { tFeetStop = t; break; }
  }
  let glidePx = -1, moveWhileStill = 0;
  if (tFeetStop !== null) {
    const after = between(tFeetStop, Infinity).map((r) => r.b.worldX);
    glidePx = after.length ? Math.max(...after) - Math.min(...after) : 0;
  }
  for (let t = marks.idle; t < (rows.at(-1)?.t ?? 0) - 700; t += 350) {
    const win = between(t, t + 700);
    if (win.length < 6) continue;
    const dx = Math.abs(win.at(-1).b.worldX - win[0].b.worldX) / ((win.at(-1).t - win[0].t) / 1000);
    if (dx > 15 && footOsc(win) < 2) moveWhileStill++;
  }
  console.log(`[transition:${LABEL}] walk→idle: feet stop @+${tFeetStop === null ? "never" : ((tFeetStop - marks.idle) / 1000).toFixed(1) + "s"}, drift after ${glidePx.toFixed(1)} px, moving-without-stepping windows=${moveWhileStill}`);
  if (!NO_ASSERT && tFeetStop === null) failures.push("feet never settled after idle");
  if (!NO_ASSERT && glidePx > 4) failures.push(`glide after feet stopped: ${glidePx.toFixed(1)} px > 4`);
  if (!NO_ASSERT && moveWhileStill > 0) failures.push(`body moved without stepping in ${moveWhileStill} windows`);

  // 3) rhythm ramp at the groove→armwave switch
  const env = (a, b) => {
    const xs = between(a, b).map((r) => r.j.shoulderL?.th ?? 0);
    if (xs.length < 5) return 0;
    const m = xs.reduce((s2, x) => s2 + x, 0) / xs.length;
    return Math.sqrt(xs.reduce((s2, x) => s2 + (x - m) ** 2, 0) / xs.length);
  };
  const early = env(marks.armwave + 300, marks.armwave + 1300);
  const late = env(marks.armwave + 5000, marks.armwave + 8000);
  const ratio = late > 1e-4 ? early / late : 1;
  console.log(`[transition:${LABEL}] armwave shoulder envelope: early(+1s)=${early.toFixed(3)} settled(+5s)=${late.toFixed(3)} ratio=${ratio.toFixed(2)}`);
  if (!NO_ASSERT && late < 0.05) failures.push(`armwave never developed (settled env ${late.toFixed(3)})`);
  if (!NO_ASSERT && ratio > 0.5) failures.push(`rhythm switch not ramped (early/settled ${ratio.toFixed(2)} > 0.5 — snapshot-only blending measured 0.63)`);

  // 4) spikes across the whole script
  const spikes = rows.at(-1)?.b.spikesFlagged ?? -1;
  console.log(`[transition:${LABEL}] spikesFlagged=${spikes} · wrote reports/transition.webm`);
  if (!NO_ASSERT && spikes !== 0) failures.push(`spikes=${spikes}`);
} catch (e) {
  failures.push(String(e));
} finally {
  await browser.close();
}
for (const f of failures) console.error(`[transition] FAIL: ${f}`);
if (!NO_ASSERT) console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} transition-check`);
process.exitCode = failures.length ? 1 : 0;
