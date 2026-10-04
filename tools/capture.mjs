#!/usr/bin/env node
/**
 * Owner CLI: video → stage tables + explorer, one command (brief 19.2).
 *
 *   npm run capture -- <video> --window 15.749-18.452 [--name runningman]
 *                     [--cycles 4] [--mirror] [--view auto|front|profile]
 *                     [--estimator rtmpose|mediapipe] [--bpl 2] [--no-open]
 *
 * No --window? The clip is looked up in docs/MOTION_SOURCES.md (its
 * `loop: A–B` entry). Runs extract (profile+front emission by default) and
 * stitches moves/<name>-captured.json (+ -front variant), prints the stage
 * summary, opens the capture explorer. Prints every underlying command.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runShown, grep } from "./lib/run.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const HELP = `npm run capture -- <video> [--window A-B] [--name <n>] [--cycles N]
                 [--mirror] [--view auto|front|profile] [--estimator rtmpose]
                 [--bpl N] [--no-open]
  --window omitted → looked up in docs/MOTION_SOURCES.md (loop: A–B on the clip's line)
  outputs: corpus/<name>.{move,poses,explorer-data}.json + .explorer.html + .qa.mp4
           web/app/moves/<name>-captured.json (+ -front twist variant)`;
if (argv.includes("--help") || !argv.length) { console.log(HELP); process.exit(argv.length ? 0 : 1); }

const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes(`--${n}`);
const VALUED = new Set(["--window", "--name", "--cycles", "--view", "--estimator", "--bpl"]);
const video = argv.find((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1]));
if (!video || !fs.existsSync(video)) { console.error(`video not found: ${video}\n${HELP}`); process.exit(1); }

const name = opt("name", path.basename(video).replace(/\.[^.]+$/, "").replace(/-h264$/, ""));
let window = opt("window", null);
if (!window) {
  // MOTION_SOURCES lookup: the line mentioning this clip, `loop: A–B`
  const ms = fs.readFileSync(path.join(ROOT, "docs/MOTION_SOURCES.md"), "utf8");
  const line = ms.split("\n").find((l) => l.includes(path.basename(video)) || l.includes(name));
  const m = line && /loop:\s*([\d:.]+)\s*[–-]\s*([\d:.]+)/.exec(line);
  const toSec = (s) => s.split(":").reduce((a, p2) => a * 60 + +p2, 0);
  if (m) {
    window = `${toSec(m[1])}-${toSec(m[2])}`;
    console.log(`[capture] window from MOTION_SOURCES.md: ${window}  (${line.trim().slice(0, 90)}…)`);
    if (/mirror:\s*yes/.test(line) && !flag("mirror")) {
      argv.push("--mirror");
      console.log("[capture] mirror: yes from MOTION_SOURCES.md");
    }
  } else if (line && /loopL|loopR/.test(line)) {
    console.error(`[capture] ${name} has loopL/loopR halves in MOTION_SOURCES.md — pass --window explicitly for the half you want`);
    process.exit(1);
  } else {
    console.error(`[capture] no --window and no MOTION_SOURCES.md loop entry for ${name}`);
    process.exit(1);
  }
}

const view = opt("view", "auto");
const extractArgs = [path.join(ROOT, "tools/mocap/extract.mjs"), video,
  "--loop-window", window, "--name", `${name}-captured`, "--out", `corpus/${name}`,
  "--estimator", opt("estimator", "rtmpose"), "--explorer-json"];
if (view === "auto") extractArgs.push("--emit-views", "profile,front");
else extractArgs.push("--view", view);
if (flag("mirror")) extractArgs.push("--mirror");
if (opt("cycles", null)) extractArgs.push("--cycles", opt("cycles"));
if (opt("bpl", null)) extractArgs.push("--bpl", opt("bpl"));

const out = await runShown("node", extractArgs);

const stitched = [];
for (const [src, dst] of [[`corpus/${name}.move.json`, `web/app/moves/${name}-captured.json`],
                          [`corpus/${name}-front.move.json`, `web/app/moves/${name}-captured-front.json`]]) {
  if (!fs.existsSync(path.join(ROOT, src))) continue;
  await runShown("node", [path.join(ROOT, "tools/mocap/stitch.mjs"), src,
    "--name", path.basename(dst, ".json"), "--out", dst]);
  stitched.push(dst);
}

console.log("\n──── capture summary ─────────────────────────────────────────");
const seen = new Set();   // both emitted views log the same analysis — print once
for (const re of [/cycles: \d+ →/, /DOUBLED/, /R1 table-vs-raw/, /clamp check|CLAMP SMELL/, /habitual−rigRest/, /foot gate/]) {
  for (const l of grep(out, re)) {
    const t = l.replace("[mocap] ", "");
    if (!seen.has(t)) { seen.add(t); console.log("  " + t); }
  }
}
console.log(`  tables: ${stitched.join(", ") || "none"}`);
console.log(`  explorer: corpus/${name}.explorer.html`);
console.log("──────────────────────────────────────────────────────────────");
if (!flag("no-open")) execFileSync("open", [path.join(ROOT, `corpus/${name}.explorer.html`)]);
