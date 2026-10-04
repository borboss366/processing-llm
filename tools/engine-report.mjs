#!/usr/bin/env node
/**
 * Owner CLI: table → engine ladder + verdict, one command (brief 19.2).
 *
 *   npm run engine-report -- --move <name> --shape <shape> [--seconds 8] [--open]
 *
 * Runs engine-trace.mjs (needs the stack up), prints the per-stage ladder
 * (the rung that eats the radians, worst joint per stage, clamp/yield
 * counts) and the engine-fidelity budget verdict, opens the explorer with
 * --open. Prints the underlying command.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runShown } from "./lib/run.mjs";
import { posRms } from "./lib/fk-ext.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const HELP = `npm run engine-report -- --move <name> --shape <biped-1|biped-2|biped-profile> [--seconds 8] [--open]`;
if (argv.includes("--help") || !argv.length) { console.log(HELP); process.exit(argv.length ? 0 : 1); }
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const MOVE = opt("move", null), SHAPE = opt("shape", "biped-1");
if (!MOVE) { console.error(HELP); process.exit(1); }

const base = path.join(ROOT, `reports/engine-${MOVE}-${SHAPE}`);
await runShown("node", [path.join(ROOT, "tools/engine-trace.mjs"),
  "--move", MOVE, "--shape", SHAPE, "--seconds", opt("seconds", "8"), "--no-webm"]);

const D = JSON.parse(fs.readFileSync(`${base}.engine-trace.json`, "utf8"));
const F = D.frames, BONES = Object.keys(F[0].s1 ?? {});
const wrap = (x) => Math.atan2(Math.sin(x), Math.cos(x));
const perBone = (key) => BONES.map((b) => {
  let s = 0;
  for (const f of F) s += wrap(((f[key] ?? {})[b] ?? 0) - (f.s1?.[b] ?? 0)) ** 2;
  return [b, Math.sqrt(s / F.length)];
});
const stages = [["s2", "blend"], ["s3", "spring (R2)"], ["s4", "+gait/liveness"], ["s5", "limits"], ["lockE", "lock+FK (final)"]];
console.log(`\n──── engine ladder · ${MOVE} × ${SHAPE} · ${F.length} frames ─────`);
let prev = 0, tallest = { label: "", step: -1 };
for (const [k, label] of stages) {
  const rows = perBone(k);
  const all = Math.sqrt(rows.reduce((a, [, v]) => a + v * v, 0) / rows.length);
  const [wb, wv] = rows.sort((a, b) => b[1] - a[1])[0];
  const step = all - prev;
  if (step > tallest.step) tallest = { label, step };
  console.log(`  ${label.padEnd(16)} RMS ${all.toFixed(3)} (Δ ${(all - prev >= 0 ? "+" : "")}${(all - prev).toFixed(3)})  worst ${wb} ${wv.toFixed(3)}`);
  prev = all;
}
const clamps = {}, yields = new Set();
for (const f of F) {
  for (const [nm, n2] of Object.entries(f.flags?.clamps ?? {})) clamps[nm] = Math.max(clamps[nm] ?? 0, n2);
  for (const [nm, l] of Object.entries(f.flags?.lock ?? {})) if (l.lift) yields.add(nm);
}
// POSITION rung (19.2 review): table FK'd vs engine joints, pelvis-
// normalized — theta ladders can read ~0 while FK sign/pivot errors splay
const pr = posRms(F, D.meta, "lockP");
const worstP = Object.entries(pr.perJoint).sort((a, b) => b[1] - a[1])[0];
console.log(`  FK POSITION      RMS ${pr.all.toFixed(3)} u (pelvis-normalized)  worst ${worstP[0]} ${worstP[1].toFixed(3)} u`);
console.log(`  clamps ${Object.keys(clamps).length ? JSON.stringify(clamps) : "0"} · lift-yields ${[...yields].join(",") || "none"}`);
console.log(`  the rung that eats the radians: ${tallest.label} (+${tallest.step.toFixed(3)} rad)`);

// fidelity budgets (same numbers as tools/engine-fidelity.mjs)
const B = { s2: 0.05, s3: 0.50, liveDelta: 0.20, limitDelta: 0.02, lockDelta: 0.15 };
const rms = (k) => Math.sqrt(perBone(k).reduce((a, [, v]) => a + v * v, 0) / BONES.length);
const r2 = rms("s2"), r3 = rms("s3"), r4 = rms("s4"), r5 = rms("s5"), rl = rms("lockE");
let tbl = {};
try { tbl = JSON.parse(fs.readFileSync(path.join(ROOT, `web/app/moves/${MOVE}.json`), "utf8")); } catch {}
const wl = new Set(tbl.clampWhitelist ?? []);
const bad = Object.keys(clamps).filter((n) => !wl.has(n));
const fails = [];
if (r2 > B.s2) fails.push(`blend ${r2.toFixed(3)} > ${B.s2}`);
if (r3 > B.s3) fails.push(`spring ${r3.toFixed(3)} > ${B.s3}`);
if (r4 - r3 > B.liveDelta) fails.push(`liveness +${(r4 - r3).toFixed(3)} > ${B.liveDelta}`);
if (rl - r4 > B.lockDelta) fails.push(`lock +${(rl - r4).toFixed(3)} > ${B.lockDelta}`);
if (bad.length) fails.push(`unwhitelisted clamps: ${bad.join(",")}`);
console.log(`  fidelity: ${fails.length ? "FAIL — " + fails.join(" · ") : "PASS (all budgets)"}${wl.size ? ` (whitelist: ${[...wl]})` : ""}`);
console.log("──────────────────────────────────────────────────────────────");
if (argv.includes("--open")) execFileSync("open", [`${base}.engine.explorer.html`]);
