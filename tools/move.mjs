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
import fs from "node:fs";
import { runShown } from "./lib/run.mjs";
import { resolveMove } from "./lib/move-resolve.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const HELP = `npm run move -- <video> [--window A-B] [--name <n>] [--cycles N] [--mirror] [--bpl N]
                 [--estimator rtmpose] [--shape <override>] [--no-capture] [--self-test]
  --no-capture  reuse the existing tables (re-run only the engine reports)`;
if (argv.includes("--help") || !argv.length) { console.log(HELP); process.exit(argv.length ? 0 : 1); }

if (argv.includes("--self-test")) {
  const cases = [
    ["front clip (basic_kick_1)", "front",
      [{ name: "k-captured", view: "profile", reinterpreted: "from-front" }, { name: "k-captured-front", view: "front" }],
      null, "k-captured-front", ["biped-1", "biped-2"]],
    ["profile clip (runningman)", "profile",
      [{ name: "r-captured", view: "profile" }, { name: "r-captured-front", view: "front", reinterpreted: "from-profile" }],
      null, "r-captured", ["biped-profile"]],
    ["front clip, no MOTION_SOURCES view", null,
      [{ name: "k-captured", view: "profile", reinterpreted: "from-front" }, { name: "k-captured-front", view: "front" }],
      null, "k-captured-front", ["biped-1", "biped-2"]],
    ["--shape override", "front",
      [{ name: "k-captured-front", view: "front" }], "biped-2", "k-captured-front", ["biped-2"]],
  ];
  let fails = 0;
  for (const [label, sv, tables, ov, wantT, wantS] of cases) {
    const r = resolveMove(sv, tables, ov);
    const ok = r.table === wantT && JSON.stringify(r.shapes) === JSON.stringify(wantS);
    if (!ok) fails++;
    console.log(`[move self-test] ${ok ? "ok  " : "FAIL"} ${label}: ${r.table} on ${r.shapes.join("+")}`);
  }
  console.log(`VERIFY:${fails ? "FAIL" : "PASS"} move-resolve`);
  process.exit(fails ? 1 : 0);
}
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const VALUED = new Set(["--window", "--name", "--cycles", "--view", "--estimator", "--bpl", "--shape"]);
const video = argv.find((a, i) => !a.startsWith("--") && !VALUED.has(argv[i - 1]));
const name = opt("name", path.basename(video ?? "").replace(/\.[^.]+$/, "").replace(/-h264$/, ""));

// preflight BEFORE the multi-minute capture: the engine reports need the
// live stack, and finding that out after capture wastes the whole run
for (const [what, url, start] of [["controller server", "http://localhost:3000/status", "npm run server"],
                                  ["vite", "http://localhost:5173/", "cd web/app && npm run dev"]]) {
  try { await fetch(url); }
  catch {
    console.error(`✗ ${what} is not running (${url}) — the engine-report step needs it.`);
    console.error(`  start it in another terminal:  ${start}   then rerun this command`);
    console.error(`  (or run just the capture half:  npm run capture -- ${argv.join(" ")})`);
    process.exit(1);
  }
}

if (!argv.includes("--no-capture")) {
  const passthrough = argv.filter((a, i) => a !== "--shape" && argv[i - 1] !== "--shape");
  await runShown("node", [path.join(ROOT, "tools/capture.mjs"), ...passthrough, "--no-open"]);
}

// ── resolve which table + which shapes (printed — the shortcut hides nothing)
const ms = fs.readFileSync(path.join(ROOT, "docs/MOTION_SOURCES.md"), "utf8")
  .split("\n").find((l) => l.includes(path.basename(video)) || l.includes(name));
const sourceView = (ms && /view:\s*(front|profile)/.exec(ms)?.[1]) ?? null;
const tables = [`${name}-captured`, `${name}-captured-front`].flatMap((t) => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(ROOT, `web/app/moves/${t}.json`), "utf8"));
    return [{ name: t, view: j.view ?? "front", reinterpreted: j.reinterpreted ?? null }];
  } catch { return []; }
});
const r = resolveMove(sourceView, tables, opt("shape", null));
console.log("\n──── move resolved ───────────────────────────────────────────");
console.log(`  MOTION_SOURCES view : ${sourceView ?? "(none on the clip's line)"}`);
for (const t of tables) console.log(`  table ${t.name.padEnd(28)} view: ${t.view}${t.reinterpreted ? `  (reinterpreted ${t.reinterpreted})` : "  (natural)"}`);
console.log(`  engine-report       : ${r.table} on ${r.shapes.join(" + ")}`);
console.log(`  why                 : ${r.why}`);
console.log("──────────────────────────────────────────────────────────────");

for (const shape of r.shapes) {
  await runShown("node", [path.join(ROOT, "tools/engine-report.mjs"), "--move", r.table, "--shape", shape]);
}

for (const f of [`corpus/${name}.explorer.html`,
                 ...r.shapes.map((s) => `reports/engine-${r.table}-${s}.engine.explorer.html`)]) {
  execFileSync("open", [path.join(ROOT, f)]);
}
console.log(`\n[move] done: ${video} → moves/${r.table}.json → capture + ${r.shapes.length} engine explorer(s) open`);
