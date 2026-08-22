/**
 * Director core — everything the LLM-director pipeline shares between the
 * live route (src/controller/server.ts) and offline replay (tools/replay.mjs).
 *
 * Prompt layout is STABLE-PREFIX + VARIABLE-TAIL, deliberately: Ollama reuses
 * the KV cache for the longest common prefix with the previous request, so
 * the role line, the full catalogue (fixed order: sorted by slug, memoized),
 * and the filter/output spec must be byte-identical across calls. Everything
 * that varies per call (history, current profile, allowed candidate numbers)
 * goes after them. Do not insert anything variable into the prefix — one
 * changed byte re-pays ~6k tokens of prompt eval (~20 s on the dev machine).
 *
 * buildDirectorPrompt() is a pure function: replay must produce byte-identical
 * prompts to the live route for the same inputs, so no IO or clock access
 * belongs in it. IO helpers (catalogue loading, Ollama call) live here too so
 * both callers share one implementation.
 *
 * Uses erasable TS syntax only (no enums/namespaces) — tools/replay.mjs
 * imports this file directly via Node's native type stripping.
 */

import fs from "node:fs/promises";
import path from "node:path";

// Tunables — importable so live route and replay share the same defaults.
export const DEFAULT_HISTORY_N = 3;         // picks the prompt remembers
export const DEFAULT_CATALOGUE_WINDOW = 60; // size of the candidate number list
export const DIRECTOR_MODEL = "qwen3:8b";
// Explicit num_ctx: the full-catalogue prefix is ~6-7k tokens and Ollama's
// default context would silently truncate it (breaking numbering AND caching).
export const DIRECTOR_NUM_CTX = 16384;

export type PresetTags = {
  motion?: string; density?: string; brightness?: string; palette?: string;
  energy?: string; geometry?: string; complexity?: number; colors?: string[];
};

export type PresetDesc = {
  name: string; description: string; slug: string; tags: PresetTags;
};

export type DirectorFilter = { hue: number; sat: number; bright: number };

/** One remembered decision: the window that triggered it + what was picked. */
export type DirectorMemory = {
  profile: Record<string, number>;
  preset: string;
  filter: DirectorFilter;
};

export type PromptVariant = "memory" | "no-memory";

// ── Preset catalogue ───────────────────────────────────────────────────────

function parseTagsFromFrontmatter(fm: string): PresetTags {
  const tags: PresetTags = {};
  for (const k of ["motion", "density", "brightness", "palette", "energy", "geometry"] as const) {
    const m = new RegExp(`^${k}:\\s*(.+)$`, "m").exec(fm);
    if (m && m[1] !== undefined) tags[k] = m[1].trim();
  }
  const cm = /^complexity:\s*([1-5])/m.exec(fm);
  if (cm && cm[1] !== undefined) tags.complexity = parseInt(cm[1], 10);
  const colm = /^colors:\s*\[(.+)\]/m.exec(fm);
  if (colm && colm[1] !== undefined) {
    tags.colors = colm[1].split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  }
  return tags;
}

export async function loadPresetDescriptions(dir: string): Promise<PresetDesc[]> {
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".md"));
    const out: PresetDesc[] = [];
    for (const f of files) {
      const raw = await fs.readFile(path.join(dir, f), "utf8");
      const m = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]+)$/.exec(raw);
      if (!m || m[1] === undefined || m[2] === undefined) continue;
      const nm = /^name:\s*(.+)$/m.exec(m[1]);
      if (!nm || nm[1] === undefined) continue;
      let name = nm[1].trim();
      if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
        try { name = JSON.parse(name); } catch {}
      }
      out.push({
        name,
        description: m[2].trim(),
        slug: f.replace(/\.md$/, ""),
        tags: parseTagsFromFrontmatter(m[1]),
      });
    }
    return out;
  } catch {
    return [];
  }
}

export type StableCatalogue = {
  items: PresetDesc[];   // sorted by slug; entry i is preset number i+1
  text: string;          // the numbered catalogue block for the prompt prefix
};

function formatCatalogueEntry(p: PresetDesc, i: number): string {
  const t = p.tags;
  const tagStr = [
    t.complexity != null ? `c${t.complexity}` : null,
    t.energy, t.density, t.brightness, t.motion,
  ].filter(Boolean).join(" ");
  return `${i + 1}. [${tagStr}] ${p.name} — ${p.description}`;
}

// Memoized per directory: the catalogue text is part of the stable prompt
// prefix and must not be rebuilt (or re-ordered) per call. Consequence:
// editing preset .md files now needs a server restart to take effect in the
// director (the /presets/descriptions listing still reads fresh).
let catalogueCache: { dir: string; value: StableCatalogue } | null = null;

export async function getStableCatalogue(dir: string): Promise<StableCatalogue> {
  if (catalogueCache && catalogueCache.dir === dir) return catalogueCache.value;
  const items = (await loadPresetDescriptions(dir))
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const value: StableCatalogue = {
    items,
    text: items.map(formatCatalogueEntry).join("\n"),
  };
  catalogueCache = { dir, value };
  return value;
}

