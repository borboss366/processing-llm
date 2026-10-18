#!/usr/bin/env node
/**
 * weight-rate (brief 17.6 addendum A.2): a full weight transfer cannot
 * happen in one frame. On every move table, sample `weight` the way the
 * engine plays the loop (per-segment ease, same as creature.js
 * sampleMoveTable) and find the fastest swing: |Δweight| summed over any
 * window of 0.1 beat. Authored tables without `weight` derive it from
 * contacts (weightFromContacts — the same rule the extractor round-trips).
 * Airborne (null) samples break a window: no support, nothing to transfer.
 *
 *   node tools/weight-rate.mjs [--bound 1.5] [--json]
 *
 * PASS = every table that CARRIES weight (captured) has max swing ≤ bound.
 * Tables with contacts only (authored) are printed as INFO: their weight is
 * a step function of discrete contacts by construction (a snap key moves
 * it in 1/16 beat) — smoothing a transfer there is the engine blend's job
 * (17.6 Task 2), not the signal's. Prints the worst gated table + phase.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { weightFromContacts } from "./mocap/lib/weight.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOVES = path.join(ROOT, "web/app/moves");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
// one global bound, no per-table numbers (generality guard). Measured
// 2026-10-19: real captured transfers ≤ 1.25 (running_man_3 1.22,
// runningman 1.11); stitch-seam pops 1.72–2.00. 1.5 separates them with
// margin both ways — a full −1→+1 transfer takes ≥ ~0.13 beat.
const BOUND = +opt("bound", 1.5);
const WINDOW_BEATS = 0.1, STEP_BEATS = 0.005;

// creature.js sampleMoveTable's ease, kept identical so the measured swing
// is the one the stage plays
function weightAt(keys, phase) {
  let i = keys.length - 1;
  for (let k = 0; k < keys.length; k++) if (keys[k].phase <= phase) i = k;
  const a = keys[i], b = keys[(i + 1) % keys.length];
  const span = (((b.phase - a.phase) % 1) + 1) % 1 || 1;
  let u = ((((phase - a.phase) % 1) + 1) % 1) / span;
  const ease = a.ease ?? "smooth";
  if (ease === "snap") u = Math.min(1, u * 4);
  if (ease !== "linear") u = u * u * (3 - 2 * u);
  if (a.w == null || b.w == null) return null;
  return a.w + (b.w - a.w) * u;
}

export function weightRate(table) {
  const keys = [...table.keys].sort((p, q) => p.phase - q.phase)
    .map((k) => ({ ...k, w: k.weight !== undefined ? k.weight : weightFromContacts(k.contacts ?? []) }));
  const bpl = table.beatsPerLoop ?? 2;
  const n = Math.round(bpl / STEP_BEATS), win = Math.round(WINDOW_BEATS / STEP_BEATS);
  const w = Array.from({ length: n }, (_, s) => weightAt(keys, s / n));
  let worst = 0, at = 0;
  for (let s = 0; s < n; s++) {
    let sum = 0, ok = true;
    for (let j = 0; j < win; j++) {
      const p = w[(s + j) % n], q = w[(s + j + 1) % n];
      if (p == null || q == null) { ok = false; break; }
      sum += Math.abs(q - p);
    }
    if (ok && sum > worst) { worst = sum; at = s / n; }
  }
  return { maxSwing: worst, phase: at, source: keys.some((k) => k.weight !== undefined) ? "weight" : "contacts" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = [];
  for (const f of fs.readdirSync(MOVES).filter((x) => x.endsWith(".json") && x !== "roster.json").sort()) {
    const t = JSON.parse(fs.readFileSync(path.join(MOVES, f), "utf8"));
    if (!Array.isArray(t.keys) || !t.keys.length) continue;
    rows.push({ name: f.slice(0, -5), ...weightRate(t) });
  }
  if (argv.includes("--json")) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
  for (const r of rows.sort((a, b) => b.maxSwing - a.maxSwing)) {
    const tag = r.source === "contacts" ? (r.maxSwing > BOUND ? "INFO" : "    ") : r.maxSwing > BOUND ? "FAIL" : "ok  ";
    console.log(`${tag} ${r.name.padEnd(34)} max swing ${r.maxSwing.toFixed(2)} / 0.1 beat @ phase ${r.phase.toFixed(3)} (${r.source})`);
  }
  const gated = rows.filter((r) => r.source === "weight");
  const bad = gated.filter((r) => r.maxSwing > BOUND);
  const w = gated.reduce((a, b) => (b.maxSwing > a.maxSwing ? b : a), gated[0]);
  const info = rows.filter((r) => r.source === "contacts" && r.maxSwing > BOUND).map((r) => r.name);
  console.log(`[weight-rate] ${bad.length ? "FAIL" : "PASS"}: ${gated.length} weight-carrying tables, bound ${BOUND} per ${WINDOW_BEATS} beat; worst ${w?.name} ${w?.maxSwing.toFixed(2)} @ phase ${w?.phase.toFixed(3)}`
    + (info.length ? ` · contacts-only over the bound (engine blend's job): ${info.join(", ")}` : ""));
  console.log(`VERIFY:${bad.length ? "FAIL" : "PASS"} weight-rate`);
  process.exit(bad.length ? 1 : 0);
}
