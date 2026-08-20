#!/usr/bin/env node
/**
 * Visual bootstrap: for each Butterchurn preset, load it in a headless
 * Chrome, let it render for a couple of seconds with white-noise FFT data,
 * grab a screenshot, and ask a vision LLM to describe what the visual
 * actually looks like (colors, motion, geometry, energy). Saves the answer
 * to web/app/preset-descriptions/<slug>.md, replacing the name-only guesses
 * that bootstrap-preset-descriptions.mjs produced earlier.
 *
 * Requires: puppeteer-core, system Chrome at /Applications/Google Chrome.app,
 *           Vite dev server running on :5173 (serves preset-snap.html),
 *           ollama running on :11434 with a vision model (default moondream).
 *
 * Usage:
 *   node scripts/visual-bootstrap.mjs                   # all 99 presets
 *   node scripts/visual-bootstrap.mjs --limit 10        # first 10 (test run)
 *   node scripts/visual-bootstrap.mjs --redo            # overwrite even if .md exists
 *   MODEL=llava:7b node scripts/visual-bootstrap.mjs    # different vision model
 */

import puppeteer from 'puppeteer-core';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import butterchurnPresetsLib from 'butterchurn-presets';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const OUT_DIR    = resolve(__dirname, '..', 'preset-descriptions');
const SNAP_URL   = process.env.SNAP_URL   || 'http://localhost:5173/preset-snap.html';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const MODEL      = process.env.MODEL      || 'moondream';
const CHROME     = process.env.CHROME     || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const args  = process.argv.slice(2);
const REDO  = args.includes('--redo');
const limitIdx = args.indexOf('--limit');
const LIMIT = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : Infinity;

const ppLib   = butterchurnPresetsLib.default || butterchurnPresetsLib;
const presets = ppLib.getPresets();
const names   = Object.keys(presets).slice(0, LIMIT);

function slug(name) {
  return name.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function buildMarkdown(name, { description, tags }) {
  const lines = [
    '---',
    `name: ${JSON.stringify(name)}`,
    'source: visual',
    `model: ${MODEL}`,
  ];
  // Each tag on its own line, only if we got a value.
  for (const k of ['motion', 'density', 'brightness', 'palette', 'energy', 'geometry']) {
    if (tags[k]) lines.push(`${k}: ${tags[k]}`);
  }
  if (typeof tags.complexity === 'number') lines.push(`complexity: ${tags.complexity}`);
  if (Array.isArray(tags.colors) && tags.colors.length) {
    lines.push(`colors: [${tags.colors.map(c => JSON.stringify(c)).join(', ')}]`);
  }
  lines.push('---', description, '');
  return lines.join('\n');
}

function formatTagsBrief(tags) {
  const out = [];
  if (tags.complexity != null) out.push(`c${tags.complexity}`);
  if (tags.energy)             out.push(tags.energy[0]);
  if (tags.density)            out.push(tags.density[0]);
  if (tags.brightness)         out.push(tags.brightness[0]);
  if (tags.motion)             out.push(tags.motion.slice(0, 3));
  return out.join(' ');
}

await mkdir(OUT_DIR, { recursive: true });

// A .md file is considered "already done by visual bootstrap" if it has
// `source: visual` in its YAML frontmatter. Old name-only descriptions
// (from bootstrap-preset-descriptions.mjs) don't have that, so this script
// will re-process them by default — even without --redo.
async function hasVisualSource(fname) {
  try {
    const raw = await readFile(resolve(OUT_DIR, fname), 'utf8');
    return /^source:\s*visual\b/m.test(raw);
  } catch { return false; }
}
const allMd = (await readdir(OUT_DIR)).filter(f => f.endsWith('.md'));
const visualDone = new Set();
for (const f of allMd) if (await hasVisualSource(f)) visualDone.add(f);

console.log(`Visual bootstrap — model=${MODEL}  snap-url=${SNAP_URL}`);
console.log(`Output: ${OUT_DIR}`);
console.log(`Presets to process: ${names.length} (limit=${LIMIT === Infinity ? 'none' : LIMIT}, redo=${REDO})`);
console.log();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  // 'new' headless can't initialise WebGL on modern Chrome without ANGLE; the
  // old --use-gl=swiftshader flag was removed. Use the legacy `true` (=old
  // headless) mode which still gets a real GL context via swiftshader.
  headless: true,
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-features=Vulkan',
    '--autoplay-policy=no-user-gesture-required',   // lets AudioContext start
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
  ],
});

// Page recycling: butterchurn leaks GL state. After ~30 preset loads the
// page crashes with "detached Frame". Recreate it preemptively every N.
const RECYCLE_EVERY = 20;
let page = null;

