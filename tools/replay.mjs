#!/usr/bin/env node
/**
 * Offline director replay — re-runs a recorded session's feature windows
 * through the director pipeline with no audio, so prompt changes can be
 * evaluated against real set data instead of by re-DJing.
 *
 *   node tools/replay.mjs sessions/<file>.jsonl [--prompt-variant memory|no-memory]
 *                                               [--history-n N] [--catalogue-window N]
 *                                               [--model <ollama-model>] [--seed N]
 *
 * --seed pins both candidate sampling and Ollama generation, so two replays
 * that differ only in --prompt-variant are a fair A/B comparison.
 *
 * Uses the exact same buildDirectorPrompt / prefilter / parse code as the
 * live route (src/director/director.ts, imported via Node's native type
 * stripping). Recency and memory accumulate from the REPLAY's own picks, so
 * the table shows what a whole set would have looked like under the variant.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_HISTORY_N,
  DEFAULT_CATALOGUE_WINDOW,
  DEFAULT_PROMPT_VARIANT,
  buildDirectorPrompt,
  callDirectorLLM,
  getStableCatalogue,
  parseDirectorResponse,
  prefilterCandidates,
} from "../src/director/director.ts";

// Deterministic RNG (mulberry32) so --seed makes candidate sampling — and,
// via Ollama's seed option, generation — reproducible for fair A/B replays.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = {};
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith("--")) { flags[argv[i].slice(2)] = argv[++i]; }
  else positional.push(argv[i]);
}
const file = positional[0];
const variant = flags["prompt-variant"] ?? DEFAULT_PROMPT_VARIANT;
const historyN = Number(flags["history-n"] ?? DEFAULT_HISTORY_N);
const catalogueWindow = Number(flags["catalogue-window"] ?? DEFAULT_CATALOGUE_WINDOW);
const model = flags["model"];
const seed = flags["seed"] !== undefined ? Number(flags["seed"]) : undefined;

if (!file || !["memory", "no-memory"].includes(variant)) {
  console.error("usage: node tools/replay.mjs sessions/<file>.jsonl [--prompt-variant memory|no-memory] [--history-n N] [--catalogue-window N] [--model m] [--seed N]");
  process.exit(1);
}

// ── load session + catalogue ──────────────────────────────────────────────
const lines = (await fs.readFile(path.resolve(file), "utf8")).split("\n").filter(Boolean);
const events = lines.map((l, i) => {
  try { return JSON.parse(l); }
  catch { console.warn(`[replay] skipping bad JSON on line ${i + 1}`); return null; }
}).filter(Boolean);

const windows = events.filter((e) => e.type === "director");
const actions = events.filter((e) => e.type === "action").length;
const start = events.find((e) => e.type === "session-start");
if (!windows.length) {
  console.error(`[replay] no director events in ${file} (${events.length} events total)`);
  process.exit(1);
}

const catalogue = await getStableCatalogue(path.join(ROOT, "web/app/preset-descriptions"));
if (!catalogue.items.length) {
  console.error("[replay] no preset descriptions found");
  process.exit(1);
}

console.log(`[replay] ${file}: ${windows.length} director windows, ${actions} operator actions` +
            (start ? `, recorded config ${JSON.stringify(start.config)}` : ""));
console.log(`[replay] variant=${variant} historyN=${historyN} catalogueWindow=${catalogueWindow}` +
            (seed !== undefined ? ` seed=${seed}` : "") + "\n");

// ── replay loop ───────────────────────────────────────────────────────────
const trunc = (s, n) => { s = String(s ?? ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; };
const col = (s, n) => trunc(s, n).padEnd(n);

const RECENT_KEEP = start?.config?.recentKeep ?? 8;
const recent = [];       // replay's own anti-repeat window
const history = [];      // replay's own memory
let changed = 0;
let holds = 0;
const t0 = Date.now();

console.log(col("#", 3) + col("t+", 7) + col("original pick", 36) + col("new pick", 36) + col("ms", 7) + col("peval", 7) + "description");
console.log("─".repeat(128));

const sessionT0 = windows[0].t;
for (let i = 0; i < windows.length; i++) {
  const w = windows[i];
  const candidateNumbers = prefilterCandidates(catalogue.items, {
    recentSlugs: recent,
    maxComplexity: w.request?.max_complexity,
    windowSize: catalogueWindow,
    ...(seed !== undefined ? { rng: mulberry32(seed * 1000 + i) } : {}),
  });
  const prompt = buildDirectorPrompt({
    catalogueText: catalogue.text,
    candidateNumbers,
    current: w.stats,
    prev: w.request?.prev ?? null,
    history: history.slice(-historyN),
    variant,
  });

  let row;
  try {
    const llm = await callDirectorLLM(prompt, {
      ...(model ? { model } : {}),
      ...(seed !== undefined ? { seed: seed * 1000 + i } : {}),
    });
    const { description, hold, pick, filter, offList } =
      parseDirectorResponse(llm.raw, catalogue.items, candidateNumbers);
    const origLabel = w.response?.hold ? "HOLD" : w.response?.preset;
    const newLabel = hold ? "HOLD" : pick.name;
    if (hold) holds++;
    if (newLabel !== origLabel) changed++;
    if (!hold) {
      recent.push(pick.slug);
      if (recent.length > RECENT_KEEP) recent.shift();
      history.push({ profile: w.stats, preset: pick.name, filter });
    }
    row = col(String(i + 1), 3) + col(`${Math.round((w.t - sessionT0) / 1000)}s`, 7) +
          col(origLabel, 36) + col((offList ? "⚠ " : "") + newLabel, 36) +
          col(String(llm.ms), 7) + col(String(llm.promptEvalCount), 7) + trunc(description, 56);
  } catch (err) {
    row = col(String(i + 1), 3) + col(`${Math.round((w.t - sessionT0) / 1000)}s`, 7) +
          col(w.response?.preset, 36) + col(`ERROR: ${err.message}`, 36) + col("-", 7) + col("-", 7);
  }
  console.log(row);
}

console.log("─".repeat(128));
console.log(`[replay] ${windows.length} windows in ${((Date.now() - t0) / 1000).toFixed(1)}s · ` +
            `${changed}/${windows.length} decisions differ from the recorded session · ` +
            `${holds} hold(s) · ⚠ = off-list pick corrected`);
