import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { spawnSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeAudio, type AudioAnalysis } from "../audio/analyzer.js";
import { generateApiFromPath } from "../modules/api-generator.js";
import { assembleSketch } from "../modules/assembler.js";
import { writeSketch } from "../processing/sketch-writer.js";
import { launchSketch } from "../processing/sketch-runner.js";
import type { ModuleApi } from "../modules/types.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AudioInputMode =
  | { type: "file"; mp3Path: string }
  | { type: "blackhole"; durationSeconds?: number; deviceName?: string };

export type ModuleConfigs = Record<string, Record<string, number | boolean | string>>;

export type PipelineState = {
  audioFilePath:  string;
  audioInputMode: "file" | "blackhole";
  audioAnalysis:  AudioAnalysis;
  moduleConfigs:  ModuleConfigs;
  activeModules:  string[];
  sketchPath?:    string;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const MODULES_DIR    = resolve("modules");
const CAPTURE_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../audio/capture.py");
const client         = new Anthropic();
const MOOD_MODEL     = "claude-haiku-4-5-20251001";

// ── Step 1: Resolve audio input ───────────────────────────────────────────────

export async function resolveAudioInput(
  input: AudioInputMode,
): Promise<{ filePath: string; mode: "file" | "blackhole" }> {
  if (input.type === "file") {
    const filePath = resolve(input.mp3Path);
    console.log(`[Input] File: ${filePath}`);
    return { filePath, mode: "file" };
  }

  const duration = input.durationSeconds ?? 30;
  const device   = input.deviceName ?? "blackhole";
  console.log(`[Input] Capturing ${duration}s from '${device}'...`);

  const result = spawnSync(
    "python3",
    [CAPTURE_SCRIPT, "--device", device, "--duration", String(duration)],
    { encoding: "utf8" },
  );
  if (result.error)   throw new Error(`Capture launch failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Capture failed: ${result.stderr}`);

  const filePath = result.stdout.trim();
  console.log(`[Input] Captured → ${filePath}`);
  return { filePath, mode: "blackhole" };
}

// ── Step 2: Analyse audio ─────────────────────────────────────────────────────

export function analyse(filePath: string): AudioAnalysis {
  console.log(`[Analysis] Analysing ${filePath}...`);
  const result = analyzeAudio(filePath, 90);
  console.log(`[Analysis] ${result.bpm} BPM · ${result.keyLabel} · ${result.dominantBand} dominant`);
  return result;
}

// ── Step 3: Configure module parameters via LLM ───────────────────────────────

function scanModules(): string[] {
  if (!existsSync(MODULES_DIR)) return [];
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(MODULES_DIR, d.name, "module.json")))
    .map(d => d.name);
}

