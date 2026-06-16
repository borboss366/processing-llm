import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import {
  Runner,
  InMemorySessionService,
  InMemoryArtifactService,
  InMemoryMemoryService,
  createEvent,
  createEventActions,
} from "@google/adk";
import { AudioInputAgent } from "./audio-input-agent.js";
import { AudioAnalysisAgent } from "./audio-analysis-agent.js";
import type { AudioInputMode } from "./audio-input-agent.js";
import type { AudioAnalysis } from "../audio/analyzer.js";

// ── Shared session state ──────────────────────────────────────────────────────
const APP = "demo-audio";
const USER = "u1";

const sessionService = new InMemorySessionService();
const artifactService = new InMemoryArtifactService();
const memoryService = new InMemoryMemoryService();

function makeRunner(agent: AudioInputAgent | AudioAnalysisAgent) {
  return new Runner({ appName: APP, agent, sessionService, artifactService, memoryService });
}

// Each agent has its own runner but they share the same sessionService
const inputRunner   = makeRunner(new AudioInputAgent());
const analysisRunner = makeRunner(new AudioAnalysisAgent());

const session = await sessionService.createSession({ appName: APP, userId: USER });

// ── Helpers ───────────────────────────────────────────────────────────────────
async function runAgent(runner: Runner): Promise<void> {
  for await (const event of runner.runAsync({
    userId: USER,
    sessionId: session.id,
    newMessage: { role: "user", parts: [{ text: "go" }] },
  })) {
    const e = event as any;
    const analysis: AudioAnalysis | undefined = e.actions?.stateDelta?.audioAnalysis;
    if (analysis) printAnalysis(analysis);
    if (e.content?.parts?.[0]?.text &&
        !e.content.parts[0].text.startsWith("[audio_")) {
      console.log(`  ${e.content.parts[0].text}`);
    }
  }
}

function printAnalysis(a: AudioAnalysis) {
  const topBands = (Object.entries(a.bandEnergies) as [string, number][])
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
    .join("  ");

  console.log("\n─────────────────────────────────────────");
  console.log(`  BPM              : ${a.bpm}`);
  console.log(`  Key              : ${a.keyLabel} (${Math.round(a.keyConfidence * 100)}% confidence)`);
  console.log(`  Duration         : ${a.durationSeconds}s`);
  console.log(`  Spectral centroid: ${a.spectralCentroid} Hz`);
  console.log(`  Harmonic ratio   : ${Math.round(a.harmonicRatio * 100)}% harmonic`);
  console.log(`  Dominant band    : ${a.dominantBand}`);
  console.log(`  Top bands        : ${topBands}`);
  console.log("─────────────────────────────────────────\n");
}

async function setInput(mode: AudioInputMode) {
  const current = await sessionService.getSession({ appName: APP, userId: USER, sessionId: session.id });
  if (!current) return;
  await sessionService.appendEvent({
    session: current,
    event: createEvent({ author: "system", actions: createEventActions({ stateDelta: { audioInput: mode } }) }),
  });
}

// ── CLI loop ──────────────────────────────────────────────────────────────────
const mp3Arg = process.argv[2];
const initialMode: AudioInputMode = mp3Arg
  ? { type: "file", mp3Path: mp3Arg }
  : { type: "blackhole", durationSeconds: 30 };

await setInput(initialMode);

console.log("\nCommands:");
console.log("  [Enter]       re-run both agents");
console.log("  i             re-run input only  (new capture / reload file)");
console.log("  a             re-run analysis only");
console.log("  f <path>      switch to a file");
console.log("  b [seconds]   switch to BlackHole capture");
console.log("  q             quit\n");

// Run both once at startup
console.log("Running initial analysis...");
await runAgent(inputRunner);
await runAgent(analysisRunner);

const rl = readline.createInterface({ input: stdin, output: stdout });

while (true) {
  const line = (await rl.question("> ")).trim();

  if (line === "q" || line === "quit") break;

  if (line === "" ) {
    await runAgent(inputRunner);
    await runAgent(analysisRunner);
  } else if (line === "i") {
    await runAgent(inputRunner);
  } else if (line === "a") {
    await runAgent(analysisRunner);
  } else if (line.startsWith("f ")) {
    const path = line.slice(2).trim();
    await setInput({ type: "file", mp3Path: path });
    await runAgent(inputRunner);
    await runAgent(analysisRunner);
  } else if (line.startsWith("b")) {
    const secs = parseInt(line.split(" ")[1] ?? "30");
    await setInput({ type: "blackhole", durationSeconds: isNaN(secs) ? 30 : secs });
    await runAgent(inputRunner);
    await runAgent(analysisRunner);
  } else {
    console.log("Unknown command.");
  }
}

rl.close();