async function openSnapPage() {
  if (page) { try { await page.close(); } catch {} }
  page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => console.log(`\n    [page error] ${err.message}`));
  await page.goto(SNAP_URL, { waitUntil: 'networkidle2', timeout: 30_000 });
  await page.waitForFunction('window.snapReady === true', { timeout: 30_000 });
}

try {
  console.log(`Opening ${SNAP_URL}…`);
  await openSnapPage();
  console.log(`Snap page ready.\n`);

  let done = 0, skipped = 0, failed = 0, sinceRecycle = 0;
  const t0 = Date.now();

  for (const [i, name] of names.entries()) {
    const file = `${slug(name)}.md`;
    if (visualDone.has(file) && !REDO) { skipped++; continue; }

    if (sinceRecycle >= RECYCLE_EVERY) {
      process.stdout.write(`  ↻ recycling page after ${sinceRecycle} loads…`);
      await openSnapPage();
      sinceRecycle = 0;
      console.log(` ready`);
    }

    process.stdout.write(`[${i + 1}/${names.length}] ${name.slice(0, 60).padEnd(60)} … `);

    let attempt = 0;
    let result = null;
    while (attempt < 2 && !result?.description) {
      attempt++;
      try {
        const ok = await page.evaluate((n) => window.setPreset(n), name);
        if (!ok) { console.log(`✗ unknown preset`); break; }
        await new Promise(r => setTimeout(r, 3000));
        const jpg = await page.screenshot({ type: 'jpeg', quality: 70, clip: { x: 0, y: 0, width: 800, height: 600 } });
        const b64 = Buffer.from(jpg).toString('base64');
        if (process.env.SAVE_FRAMES) {
          await writeFile(resolve(OUT_DIR, `${slug(name)}.jpg`), jpg);
        }
        result = await describeImage(b64, name);
        if (!result?.description) throw new Error('empty description');
      } catch (err) {
        if (attempt === 1 && /detached|Target closed|Session closed|crashed/i.test(err.message)) {
          console.log(`✗ ${err.message.slice(0, 50)} — recovering`);
          await openSnapPage();
          sinceRecycle = 0;
          process.stdout.write(`    retry … `);
          continue;
        }
        failed++;
        console.log(`✗ ${err.message}`);
        break;
      }
    }

    if (result?.description) {
      const md = buildMarkdown(name, result);
      await writeFile(resolve(OUT_DIR, file), md, 'utf8');
      visualDone.add(file);
      done++;
      sinceRecycle++;
      const tagsBrief = formatTagsBrief(result.tags);
      console.log(`✓ [${tagsBrief}] ${result.description.slice(0, 50)}${result.description.length > 50 ? '…' : ''}`);
    }
  }

  const sec = Math.round((Date.now() - t0) / 1000);
  console.log(`\nDone in ${sec}s. new=${done} skipped=${skipped} failed=${failed}`);
} finally {
  if (page) { try { await page.close(); } catch {} }
  await browser.close();
}

