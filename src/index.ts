import "dotenv/config";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { runPipeline } from "./pipeline.js";
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
        '\nDescribe a visual / music visualisation (or "quit" to exit):\n> '
      );

      const description = input.trim();
      if (description === "") continue;
      if (description === "quit" || description === "exit") break;

      try {
        const result = await runPipeline(description);
        if (result.run.exitCode === 0) {
          console.log(`\n[Done] Sketch ran successfully: ${result.sketch.name}`);
        } else {
          console.error(`\n[Warn] Processing exited with code ${result.run.exitCode}`);
          console.log(`       Sketch saved at: ${result.sketch.file}`);
          console.log("       Open it manually in the Processing IDE to debug.");
        }
      } catch (err) {
        console.error(`[Error] ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
