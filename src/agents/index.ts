import "dotenv/config";
// Register the Anthropic model backend before anything else
import "./anthropic-llm.js";

import { LlmAgent, InMemoryRunner, SequentialAgent } from "@google/adk";
import { AudioInputAgent } from "./audio-input-agent.js";
import { AudioAnalysisAgent } from "./audio-analysis-agent.js";

export const sketchAgent = new LlmAgent({
  name: "sketch_agent",
  model: "claude-sonnet-4-6",
  description: "Generates and refines Processing (Java) sketches driven by image data, audio, and user descriptions.",
  instruction: `You are an expert creative coder specialising in Processing (the Java-based creative coding environment).
When given a task, output ONLY valid Processing source code — no markdown, no explanations, no code fences.
The sketch must include void setup() and void draw() and be self-contained and runnable as-is.`,
});

// Audio pipeline: resolve source → analyse → done
// Results land in session state as `audioFilePath` and `audioAnalysis`
export const audioPipeline = new SequentialAgent({
  name: "audio_pipeline",
  description: "Resolves an audio source (file or BlackHole) then extracts BPM and key.",
  subAgents: [new AudioInputAgent(), new AudioAnalysisAgent()],
});

export const runner = new InMemoryRunner({
  agent: audioPipeline,
  appName: "processing-llm",
});
