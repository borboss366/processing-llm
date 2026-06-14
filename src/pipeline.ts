import { callLLM, CODE_MODEL, type Turn } from "./llm/anthropic-client.js";
import { buildCodeGenPrompt, buildRefinementPrompt, SYSTEM_PROMPT } from "./prompt/builder.js";
import { writeSketch, type WrittenSketch } from "./processing/sketch-writer.js";
import { runSketch, launchSketch, type RunResult } from "./processing/sketch-runner.js";

function extractCode(raw: string): string {
  const fenceMatch = raw.match(/```(?:java|processing|pde)?\s*([\s\S]+?)```/);
  if (fenceMatch?.[1] != null) return fenceMatch[1].trim();
  return raw.trim();
}

export type Session = {
  description: string;
  mp3Path?: string;
  turns: Turn[];      // full conversation history
  currentCode: string;
};

export type PipelineResult = {
  sketch: WrittenSketch;
  run: RunResult;
  session: Session;
};

export async function startSession(description: string, mp3Path?: string): Promise<PipelineResult> {
  console.log(`\n[LLM] Generating sketch with ${CODE_MODEL}...`);

  const userTurn: Turn = {
    role: "user",
    content: buildCodeGenPrompt({ userDescription: description, mp3Path }),
  };

  const raw = await callLLM(SYSTEM_PROMPT, [userTurn]);
  const code = extractCode(raw);

  console.log(`[LLM] Generated ${code.split("\n").length} lines`);

  const sketch = await writeSketch(code);
  console.log(`[FS]  Wrote sketch → ${sketch.file}`);

  const run = await runSketch(sketch);

  const session: Session = {
    description,
    mp3Path,
    turns: [userTurn, { role: "assistant", content: code }],
    currentCode: code,
  };

  return { sketch, run, session };
}

export type WebGenerateResult = {
  sketch: WrittenSketch;
  session: Session;
};

export async function generateAndLaunch(
  description: string,
  mp3Path?: string
): Promise<WebGenerateResult> {
  console.log(`\n[LLM] Generating sketch with ${CODE_MODEL}...`);

  const userTurn: Turn = {
    role: "user",
    content: buildCodeGenPrompt({ userDescription: description, mp3Path }),
  };

  const raw = await callLLM(SYSTEM_PROMPT, [userTurn]);
  const code = extractCode(raw);

  console.log(`[LLM] Generated ${code.split("\n").length} lines`);

  const sketch = await writeSketch(code);
  console.log(`[FS]  Wrote sketch → ${sketch.file}`);

  launchSketch(sketch);

  const session: Session = {
    description,
    mp3Path,
    turns: [userTurn, { role: "assistant", content: code }],
    currentCode: code,
  };

  return { sketch, session };
}

export async function refineAndLaunch(
  session: Session,
  modification: string
): Promise<WebGenerateResult> {
  console.log(`\n[LLM] Refining sketch...`);

  const refineTurn: Turn = {
    role: "user",
    content: buildRefinementPrompt(modification),
  };

  const turns = [...session.turns, refineTurn];
  const raw = await callLLM(SYSTEM_PROMPT, turns);
  const code = extractCode(raw);

  console.log(`[LLM] Refined sketch: ${code.split("\n").length} lines`);

  const sketch = await writeSketch(code);
  console.log(`[FS]  Wrote sketch → ${sketch.file}`);

  launchSketch(sketch);

  const updatedSession: Session = {
    ...session,
    turns: [...turns, { role: "assistant", content: code }],
    currentCode: code,
  };

  return { sketch, session: updatedSession };
}

export async function refineSession(
  session: Session,
  modification: string
): Promise<PipelineResult> {
  console.log(`\n[LLM] Refining sketch...`);

  const refineTurn: Turn = {
    role: "user",
    content: buildRefinementPrompt(modification),
  };

  const turns = [...session.turns, refineTurn];
  const raw = await callLLM(SYSTEM_PROMPT, turns);
  const code = extractCode(raw);

  console.log(`[LLM] Updated sketch: ${code.split("\n").length} lines`);

  const sketch = await writeSketch(code);
  console.log(`[FS]  Wrote sketch → ${sketch.file}`);

  const run = await runSketch(sketch);

  const updatedSession: Session = {
    ...session,
    turns: [...turns, { role: "assistant", content: code }],
    currentCode: code,
  };

  return { sketch, run, session: updatedSession };
}
