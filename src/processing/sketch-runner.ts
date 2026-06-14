import { spawn, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { WrittenSketch } from "./sketch-writer.js";

// Processing 4 ships a built-in CLI — no separate install required
const PROCESSING_BIN = "/Applications/Processing.app/Contents/MacOS/Processing";

export type RunResult = {
  exitCode: number;
  stderr: string;
};

let activeProc: ReturnType<typeof spawn> | null = null;

export function killActiveSketch(): void {
  if (activeProc) {
    if (activeProc.pid) {
      try {
        process.kill(-activeProc.pid, "SIGKILL"); // kill entire process group (CLI + Java sketch child)
      } catch {}
    }
    activeProc = null;
  }
  // Fallback: kill any orphaned Processing processes from a previous server run
  spawnSync("pkill", ["-9", "-f", "Processing.app/Contents/MacOS/Processing"], { stdio: "ignore" });
}

export function launchSketch(sketch: WrittenSketch): void {
  killActiveSketch();
  const sketchPath = resolve(sketch.dir);
  const proc = spawn(PROCESSING_BIN, ["cli", `--sketch=${sketchPath}`, "--run"], {
    detached: true, // make CLI a process group leader so we can kill it + its Java child together
  });
  activeProc = proc;
  proc.stdout.on("data", (chunk: Buffer) => process.stdout.write(chunk));
  proc.stderr.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  proc.on("close", (code) => {
    if (activeProc === proc) activeProc = null;
    if (code !== 0 && code !== null) console.error(`[Processing] exited with code ${code}`);
  });
  proc.on("error", (err) => console.error(`[Processing] failed to start: ${err.message}`));
  proc.unref();
}

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
