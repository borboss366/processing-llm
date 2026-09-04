#!/usr/bin/env node
/**
 * Rotation stress harness (brief 15 B1; leg-swing row brief 16.1) — maps
 * the ACTUAL safe envelope of the arm chains and the hip DOF before any
 * new vocabulary is authored.
 *
 * Generates five stress tables (deleted afterwards):
 *   - sweep: shoulder ±π (elbow 0) then elbow FULL SIGNED −2.4→+2.4
 *     (shoulder 0) — the straight-arm zero crossing lives in this leg
 *   - cross: arm across the body both directions, elbow bent 1.2
 *   - w-hold: snap into the overhead "W" (shoulders ∓2.6, elbows bent
 *     OPPOSITE to rest sign) and hold
 *   - leg: hip ±0.9 straight-leg sweeps (each swing crosses the stance
 *     leg) + a bent-knee compound segment (16.1)
 *   - legsnap: declared snap into a hips-split lunge and hold (16.1)
 *
 * Drives them three ways: STATIC (manual scrub, springs settled — the
 * slow case), BEAT (live, one sweep per 8 beats), SNAP (the w-hold's
 * snap keys, live). Liveness 0 and amplitude 0: pure table poses.
 *
 * Per pose/phase: connected components (accum flood-fill — must be 1),
 * NaN scan over joints, bone rot-deviation, min limb density at the
 * extremes. Live: spikesFlagged must stay 0.
 *
 *   node tools/rotation-stress.mjs
 */
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOVES = path.join(ROOT, "web/app/moves");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const osc = (address, value) => post("/osc", { address, value });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── stress tables ─────────────────────────────────────────────────────────
const SH_MAX = Math.PI, EL_MAX = 2.4;
function sweepTable() {
  // CONTINUOUS + CYCLIC: segment boundaries and the loop wrap must not
  // jump (the first cut of this table spiked at its own discontinuities —
  // that measured the table, not the mechanism)
  const segs = [
    [0.00, 0.10, "sh", 0, -SH_MAX], [0.10, 0.30, "sh", -SH_MAX, SH_MAX], [0.30, 0.40, "sh", SH_MAX, 0],
    [0.40, 0.50, "el", 0, -EL_MAX], [0.50, 0.70, "el", -EL_MAX, EL_MAX], [0.70, 0.80, "el", EL_MAX, 0],
  ];
  const keys = [];
  const K = 40;
  for (let k = 0; k < K; k++) {
    const u = k / K;
    let sh = 0, el = 0;
    for (const [a, b, which, v0, v1] of segs) {
      if (u >= a && u <= b) {
        const t = (u - a) / (b - a);
        if (which === "sh") sh = v0 + (v1 - v0) * t; else el = v0 + (v1 - v0) * t;
      }
    }
    keys.push({ phase: +u.toFixed(4), joints: {
      shoulderL: { rot: +sh.toFixed(3) }, shoulderR: { rot: +(-sh).toFixed(3) },
      elbowL: { rot: +el.toFixed(3) }, elbowR: { rot: +(-el).toFixed(3) } }, contacts: [], ease: "linear" });
  }
  return { name: "rotation-stress", beatsPerLoop: 16, overlay: 0, keys };
}
const crossTable = () => ({ name: "rotation-stress-cross", beatsPerLoop: 8, overlay: 0, keys: [
  { phase: 0, joints: { shoulderL: { rot: 0 }, elbowL: { rot: 1.2 }, shoulderR: { rot: 0 }, elbowR: { rot: -1.2 } }, contacts: [], ease: "smooth" },
  { phase: 0.25, joints: { shoulderL: { rot: 2.2 }, elbowL: { rot: 1.2 }, shoulderR: { rot: -2.2 }, elbowR: { rot: -1.2 } }, contacts: [], ease: "smooth" },
  { phase: 0.5, joints: { shoulderL: { rot: 0 }, elbowL: { rot: 1.2 }, shoulderR: { rot: 0 }, elbowR: { rot: -1.2 } }, contacts: [], ease: "smooth" },
  { phase: 0.75, joints: { shoulderL: { rot: -2.2 }, elbowL: { rot: 1.2 }, shoulderR: { rot: 2.2 }, elbowR: { rot: -1.2 } }, contacts: [], ease: "smooth" },
] });
const wTable = () => ({ name: "rotation-stress-w", beatsPerLoop: 8, overlay: 0, keys: [
  { phase: 0, joints: { shoulderL: { rot: 0 }, elbowL: { rot: 0 }, shoulderR: { rot: 0 }, elbowR: { rot: 0 } }, contacts: [], ease: "smooth" },
  { phase: 0.2, joints: { shoulderL: { rot: -2.6 }, elbowL: { rot: -1.2 }, shoulderR: { rot: 2.6 }, elbowR: { rot: 1.2 } }, contacts: [], ease: "snap" },
  { phase: 0.9, joints: { shoulderL: { rot: -2.6 }, elbowL: { rot: -1.2 }, shoulderR: { rot: 2.6 }, elbowR: { rot: 1.2 } }, contacts: [], ease: "smooth" },
] });

