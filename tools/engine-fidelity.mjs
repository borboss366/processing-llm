#!/usr/bin/env node
/**
 * Engine fidelity (brief 19.1 Task 4): per-stage |engine − table| RMS over
 * a loop, against per-stage budgets. Replaces chain-travel as THE fidelity
 * row — the A7 knee bug (table 1.8 rad rendered straight) could not have
 * shipped past this.
 *
 * Budgets (rad RMS, measured 2026-10-03 + headroom; the spring number IS
 * the R2 rung — shrinking it is future work, regressing it is a failure):
 *   blend (s2)             ≤ 0.05   settled crossfade adds nothing
 *   spring (s3)            ≤ 0.50   MV_WN=10 lag envelope (measured 0.35)
 *   liveness (s4 − s3)     ≤ 0.20   gait + variation ride on top by design
 *   limits (s5 − s3)       ≤ 0.02   clamps add NOTHING unless whitelisted
 *   lock+FK (final − s4)   ≤ 0.15   stance lock must not eat table content
 * Any rotLimit clamp on a captured table fails unless the table header
 * carries `clampWhitelist: [joint, ...]` with a reason.
 *
 *   node tools/engine-fidelity.mjs   (spawns its own captures; needs stack)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { posRms } from "./lib/fk-ext.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CASES = [
  { move: "runningman-captured", shape: "biped-profile", captured: true },
  { move: "tstep-captured", shape: "biped-1", captured: true },
];
const BUDGET = { s2: 0.05, s3: 0.50, liveDelta: 0.20, limitDelta: 0.02, lockDelta: 0.15,
  // position rung (19.2 review): pelvis-normalized |tableFK − engine| —
  // catches FK sign/pivot errors that theta ladders cannot (measured:
  // runningman ~0.04, basic_kick 0.055 incl. its clamped foot)
  posU: 0.10 };
const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
const failures = [];

for (const c of CASES) {
  const out = path.join(ROOT, `reports/engine-${c.move}-${c.shape}`);
  const tracePath = `${out}.engine-trace.json`;
  // reuse a fresh matrix dump when present; capture otherwise
  if (!fs.existsSync(tracePath) || Date.now() - fs.statSync(tracePath).mtimeMs > 3600_000) {
    const r = spawnSync("node", [path.join(ROOT, "tools/engine-trace.mjs"),
      "--move", c.move, "--shape", c.shape, "--seconds", "8", "--no-webm"], { stdio: "inherit" });
    if (r.status !== 0) { failures.push(`${c.move}: capture failed`); continue; }
  }
  const D = JSON.parse(fs.readFileSync(tracePath, "utf8"));
  const F = D.frames;
  const BONES = Object.keys(F[0].s1 ?? {});
  const rms = (key) => {
    let s = 0, n = 0;
    for (const b of BONES) for (const f of F) { s += wrap(((f[key] ?? {})[b] ?? 0) - (f.s1?.[b] ?? 0)) ** 2; n++; }
    return Math.sqrt(s / n);
  };
  const table = JSON.parse(fs.readFileSync(path.join(ROOT, `web/app/moves/${c.move}.json`), "utf8"));
  const whitelist = new Set(table.clampWhitelist ?? []);
  // whitelisted clamp slots map to their ext bone (slot J = bone entering J)
  const SLOT2EXT = { footL: "ankleL", footR: "ankleR", ankleL: "kneeL", ankleR: "kneeR",
                     kneeL: "hipL", kneeR: "hipR", handL: "elbowL", handR: "elbowR",
                     elbowL: "shoulderL", elbowR: "shoulderR" };
  const exempt = new Set([...whitelist].map((s2) => SLOT2EXT[s2] ?? s2));
  const okBones = BONES.filter((b) => !exempt.has(b));
  const rmsOver = (key, set) => {
    let s = 0, n = 0;
    for (const b of set) for (const f of F) { s += wrap(((f[key] ?? {})[b] ?? 0) - (f.s1?.[b] ?? 0)) ** 2; n++; }
    return Math.sqrt(s / Math.max(1, n));
  };
  const r2 = rms("s2"), r3 = rms("s3"), r4 = rms("s4"), rl = rms("lockE");
  // limits delta judged on NON-whitelisted bones only (whitelisted clamps
  // are logged, justified losses — the budget's "except" clause)
  const r5 = rmsOver("s5", okBones), r3ok = rmsOver("s3", okBones);
  // s1 sanity: the reference must carry real motion (a dead tap = silent lie)
  const amp = Math.max(...BONES.map((b) => {
    const v = F.map((f) => f.s1?.[b] ?? 0);
    return Math.max(...v) - Math.min(...v);
  }));
  const clampTotals = {};
  for (const f of F) for (const [nm, n2] of Object.entries(f.flags?.clamps ?? {})) clampTotals[nm] = Math.max(clampTotals[nm] ?? 0, n2);
  const badClamps = Object.keys(clampTotals).filter((nm) => !whitelist.has(nm));

  console.log(`[engine-fidelity] ${c.move} × ${c.shape}: blend ${r2.toFixed(3)} · spring ${r3.toFixed(3)} · +live ${(r4 - r3).toFixed(3)} · limits Δ ${(r5 - r3ok).toFixed(3)} (ex-whitelist) · lock Δ ${(rl - r4).toFixed(3)} · s1 amp ${amp.toFixed(2)} · clamps ${JSON.stringify(clampTotals)}${whitelist.size ? " whitelist [" + [...whitelist] + "]" : ""}`);
  if (amp < 0.3) failures.push(`${c.move}: reference stream dead (amp ${amp.toFixed(2)})`);
  if (r2 > BUDGET.s2) failures.push(`${c.move}: blend ${r2.toFixed(3)} > ${BUDGET.s2}`);
  if (r3 > BUDGET.s3) failures.push(`${c.move}: spring ${r3.toFixed(3)} > ${BUDGET.s3}`);
  if (r4 - r3 > BUDGET.liveDelta) failures.push(`${c.move}: liveness adds ${(r4 - r3).toFixed(3)} > ${BUDGET.liveDelta}`);
  if (Math.abs(r5 - r3ok) > BUDGET.limitDelta) failures.push(`${c.move}: limits add ${(r5 - r3ok).toFixed(3)} > ${BUDGET.limitDelta} (non-whitelisted bones)`);
  if (rl - r4 > BUDGET.lockDelta) failures.push(`${c.move}: lock/FK adds ${(rl - r4).toFixed(3)} > ${BUDGET.lockDelta} (the A7 class)`);
  if (badClamps.length) failures.push(`${c.move}: unwhitelisted clamps on ${badClamps.join(",")} — whitelist with a reason in the table header or fix the channel`);
  const pr = posRms(F, D.meta, "lockP");
  console.log(`[engine-fidelity]   position rung: ${pr.all.toFixed(3)} u (budget ${BUDGET.posU})`);
  if (pr.all > BUDGET.posU) failures.push(`${c.move}: FK position RMS ${pr.all.toFixed(3)} u > ${BUDGET.posU}`);
}

for (const f of failures) console.error(`[engine-fidelity] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} engine-fidelity`);
process.exitCode = failures.length ? 1 : 0;