/** Candidate preset numbers (1-based into the stable catalogue): recency
 *  blocklist + complexity ceiling, then a sample of `windowSize` — the fresh
 *  subset now lives in the tail's number list, NOT in a shuffled prompt.
 *  `rng` is injectable so replay can be deterministic under --seed. */
export function prefilterCandidates(
  items: PresetDesc[],
  opts: {
    recentSlugs?: string[]; maxComplexity?: number; windowSize?: number;
    rng?: () => number;
  } = {},
): number[] {
  const {
    recentSlugs = [], maxComplexity,
    windowSize = DEFAULT_CATALOGUE_WINDOW, rng = Math.random,
  } = opts;
  const recentSet = new Set(recentSlugs);
  let eligible: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const p = items[i]!;
    if (recentSet.has(p.slug)) continue;
    if (typeof maxComplexity === "number" && typeof p.tags.complexity === "number"
        && p.tags.complexity > maxComplexity) continue;
    eligible.push(i + 1);
  }
  // Always keep ≥1 candidate — if recency/complexity excluded everything,
  // fall back to the full list so the director still picks something.
  if (!eligible.length) eligible = items.map((_, i) => i + 1);
  if (eligible.length > windowSize) {
    // partial Fisher-Yates: sample windowSize without replacement
    for (let i = 0; i < windowSize; i++) {
      const j = i + Math.floor(rng() * (eligible.length - i));
      [eligible[i], eligible[j]] = [eligible[j]!, eligible[i]!];
    }
    eligible = eligible.slice(0, windowSize);
  }
  return eligible.sort((a, b) => a - b);
}

// ── Prompt construction (pure) ─────────────────────────────────────────────

export function profileLine(f: Record<string, number>): string {
  const g = (k: string) => (typeof f[k] === "number" ? f[k]!.toFixed(2) : "0.00");
  const bpm = Math.round(Number(f["mean_bpm"]) || 0);
  return (
    `level=${g("mean_level")} dyn=${g("dynRange")} bpm=${bpm} bps=${g("mean_beatsPerSec")} ` +
    `bri=${g("mean_centroid")} roll=${g("mean_rolloff")} flat=${g("mean_flatness")} crest=${g("mean_crest")} flux=${g("mean_flux")} ` +
    `bands sub=${g("mean_b_sub")} kick=${g("mean_b_kick")} low=${g("mean_b_low")} ` +
    `lowMid=${g("mean_b_lowMid")} mid=${g("mean_b_mid")} upMid=${g("mean_b_upperMid")} ` +
    `pres=${g("mean_b_presence")} air=${g("mean_b_air")}`
  );
}

/** The stable prompt prefix. Byte-identical across calls for a given
 *  catalogue — this is what Ollama's KV-cache prefix reuse keys on. */
export function buildDirectorPrefix(catalogueText: string): string {
  return (
    `You are a VJ director for a live music set. Whenever the audio character changes, ` +
    `you pick ONE butterchurn preset (by its number) and a colour filter for it.\n\n` +
    `Available butterchurn presets (numbered):\n${catalogueText}\n\n` +
    `Filter parameters:\n` +
    `  hue    : -180..180 degrees (hue rotation; 0 = no shift)\n` +
    `  sat    : 0..2     (saturation multiplier; 1 = unchanged)\n` +
    `  bright : 0.5..1.5 (brightness multiplier; 1 = unchanged)\n\n` +
    `You always answer with one-line JSON only:\n` +
    `{"description":"<one sentence, ≤15 words, on what the new section sounds like>",` +
    `"preset":<number>,` +
    `"filter":{"hue":<deg>,"sat":<num>,"bright":<num>}}\n\n`
  );
}

/**
 * Build the full director prompt: stable prefix + variable tail.
 *
 *  - variant 'memory' (live default): the model sees the last N decisions
 *    (profile + preset + filter) and is asked what should FOLLOW.
 *  - variant 'no-memory': prev/current profile only, kept for replay A/B.
 */
