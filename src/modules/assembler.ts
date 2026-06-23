import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateApiFromPath } from "./api-generator.js";
import type { ModuleApi, ParamType, Renderer } from "./types.js";
import type { ModuleConfigs } from "../agents/mood-parameter-agent.js";

// ── Value formatting ──────────────────────────────────────────────────────────

function formatValue(value: unknown, type: ParamType): string {
  switch (type) {
    case "boolean": return value ? "true" : "false";
    case "int":     return String(Math.round(Number(value)));
    case "color":   return String(value);   // "#rrggbb" — valid Processing hex literal
    case "float":   return String(value);
    case "string":  return typeof value === "string" ? value : String(value);   // template wraps with quotes
    default:        return typeof value === "string" ? value : String(value);
  }
}

// Renderer strictness — assembler picks the strictest demand across modules
const RENDERER_RANK: Record<Renderer, number> = { JAVA2D: 0, P2D: 1, P3D: 2 };

function pickRenderer(apis: ModuleApi[]): Renderer {
  let best: Renderer = "JAVA2D";
  for (const api of apis) {
    if (api.renderer && RENDERER_RANK[api.renderer] > RENDERER_RANK[best]) best = api.renderer;
  }
  return best;
}

// ── Template substitution ─────────────────────────────────────────────────────

function substituteTemplate(
  template: string,
  api: ModuleApi,
  configs: ModuleConfigs,
): string {
  const subs: Record<string, string> = {};

  // Baked params (layout + osc:false) — defaults only
  for (const b of api.baked) {
    subs[b.name] = formatValue(b.value, b.type);
  }

  // OSC params — use configured value if present, else default
  const moduleConfig = configs[api.id] ?? {};
  for (const p of api.oscParams) {
    const value = moduleConfig[p.address] ?? p.default;
    subs[p.name] = formatValue(value, p.type);
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (key in subs) return subs[key]!;
    console.warn(`[assembler] Unresolved placeholder: {{${key}}} in module ${api.id}`);
    return `{{${key}}}`;
  });
}

// ── Scaffold sections ─────────────────────────────────────────────────────────

function effectsComment(apis: ModuleApi[]): string {
  const names = apis.flatMap(api =>
    api.oscParams.filter(p => p.type === "boolean").map(p => `${api.oscPrefix}_${p.name}`)
  );
  return `// EFFECTS: ${names.join(", ")}`;
}

function paramsComment(apis: ModuleApi[], configs: ModuleConfigs): string {
  const entries = apis.flatMap(api => {
    const cfg = configs[api.id] ?? {};
    return api.oscParams
      .filter(p => p.type !== "boolean")
      .map(p => `${api.oscPrefix}_${p.name}=${cfg[p.address] ?? p.default}`);
  });
  return `// PARAMS: ${entries.join(", ")}`;
}

function audioGlobals(liveInput: boolean): string {
  if (liveInput) return `
import ddf.minim.*;
import ddf.minim.analysis.*;
Minim minim;
AudioInput input;
FFT fft;
BeatDetect beat;
float   smoothedLevel = 0;
float   bassEnergy    = 0;
boolean onBeat        = false;
float[] spectrum;`;

  return `
import processing.sound.*;
SoundFile song;
Amplitude amp;
FFT       fft;
final int FFT_SIZE = 512;
float[]   spectrum = new float[FFT_SIZE];
float     smoothedAmp  = 0;
float     bassEnergy   = 0;
float     prevBassEnergy = 0;
boolean   onBeat       = false;`;
}

function audioSetup(liveInput: boolean, mp3Path?: string): string {
  if (liveInput) return `
  minim = new Minim(this);
  input = minim.getLineIn(Minim.STEREO, 1024);
  fft   = new FFT(input.bufferSize(), input.sampleRate());
  fft.logAverages(22, 3);
  beat  = new BeatDetect(input.bufferSize(), input.sampleRate());
  beat.setSensitivity(150);
  spectrum = new float[fft.avgSize()];`;

  return `
  song = new SoundFile(this, "${mp3Path ?? ""}");
  song.play();
  amp  = new Amplitude(this);
  amp.input(song);
  fft  = new FFT(this, FFT_SIZE);
  fft.input(song);`;
}