async function describeImage(b64, presetName) {
  // Simple prose prompt — what llava is actually good at. Tags are derived
  // separately by qwen3:8b in extractTags() because vision models can't
  // reliably commit to structured labels on abstract content.
  const prompt =
    `Describe this abstract music-visualization frame in two short sentences. ` +
    `Mention: dominant colors, motion type, geometric character, energy level, ` +
    `how busy/complex it looks. Be specific.`;

  const body = JSON.stringify({
    model: MODEL,
    prompt,
    images: [b64],
    stream: false,
    keep_alive: -1,
    // Longer budget — we're asking for 8 labels + a sentence (~80-120 tokens).
    options: { num_predict: 200, temperature: 0.1 },
  });
  if (process.env.DEBUG_MOONDREAM) {
    const fs = await import('node:fs/promises');
    await fs.writeFile('/tmp/moondream-script-req.json', body);
    console.log(`    [moondream req body size: ${body.length}]`);
  }
  let r;
  try {
    r = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (err) {
    console.log(`\n    [moondream fetch threw] ${err.message}`);
    return '';
  }
  if (!r.ok) {
    const txt = await r.text().catch(() => '(no body)');
    console.log(`\n    [moondream HTTP ${r.status}] ${txt.slice(0, 200)}`);
    return '';
  }
  let json;
  try { json = await r.json(); }
  catch (err) {
    console.log(`\n    [moondream non-JSON response] ${err.message}`);
    return '';
  }
  const raw = json.response ?? '';
  if (process.env.DEBUG_MOONDREAM) {
    console.log(`\n    [moondream raw len=${raw.length}] ${JSON.stringify(raw).slice(0, 200)}`);
  }
  void presetName;
  // Llava gives us a prose description. Pass it to qwen3:8b to extract
  // structured tags. Two-call pipeline: each model does what it's best at.
  let description = (raw ?? '').trim();
  // strip leading "The image is..." preamble
  description = description
    .replace(/^["']|["']$/g, '')
    .replace(/^(The|This)\s+(image|frame|visualization|art piece|piece)\s+(is|shows|depicts|presents|features|displays)\s*(an|a|the)?\s*(abstract|digital|colorful|dynamic|vibrant)?\s*(representation|art piece|depiction|piece|view|scene|composition)?\s*(of)?\s*/i, '')
    .replace(/^[a-z]/, c => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
  if (!description || /^[!?.\s]+$/.test(description)) return { description: '', tags: {} };

  const tags = await extractTagsFromDescription(description);
  return { description, tags };
}

// Second pass: qwen3:8b (text-only, no image) extracts structured tags from
// llava's prose description. Qwen is much more disciplined about following
// JSON output formats than llava is about following label formats.
async function extractTagsFromDescription(description) {
  const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen3:8b';
  // Calibration notes embedded — without these qwen3 over-grades on llava's
  // florid language ("vibrant", "dynamic", "intricate") and emits c5/intense
  // for everything. Few-shot anchors keep it honest.
  const prompt =
    `Extract structured tags from a music-visualization description.\n\n` +
    `IMPORTANT CALIBRATION:\n` +
    `- llava (the describer) uses "vibrant", "dynamic", "abstract" for almost everything.\n` +
    `  Ignore those superlatives — judge by SPECIFIC content.\n` +
    `- complexity 5 requires explicit chaos/overwhelm signals (e.g., "many competing",\n` +
    `  "explosion of", "overwhelming", "chaotic"). Otherwise prefer 3 or 4.\n` +
    `- complexity 1-2 needs explicit simplicity (e.g., "single", "minimal", "few",\n` +
    `  "sparse", "mostly empty").\n` +
    `- energy "intense" requires fast + high-contrast cues; "calm" requires slow/soft cues.\n` +
    `  Default to "medium" if unsure.\n\n` +
    `Examples:\n` +
    `IN  "A single white circle slowly pulsing on a black background."\n` +
    `OUT {"motion":"pulsing","density":"sparse","brightness":"dim","palette":"monochrome","colors":["white","black"],"energy":"calm","geometry":"blob","complexity":1}\n\n` +
    `IN  "Vibrant abstract visualization with swirling blue and purple patterns on dark background."\n` +
    `OUT {"motion":"swirling","density":"medium","brightness":"medium","palette":"cool","colors":["blue","purple"],"energy":"medium","geometry":"abstract","complexity":3}\n\n` +
    `IN  "Chaotic explosion of red, yellow, green particles with extreme contrast and rapid simultaneous motions."\n` +
    `OUT {"motion":"exploding","density":"dense","brightness":"bright","palette":"warm","colors":["red","yellow","green"],"energy":"intense","geometry":"particles","complexity":5}\n\n` +
    `IN  "Slow blue waves drifting across a dark teal background, sparse motion."\n` +
    `OUT {"motion":"flowing","density":"sparse","brightness":"dim","palette":"cool","colors":["blue","teal"],"energy":"calm","geometry":"organic","complexity":2}\n\n` +
    `Now extract for:\n` +
    `IN  "${description}"\n` +
    `OUT `;
  try {
    const r = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: QWEN_MODEL, prompt, stream: false, think: false, keep_alive: -1,
        options: { num_predict: 200, temperature: 0.3, stop: ['\n\n'] },
      }),
    });
    if (!r.ok) return {};
    const json = await r.json();
    const text = (json.response ?? '').trim();
    // pull the first {...} block (qwen sometimes adds preamble)
    const m = text.match(/\{[\s\S]*?\}/);
    if (!m) return {};
    const obj = JSON.parse(m[0]);
    // normalise + validate
    const out = {};
    const ENUMS = {
      motion:     ['swirling', 'pulsing', 'flowing', 'static', 'chaotic', 'scrolling', 'exploding'],
      density:    ['sparse', 'medium', 'dense'],
      brightness: ['dim', 'medium', 'bright'],
      palette:    ['warm', 'cool', 'monochrome', 'rainbow', 'dark'],
      energy:     ['calm', 'medium', 'intense'],
      geometry:   ['spiral', 'grid', 'organic', 'fractal', 'particles', 'lines', 'blob', 'abstract'],
    };
    for (const [k, opts] of Object.entries(ENUMS)) {
      const v = String(obj[k] ?? '').toLowerCase();
      if (opts.includes(v)) out[k] = v;
    }
    if (Array.isArray(obj.colors)) {
      out.colors = obj.colors
        .map(c => String(c).trim().toLowerCase().replace(/[^a-z\- ]/g, '').trim())
        .filter(Boolean).slice(0, 4);
    }
    const cx = parseInt(obj.complexity, 10);
    if (cx >= 1 && cx <= 5) out.complexity = cx;
    return out;
  } catch {
    return {};
  }
}

