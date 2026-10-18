#!/usr/bin/env node
/**
 * weight-rate (brief 17.6 addendum A.2; bound in ms per owner 2026-10-19):
 * a full weight transfer (Σ|Δweight| = 2) cannot complete faster than the
 * extractor can CONFIRM one. The extractor lets a lift that contradicts the
 * pelvis carry the weight over only after `persist` = ⌊SG window / 2⌋
 * frames — 4 frames at the source 29.97 fps = 133 ms. That is the bound,
 * derived once from the extractor's own rule, not fitted to any table.
 * It is stated in SOURCE time: the table's provenance `loopSec` maps it to
 * loop phase (the stage may later play the table at any tempo — that is
 * the engine's spring's business, not the signal's).
 *
 * Check: for every table that carries weight and its source time, sample
 * weight the way the engine plays it (per-segment ease, as creature.js
 * sampleMove) and take the largest Σ|Δweight| over any window of T_MIN.
 * PASS = every one < 2. Tables without `weight` (authored, contacts only)
 * or without `loopSec` are printed as INFO.
 *
 *   node tools/weight-rate.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { weightFromContacts } from "./mocap/lib/weight.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MOVES = path.join(ROOT, "web/app/moves");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
// derived once: the extractor's persist rule at its defaults
const SG_WINDOW = 9, SOURCE_FPS = 29.97;
const T_MIN_MS = Math.floor(SG_WINDOW / 2) / SOURCE_FPS * 1000;   // 133.5 ms
const STEPS = 2000;                                               // samples per loop

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
  const source = keys.some((k) => k.weight !== undefined) ? "weight" : "contacts";
  const loopSec = table.provenance?.loopSec ?? null;
  if (!loopSec) return { maxSwing: null, phase: null, source, windowMs: T_MIN_MS, loopSec };
  const n = STEPS, win = Math.max(1, Math.round(T_MIN_MS / (loopSec * 1000) * n));
  const w = Array.from({ length: n }, (_, s2) => weightAt(keys, s2 / n));
  let worst = 0, at = 0;
  for (let s2 = 0; s2 < n; s2++) {
    let sum = 0, ok = true;
    for (let j = 0; j < win; j++) {
      const p = w[(s2 + j) % n], q = w[(s2 + j + 1) % n];
      if (p == null || q == null) { ok = false; break; }
      sum += Math.abs(q - p);
    }
    if (ok && sum > worst) { worst = sum; at = s2 / n; }
  }
  return { maxSwing: worst, phase: at, source, windowMs: T_MIN_MS, loopSec };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = [];
  for (const f of fs.readdirSync(MOVES).filter((x) => x.endsWith(".json") && x !== "roster.json").sort()) {
    const t = JSON.parse(fs.readFileSync(path.join(MOVES, f), "utf8"));
    if (!Array.isArray(t.keys) || !t.keys.length) continue;
    rows.push({ name: f.slice(0, -5), ...weightRate(t) });
  }
  if (argv.includes("--json")) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
  const gated = rows.filter((r) => r.source === "weight" && r.maxSwing != null);
  for (const r of rows.sort((a, b) => (b.maxSwing ?? -1) - (a.maxSwing ?? -1))) {
    const tag = r.maxSwing == null ? "INFO" : r.source === "weight" ? (r.maxSwing >= 2 ? "FAIL" : "ok  ") : "INFO";
    const why = r.maxSwing == null ? (r.source === "weight" ? "no provenance.loopSec — re-extract" : "authored, no source time") : `(${r.source})`;
    console.log(`${tag} ${r.name.padEnd(34)} ${r.maxSwing == null ? "—" : `Σ|Δw| ${r.maxSwing.toFixed(2)} in ${T_MIN_MS.toFixed(0)} ms @ phase ${r.phase.toFixed(3)}`} ${why}`);
  }
  const bad = gated.filter((r) => r.maxSwing >= 2);
  const w = gated.reduce((a, b) => (b.maxSwing > a.maxSwing ? b : a), gated[0]);
  console.log(`[weight-rate] ${bad.length || !gated.length ? "FAIL" : "PASS"}: ${gated.length} tables with weight + source time; no full transfer (Σ|Δw| ≥ 2) inside ${T_MIN_MS.toFixed(1)} ms of source time; worst ${w?.name} ${w?.maxSwing.toFixed(2)} @ ${w?.phase.toFixed(3)}`);
  console.log(`VERIFY:${bad.length || !gated.length ? "FAIL" : "PASS"} weight-rate`);
  process.exit(bad.length ? 1 : 0);
}
