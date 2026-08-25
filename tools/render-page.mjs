/**
 * Shared puppeteer setup for the real-audio harnesses (beat-test-real.mjs,
 * record-session.mjs): launches headless Chrome with the WebGL + autoplay
 * flags proven out by web/app/scripts/visual-bootstrap.mjs, opens the render
 * window with file audio, clicks Start, and waits until audio is flowing.
 *
 * Requires the controller server (:3000) and Vite (:5173) to be running.
 */

import { createRequire } from "node:module";

// puppeteer-core lives in web/app's node_modules
const require = createRequire(new URL("../web/app/package.json", import.meta.url));
const puppeteer = require("puppeteer-core");

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const BASE_URL = process.env.BASE_URL || "http://localhost:5173";

export async function assertStackRunning() {
  for (const [name, url] of [["controller server", "http://localhost:3000/browser-modules"], ["vite", BASE_URL]]) {
    try { await fetch(url); }
    catch { throw new Error(`${name} not reachable at ${url} — start it first (npm run server / npm run dev)`); }
  }
}

export async function launchBrowser() {
  return puppeteer.launch({
    executablePath: CHROME,
    headless: true,     // old headless: still gets a GL context via swiftshader
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--autoplay-policy=no-user-gesture-required",
      "--no-sandbox",
      "--mute-audio",   // analyser still gets samples; the box stays silent
      // Two tabs (render + controller): without these, Chrome throttles rAF
      // and timers in whichever page is backgrounded, silently freezing the
      // render loop — no ticks, no render-state, an empty session.
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
    ],
  });
}

/** Open the render window playing `filePath` (a /music/... server path),
 *  click Start, wait until the file is actually playing. */
export async function openRenderWithFile(browser, filePath, { seekSec = 0, extra = "" } = {}) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const url = `${BASE_URL}/?audio=${encodeURIComponent(`file:${filePath}`)}` +
              (seekSec ? `&seek=${seekSec}` : "") + (extra ? `&${extra}` : "");
  await page.goto(url, { waitUntil: "networkidle2", timeout: 30_000 });
  await page.click("#btn-start");
  await page.waitForFunction(
    () => window.__audio?.fileElement && !window.__audio.fileElement.paused &&
          window.__audio.fileElement.currentTime > 0,
    { timeout: 20_000 },
  );
  return page;
}

/** Sample the render window's audio.state. */
export function sampleBeatState(page) {
  return page.evaluate(() => {
    const s = window.__audio.state;
    return {
      t: window.__audio.fileElement?.currentTime ?? 0,
      bpm: s.bpm, conf: s.beatConfidence, phase: s.beatPhase,
      lastConfidentBpm: s.lastConfidentBpm, level: s.smoothedLevel,
    };
  });
}
