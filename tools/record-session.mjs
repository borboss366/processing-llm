#!/usr/bin/env node
/**
 * Records a real Auto-Director session from file audio (brief 2, Task C.2):
 * opens the render window (file input) + the controller window in headless
 * Chrome, starts Auto-Director, and lets the full live stack run — director
 * picks land in sessions/<id>.jsonl exactly as in a real set. Also samples
 * the beat tracker every 2 s and prints a summary at the end.
 *
 *   node tools/record-session.mjs --file /music/mix.mp3 [--minutes 12] [--seek 0]
 *
 * Needs `npm run server`, `npm run dev`, and Ollama running. Real time.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser, openRenderWithFile, sampleBeatState, BASE_URL } from "./render-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flags = {};
for (let i = 0; i < argv.length; i++) if (argv[i].startsWith("--")) flags[argv[i].slice(2)] = argv[++i];
const file = flags.file;
const minutes = Number(flags.minutes ?? 12);
const seekSec = Number(flags.seek ?? 0);
if (!file) {
  console.error("usage: node tools/record-session.mjs --file /music/mix.mp3 [--minutes 12] [--seek 0]");
  process.exit(1);
}

await assertStackRunning();
// One browser PER window: headless Chrome's compositor produces zero frames
// for a backgrounded tab (rAF fully stops — measured 0 fps, flags don't
// help), which froze the render loop when both pages shared one browser.
const renderBrowser = await launchBrowser();
const controllerBrowser = await launchBrowser();
try {
  const render = await openRenderWithFile(renderBrowser, file, { seekSec });
  console.log(`[record] render window playing ${file} (seek ${seekSec}s)`);

  const controller = await controllerBrowser.newPage();
  await controller.goto(`${BASE_URL}/controller.html`, { waitUntil: "networkidle2", timeout: 30_000 });
  // let the WS connect and render-state flow before starting the director
  await new Promise((r) => setTimeout(r, 3_000));
  await controller.click("#btn-mood");
  console.log(`[record] Auto-Director started — recording for ${minutes} min`);

  // Fail fast if features aren't flowing (e.g. render tab throttled): within
  // 15 s the director must have moved past "no audio samples yet".
  await new Promise((r) => setTimeout(r, 15_000));
  const status = await controller.$eval("#mood-status", (el) => el.textContent).catch(() => "");
  if (/no audio samples/.test(status)) {
    throw new Error(`director sees no audio after 15 s — render-state not flowing (status: "${status}")`);
  }

  const beatLog = [];
  const t0 = Date.now();
  let lastPrint = 0;
  while ((Date.now() - t0) / 60000 < minutes) {
    const s = await sampleBeatState(render);
    beatLog.push(s);
    const elapsed = (Date.now() - t0) / 1000;
    if (elapsed - lastPrint >= 60) {
      lastPrint = elapsed;
      const mood = await controller.$eval("#mood-status", (el) => el.textContent).catch(() => "?");
      console.log(`[record] ${Math.round(elapsed / 60)}min · bpm ${s.bpm.toFixed(1)} conf ${s.conf.toFixed(2)} level ${s.level.toFixed(2)} · ${mood}`);
    }
    if (render.isClosed()) throw new Error("render window died");
    await new Promise((r) => setTimeout(r, 2_000));
  }

  await controller.click("#btn-mood");   // stop → session-stop event
  await new Promise((r) => setTimeout(r, 1_500));

  // newest session file = the one we just recorded
  const dir = path.join(ROOT, "sessions");
  const files = await Promise.all((await fs.readdir(dir)).filter((f) => f.endsWith(".jsonl"))
    .map(async (f) => ({ f, m: (await fs.stat(path.join(dir, f))).mtimeMs })));
  const newest = files.sort((a, b) => b.m - a.m)[0]?.f;

  // beat summary: confidence dips below 0.4 and how long re-acquisition took
  const confs = beatLog.map((s) => s.conf);
  const meanConf = confs.reduce((a, b) => a + b, 0) / confs.length;
  const dips = [];
  let dipStart = null;
  for (let i = 0; i < beatLog.length; i++) {
    if (confs[i] < 0.4 && dipStart === null) dipStart = i;
    if (confs[i] >= 0.4 && dipStart !== null) { dips.push({ at: beatLog[dipStart].t, secs: (i - dipStart) * 2 }); dipStart = null; }
  }
  if (dipStart !== null) dips.push({ at: beatLog[dipStart].t, secs: (beatLog.length - dipStart) * 2 });

  await fs.writeFile(path.join(dir, `${newest?.replace(/\.jsonl$/, "")}-beat.json`),
    JSON.stringify(beatLog), "utf8");
  console.log(`[record] done → sessions/${newest}`);
  console.log(`[record] beat: conf mean ${meanConf.toFixed(2)}, ${dips.length} dip(s) below 0.4: ` +
    (dips.length ? dips.map((d) => `at ${Math.round(d.at)}s for ${d.secs}s`).join(", ") : "none"));
} finally {
  await renderBrowser.close();
  await controllerBrowser.close();
}
