import { generateCode, CODE_MODEL } from "./llm/anthropic-client.js";
import { buildCodeGenPrompt, SYSTEM_PROMPT } from "./prompt/builder.js";
import { writeSketch, type WrittenSketch } from "./processing/sketch-writer.js";
import { runSketch, type RunResult } from "./processing/sketch-runner.js";

function extractCode(raw: string): string {
  // Strip markdown code fences if the model wraps its output
  const fenceMatch = raw.match(/```(?:java|processing|pde)?\s*([\s\S]+?)```/);
  if (fenceMatch?.[1] != null) return fenceMatch[1].trim();
  return raw.trim();
}

export type PipelineResult = {
  sketch: WrittenSketch;
  run: RunResult;
};

export async function runPipeline(userDescription: string): Promise<PipelineResult> {
  console.log(`\n[LLM] Generating sketch with ${CODE_MODEL}...`);

  const raw = await generateCode(
    SYSTEM_PROMPT,
    buildCodeGenPrompt({ userDescription })
  );
  const code = extractCode(raw);

  console.log(`[LLM] Generated ${code.split("\n").length} lines of Processing code`);

  const sketch = await writeSketch(code);
  console.log(`[FS]  Wrote sketch → ${sketch.file}`);

  console.log(`[RUN] Launching Processing...`);
  const run = await runSketch(sketch);

  return { sketch, run };
}
