import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../llm/ollama-client.js";
import { expandBrief } from "./qwen-expander.js";

const QWEN_MODEL  = "qwen3:8b";
const GUIDE_PATH  = join(process.cwd(), "src/prompt/qwen-module-guide.md");
const SANDBOX_DIR = join(process.cwd(), "modules/sandbox");

export type GenerateModuleOptions = {
  /** When true, run a first qwen call to expand the user's brief into a structured task prompt. */
  twoStage?: boolean;
};

export type GenerateModuleResult = {
  ok: boolean;
  id: string;
  sandboxDir: string;
  durationSec: number;          // generator duration
  evalCount: number;
  promptTokens: number;
  jsonValid: boolean;
  audit: Record<string, boolean | number>;
  patches: string[];
  rawResponseBytes: number;
  error?: string;
  // Two-stage extras
  expanderDurationSec?: number;
  expandedPrompt?: string;
};

export async function generateModule(
  id: string,
  userPrompt: string,
  opts: GenerateModuleOptions = {},
): Promise<GenerateModuleResult> {
  let actualPrompt = userPrompt;
  let expanderDurationSec: number | undefined;
  let expandedPrompt: string | undefined;
  if (opts.twoStage) {
    const exp = await expandBrief(userPrompt);
    actualPrompt = exp.expandedPrompt;
    expanderDurationSec = exp.durationSec;
    expandedPrompt = exp.expandedPrompt;
  }
  const guide = readFileSync(GUIDE_PATH, "utf8");
  const fullPrompt =
    guide +
    "\n\n---\n\n" +
    actualPrompt +
    "\n\nOutput two fenced blocks (json then java) and nothing else.";

  const result = await generate(QWEN_MODEL, fullPrompt, {
    think: false,
    options: {
      temperature: 0.2,
      top_p: 0.9,
      repeat_penalty: 1.1,
      num_ctx: 16384,
      num_predict: 5500,
    },
  });

  const raw = result.response;
  const jsonMatch = raw.match(/```json\s*\n([\s\S]*?)\n```/);
  const javaMatch = raw.match(/```java\s*\n([\s\S]*?)\n```/);

  const base = {
    id,
    sandboxDir: "",
    durationSec: result.total_duration / 1e9,
    evalCount:   result.eval_count,
    promptTokens: result.prompt_eval_count,
    jsonValid:   false,
    audit:       {} as Record<string, boolean | number>,
    patches:     [] as string[],
    rawResponseBytes: raw.length,
  };

  if (!jsonMatch || !javaMatch) {
    return { ...base, ok: false, error: "qwen did not produce two fenced blocks (json + java)" };
  }

  let jsonText = jsonMatch[1].trim();
  let pdeText  = javaMatch[1].trim();

  // ── Parse + validate the JSON ──────────────────────────────────────────────
  let oscPrefix = "";
  let jsonValid = false;
  try {
    const parsed = JSON.parse(jsonText) as { oscPrefix?: string };
    if (typeof parsed.oscPrefix === "string" && parsed.oscPrefix.length > 0) {
      oscPrefix = parsed.oscPrefix;
      jsonValid = true;
    }
  } catch {}
  if (!jsonValid) {
    return { ...base, ok: false, error: "module.json failed to parse or missing oscPrefix" };
  }

  // ── Auto-patch the recurring qwen bugs ─────────────────────────────────────
  const prefixUpper = oscPrefix.toUpperCase();
  const patches: string[] = [];

  // 1. Anchor constant typos: <PREFIX>_ANCHZ, <PREFIX>_ANCHNE, <PREFIX>_ANCH_OR, etc.
  const expectedAnchor = `${prefixUpper}_ANCHOR`;
  const anchorTypoRe   = new RegExp(`\\b${prefixUpper}_ANCH\\w*\\b`, "g");
  pdeText = pdeText.replace(anchorTypoRe, (m) => {
    if (m !== expectedAnchor) {
      patches.push(`anchor constant typo: ${m} → ${expectedAnchor}`);
      return expectedAnchor;
    }
    return m;
  });

  // 2. float-instead-of-color declarations: `float <prefix>FooColor = {{x}};` → `color`
  const colorDeclRe = new RegExp(`\\bfloat\\s+(${oscPrefix}\\w*[Cc]olor)\\b`, "g");
  pdeText = pdeText.replace(colorDeclRe, (_m, name: string) => {
    patches.push(`type fix: float ${name} → color ${name}`);
    return `color ${name}`;
  });

  // 3. Missing CX/CY declarations when anchor-to-center pattern is used
  const cxName = `${oscPrefix}CX`;
  const cyName = `${oscPrefix}CY`;
  const cxAssigned = pdeText.includes(`${cxName} =`);
  const cxDeclared = new RegExp(`\\bfloat\\s+[^;]*\\b${cxName}\\b`).test(pdeText);
  if (cxAssigned && !cxDeclared) {
    // Inject the declaration just before the first <prefix>_setup() function
    const re = new RegExp(`(void\\s+${oscPrefix}_setup\\s*\\(\\s*\\))`);
    if (re.test(pdeText)) {
      pdeText = pdeText.replace(re, `float ${cxName}, ${cyName};\n\n$1`);
      patches.push(`added missing declaration: float ${cxName}, ${cyName};`);
    }
  }

  // ── Save to sandbox ────────────────────────────────────────────────────────
  const sandboxDir = join(SANDBOX_DIR, id);
  mkdirSync(sandboxDir, { recursive: true });
  writeFileSync(join(sandboxDir, "module.json"), jsonText + "\n");
  writeFileSync(join(sandboxDir, "module.pde"),  pdeText  + "\n");

  // ── Audit ──────────────────────────────────────────────────────────────────
  const audit: Record<string, boolean | number> = {
    has_setup:       pdeText.includes(`${oscPrefix}_setup(`),
    has_draw:        pdeText.includes(`${oscPrefix}_draw(`),
    has_osc:         pdeText.includes(`${oscPrefix}_osc(`),
    no_void_setup:   !pdeText.includes("void setup()"),
    no_void_draw:    !pdeText.includes("void draw()"),
    no_size:         !pdeText.includes("size("),
    no_background:   !pdeText.includes("background("),
    no_import:       !pdeText.includes("import "),
    no_minim_decl:   !pdeText.includes("Minim minim"),
    no_rotate_const: !/rotate\([^)]*\*\s*(30|180)\b/.test(pdeText),
    osc_count:       (pdeText.match(new RegExp(`checkAddrPattern\\("/${oscPrefix}/`, "g")) ?? []).length,
  };

  return {
    ...base,
    ok: true,
    sandboxDir,
    jsonValid: true,
    audit,
    patches,
    expanderDurationSec,
    expandedPrompt,
  };
}