function audioUpdate(liveInput: boolean): string {
  if (liveInput) return `
  fft.forward(input.mix);
  beat.detect(input.mix);
  smoothedLevel = lerp(smoothedLevel, input.mix.level(), 0.25);
  bassEnergy = 0;
  for (int i = 0; i < 4; i++) bassEnergy += fft.getBand(i);
  bassEnergy /= 4.0;
  onBeat = beat.isOnset();
  // Normalise Minim FFT averages to ~0-1 range for modules
  // logAverages() values are typically 0-10 at listening volume
  for (int i = 0; i < spectrum.length; i++) spectrum[i] = fft.getAvg(i) / 10.0;`;

  return `
  if (song.isPlaying()) {
    fft.analyze(spectrum);
    float rawAmp    = amp.analyze();
    smoothedAmp     = lerp(smoothedAmp, rawAmp, 0.25);
    bassEnergy      = 0;
    for (int i = 0; i < 8; i++) bassEnergy += spectrum[i];
    bassEnergy     /= 8.0;
    onBeat          = (bassEnergy - prevBassEnergy) > 0.02;
    prevBassEnergy  = lerp(prevBassEnergy, bassEnergy, 0.1);
  }`;
}

// ── Full sketch assembly ──────────────────────────────────────────────────────

export type AssemblyOptions = {
  moduleIds: string[];
  configs: ModuleConfigs;
  modulesDir: string;
  liveInput?: boolean;
  mp3Path?: string;
  oscPort?: number;
};

export type ManifestEntry = {
  id: string;
  name: string;
  oscPrefix: string;
  description: string;
};
export type AssembledSketch = {
  code: string;
  manifest: { moduleIds: string[]; modules: ManifestEntry[]; oscPort: number };
};

export function assembleSketch(opts: AssemblyOptions): AssembledSketch {
  const { moduleIds, configs, modulesDir, liveInput = true, mp3Path } = opts;

  // Load and substitute each module
  const modules: Array<{ api: ModuleApi; code: string }> = moduleIds.map(id => {
    const dir      = join(modulesDir, id);
    const api      = generateApiFromPath(dir);
    const template = readFileSync(join(dir, "module.pde"), "utf8");
    return { api, code: substituteTemplate(template, api, configs) };
  });

  const apis = modules.map(m => m.api);

  // Sort by zOrder for draw call ordering
  const drawOrder = [...modules].sort((a, b) => {
    const zA = Number(a.api.baked.find(p => p.name === "zOrder")?.value ?? 0);
    const zB = Number(b.api.baked.find(p => p.name === "zOrder")?.value ?? 0);
    return zA - zB;
  });

  const oscPort = opts.oscPort ?? 12000;

  const lines: string[] = [
    effectsComment(apis),
    paramsComment(apis, configs),
    "",
    "import oscP5.*;",
    "import netP5.*;",
    audioGlobals(liveInput),
    "",
    "OscP5 oscP5;",
    "",
    // Per-module enable flags + lifecycle OSC handler
    "// ── Module enable flags (default ON, toggle via /modules/<id>/enabled 0|1)",
    ...modules.map(m => `boolean ${m.api.oscPrefix}Enabled = true;`),
    "",
    "void moduleEnableOsc(OscMessage msg) {",
    ...modules.map(m =>
      `  if (msg.checkAddrPattern("/modules/${m.api.id}/enabled")) ${m.api.oscPrefix}Enabled = msg.get(0).intValue() == 1;`
    ),
    "}",
    "",
    // Module code blocks
    ...modules.flatMap(m => [
      `// ${"─".repeat(76)}`,
      `// Module: ${m.api.name}`,
      `// ${"─".repeat(76)}`,
      m.code,
      "",
    ]),
    // setup()
    `void setup() {`,
    (() => {
      const r = pickRenderer(apis);
      return r === "JAVA2D" ? `  size(800, 600);` : `  size(800, 600, ${r});`;
    })(),
    `  colorMode(RGB, 255);`,
    `  oscP5 = new OscP5(this, ${oscPort});`,
    audioSetup(liveInput, mp3Path),
    ...apis.map(api => `  ${api.oscPrefix}_setup();`),
    `}`,
    "",
    // draw()
    `void draw() {`,
    `  background(0);`,
    audioUpdate(liveInput),
    ...drawOrder.map(m => `  if (${m.api.oscPrefix}Enabled) ${m.api.oscPrefix}_draw();`),
    `}`,
    "",
    // oscEvent() — system enable msgs go first, then each module's own handler
    `void oscEvent(OscMessage msg) {`,
    `  moduleEnableOsc(msg);`,
    ...apis.map(api => `  ${api.oscPrefix}_osc(msg);`),
    `}`,
    "",
    // stop() — Minim only
    ...(liveInput ? [
      `void stop() {`,
      `  input.close();`,
      `  minim.stop();`,
      `  super.stop();`,
      `}`,
    ] : []),
  ];

  const manifest = {
    moduleIds: apis.map(a => a.id),
    modules: apis.map(a => ({
      id:          a.id,
      name:        a.name,
      oscPrefix:   a.oscPrefix,
      description: a.description,
    })),
    oscPort,
  };

  return { code: lines.join("\n"), manifest };
}
