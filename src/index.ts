import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { startSession, refineSession, type Session } from "./pipeline.js";
import { checkApiKey, CODE_MODEL } from "./llm/anthropic-client.js";

async function main(): Promise<void> {
  console.log("=== Processing LLM Visualiser ===\n");

  try {
    checkApiKey();
    console.log(`[API] Anthropic SDK ready — model: ${CODE_MODEL}`);
  } catch (err) {
    console.error(`[Error] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  try {
    while (true) {
      const input = await rl.question(
        '\nDescribe a visualisation (or "quit" to exit):\n> '
      );

      const description = input.trim();
      if (description === "") continue;
      if (description === "quit" || description === "exit") break;

      let session: Session | null = null;

      try {
        const result = await startSession(description);
        session = result.session;
        printRunResult(result.run.exitCode, result.sketch.file);
      } catch (err) {
        console.error(`[Error] ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      // Refinement loop — stays on the same sketch until user starts fresh
      while (session !== null) {
        const mod = await rl.question(
          '\nModify it (or "new" for a new sketch, "quit" to exit):\n> '
        );

        const trimmed = mod.trim();
        if (trimmed === "") continue;
        if (trimmed === "quit" || trimmed === "exit") { rl.close(); process.exit(0); }
        if (trimmed === "new") break;

        try {
          const result = await refineSession(session, trimmed);
          session = result.session;
          printRunResult(result.run.exitCode, result.sketch.file);
        } catch (err) {
          console.error(`[Error] ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  } finally {
    rl.close();
  }
}

function printRunResult(exitCode: number, file: string): void {
  if (exitCode === 0) {
    console.log(`\n[Done] Sketch launched successfully`);
  } else {
    console.error(`\n[Warn] Processing exited with code ${exitCode}`);
    console.log(`       Sketch saved at: ${file}`);
    console.log("       Open it manually in the Processing IDE to debug.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