// leg-swing row (brief 16.1): hip ±0.9 sweeps — STRAIGHT leg (knee 0, the
// new DOF doing all the work), one hip at a time so each swing crosses the
// stance leg, then a compound pass with knees bent. Continuous + cyclic
// like the arm sweep. The weight foot keeps contact; the swinging leg's
// foot deliberately does not (it's in the air).
const HIP_MAX = 0.9;
function legSweepTable() {
  const segs = [
    [0.00, 0.10, "hl", 0, -HIP_MAX], [0.10, 0.30, "hl", -HIP_MAX, HIP_MAX], [0.30, 0.40, "hl", HIP_MAX, 0],
    [0.40, 0.50, "hr", 0, -HIP_MAX], [0.50, 0.70, "hr", -HIP_MAX, HIP_MAX], [0.70, 0.80, "hr", HIP_MAX, 0],
    [0.80, 0.85, "kb", 0, 0.8], [0.85, 0.95, "kb", 0.8, 0.8], [0.95, 1.00, "kb", 0.8, 0],
  ];
  const keys = [];
  const K = 40;
  for (let k = 0; k < K; k++) {
    const u = k / K;
    let hl = 0, hr = 0, kb = 0;
    for (const [a, b, which, v0, v1] of segs) {
      if (u >= a && u <= b) {
        const t = (u - a) / (b - a);
        if (which === "hl") hl = v0 + (v1 - v0) * t;
        else if (which === "hr") hr = v0 + (v1 - v0) * t;
        else kb = v0 + (v1 - v0) * t;
      }
    }
    // compound segment: both hips half-range out, knees bent — the squat-ish
    // extreme where thigh/shin goo overlaps most
    if (kb > 0) { hl = -0.45; hr = 0.45; }
    keys.push({ phase: +u.toFixed(4), joints: {
      hipL: { rot: +hl.toFixed(3) }, hipR: { rot: +hr.toFixed(3) },
      kneeL: { rot: +kb.toFixed(3) }, kneeR: { rot: +(-kb).toFixed(3) },
    }, contacts: [u < 0.4 ? "footR" : u < 0.8 ? "footL" : "footL"], ease: "linear" });
  }
  return { name: "rotation-stress-leg", beatsPerLoop: 16, overlay: 0, keys };
}
// lunge snap-hold: declared snap into hips split ±0.7, knees opposing
const legSnapTable = () => ({ name: "rotation-stress-legsnap", beatsPerLoop: 8, overlay: 0, keys: [
  { phase: 0, joints: { hipL: { rot: 0 }, hipR: { rot: 0 }, kneeL: { rot: 0 }, kneeR: { rot: 0 } }, contacts: ["footL", "footR"], ease: "smooth" },
  { phase: 0.2, joints: { hipL: { rot: -0.7 }, hipR: { rot: 0.7 }, kneeL: { rot: 0.6 }, kneeR: { rot: -0.6 } }, contacts: [], ease: "snap" },
  { phase: 0.9, joints: { hipL: { rot: -0.7 }, hipR: { rot: 0.7 }, kneeL: { rot: 0.6 }, kneeR: { rot: -0.6 } }, contacts: [], ease: "smooth" },
] });

