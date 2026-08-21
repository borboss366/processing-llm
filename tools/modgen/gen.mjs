#!/usr/bin/env node
/**
 * Offline module generator — qwen3:8b writes a p5 module from an NL prompt.
 *
 *   node tools/modgen/gen.mjs --id <kebab-id> "<what the module should do>"
 *
 * Writes web/app/loaded-modules/<id>.js and, if the controller server is
 * running, POSTs /browser-modules/load so connected windows hot-import it.
 * The module contract handed to the LLM is web/app/MODULE_ABI.md verbatim —
 * this script owns no copy of the ABI.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ABI_FILE = path.join(ROOT, "web/app/MODULE_ABI.md");
const MODULES_DIR = path.join(ROOT, "web/app/loaded-modules");
const SERVER_URL = process.env.CONTROLLER_URL ?? "http://localhost:3000";
const OLLAMA_URL = process.env.OLLAMA_HOST
  ? `http://${process.env.OLLAMA_HOST}/api/generate`
  : "http://localhost:11434/api/generate";
const MODEL = process.env.MODGEN_MODEL ?? "qwen3:8b";

function usage(msg) {
  if (msg) console.error(`error: ${msg}`);
  console.error('usage: node tools/modgen/gen.mjs --id <kebab-id> "<prompt>"');
  process.exit(1);
}

const argv = process.argv.slice(2);
const idFlag = argv.indexOf("--id");
if (idFlag === -1 || !argv[idFlag + 1]) usage("--id required");
const id = argv[idFlag + 1];
const prompt = argv.filter((_, i) => i !== idFlag && i !== idFlag + 1).join(" ").trim();
if (!/^[a-z][a-z0-9-]{0,30}$/.test(id)) usage(`bad id "${id}" (lowercase kebab-case)`);
if (!prompt) usage("prompt required");

const abi = await fs.readFile(ABI_FILE, "utf8");

const fullPrompt =
  `You write self-contained ES-module JS for a p5.js VJ visualizer.\n` +
  `The module contract you MUST follow:\n\n${abi}\n\n` +
  `RULES:\n` +
  `- Output ONLY the JS module — no markdown fences, no commentary.\n` +
  `- ES module syntax (export default). No import statements.\n` +
  `- Use the ctx.p prefix for all p5 calls. Never call bare fill/circle/etc.\n` +
  `- Keep it under 120 lines. Focus on the requested behavior.\n` +
  `- Colors in defaults are hex strings like '#ff8c00', not p5 color objects.\n` +
  `- Per-frame state (particles, trails) is initialised in setup().\n\n` +
  `Generate a module with id "${id}".\n` +
  `Requirement: ${prompt}\n\n` +
  `Output the JS module now.`;

console.log(`[modgen] ${MODEL} ← "${prompt}" (id: ${id})`);
const t0 = Date.now();

const r = await fetch(OLLAMA_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: MODEL, prompt: fullPrompt, stream: false, think: false, keep_alive: -1,
    options: { num_predict: 2000, temperature: 0.4 },
  }),
}).catch((e) => {
  console.error(`[modgen] Ollama unreachable at ${OLLAMA_URL}: ${e.message}`);
  process.exit(1);
});
if (!r.ok) {
  console.error(`[modgen] Ollama HTTP ${r.status}: ${await r.text()}`);
  process.exit(1);
}
const j = await r.json();
let code = (j.response ?? "").trim()
  .replace(/^```(?:js|javascript)?\s*\n?/i, "")
  .replace(/\n?```\s*$/i, "")
  .trim();

if (!/export\s+default\s*\{/.test(code)) {
  console.error("[modgen] generated code has no `export default {` — raw output:\n");
  console.error(code);
  process.exit(1);
}

const filePath = path.join(MODULES_DIR, `${id}.js`);
await fs.mkdir(MODULES_DIR, { recursive: true });
await fs.writeFile(filePath, code, "utf8");
console.log(`[modgen] wrote ${path.relative(ROOT, filePath)} (${code.length} bytes, ${Date.now() - t0} ms)`);

try {
  const res = await fetch(`${SERVER_URL}/browser-modules/load`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const body = await res.json();
  console.log(res.ok && body.ok
    ? `[modgen] hot-loaded into running server (${SERVER_URL})`
    : `[modgen] server load refused: ${JSON.stringify(body)}`);
} catch {
  console.log(`[modgen] no server at ${SERVER_URL} — module will load on next start`);
}
