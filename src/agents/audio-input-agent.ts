import { BaseAgent, createEvent, createEventActions } from "@google/adk";
import type { InvocationContext, Event } from "@google/adk";
import { spawnSync } from "node:child_process";
import { resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const CAPTURE_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "../audio/capture.py");

export type AudioInputMode =
  | { type: "file"; mp3Path: string }
  | { type: "blackhole"; durationSeconds?: number; deviceName?: string };

/**
 * Deterministic agent — no LLM.
 * Reads `audioInput` from session state, resolves an audio file path,
 * and writes `audioFilePath` to state for AudioAnalysisAgent.
 *
 * Session state input:
 *   audioInput: AudioInputMode
 *
 * Session state output:
 *   audioFilePath: string   — absolute path to a WAV or MP3 file
 *   audioInputMode: string  — "file" | "blackhole"
 */
export class AudioInputAgent extends BaseAgent {
  constructor() {
    super({
      name: "audio_input",
      description: "Resolves audio input from a file path or captures live audio from BlackHole.",
    });
  }

  protected async *runAsyncImpl(ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    const input = ctx.session.state["app:audioInput"] as AudioInputMode | undefined;

    if (!input) {
      yield createEvent({
        author: this.name,
        content: { role: "model", parts: [{ text: "[audio_input] No audioInput in state — skipping." }] },
        actions: createEventActions(),
      });
      return;
    }

    try {
      let filePath: string;

      if (input.type === "file") {
        filePath = isAbsolute(input.mp3Path) ? input.mp3Path : resolve(input.mp3Path);
        console.log(`[AudioInputAgent] Using file: ${filePath}`);
      } else {
        // Capture from BlackHole
        const duration = input.durationSeconds ?? 30;
        const device = input.deviceName ?? "blackhole";
        console.log(`[AudioInputAgent] Capturing ${duration}s from '${device}'...`);

        const result = spawnSync("python3", [
          CAPTURE_SCRIPT,
          "--device", device,
          "--duration", String(duration),
        ], { encoding: "utf8" });

        if (result.error) throw new Error(`Capture launch failed: ${result.error.message}`);
        if (result.status !== 0) throw new Error(`Capture failed: ${result.stderr}`);

        filePath = result.stdout.trim();
        console.log(`[AudioInputAgent] Captured → ${filePath}`);
      }

      yield createEvent({
        author: this.name,
        actions: createEventActions({
          stateDelta: {
            "app:audioFilePath": filePath,
            "app:audioInputMode": input.type,
          },
        }),
        content: {
          role: "model",
          parts: [{ text: `Audio ready: ${filePath} (${input.type})` }],
        },
      });
    } catch (err) {
      yield createEvent({
        author: this.name,
        content: { role: "model", parts: [{ text: `[audio_input] Error: ${err}` }] },
        actions: createEventActions(),
      });
    }
  }

  protected async *runLiveImpl(_ctx: InvocationContext): AsyncGenerator<Event, void, void> {
    throw new Error("AudioInputAgent does not support live mode");
  }
}
