#!/usr/bin/env node
/**
 * Rank-normalize the complexity / energy / density tags on every preset
 * description so the operator's filter knobs land on meaningful percentiles
 * regardless of the vision model's absolute bias.
 *
 * The model tends to grade everything as "intense / dense / c5" because most
 * MilkDrop frames look vibrant in isolation. After this pass:
 *   - complexity is exactly 20-20-20-20-20 across c1..c5
 *   - energy   is roughly 33-34-33 across calm / medium / intense
 *   - density  is roughly 33-34-33 across sparse / medium / dense
 *
 * The original model judgments are kept as the ranking signal — relative
 * ordering is preserved, only the absolute label changes.
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(__dirname, '..', 'preset-descriptions');

const COMPLEXITY_BUCKETS = [1, 2, 3, 4, 5];          // quintiles
const ENERGY_BUCKETS     = ['calm', 'medium', 'intense'];
const DENSITY_BUCKETS    = ['sparse', 'medium', 'dense'];

// Rank weights so ties on the primary tag are broken with the secondary signal.
const ENERGY_RANK  = { calm: 1, medium: 2, intense: 3 };
const DENSITY_RANK = { sparse: 1, medium: 2, dense: 3 };

const files = (await readdir(DIR)).filter(f => f.endsWith('.md'));
const rows = [];
for (const f of files) {
  const raw = await readFile(resolve(DIR, f), 'utf8');
  const m = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]+)$/.exec(raw);
  if (!m) continue;
  const fm = m[1];
  const get = (k) => (new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm) ?? [])[1]?.trim();
  rows.push({
    file:       f,
    raw,
    fm,
    body:       m[2],
    complexity: parseInt(get('complexity') ?? '3', 10),
    energy:     get('energy') ?? 'medium',
    density:    get('density') ?? 'medium',
  });
}

console.log(`Loaded ${rows.length} preset descriptions.`);
console.log('\nBefore:');
report(rows);

// Build a "busyness score" per row that smoothly orders presets across
// complexity ties: complexity dominates, energy + density break ties.
for (const r of rows) {
  r.score =
    r.complexity * 100 +
    (ENERGY_RANK[r.energy]  ?? 2) * 10 +
    (DENSITY_RANK[r.density] ?? 2);
}

// Sort ascending (low score = low complexity, low energy, sparse).
rows.sort((a, b) => a.score - b.score);

// Assign new complexity by quintile (20-20-20-20-20). With 100 rows that's
// indexes [0..19]→c1, [20..39]→c2, [40..59]→c3, [60..79]→c4, [80..99]→c5.
const N = rows.length;
for (let i = 0; i < N; i++) {
  const q = Math.min(COMPLEXITY_BUCKETS.length - 1, Math.floor(i * COMPLEXITY_BUCKETS.length / N));
  rows[i].newComplexity = COMPLEXITY_BUCKETS[q];
}

// Sort by energy-rank for energy tertiles.
rows.sort((a, b) => (ENERGY_RANK[a.energy] ?? 2) - (ENERGY_RANK[b.energy] ?? 2));
for (let i = 0; i < N; i++) {
  const t = Math.min(ENERGY_BUCKETS.length - 1, Math.floor(i * ENERGY_BUCKETS.length / N));
  rows[i].newEnergy = ENERGY_BUCKETS[t];
}

// Sort by density-rank for density tertiles.
rows.sort((a, b) => (DENSITY_RANK[a.density] ?? 2) - (DENSITY_RANK[b.density] ?? 2));
for (let i = 0; i < N; i++) {
  const t = Math.min(DENSITY_BUCKETS.length - 1, Math.floor(i * DENSITY_BUCKETS.length / N));
  rows[i].newDensity = DENSITY_BUCKETS[t];
}

console.log('\nAfter:');
report(rows, true);

// Write back — only swap the three normalised fields. Preserve everything else
// (name, source, model, motion, palette, brightness, colors, description body).
let changed = 0;
for (const r of rows) {
  let fm = r.fm
    .replace(/^complexity:.*$/m, `complexity: ${r.newComplexity}`)
    .replace(/^energy:.*$/m,     `energy: ${r.newEnergy}`)
    .replace(/^density:.*$/m,    `density: ${r.newDensity}`);
  // also stamp a normalisation marker so we know this file has been touched
  if (!/^normalised:/m.test(fm)) fm += `\nnormalised: ${new Date().toISOString().slice(0, 10)}`;
  const next = `---\n${fm}\n---\n${r.body}\n`;
  if (next !== r.raw) {
    await writeFile(resolve(DIR, r.file), next, 'utf8');
    changed++;
  }
}
console.log(`\nWrote ${changed} files.`);

function report(arr, useNew = false) {
  const cKey = useNew ? 'newComplexity' : 'complexity';
  const eKey = useNew ? 'newEnergy'     : 'energy';
  const dKey = useNew ? 'newDensity'    : 'density';
  const tally = (key) => {
    const t = {};
    for (const r of arr) t[r[key]] = (t[r[key]] ?? 0) + 1;
    return t;
  };
  const cs = tally(cKey), es = tally(eKey), ds = tally(dKey);
  console.log('  complexity:', cs);
  console.log('  energy:    ', es);
  console.log('  density:   ', ds);
}
