import Anthropic from "@anthropic-ai/sdk";
import { BaseAgent, createEvent, createEventActions } from "@google/adk";
import type { InvocationContext, Event } from "@google/adk";
import { readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { generateApiFromPath } from "../modules/api-generator.js";
import type { AudioAnalysis } from "../audio/analyzer.js";
import type { ModuleApi } from "../modules/types.js";

const client  = new Anthropic();
const MODEL   = "claude-haiku-4-5-20251001";
const MODULES_DIR = resolve("modules");

export type ModuleConfigs = Record<string, Record<string, number | boolean | string>>;

// ── Helpers ───────────────────────────────────────────────────────────────────

function scanModules(): string[] {
  if (!existsSync(MODULES_DIR)) return [];
  return readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(MODULES_DIR, d.name, "module.json")))
    .map(d => d.name);
}

function buildPrompt(analysis: AudioAnalysis, apis: ModuleApi[]): string {
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

  const moduleSpecs = apis.map(api => {
    const params = api.oscParams.map(p => {
      const rangeStr = p.range ? ` [${p.range[0]}–${p.range[1]}]` : "";
      return `    "${p.address}": ${p.type}${rangeStr}  // ${p.description}`;
    }).join("\n");
    return `Module "${api.id}" (prefix /${api.oscPrefix}/):\n${params}`;
  }).join("\n\n");

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
- Set each parameter to suit the music's mood, energy, and character.
- Physics — springStiffness floor is 0.4 (even for slow/liquid tracks); only go below for ambient/drone.
  damping should be 0.65–0.80 for most music; above 0.85 is reserved for extremely slow or underwater feel.
  Higher BPM → higher springStiffness, lower damping. High harmonic ratio → add fluidDrag for smoothness.
- Colours: derive from key and scale (minor = darker, cooler; major = brighter, warmer).
- fftGain: spectrum is normalised ~0-1; gain of 1.0–2.0 fills bars at moderate listening volume.
  Increase toward 3.0–5.0 if the track is quiet, decrease toward 0.5 if it clips.
- Glow/smoothing: higher for melodic/harmonic content, lower for percussive.
- Stay within each parameter's stated range.

Return ONLY a JSON object. Top-level keys are module IDs. Values are objects mapping OSC addresses to configured values.
Example: { "equalizer": { "/eq/damping": 0.85, "/eq/barColor": "#1a0033" } }`;
}

async function callLlm(prompt: string): Promise<ModuleConfigs> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text ?? "";
  const match = text.match(/\{[\s\S]+\}/);
  if (!match) throw new Error(`No JSON in response:\n${text}`);
  return JSON.parse(match[0]) as ModuleConfigs;
}

// ── Agent ─────────────────────────────────────────────────────────────────────

export class MoodParameterAgent extends BaseAgent {
  constructor() {
    super({
      name: "mood_parameter",
      description:
        "Reads audio analysis from session state and configures active module parameters to match the music mood. Writes moduleConfigs to state.",
    });
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const analysis = ctx.session.state["app:audioAnalysis"] as AudioAnalysis | undefined;

    if (!analysis) {
      yield createEvent({
        author: this.name,
        content: { role: "model", parts: [{ text: "[mood_parameter] No audioAnalysis in state — skipping." }] },
        actions: createEventActions(),
      });
      return;
    }

    // Resolve active modules — from state or scan all available
    const activeIds = (ctx.session.state["activeModules"] as string[] | undefined)
      ?? scanModules();

    if (activeIds.length === 0) {
      yield createEvent({
        author: this.name,
        content: { role: "model", parts: [{ text: "[mood_parameter] No modules found." }] },
        actions: createEventActions(),
      });
      return;
    }

    console.log(`[MoodParameterAgent] Configuring [${activeIds.join(", ")}] for ${analysis.keyLabel} @ ${analysis.bpm} BPM`);

    // Load module APIs
    const apis: ModuleApi[] = [];
    for (const id of activeIds) {
      try {
        apis.push(generateApiFromPath(join(MODULES_DIR, id)));
      } catch (e) {
        console.warn(`[MoodParameterAgent] Could not load module "${id}": ${e}`);
      }
    }

    if (apis.length === 0) {
      yield createEvent({
        author: this.name,
        content: { role: "model", parts: [{ text: "[mood_parameter] No valid modules loaded." }] },
        actions: createEventActions(),
      });
      return;
    }

    try {
      const prompt  = buildPrompt(analysis, apis);
      const configs = await callLlm(prompt);

      // Log what was configured
      for (const [moduleId, params] of Object.entries(configs)) {
        console.log(`[MoodParameterAgent] ${moduleId}:`);
        for (const [address, value] of Object.entries(params)) {
          console.log(`  ${address.padEnd(30)} ${value}`);
        }
      }

      yield createEvent({
        author: this.name,
        actions: createEventActions({ stateDelta: { "app:moduleConfigs": configs } }),
        content: {
          role: "model",
          parts: [{
            text: `Configured ${apis.map(a => a.name).join(", ")} for ${analysis.keyLabel} @ ${analysis.bpm} BPM`,
          }],
        },
      });
    } catch (err) {
      yield createEvent({
        author: this.name,
        content: { role: "model", parts: [{ text: `[mood_parameter] Failed: ${err}` }] },
        actions: createEventActions(),
      });
    }
  }

  protected async *runLiveImpl(_ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    throw new Error("MoodParameterAgent does not support live mode");
  }
}
