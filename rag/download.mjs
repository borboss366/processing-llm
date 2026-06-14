#!/usr/bin/env node
/**
 * Downloads all official Processing examples from GitHub, concatenates
 * multi-tab sketches, extracts descriptions from header comments, and
 * writes rag/sketches/<slug>.pde + rag/catalog.json.
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const OUT_DIR = new URL("./sketches/", import.meta.url).pathname;
const CATALOG_FILE = new URL("./catalog.json", import.meta.url).pathname;

// ── 1. Clone (shallow) into a temp dir ──────────────────────────────────────

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "processing-examples-"));
console.log(`Cloning into ${tmpDir} ...`);
execSync(
  "git clone --depth=1 --quiet https://github.com/processing/processing-examples.git .",
  { cwd: tmpDir, stdio: "inherit" }
);

// ── 2. Collect sketch folders ────────────────────────────────────────────────
// Each sketch is a leaf directory containing at least one .pde file.

function findSketchDirs(root) {
  const results = [];
  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const pdes = entries.filter((e) => e.isFile() && e.name.endsWith(".pde"));
    if (pdes.length > 0) {
      results.push(dir);
      return; // don't recurse into sketch dirs
    }
    for (const e of entries) {
      if (e.isDirectory()) walk(path.join(dir, e.name));
    }
  }
  walk(root);
  return results;
}

const sketchDirs = findSketchDirs(tmpDir).filter(
  (d) => !d.includes("/.git/")
);
console.log(`Found ${sketchDirs.length} sketch folders.`);

// ── 3. Extract description from first block comment ──────────────────────────

function extractDescription(code) {
  // Grab lines from the opening /** ... */ block
  const blockMatch = code.match(/\/\*\*?([\s\S]*?)\*\//);
  if (blockMatch) {
    const lines = blockMatch[1]
      .split("\n")
      .map((l) => l.replace(/^\s*\*\s?/, "").trim())
      .filter((l) => l && !l.startsWith("by ") && !l.startsWith("@") && !/^[\w\s]+$/.test(l) || l.includes(" "));
    // First non-empty, non-title, non-author line is usually the description
    const desc = lines.find(
      (l) => l.length > 10 && !l.toLowerCase().startsWith("by ")
    );
    if (desc) return desc;
  }
  // Fallback: first // comment line that looks like a sentence
  const lineMatch = code.match(/\/\/\s*([A-Z][^/\n]{10,})/);
  return lineMatch ? lineMatch[1].trim() : "";
}

// ── 4. Derive tags from the category path ────────────────────────────────────

const TAG_MAP = {
  Basics: ["basics"],
  Topics: ["topics"],
  Arrays: ["arrays", "data"],
  Camera: ["camera", "3d"],
  Color: ["color"],
  Control: ["control", "logic"],
  Data: ["data", "types"],
  Form: ["shapes", "geometry"],
  Image: ["image", "pixels"],
  Input: ["input", "mouse", "keyboard"],
  Lights: ["lights", "3d"],
  Math: ["math"],
  Objects: ["oop", "objects"],
  Shape: ["shapes", "svg"],
  Structure: ["structure"],
  Transform: ["transform", "matrix"],
  Typography: ["typography", "text"],
  "Advanced Data": ["data", "json", "table"],
  Animation: ["animation"],
  "Cellular Automata": ["simulation", "automata"],
  Drawing: ["drawing"],
  "File IO": ["file", "io"],
  "Fractals and L-Systems": ["fractal", "lsystem", "generative"],
  GUI: ["gui", "button"],
  "Image Processing": ["image", "pixels", "filter"],
  Interaction: ["interaction", "mouse"],
  Motion: ["motion", "physics"],
  Simulate: ["simulation", "particles", "physics"],
  Vectors: ["vectors", "math", "physics"],
};

function tagsFromPath(relPath) {
  const parts = relPath.split(path.sep);
  const tags = new Set();
  for (const part of parts) {
    const mapped = TAG_MAP[part];
    if (mapped) for (const t of mapped) tags.add(t);
  }
  return [...tags];
}

// ── 5. Process each sketch ────────────────────────────────────────────────────

const catalog = [];

for (const dir of sketchDirs) {
  const rel = path.relative(tmpDir, dir); // e.g. "Basics/Math/SineWave"
  const parts = rel.split(path.sep);      // ["Basics", "Math", "SineWave"]
  const sketchName = parts[parts.length - 1];
  const category = parts.slice(0, -1).join("/");

  // Collect all .pde files; put the file matching the sketch name first
  const pdeFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".pde"))
    .sort((a, b) => {
      if (a.replace(".pde", "") === sketchName) return -1;
      if (b.replace(".pde", "") === sketchName) return 1;
      return a.localeCompare(b);
    });

  const code = pdeFiles
    .map((f) => fs.readFileSync(path.join(dir, f), "utf8"))
    .join("\n\n// ── tab: " + sketchName + " ──\n\n");

  const description = extractDescription(code);
  const tags = tagsFromPath(rel);

  // Slug: "Basics_Math_SineWave"
  const slug = parts.join("_");
  const outFile = path.join(OUT_DIR, slug + ".pde");

  fs.writeFileSync(outFile, code, "utf8");

  catalog.push({
    file: slug + ".pde",
    name: sketchName,
    category,
    description,
    tags,
  });

  process.stdout.write(`  ✓ ${slug}\n`);
}

// ── 6. Write catalog ──────────────────────────────────────────────────────────

fs.writeFileSync(CATALOG_FILE, JSON.stringify(catalog, null, 2), "utf8");
console.log(`\nWrote ${catalog.length} sketches → rag/sketches/`);
console.log(`Wrote catalog → rag/catalog.json`);

// ── 7. Cleanup ────────────────────────────────────────────────────────────────

spawnSync("rm", ["-rf", tmpDir]);
console.log("Done.");
