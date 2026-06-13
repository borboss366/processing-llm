import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { WrittenSketch } from "./sketch-writer.js";

// Processing 4 ships a built-in CLI — no separate install required
const PROCESSING_BIN = "/Applications/Processing.app/Contents/MacOS/Processing";

export type RunResult = {
  exitCode: number;
  stderr: string;
};

export async function runSketch(sketch: WrittenSketch): Promise<RunResult> {
  const sketchPath = resolve(sketch.dir);

  return new Promise((resolvePromise) => {
    const proc = spawn(PROCESSING_BIN, [
      "cli",
      `--sketch=${sketchPath}`,
      "--run",
    ]);

    const stderrChunks: Buffer[] = [];

    proc.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
      process.stderr.write(chunk);
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
    });

    proc.on("close", (code) => {
      resolvePromise({
        exitCode: code ?? 1,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
      });
    });

    proc.on("error", (err) => {
      resolvePromise({
        exitCode: 1,
        stderr: `Failed to start Processing: ${err.message}`,
      });
    });
  });
}