const measureSnippet = () => ({
  perf: window.__creaturePerf ? { ...window.__creaturePerf } : null,
  joints: (window.__creatureJoints ?? []).map((j) => [j.name, j.ax, j.ay, j.theta]),
  spikes: window.__creatureBench?.spikesFlagged ?? -1,
});
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
  for (let s2 = 0; s2 < w * h; s2++) {
    if (mask[s2] !== 1) continue;
    let area = 0;
    stack.push(s2); mask[s2] = 2;
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
const rows = [];
const browser = await launchBrowser();
try {
  await fs.writeFile(path.join(MOVES, "rotation-stress.json"), JSON.stringify(sweepTable()));
  await fs.writeFile(path.join(MOVES, "rotation-stress-cross.json"), JSON.stringify(crossTable()));
  await fs.writeFile(path.join(MOVES, "rotation-stress-w.json"), JSON.stringify(wTable()));
  await fs.writeFile(path.join(MOVES, "rotation-stress-leg.json"), JSON.stringify(legSweepTable()));
  await fs.writeFile(path.join(MOVES, "rotation-stress-legsnap.json"), JSON.stringify(legSnapTable()));

  const page = await openRenderWithFile(browser, MIX, { seekSec: 300 });
  await post("/browser-modules/load", { id: "creature" });
  await sleep(1500);
  for (const [k, v] of [["entryConf", 0], ["behavior", "groove"], ["liveness", 0],
                        ["amplitude", 0], ["densityProbe", 1], ["move", "rotation-stress"]]) {
    await osc(`/creature/${k}`, v);
  }
  await osc("/post/post", 0);
  await post("/browser-modules/trigger", { id: "creature" });
  await sleep(5000);
  await osc("/creature/clockMode", "manual");

  // ── STATIC: scrub the sweep, springs settled per step ─────────────────
  const label = (u) => {
    if (u <= 0.1) return `shoulder ${(-SH_MAX * u / 0.1).toFixed(2)}`;
    if (u <= 0.3) return `shoulder ${(-SH_MAX + 2 * SH_MAX * (u - 0.1) / 0.2).toFixed(2)}`;
    if (u <= 0.4) return `shoulder ${(SH_MAX * (0.4 - u) / 0.1).toFixed(2)}`;
    if (u <= 0.5) return `elbow ${(-EL_MAX * (u - 0.4) / 0.1).toFixed(2)}`;
    if (u <= 0.7) return `elbow ${(-EL_MAX + 2 * EL_MAX * (u - 0.5) / 0.2).toFixed(2)}`;
    if (u <= 0.8) return `elbow ${(EL_MAX * (0.8 - u) / 0.1).toFixed(2)}`;
    return "rest";
  };
  for (let i = 0; i <= 32; i++) {
    const u = i / 32;
    await osc("/creature/phaseScrub", u);
    await sleep(i % 4 === 0 ? 2600 : 700);   // density probe fires every ~2.3 s
    const m = await page.evaluate(measureSnippet);
    const comps = i % 4 === 0 ? await page.evaluate(componentsSnippet) : null;
    const nan = m.joints.some((j) => j.slice(1).some((x) => !Number.isFinite(x)));
    const dens = m.perf?.limbDensity ?? {};
    const minDens = Math.min(...[dens.limb2, dens.limb3].filter((x) => x != null), Infinity);
    rows.push({ mode: "static", label: label(u), comps, nan, boneDev: m.perf?.boneDevRot ?? null, minDens: i % 4 === 0 ? minDens : null });
    if (nan) failures.push(`NaN at static ${label(u)}`);
    if (comps !== null && comps !== 1) failures.push(`components=${comps} at static ${label(u)}`);
    if ((m.perf?.boneDevRot ?? 0) >= 0.03) failures.push(`boneDev ${(m.perf.boneDevRot * 100).toFixed(1)}% at static ${label(u)}`);
    if (i === 0 || i === 16 || i === 8 || i === 24 || i === 32) {
      await page.screenshot({ path: path.join(ROOT, `reports/rotstress-${i}.png`) });
    }
  }

  // ── W hold (snap speed): live, 2 loops. The 2.6 rad snap is a DECLARED
  // snap (choreography) — spikes are counted but only reported for it;
  // the sweep/cross segments below must be strictly clean.
  await osc("/creature/move", "rotation-stress-w");
  await osc("/creature/clockMode", "live");
  await sleep(2000);
  const spikesW0 = (await page.evaluate(measureSnippet)).spikes;
  for (let t = 0; t < 16; t++) {
    await sleep(500);
    const m = await page.evaluate(measureSnippet);
    const nan = m.joints.some((j) => j.slice(1).some((x) => !Number.isFinite(x)));
    if (nan) failures.push(`NaN during w-hold t=${t}`);
  }
  const compsW = await page.evaluate(componentsSnippet);
  await page.screenshot({ path: path.join(ROOT, "reports/rotstress-w.png") });
  if (compsW !== 1) failures.push(`components=${compsW} during w-hold`);
  const spikesW1 = (await page.evaluate(measureSnippet)).spikes;
  console.log(`[rotstress] w-hold spikes (declared snap window): ${spikesW1 - spikesW0}`);
  rows.push({ mode: "w-hold", comps: compsW });
  const spikes0 = spikesW1;   // baseline for the strict segments

  // ── BEAT speed: live sweep + cross, 2 loops each, spikes must hold ────
  for (const mv of ["rotation-stress", "rotation-stress-cross"]) {
    await osc("/creature/move", mv);
    await sleep(1500);
    for (let t = 0; t < 16; t++) {
      await sleep(500);
      const m = await page.evaluate(measureSnippet);
      const nan = m.joints.some((j) => j.slice(1).some((x) => !Number.isFinite(x)));
      if (nan) failures.push(`NaN during live ${mv} t=${t}`);
    }
    const comps = await page.evaluate(componentsSnippet);
    if (comps !== 1) failures.push(`components=${comps} during live ${mv}`);
    rows.push({ mode: `live ${mv}`, comps });
  }
  const spikes1 = (await page.evaluate(measureSnippet)).spikes;
  console.log(`[rotstress] sweep+cross spikes delta=${spikes1 - spikes0} (must be 0)`);
  if (spikes1 - spikes0 !== 0) failures.push(`spikes during live sweep/cross: ${spikes1 - spikes0}`);

  // ── LEG-SWING row (brief 16.1): hip ±0.9 — static scrub, then live, then
  // the declared lunge snap. Same asserts; density watches limb0/limb1.
  await osc("/creature/move", "rotation-stress-leg");
  await osc("/creature/clockMode", "manual");
  await sleep(1500);
  const legLabel = (u) => {
    if (u <= 0.1) return `hipL ${(-HIP_MAX * u / 0.1).toFixed(2)}`;
    if (u <= 0.3) return `hipL ${(-HIP_MAX + 2 * HIP_MAX * (u - 0.1) / 0.2).toFixed(2)}`;
    if (u <= 0.4) return `hipL ${(HIP_MAX * (0.4 - u) / 0.1).toFixed(2)}`;
    if (u <= 0.5) return `hipR ${(-HIP_MAX * (u - 0.4) / 0.1).toFixed(2)}`;
    if (u <= 0.7) return `hipR ${(-HIP_MAX + 2 * HIP_MAX * (u - 0.5) / 0.2).toFixed(2)}`;
    if (u <= 0.8) return `hipR ${(HIP_MAX * (0.8 - u) / 0.1).toFixed(2)}`;
    return "compound bent-knee";
  };
  for (let i = 0; i <= 32; i++) {
    const u = i / 32;
    await osc("/creature/phaseScrub", u);
    await sleep(i % 4 === 0 ? 2600 : 700);
    const m = await page.evaluate(measureSnippet);
    const comps = i % 4 === 0 ? await page.evaluate(componentsSnippet) : null;
    const nan = m.joints.some((j) => j.slice(1).some((x) => !Number.isFinite(x)));
    const dens = m.perf?.limbDensity ?? {};
    const minDens = Math.min(...[dens.limb0, dens.limb1].filter((x) => x != null), Infinity);
    rows.push({ mode: "static-leg", label: legLabel(u), comps, nan, boneDev: m.perf?.boneDevRot ?? null, minDens: i % 4 === 0 ? minDens : null });
    if (nan) failures.push(`NaN at static-leg ${legLabel(u)}`);
    if (comps !== null && comps !== 1) failures.push(`components=${comps} at static-leg ${legLabel(u)}`);
    if ((m.perf?.boneDevRot ?? 0) >= 0.03) failures.push(`boneDev ${(m.perf.boneDevRot * 100).toFixed(1)}% at static-leg ${legLabel(u)}`);
    if (i === 4 || i === 20 || i === 28) {
      await page.screenshot({ path: path.join(ROOT, `reports/rotstress-leg-${i}.png`) });
    }
  }
  await osc("/creature/clockMode", "live");
  await sleep(1500);
  const spikesL0 = (await page.evaluate(measureSnippet)).spikes;
  for (let t = 0; t < 16; t++) {
    await sleep(500);
    const m = await page.evaluate(measureSnippet);
    const nan = m.joints.some((j) => j.slice(1).some((x) => !Number.isFinite(x)));
    if (nan) failures.push(`NaN during live leg sweep t=${t}`);
  }
  const compsLeg = await page.evaluate(componentsSnippet);
  if (compsLeg !== 1) failures.push(`components=${compsLeg} during live leg sweep`);
  const spikesL1 = (await page.evaluate(measureSnippet)).spikes;
  console.log(`[rotstress] live leg sweep spikes delta=${spikesL1 - spikesL0} (must be 0)`);
  if (spikesL1 - spikesL0 !== 0) failures.push(`spikes during live leg sweep: ${spikesL1 - spikesL0}`);
  rows.push({ mode: "live leg sweep", comps: compsLeg });
  // lunge snap (declared — spikes reported, not asserted)
  await osc("/creature/move", "rotation-stress-legsnap");
  await sleep(2000);
  const spikesLS0 = (await page.evaluate(measureSnippet)).spikes;
  for (let t = 0; t < 12; t++) {
    await sleep(500);
    const m = await page.evaluate(measureSnippet);
    const nan = m.joints.some((j) => j.slice(1).some((x) => !Number.isFinite(x)));
    if (nan) failures.push(`NaN during lunge snap t=${t}`);
  }
  const compsLS = await page.evaluate(componentsSnippet);
  await page.screenshot({ path: path.join(ROOT, "reports/rotstress-lunge.png") });
  if (compsLS !== 1) failures.push(`components=${compsLS} during lunge snap`);
  const spikesLS1 = (await page.evaluate(measureSnippet)).spikes;
  console.log(`[rotstress] lunge snap spikes (declared snap window): ${spikesLS1 - spikesLS0}`);
  rows.push({ mode: "lunge-snap", comps: compsLS });
  const legStatics = rows.filter((r) => r.mode === "static-leg");
  const legMeasured = legStatics.filter((r) => r.comps !== null);
  console.log(`[rotstress] LEG ENVELOPE: hip ±${HIP_MAX} rad — boneDev max=${(Math.max(...legStatics.map((r) => r.boneDev ?? 0)) * 100).toFixed(1)}%; ` +
    `min leg density at extremes=${Math.min(...legMeasured.map((r) => r.minDens ?? Infinity)).toFixed(2)}`);

  // envelope summary
  const statics = rows.filter((r) => r.mode === "static");
  const measured = statics.filter((r) => r.comps !== null);
  console.log(`[rotstress] static poses=${statics.length} (components measured at ${measured.length}); ` +
    `boneDev max=${(Math.max(...statics.map((r) => r.boneDev ?? 0)) * 100).toFixed(1)}%; ` +
    `min arm density at extremes=${Math.min(...measured.map((r) => r.minDens ?? Infinity)).toFixed(2)}`);
  console.log(`[rotstress] ENVELOPE: shoulder ±${SH_MAX.toFixed(2)} rad, elbow ±${EL_MAX} rad SIGNED — ${failures.length ? "REDUCED (see failures)" : "FULL RANGE CLEAN, static + beat + snap"}`);
} catch (e) {
  failures.push(String(e));
} finally {
  for (const f of ["rotation-stress.json", "rotation-stress-cross.json", "rotation-stress-w.json",
                   "rotation-stress-leg.json", "rotation-stress-legsnap.json"]) {
    await fs.unlink(path.join(MOVES, f)).catch(() => {});
  }
  await browser.close();
}
for (const f of failures) console.error(`[rotstress] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} rotation-stress`);
process.exitCode = failures.length ? 1 : 0;
