#!/usr/bin/env node
/**
 * Music-pause soak (brief 13 Task 2): plays the techno mix headless for
 * --minutes (default 30) and collects the permanent audio-health
 * instrumentation (element stalls/waiting, AudioContext state changes,
 * main-thread long tasks, wall-vs-media skips, visibility flips).
 *
 * Acceptance: zero gap-class events (media-skip / element-stalled /
 * element-waiting) over the soak. Other events are reported as context.
 *
 *   node tools/pause-soak.mjs [--minutes 30] [--gaps]
 *
 * --gaps: inject a 3–6 s main-thread busy-loop every ~90 s (occlusion-style
 * rAF gaps, brief 13.1) — playback must still show zero gap-class events.
 */
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";
import { parseArgs } from "./args.mjs";

const { flags } = parseArgs(process.argv.slice(2));
const minutes = Number(flags.minutes ?? 30);
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";

await assertStackRunning();
const browser = await launchBrowser();
const failures = [];
try {
  const page = await openRenderWithFile(browser, MIX, { seekSec: 0 });
  const t0 = Date.now();
  const seen = new Map();
  let lastMedia = 0;
  let lastGap = Date.now();
  let gapsInjected = 0;
  while (Date.now() - t0 < minutes * 60_000) {
    await new Promise((r) => setTimeout(r, 5000));
    if (flags.gaps && Date.now() - lastGap > 90_000) {
      lastGap = Date.now();
      gapsInjected++;
      const ms = 3000 + Math.floor(Math.random() * 3000);
      console.log(`[soak] injecting ${ms} ms occlusion gap (#${gapsInjected})`);
      await page.evaluate((m) => { const t = performance.now(); while (performance.now() - t < m) {} }, ms);
    }
    const st = await page.evaluate(() => ({
      health: window.__audio?.state?.audioHealth ?? [],
      media: window.__audio?.state?.mediaMs ?? 0,
    })).catch(() => null);
    if (!st) { failures.push("page died mid-soak"); break; }
    for (const h of st.health) {
      const key = `${h.t}:${h.kind}`;
      if (!seen.has(key)) {
        // startup events (first 3 s) are load mechanics, not playback gaps:
        // element-waiting fires before play begins, suspend = buffer full
        seen.set(key, { ...h, startup: h.t - t0 < 3000 });
        console.log(`[soak] +${((h.t - t0) / 60000).toFixed(1)}min ${h.kind} ${h.detail ?? ""}${h.t - t0 < 3000 ? " (startup)" : ""}`);
      }
    }
    if (st.media === lastMedia && st.media > 0) failures.push(`media frozen at ${Math.round(st.media / 1000)}s`);
    lastMedia = st.media;
  }
  const kinds = {};
  for (const h of seen.values()) kinds[h.kind] = (kinds[h.kind] ?? 0) + 1;
  console.log(`[soak] ${minutes} min complete · gapsInjected=${gapsInjected} · events: ${JSON.stringify(kinds)}`);
  const gaps = [...seen.values()].filter((h) => !h.startup &&
    ["media-skip", "element-stalled", "element-waiting"].includes(h.kind)).length;
  if (gaps > 0) failures.push(`${gaps} gap-class events`);
} catch (e) {
  failures.push(String(e));
} finally {
  await browser.close();
}
for (const f of failures) console.error(`[soak] FAIL: ${f}`);
console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} pause-soak minutes=${minutes}`);
process.exitCode = failures.length ? 1 : 0;
