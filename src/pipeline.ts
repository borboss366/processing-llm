import { callLLM, CODE_MODEL, type Turn } from "./llm/anthropic-client.js";
import { buildCodeGenPrompt, buildRefinementPrompt, SYSTEM_PROMPT } from "./prompt/builder.js";
import { retrieveExamples } from "./rag/retriever.js";
import { writeSketch, type WrittenSketch, type SketchAssets } from "./processing/sketch-writer.js";
import { runSketch, launchSketch, type RunResult } from "./processing/sketch-runner.js";
import { preprocessImage, type ImageData } from "./image/preprocessor.js";
import { analyzeImage } from "./llm/vision-client.js";
import { analyzeAudio, type AudioAnalysis } from "./audio/analyzer.js";
import { extname, join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

function extractCode(raw: string): string {
  const fenceMatch = raw.match(/```(?:java|processing|pde)?\s*([\s\S]+?)```/);
  if (fenceMatch?.[1] != null) return fenceMatch[1].trim();
  return raw.trim();
}

function extractEffects(code: string): string[] {
  const match = code.match(/\/\/\s*EFFECTS:\s*(.+)/);
  if (!match?.[1]) return [];
  return match[1].split(',').map(s => s.trim()).filter(Boolean);
}

function extractParams(code: string): Record<string, number> {
  const match = code.match(/\/\/\s*PARAMS:\s*(.+)/);
  if (!match?.[1]) return {};
  const result: Record<string, number> = {};
  for (const entry of match[1].split(',')) {
    const [name, val] = entry.trim().split('=');
    if (name?.trim()) result[name.trim()] = parseFloat(val ?? '0.5') || 0.5;
  }
  return result;
}

export type Session = {
  description: string;
  mp3Path?: string;
  liveInput?: boolean;
  imagePath?: string;
  imageData?: ImageData;
  visionDescription?: string;
  imageDescription?: string;
  audioAnalysis?: AudioAnalysis;
  effects: string[];
  params: Record<string, number>;
  turns: Turn[];
  currentCode: string;
};

export type PipelineResult = {
  sketch: WrittenSketch;
  run: RunResult;
  session: Session;
};

export async function startSession(description: string, mp3Path?: string, imagePath?: string, imageDescription?: string): Promise<PipelineResult> {
  console.log(`\n[LLM] Generating sketch with ${CODE_MODEL}...`);

  const ragExamples = retrieveExamples(description);
  if (ragExamples.length) console.log(`[RAG] Injecting ${ragExamples.length} example(s)`);

  let imageData: ImageData | undefined;
  let visionDescription: string | undefined;
  let assets: SketchAssets | undefined;

  if (imagePath) {
    console.log(`[IMG] Preprocessing image + vision analysis → ${imagePath}`);
    const svgDir = await mkdtemp(join(tmpdir(), "proc-blobs-"));
    try {
      [imageData, visionDescription] = await Promise.all([
        Promise.resolve(preprocessImage(imagePath, svgDir)),
        analyzeImage(imagePath).catch(e => { console.warn(`[Vision] ${e}`); return undefined; }),
      ]);
      console.log(`[IMG] Palette: ${imageData.palette.length} colors, Contours: ${imageData.contours.length}, Blobs: ${imageData.blobSvgs.length} SVGs`);
      if (visionDescription) console.log(`[Vision] ${visionDescription.slice(0, 80)}…`);
      assets = { imageData, imagePath, svgDir };
    } catch (e) {
      await rm(svgDir, { recursive: true }).catch(() => {});
      throw e;
    }
  }

  const userTurn: Turn = {
    role: "user",
    content: buildCodeGenPrompt({
      userDescription: description,
      ragExamples,
      ...(mp3Path !== undefined ? { mp3Path } : {}),
      ...(imageData !== undefined ? { imageData } : {}),
      ...(imagePath !== undefined ? { imageExt: extname(imagePath) } : {}),
      ...(visionDescription !== undefined ? { visionDescription } : {}),
      ...(imageDescription !== undefined ? { imageDescription } : {}),
    }),
  };

  const raw = await callLLM(SYSTEM_PROMPT, [userTurn]);
  const code = extractCode(raw);

  console.log(`[LLM] Generated ${code.split("\n").length} lines`);

  const sketch = await writeSketch(code, assets);
  if (assets) await rm(assets.svgDir, { recursive: true }).catch(() => {});
  console.log(`[FS]  Wrote sketch → ${sketch.file}`);

  const run = await runSketch(sketch);

  const session: Session = {
    description,
    ...(mp3Path !== undefined ? { mp3Path } : {}),
    ...(imagePath !== undefined ? { imagePath } : {}),
    ...(imageData !== undefined ? { imageData } : {}),
    ...(visionDescription !== undefined ? { visionDescription } : {}),
    ...(imageDescription !== undefined ? { imageDescription } : {}),
    effects: extractEffects(code),
    params: extractParams(code),
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
  mp3Path?: string,
  liveInput?: boolean,
  imagePath?: string,
  imageDescription?: string,
): Promise<WebGenerateResult> {
  console.log(`\n[LLM] Generating sketch with ${CODE_MODEL}...`);

  const ragExamples = retrieveExamples(description);
  if (ragExamples.length) console.log(`[RAG] Injecting ${ragExamples.length} example(s)`);

  let imageData: ImageData | undefined;
  let visionDescription: string | undefined;
  let audioAnalysis: AudioAnalysis | undefined;
  let assets: SketchAssets | undefined;

  // Run image preprocessing + vision + audio analysis in parallel
  const parallelTasks: Promise<void>[] = [];

  if (imagePath) {
    const svgDir = await mkdtemp(join(tmpdir(), "proc-blobs-"));
    parallelTasks.push(
      Promise.all([
        Promise.resolve(preprocessImage(imagePath, svgDir)),
        analyzeImage(imagePath).catch(e => { console.warn(`[Vision] ${e}`); return undefined; }),
      ]).then(([data, vision]) => {
        imageData = data;
        visionDescription = vision ?? undefined;
        assets = { imageData, imagePath, svgDir };
        console.log(`[IMG] Palette: ${data.palette.length} colors, Contours: ${data.contours.length}, Blobs: ${data.blobSvgs.length} SVGs`);
        if (visionDescription) console.log(`[Vision] ${visionDescription.slice(0, 80)}…`);
      }).catch(async e => { await rm(svgDir, { recursive: true }).catch(() => {}); throw e; })
    );
  }

  if (mp3Path) {
    parallelTasks.push(
      Promise.resolve(analyzeAudio(mp3Path, 90))
        .then(a => {
          audioAnalysis = a;
          console.log(`[Audio] ${a.bpm} BPM · ${a.keyLabel} (${Math.round(a.keyConfidence * 100)}% confidence)`);
        })
        .catch(e => console.warn(`[Audio] Analysis failed: ${e}`))
    );
  }

  if (parallelTasks.length > 0) await Promise.all(parallelTasks);

  const userTurn: Turn = {
    role: "user",
    content: buildCodeGenPrompt({
      userDescription: description,
      ragExamples,
      ...(mp3Path !== undefined ? { mp3Path } : {}),
      ...(liveInput !== undefined ? { liveInput } : {}),
      ...(imageData !== undefined ? { imageData } : {}),
      ...(imagePath !== undefined ? { imageExt: extname(imagePath) } : {}),
      ...(visionDescription !== undefined ? { visionDescription } : {}),
      ...(imageDescription !== undefined ? { imageDescription } : {}),
      ...(audioAnalysis !== undefined ? { audioAnalysis } : {}),
    }),
  };

  const raw = await callLLM(SYSTEM_PROMPT, [userTurn]);
  const code = extractCode(raw);

  console.log(`[LLM] Generated ${code.split("\n").length} lines`);

  const sketch = await writeSketch(code, assets);
  if (assets) await rm(assets.svgDir, { recursive: true }).catch(() => {});
  console.log(`[FS]  Wrote sketch → ${sketch.file}`);

  launchSketch(sketch);

  const session: Session = {
    description,
    ...(mp3Path !== undefined ? { mp3Path } : {}),
    ...(liveInput !== undefined ? { liveInput } : {}),
    ...(imagePath !== undefined ? { imagePath } : {}),
    ...(imageData !== undefined ? { imageData } : {}),
    ...(visionDescription !== undefined ? { visionDescription } : {}),
    ...(imageDescription !== undefined ? { imageDescription } : {}),
    ...(audioAnalysis !== undefined ? { audioAnalysis } : {}),
    effects: extractEffects(code),
    params: extractParams(code),
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
    effects: extractEffects(code),
    params: extractParams(code),
    turns: [...turns, { role: "assistant", content: code }],
    currentCode: code,
  };

  return { sketch, session: updatedSession };
}

export async function relaunchSession(session: Session): Promise<WrittenSketch> {
  let assets: SketchAssets | undefined;
  if (session.imagePath && session.imageData) {
    const svgDir = await mkdtemp(join(tmpdir(), "proc-blobs-"));
    try {
      preprocessImage(session.imagePath, svgDir);
      assets = { imageData: session.imageData, imagePath: session.imagePath, svgDir };
    } catch {
      await rm(svgDir, { recursive: true }).catch(() => {});
    }
  }
  const sketch = await writeSketch(session.currentCode, assets);
  if (assets) await rm(assets.svgDir, { recursive: true }).catch(() => {});
  console.log(`[FS]  Wrote sketch → ${sketch.file}`);
  launchSketch(sketch);
  return sketch;
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
    effects: extractEffects(code),
    params: extractParams(code),
    turns: [...turns, { role: "assistant", content: code }],
    currentCode: code,
  };

  return { sketch, run, session: updatedSession };
}
