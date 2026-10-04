#!/usr/bin/env node
/**
 * Owner CLI: video in → dancing-creature report, one command (brief 19.2).
 *
 *   npm run move -- <video> [--window A-B] [--name <n>] [capture flags…]
 *
 * capture (extract + stitch + capture explorer) → engine-report on the new
 * table for BOTH bipeds → opens the capture explorer and both engine
 * explorers. Every underlying command is printed by the wrapped tools.
 */
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runShown } from "./lib/run.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const HELP = `npm run move -- <video> [--window A-B] [--name <n>] [--cycles N] [--mirror] [--bpl N] [--estimator rtmpose]`;
if (argv.includes("--help") || !argv.length) { console.log(HELP); process.exit(argv.length ? 0 : 1); }
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const VALUED = new Set(["--window", "--name", "--cycles", "--view", "--estimator", "--bpl"]);
const video = argv.find((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1]));
const name = opt("name", path.basename(video ?? "").replace(/\.[^.]+$/, "").replace(/-h264$/, ""));

await runShown("node", [path.join(ROOT, "tools/capture.mjs"), ...argv, "--no-open"]);

const moveName = `${name}-captured`;
for (const shape of ["biped-1", "biped-2"]) {
  await runShown("node", [path.join(ROOT, "tools/engine-report.mjs"), "--move", moveName, "--shape", shape]);
}

for (const f of [`corpus/${name}.explorer.html`,
                 `reports/engine-${moveName}-biped-1.engine.explorer.html`,
                 `reports/engine-${moveName}-biped-2.engine.explorer.html`]) {
  execFileSync("open", [path.join(ROOT, f)]);
}
console.log(`\n[move] done: ${video} → moves/${moveName}.json → capture + 2 engine explorers open`);