function buildMoodPrompt(analysis: AudioAnalysis, apis: ModuleApi[]): string {
  const brightness =
    analysis.spectralCentroid < 800  ? "very dark/warm"
  : analysis.spectralCentroid < 1800 ? "warm/mid"
  : analysis.spectralCentroid < 3500 ? "neutral/mid-bright"
  : analysis.spectralCentroid < 6000 ? "bright"
  :                                     "very bright/harsh";

  const character =
    analysis.harmonicRatio > 0.7 ? "mostly melodic/harmonic — smooth, flowing motion"
  : analysis.harmonicRatio < 0.3 ? "mostly percussive — sharp impacts, snappy response"
  :                                 "balanced — mix of fluid motion and sharp beats";

  const topBands = (Object.entries(analysis.bandEnergies) as [string, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
    .join(", ");

  const moduleSpecs = apis.map(api =>
    `Module "${api.id}" (prefix /${api.oscPrefix}/):\n` +
    api.oscParams.map(p => {
      const r = p.range ? ` [${p.range[0]}–${p.range[1]}]` : "";
      return `    "${p.address}": ${p.type}${r}  // ${p.description}`;
    }).join("\n")
  ).join("\n\n");

  return `You are configuring Processing visualiser modules to match the current music's mood.

AUDIO ANALYSIS:
  BPM:               ${analysis.bpm}
  Key:               ${analysis.keyLabel} (${Math.round(analysis.keyConfidence * 100)}% confidence)
  Scale:             ${analysis.scale}
  Spectral centroid: ${analysis.spectralCentroid} Hz → ${brightness}
  Harmonic ratio:    ${Math.round(analysis.harmonicRatio * 100)}% → ${character}
  Dominant band:     ${analysis.dominantBand}
  Top bands:         ${topBands}
  Beat interval:     ${(60 / analysis.bpm).toFixed(3)}s

MODULES TO CONFIGURE:
${moduleSpecs}

INSTRUCTIONS:
- Physics — springStiffness floor is 0.4; damping 0.65–0.80 for most music.
  Higher BPM → higher springStiffness, lower damping. High harmonic ratio → add fluidDrag.
- Colours: minor = darker/cooler; major = brighter/warmer.
- fftGain: spectrum is normalised ~0-1; 1.0–2.0 fills bars at moderate volume.
- Glow/smoothing: higher for melodic content, lower for percussive.
- Stay within each parameter's stated range.

Return ONLY a JSON object mapping module IDs to OSC address→value objects.
Example: { "equalizer": { "/eq/damping": 0.75, "/eq/barColor": "#1a0033" } }`;
}

export async function configureMood(
  analysis: AudioAnalysis,
  moduleIds?: string[],
): Promise<ModuleConfigs> {
  const ids  = moduleIds ?? scanModules();
  const apis = ids.flatMap(id => {
    try { return [generateApiFromPath(join(MODULES_DIR, id))]; }
    catch { console.warn(`[Mood] Could not load module "${id}"`); return []; }
  });

  if (apis.length === 0) throw new Error("No modules found");

  console.log(`[Mood] Configuring [${ids.join(", ")}] for ${analysis.keyLabel} @ ${analysis.bpm} BPM`);

  const response = await client.messages.create({
    model: MOOD_MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: buildMoodPrompt(analysis, apis) }],
  });

  const text  = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  const match = text.match(/\{[\s\S]+\}/);
  if (!match) throw new Error(`No JSON in mood response:\n${text}`);

  const configs = JSON.parse(match[0]) as ModuleConfigs;

  for (const [id, params] of Object.entries(configs)) {
    console.log(`[Mood] ${id}:`);
    for (const [addr, val] of Object.entries(params))
      console.log(`  ${addr.padEnd(30)} ${val}`);
  }

  return configs;
}

// ── Step 4: Assemble + launch ─────────────────────────────────────────────────

export async function assembleAndLaunch(state: PipelineState): Promise<string> {
  console.log(`[Assemble] Building [${state.activeModules.join(", ")}]...`);

  const { code } = assembleSketch({
    moduleIds:  state.activeModules,
    configs:    state.moduleConfigs,
    modulesDir: MODULES_DIR,
    liveInput:  state.audioInputMode === "blackhole",
    ...(state.audioInputMode === "file" ? { mp3Path: state.audioFilePath } : {}),
  });

  const sketch = await writeSketch(code);
  launchSketch(sketch);
  console.log(`[Assemble] Launched → ${sketch.file}`);
  return sketch.file;
}

// ── Full pipeline ─────────────────────────────────────────────────────────────

export async function runPipeline(
  input: AudioInputMode,
  moduleIds?: string[],
): Promise<PipelineState> {
  const { filePath, mode } = await resolveAudioInput(input);
  const audioAnalysis      = analyse(filePath);
  const activeModules      = moduleIds ?? scanModules();
  const moduleConfigs      = await configureMood(audioAnalysis, activeModules);

  return {
    audioFilePath:  filePath,
    audioInputMode: mode,
    audioAnalysis,
    moduleConfigs,
    activeModules,
  };
}
