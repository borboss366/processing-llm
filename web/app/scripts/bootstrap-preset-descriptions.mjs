#!/usr/bin/env node
/**
 * One-shot: generate a short visual description for every Butterchurn preset
 * via qwen3:8b, save as web/app/preset-descriptions/<slug>.md with YAML
 * frontmatter holding the original preset name.
 *
 * Skips presets whose .md already exists, so re-runs are cheap.
 * Run:  node scripts/bootstrap-preset-descriptions.mjs
 */

import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import butterchurnPresetsLib from 'butterchurn-presets';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = resolve(__dirname, '..', 'preset-descriptions');
const OLLAMA    = process.env.OLLAMA_HOST
  ? `http://${process.env.OLLAMA_HOST}/api/generate`
  : 'http://localhost:11434/api/generate';
const MODEL     = process.env.MODEL || 'qwen3:8b';

const ppLib = butterchurnPresetsLib.default || butterchurnPresetsLib;
const presets = ppLib.getPresets();
const names   = Object.keys(presets);

function slug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

async function describe(name) {
  const prompt =
    `MilkDrop visualizer preset name: "${name}"\n\n` +
    `In ONE concise sentence (max 20 words), describe what this preset probably looks like visually. ` +
    `Focus on: colors, motion type, geometry. Be specific and evocative. ` +
    `Output the sentence ONLY — no quotes, no preamble, no markdown.`;
  const r = await fetch(OLLAMA, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt, stream: false, think: false, keep_alive: -1,
      options: { num_predict: 80, temperature: 0.6 },
    }),
  });
  const json = await r.json();
  return (json.response ?? '').trim().split('\n')[0].replace(/^["']|["']$/g, '').trim();
}

await mkdir(OUT_DIR, { recursive: true });
const existing = new Set((await readdir(OUT_DIR)).filter(f => f.endsWith('.md')));

let done = 0, skipped = 0, failed = 0;
const t0 = Date.now();
for (const name of names) {
  const file = `${slug(name)}.md`;
  if (existing.has(file)) { skipped++; continue; }

  process.stdout.write(`[${done + skipped + failed + 1}/${names.length}] ${name.slice(0, 60).padEnd(60)} … `);
  try {
    const desc = await describe(name);
    if (!desc) throw new Error('empty response');
    const md = `---\nname: ${JSON.stringify(name)}\n---\n${desc}\n`;
    await writeFile(resolve(OUT_DIR, file), md, 'utf8');
    done++;
    console.log(`✓ ${desc.slice(0, 60)}${desc.length > 60 ? '…' : ''}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${e.message}`);
  }
}

const sec = Math.round((Date.now() - t0) / 1000);
console.log(`\nDone in ${sec}s. new=${done} skipped=${skipped} failed=${failed}`);
