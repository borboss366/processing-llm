import { BaseAgent, createEvent, createEventActions } from "@google/adk";
import type { InvocationContext, Event } from "@google/adk";
import { analyzeAudio } from "../audio/analyzer.js";

/**
 * Deterministic agent — no LLM.
 * Reads `audioFilePath` from session state, runs librosa BPM + key analysis,
 * writes `audioAnalysis` to state for the next agent in the chain.
 */
export class AudioAnalysisAgent extends BaseAgent {
  constructor() {
    super({
      name: "audio_analysis",
      description: "Determines BPM and musical key (major/minor) from an audio file using librosa.",
    });
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const filePath = ctx.session.state["app:audioFilePath"] as string | undefined;

    if (!filePath) {
      yield createEvent({
        author: this.name,
        content: { role: "model", parts: [{ text: "[audio_analysis] No audioFilePath in state — skipping." }] },
        actions: createEventActions(),
      });
      return;
    }

    console.log(`[AudioAnalysisAgent] Analysing: ${filePath}`);

    try {
      const analysis = analyzeAudio(filePath, 90);
      console.log(`[AudioAnalysisAgent] ${analysis.bpm} BPM · ${analysis.keyLabel} (${Math.round(analysis.keyConfidence * 100)}%)`);

      yield createEvent({
        author: this.name,
        actions: createEventActions({ stateDelta: { "app:audioAnalysis": analysis } }),
        content: {
          role: "model",
          parts: [{ text: `${analysis.bpm} BPM · ${analysis.keyLabel} · ${analysis.durationSeconds}s` }],
        },
      });
    } catch (err) {
      yield createEvent({
        author: this.name,
        content: { role: "model", parts: [{ text: `[audio_analysis] Failed: ${err}` }] },
        actions: createEventActions(),
      });
    }
  }

  protected async *runLiveImpl(_ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    throw new Error("AudioAnalysisAgent does not support live mode");
  }
}
