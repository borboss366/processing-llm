import "dotenv/config";
import { InMemoryRunner } from "@google/adk";
import { audioPipeline } from "./index.js";
import type { AudioInputMode } from "./audio-input-agent.js";
import type { AudioAnalysis } from "../audio/analyzer.js";

const mp3Arg = process.argv[2];

const audioInput: AudioInputMode = mp3Arg
  ? { type: "file", mp3Path: mp3Arg }
  : { type: "blackhole", durationSeconds: 30 };

if (audioInput.type === "blackhole") {
  console.log("No file provided — capturing 30s from BlackHole...");
} else {
  console.log(`Analysing: ${audioInput.mp3Path}`);
}

const runner = new InMemoryRunner({ agent: audioPipeline, appName: "demo-audio" });
const session = await runner.sessionService.createSession({
  appName: "demo-audio",
  userId: "u1",
  state: { audioInput },
});

for await (const event of runner.runAsync({
  userId: "u1",
  sessionId: session.id,
  newMessage: { role: "user", parts: [{ text: "analyse" }] },
})) {
  const e = event as any;
  const analysis: AudioAnalysis | undefined = e.actions?.stateDelta?.audioAnalysis;
  if (analysis) {
    console.log("\n─────────────────────────────");
    console.log(`  BPM      : ${analysis.bpm}`);
    console.log(`  Key      : ${analysis.keyLabel}`);
    console.log(`  Mode     : ${analysis.scale}`);
    console.log(`  Confidence: ${Math.round(analysis.keyConfidence * 100)}%`);
    console.log(`  Duration : ${analysis.durationSeconds}s`);
    console.log("─────────────────────────────\n");
  }
}