// Parse llava's labelled output. llava emits labels either one-per-line OR
// all-on-one-line comma-separated ("Motion: flowing, Density: medium, ..."),
// so we can't anchor on \n. Two-pass: locate every "label:" occurrence,
// take the text between consecutive label positions as that label's value.
function parseTaggedResponse(raw) {
  if (/^[!?.\s]+$/.test((raw ?? '').trim())) return { description: '', tags: {} };

  const LABEL_NAMES = ['motion', 'density', 'brightness', 'palette', 'colors', 'energy', 'geometry', 'complexity', 'description'];
  const TAG_ENUMS = {
    motion:     ['swirling', 'pulsing', 'flowing', 'static', 'chaotic', 'scrolling', 'exploding'],
    density:    ['sparse', 'medium', 'dense'],
    brightness: ['dim', 'medium', 'bright'],
    palette:    ['warm', 'cool', 'monochrome', 'rainbow', 'dark'],
    energy:     ['calm', 'medium', 'intense'],
    geometry:   ['spiral', 'grid', 'organic', 'fractal', 'particles', 'lines', 'blob', 'abstract'],
  };

  // 1) Locate every "label:" occurrence in raw text — slice between them.
  const labelRegex = new RegExp(`\\b(${LABEL_NAMES.join('|')})\\s*:`, 'gi');
  const hits = [...raw.matchAll(labelRegex)];
  const fields = {};
  for (let i = 0; i < hits.length; i++) {
    const h    = hits[i];
    const key  = h[1].toLowerCase();
    const from = h.index + h[0].length;
    const to   = i + 1 < hits.length ? hits[i + 1].index : raw.length;
    fields[key] = raw.slice(from, to).replace(/[,\s.]+$/, '').trim();
  }

  // 2) Resolve enums from the captured value text.
  const tags = {};
  for (const [key, opts] of Object.entries(TAG_ENUMS)) {
    if (!fields[key]) continue;
    const val = fields[key].toLowerCase();
    const hit = opts.find(o => val.includes(o));
    if (hit) tags[key] = hit;
  }
  if (fields.colors) {
    tags.colors = fields.colors
      .split(/,|\band\b|\bor\b|\//gi)
      .map(s => s.trim().toLowerCase().replace(/[^a-z\- ]/g, '').trim())
      .filter(Boolean).slice(0, 4);
  }
  if (fields.complexity) {
    const m = /([1-5])/.exec(fields.complexity);
    if (m) tags.complexity = parseInt(m[1], 10);
  }

  // Description: prefer explicit `description:` field, then synthesise from
  // tags, and as a final fallback take the raw text — even if llava abandoned
  // the labels and answered in prose, we keep that prose so the director
  // still has SOMETHING to read.
  let description = fields.description ?? '';
  if (!description && Object.keys(tags).length) {
    description = synthesiseDescription(tags);
  }
  if (!description) {
    // No labels found — llava reverted to prose. Take the first sentence.
    const m = raw.trim().match(/^[\s\S]*?[.!?](?:\s|$)/);
    if (m) description = m[0].trim();
    else    description = raw.trim().slice(0, 200);
  }
  description = description
    .replace(/^["']|["']$/g, '')
    .replace(/^(The|This)\s+(image|frame|visualization|art piece|piece)\s+(is|shows|depicts|presents|features|displays)\s*(an|a|the)?\s*(abstract|digital|colorful|dynamic|vibrant)?\s*(representation|art piece|depiction|piece|view|scene|composition)?\s*(of)?\s*/i, '')
    .replace(/^[a-z]/, c => c.toUpperCase())
    .replace(/\s+/g, ' ')
    .trim();
  return { description, tags };
}

// Fall-back: if llava emits only labels, stitch them into a sentence so the
// director still has prose to reason over.
function synthesiseDescription(t) {
  const parts = [];
  if (Array.isArray(t.colors) && t.colors.length) {
    parts.push(t.colors.slice(0, 3).join(', '));
  }
  if (t.geometry && t.geometry !== 'abstract') parts.push(t.geometry);
  parts.push(t.motion ? `${t.motion} motion` : 'motion');
  const mods = [];
  if (t.energy)     mods.push(`${t.energy} energy`);
  if (t.density)    mods.push(`${t.density} density`);
  if (t.brightness) mods.push(`${t.brightness} brightness`);
  if (t.palette)    mods.push(`${t.palette} palette`);
  if (mods.length) parts.push(`with ${mods.join(', ')}`);
  return parts.join(', ') + '.';
}
