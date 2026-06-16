import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  runPipeline, resolveAudioInput, analyse, configureMood, assembleAndLaunch,
  type AudioInputMode, type PipelineState,
} from "../pipeline/audio.js";

// ── State ─────────────────────────────────────────────────────────────────────

let currentInput: AudioInputMode = process.argv[2]
  ? { type: "file", mp3Path: process.argv[2] }
  : { type: "blackhole", durationSeconds: 30 };

let state: PipelineState | undefined;

// ── Display ───────────────────────────────────────────────────────────────────

function printAnalysis(s: PipelineState) {
  const a = s.audioAnalysis;
  const topBands = (Object.entries(a.bandEnergies) as [string, number][])
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
    .join("  ");

  console.log("\n─────────────────────────────────────────");
  console.log(`  BPM              : ${a.bpm}`);
  console.log(`  Key              : ${a.keyLabel} (${Math.round(a.keyConfidence * 100)}%)`);
  console.log(`  Duration         : ${a.durationSeconds}s`);
  console.log(`  Spectral centroid: ${a.spectralCentroid} Hz`);
  console.log(`  Harmonic ratio   : ${Math.round(a.harmonicRatio * 100)}% harmonic`);
  console.log(`  Dominant band    : ${a.dominantBand}`);
  console.log(`  Top bands        : ${topBands}`);
  console.log("─────────────────────────────────────────");
}

function printConfigs(s: PipelineState) {
  console.log("\n── Module configs ────────────────────────");
  for (const [id, params] of Object.entries(s.moduleConfigs)) {
    console.log(`  [${id}]`);
    for (const [addr, val] of Object.entries(params))
      console.log(`    ${addr.padEnd(30)} ${val}`);
  }
  console.log("──────────────────────────────────────────\n");
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdAll() {
  state = await runPipeline(currentInput);
  printAnalysis(state);
  printConfigs(state);
}

async function cmdInput() {
  const { filePath, mode } = await resolveAudioInput(currentInput);
  if (state) { state.audioFilePath = filePath; state.audioInputMode = mode; }
  else state = { audioFilePath: filePath, audioInputMode: mode, audioAnalysis: undefined as any, moduleConfigs: {}, activeModules: [] };
  console.log(`  Audio ready: ${filePath} (${mode})`);
}

async function cmdAnalysis() {
  if (!state?.audioFilePath) { console.log("  Run input first (i)"); return; }
  state.audioAnalysis = analyse(state.audioFilePath);
  printAnalysis(state);
}

async function cmdMood() {
  if (!state?.audioAnalysis) { console.log("  Run analysis first (a)"); return; }
  state.moduleConfigs = await configureMood(state.audioAnalysis, state.activeModules);
  printConfigs(state);
}

async function cmdAssemble() {
  if (!state?.moduleConfigs || Object.keys(state.moduleConfigs).length === 0) {
    console.log("  Run mood config first (m)"); return;
  }
  state.sketchPath = await assembleAndLaunch(state);
}

async function cmdSwitchFile(path: string) {
  currentInput = { type: "file", mp3Path: path };
  state = await runPipeline(currentInput, state?.activeModules);
  printAnalysis(state);
  printConfigs(state);
}

async function cmdSwitchBlackHole(secs: number) {
  currentInput = { type: "blackhole", durationSeconds: secs };
  state = await runPipeline(currentInput, state?.activeModules);
  printAnalysis(state);
  printConfigs(state);
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log("\nCommands:");
console.log("  [Enter]       run full pipeline");
console.log("  i             re-run input only");
console.log("  a             re-run analysis only");
console.log("  m             re-run mood config only");
console.log("  s             assemble + launch sketch");
console.log("  f <path>      switch to a file");
console.log("  b [seconds]   switch to BlackHole capture");
console.log("  q             quit\n");

console.log("Running initial pipeline...");
state = await runPipeline(currentInput);
printAnalysis(state);
printConfigs(state);

const rl = readline.createInterface({ input: stdin, output: stdout });

while (true) {
  const line = (await rl.question("> ")).trim();

  if (line === "q" || line === "quit") break;
  else if (line === "")          await cmdAll();
  else if (line === "i")         await cmdInput();
  else if (line === "a")         await cmdAnalysis();
  else if (line === "m")         await cmdMood();
  else if (line === "s")         await cmdAssemble();
  else if (line.startsWith("f ")) await cmdSwitchFile(line.slice(2).trim());
  else if (line.startsWith("b")) {
    const secs = parseInt(line.split(" ")[1] ?? "30");
    await cmdSwitchBlackHole(isNaN(secs) ? 30 : secs);
  }
  else console.log("  Unknown command.");
}

rl.close();
