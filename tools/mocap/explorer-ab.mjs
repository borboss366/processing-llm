#!/usr/bin/env node
/**
 * A/B estimator explorer (brief 18.1 T3): combine two explorer-data dumps of
 * the SAME clip/window (extract.mjs --explorer-json, one run per estimator)
 * into one page with a per-stage A/B/overlay toggle and a summary card.
 *
 *   node tools/mocap/explorer-ab.mjs <A.explorer-data.json> <B.explorer-data.json> <out.html>
 */
import fs from "node:fs";
import { renderExplorer } from "./lib/explorer.mjs";

const [a, b, out] = process.argv.slice(2);
if (!a || !b || !out) {
  console.error("usage: node tools/mocap/explorer-ab.mjs <A.explorer-data.json> <B.explorer-data.json> <out.html>");
  process.exit(1);
}
const DA = JSON.parse(fs.readFileSync(a, "utf8"));
const DB = JSON.parse(fs.readFileSync(b, "utf8"));
if (DA.meta.clip !== DB.meta.clip || DA.meta.window.join() !== DB.meta.window.join()) {
  console.error(`refusing: different clips/windows (${DA.meta.clip} ${DA.meta.window} vs ${DB.meta.clip} ${DB.meta.window})`);
  process.exit(1);
}
fs.writeFileSync(out, renderExplorer(DA, DB));
console.log(`[explorer-ab] wrote ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB) — A=${DA.meta.params.estimator} B=${DB.meta.params.estimator}`);
