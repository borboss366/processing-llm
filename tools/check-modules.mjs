#!/usr/bin/env node
/**
 * Module-contract check: import every web/app/loaded-modules/*.js in Node
 * and assert the MODULE_ABI.md basics — a default export whose `id` matches
 * the filename, a `draw` function, a string `oscPrefix`, and only known
 * interface names. Loaded modules must not touch browser APIs at import
 * time (only inside setup/draw), so plain Node import doubles as that check.
 *
 * Prints one line per module and a final VERIFY:PASS/FAIL line.
 */

import { readdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "web/app/loaded-modules");
const KNOWN_IFACES = new Set(["triggerable", "fadeable", "sliding", "movable", "multi-instance"]);

const files = readdirSync(DIR).filter((f) => f.endsWith(".js")).sort();
const fails = [];

for (const f of files) {
  const id = f.replace(/\.js$/, "");
  const problems = [];
  try {
    const ns = await import(pathToFileURL(path.join(DIR, f)).href);
    const m = ns.default;
    if (!m || typeof m !== "object") problems.push("no default export object");
    else {
      if (m.id !== id) problems.push(`id "${m.id}" ≠ filename "${id}"`);
      if (typeof m.draw !== "function") problems.push("draw() missing");
      if (typeof m.oscPrefix !== "string" || !m.oscPrefix) problems.push("oscPrefix missing");
      for (const i of m.interfaces ?? []) {
        if (!KNOWN_IFACES.has(i)) problems.push(`unknown interface "${i}"`);
      }
    }
  } catch (e) {
    problems.push(`import failed: ${e.message}`);
  }
  console.log(`${problems.length ? "FAIL" : "ok  "} ${id}${problems.length ? " — " + problems.join("; ") : ""}`);
  if (problems.length) fails.push(id);
}

console.log(fails.length
  ? `VERIFY:FAIL module-load reason=${fails.join(",")}`
  : `VERIFY:PASS module-load modules=${files.length}`);
process.exit(fails.length ? 1 : 0);
