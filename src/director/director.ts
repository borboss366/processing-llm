/**
 * Director core — everything the LLM-director pipeline shares between the
 * live route (src/controller/server.ts) and offline replay (tools/replay.mjs).
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
export const DEFAULT_CATALOGUE_WINDOW = 60; // presets shown per prompt
export const DIRECTOR_MODEL = "qwen3:8b";

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

/** Recency blocklist + complexity ceiling, then shuffle and cap the window.
 *  Shuffling matters: without it, alphabetical order meant the prompt only
 *  ever contained the first N presets. */
export function prefilterCandidates(
  list: PresetDesc[],
  opts: { recentSlugs?: string[]; maxComplexity?: number; windowSize?: number } = {},
): PresetDesc[] {
  const { recentSlugs = [], maxComplexity, windowSize = DEFAULT_CATALOGUE_WINDOW } = opts;
  const recentSet = new Set(recentSlugs);
  let candidates = list.filter((p) => {
    if (recentSet.has(p.slug)) return false;
    if (typeof maxComplexity === "number" && typeof p.tags.complexity === "number") {
      if (p.tags.complexity > maxComplexity) return false;
    }
    return true;
  });
  // Always keep ≥1 candidate — if recency/complexity excluded everything,
  // fall back to the full list so the director still picks something.
  if (!candidates.length) candidates = [...list];
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  return candidates.slice(0, windowSize);
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

function formatCatalogue(items: PresetDesc[]): string {
  return items
    .map((p, i) => {
      const t = p.tags;
      const tagStr = [
        t.complexity != null ? `c${t.complexity}` : null,
        t.energy, t.density, t.brightness, t.motion,
      ].filter(Boolean).join(" ");
      return `${i + 1}. [${tagStr}] ${p.name} — ${p.description}`;
    })
    .join("\n");
}

const FILTER_SPEC =
  `Filter parameters:\n` +
  `  hue    : -180..180 degrees (hue rotation; 0 = no shift)\n` +
  `  sat    : 0..2     (saturation multiplier; 1 = unchanged)\n` +
  `  bright : 0.5..1.5 (brightness multiplier; 1 = unchanged)\n\n` +
  `Output one-line JSON only:\n` +
  `{"description":"<one sentence, ≤15 words, on what the new section sounds like>",` +
  `"preset":<number>,` +
  `"filter":{"hue":<deg>,"sat":<num>,"bright":<num>}}`;

/**
 * Build the director prompt. Pure — same inputs, same string.
 *
 *  - variant 'memory' (live default): the model sees the last N decisions
 *    (profile + preset + filter) and is asked what should FOLLOW.
 *  - variant 'no-memory': the pre-memory prompt (prev + current profile only),
 *    kept for replay A/B comparison.
 */
export function buildDirectorPrompt(opts: {
  current: Record<string, number>;
  prev?: Record<string, number> | null;
  catalogue: PresetDesc[];
  history?: DirectorMemory[];
  variant?: PromptVariant;
}): string {
  const { current, prev, catalogue, history = [], variant = "memory" } = opts;
  const head =
    `You are a VJ director for a live music set. The audio character just changed.\n\n` +
    `Available butterchurn presets (numbered):\n${formatCatalogue(catalogue)}\n\n`;

  if (variant === "no-memory" || (variant === "memory" && history.length === 0)) {
    return (
      head +
      (prev
        ? `Previous section: ${profileLine(prev)}\n`
        : `(No previous section — this is the start of the set.)\n`) +
      `Current section:  ${profileLine(current)}\n\n` +
      `Pick a visualisation that fits the CURRENT section, and a colour filter for it.\n` +
      FILTER_SPEC
    );
  }

  const historyLines = history
    .map((h, i) =>
      `  ${i + 1}. ${profileLine(h.profile)}\n` +
      `     → "${h.preset}" (hue ${Math.round(h.filter.hue)}° sat ${h.filter.sat.toFixed(2)} bright ${h.filter.bright.toFixed(2)})`)
    .join("\n");

  return (
    head +
    `Recent picks, oldest first — what the audience has just seen and what it sounded like:\n` +
    `${historyLines}\n\n` +
    `Current section:  ${profileLine(current)}\n\n` +
    `Given the last picks and their sound profiles, pick what should FOLLOW: a visualisation\n` +
    `that fits the CURRENT section and reads as a progression from the recent picks, not a\n` +
    `repeat of them. Also pick a colour filter for it.\n` +
    FILTER_SPEC
  );
}

// ── Response parsing (shared clamping) ─────────────────────────────────────

export type DirectorPick = {
  description: string;
  pick: PresetDesc;
  filter: DirectorFilter;
};

export function parseDirectorResponse(raw: string, items: PresetDesc[]): DirectorPick {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("no JSON found in response");
  const parsed = JSON.parse(jsonMatch[0]);

  const idx = Math.max(1, Math.min(items.length, parseInt(String(parsed.preset), 10) || 1)) - 1;
  const pick = items[idx];
  if (!pick) throw new Error("empty candidate list");
  const filter = parsed.filter ?? {};
  const safe = (n: unknown, lo: number, hi: number, fallback: number) => {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(lo, Math.min(hi, v));
  };
  return {
    description: String(parsed.description ?? "").slice(0, 200),
    pick,
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

export async function callDirectorLLM(
  prompt: string,
  opts: { url?: string; model?: string } = {},
): Promise<{ raw: string; ms: number }> {
  const t0 = Date.now();
  const r = await fetch(opts.url ?? ollamaUrlFromEnv(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? DIRECTOR_MODEL,
      prompt, stream: false, think: false, keep_alive: -1,
      options: { num_predict: 200, temperature: 0.5, stop: ["\n\n"] },
    }),
  });
  const j = (await r.json()) as { response?: string };
  return { raw: (j.response ?? "").trim(), ms: Date.now() - t0 };
}