export function buildDirectorPrompt(opts: {
  catalogueText: string;
  candidateNumbers: number[];
  current: Record<string, number>;
  prev?: Record<string, number> | null;
  history?: DirectorMemory[];
  variant?: PromptVariant;
}): string {
  const { catalogueText, candidateNumbers, current, prev, history = [], variant = "memory" } = opts;

  let context: string;
  let ask: string;
  if (variant === "no-memory" || history.length === 0) {
    context =
      (prev
        ? `Previous section: ${profileLine(prev)}\n`
        : `(No previous section — this is the start of the set.)\n`) +
      `Current section:  ${profileLine(current)}\n\n`;
    ask = `Pick a visualisation that fits the CURRENT section, and a colour filter for it.\n`;
  } else {
    const historyLines = history
      .map((h, i) =>
        `  ${i + 1}. ${profileLine(h.profile)}\n` +
        `     → "${h.preset}" (hue ${Math.round(h.filter.hue)}° sat ${h.filter.sat.toFixed(2)} bright ${h.filter.bright.toFixed(2)})`)
      .join("\n");
    context =
      `Recent picks, oldest first — what the audience has just seen and what it sounded like:\n` +
      `${historyLines}\n\n` +
      `Current section:  ${profileLine(current)}\n\n`;
    ask =
      `Given the last picks and their sound profiles, pick what should FOLLOW: a visualisation\n` +
      `that fits the CURRENT section and reads as a progression from the recent picks, not a\n` +
      `repeat of them. Also pick a colour filter for it.\n`;
  }

  return (
    buildDirectorPrefix(catalogueText) +
    context +
    ask +
    `Choose ONLY from these preset numbers: [${candidateNumbers.join(", ")}] — any other number is invalid.\n` +
    `Output the one-line JSON now.`
  );
}

// ── Response parsing (shared clamping + candidate validation) ──────────────

export type DirectorPick = {
  description: string;
  pick: PresetDesc;
  filter: DirectorFilter;
  offList: boolean;      // model ignored the candidate-number constraint
};

export function parseDirectorResponse(
  raw: string,
  catalogue: PresetDesc[],
  candidateNumbers: number[],
): DirectorPick {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("no JSON found in response");
  const parsed = JSON.parse(jsonMatch[0]);
  if (!candidateNumbers.length) throw new Error("empty candidate list");

  const requested = parseInt(String(parsed.preset), 10);
  let num = Number.isFinite(requested) ? requested : candidateNumbers[0]!;
  let offList = false;
  if (!candidateNumbers.includes(num)) {
    // Deterministic fallback: nearest allowed number to what it asked for.
    offList = true;
    num = candidateNumbers.reduce((best, c) =>
      Math.abs(c - num) < Math.abs(best - num) ? c : best, candidateNumbers[0]!);
  }
  const pick = catalogue[num - 1];
  if (!pick) throw new Error(`preset number ${num} out of catalogue range`);

  const filter = parsed.filter ?? {};
  const safe = (n: unknown, lo: number, hi: number, fallback: number) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(lo, Math.min(hi, v));
  };
  return {
    description: String(parsed.description ?? "").slice(0, 200),
    pick,
    offList,
    filter: {
      hue:    safe(filter.hue,    -180, 180, 0),
      sat:    safe(filter.sat,    0,    2,   1),
      bright: safe(filter.bright, 0.5,  1.5, 1),
    },
  };
}

// ── Ollama call (shared IO) ────────────────────────────────────────────────

export function ollamaUrlFromEnv(): string {
  return process.env["OLLAMA_HOST"]
    ? `http://${process.env["OLLAMA_HOST"]}/api/generate`
    : "http://localhost:11434/api/generate";
}

export type LLMResult = {
  raw: string;
  ms: number;
  promptEvalCount: number;    // tokens of prompt actually evaluated (cache misses)
  promptEvalMs: number;
  evalCount: number;          // generated tokens
  evalMs: number;
};

export async function callDirectorLLM(
  prompt: string,
  opts: { url?: string; model?: string; numPredict?: number; seed?: number } = {},
): Promise<LLMResult> {
  const t0 = Date.now();
  const r = await fetch(opts.url ?? ollamaUrlFromEnv(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? DIRECTOR_MODEL,
      prompt, stream: false, think: false, keep_alive: -1,
      options: {
        num_predict: opts.numPredict ?? 200,
        temperature: 0.5,
        stop: ["\n\n"],
        num_ctx: DIRECTOR_NUM_CTX,
        ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      },
    }),
  });
  const j = (await r.json()) as {
    response?: string;
    prompt_eval_count?: number; prompt_eval_duration?: number;
    eval_count?: number; eval_duration?: number;
  };
  return {
    raw: (j.response ?? "").trim(),
    ms: Date.now() - t0,
    promptEvalCount: j.prompt_eval_count ?? 0,
    promptEvalMs: Math.round((j.prompt_eval_duration ?? 0) / 1e6),
    evalCount: j.eval_count ?? 0,
    evalMs: Math.round((j.eval_duration ?? 0) / 1e6),
  };
}

/** Pre-pay the prompt-eval cost of the stable prefix so even the FIRST real
 *  pick of a set hits a warm KV cache. Fire-and-forget at server boot.
 *  Note: Ollama's cache keys on the previous request per slot — any other
 *  model call in between (modgen, bootstrap) evicts it. */
export async function warmDirectorPrompt(dir: string, opts: { model?: string } = {}): Promise<LLMResult> {
  const cat = await getStableCatalogue(dir);
  return callDirectorLLM(buildDirectorPrefix(cat.text), { ...opts, numPredict: 1 });
}
