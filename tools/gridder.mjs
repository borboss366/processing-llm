#!/usr/bin/env node
/**
 * Offline beatgrid computation (brief 13 Task 1.5). NON-causal: decodes the
 * whole file (headless page — WebAudio decode), builds an onset envelope,
 * picks a global tempo by autocorrelation (log-normal prior ~125 like the
 * live PLL), then runs dynamic-programming beat tracking with a full
 * backtrack (the forward+backward pass — no real-time constraint), and
 * writes `music/<file>.beatgrid.json`:
 *
 *   { version, source, bpm, firstBeatMs, downbeatEvery, beats: [ms…],
 *     confidence: { onsetZAtBeats, ibiSpreadPct, tempo } }
 *
 * Confidence report per track goes to stdout. Stubborn tracks:
 *   node tools/gridder.mjs --file <name.mp3> --tap --bpm 174 --first 512
 * writes a constant-bpm sidecar from manual values instead.
 *
 *   node tools/gridder.mjs                # grid every music/*.mp3
 *   node tools/gridder.mjs --file <name>  # one track
 *
 * Needs server (3000) + vite (5173) for the /music route.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertStackRunning, launchBrowser } from "./render-page.mjs";
import { parseArgs } from "./args.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { flags } = parseArgs(process.argv.slice(2));

const files = flags.file
  ? [String(flags.file)]
  : (await fs.readdir(path.join(ROOT, "music"))).filter((f) => /\.(mp3|wav|m4a|ogg)$/i.test(f));

if (flags.tap) {
  const bpm = Number(flags.bpm), first = Number(flags.first ?? 0);
  if (!flags.file || !bpm) { console.error("--tap needs --file, --bpm [, --first ms]"); process.exit(1); }
  const sidecar = {
    version: 1, source: "tap", bpm, firstBeatMs: first, downbeatEvery: 4,
    confidence: { manual: true },
  };
  await fs.writeFile(path.join(ROOT, "music", `${flags.file}.beatgrid.json`), JSON.stringify(sidecar, null, 2));
  console.log(`[gridder] tap grid written for ${flags.file}: ${bpm} bpm, first beat ${first} ms`);
  console.log("VERIFY:PASS gridder mode=tap");
  process.exit(0);
}

await assertStackRunning();
const browser = await launchBrowser();
let failed = 0;

const analyse = () => /* runs in the page */ async (fileUrl, forcedBpm) => {
  console.log("[g] fetching");
  const buf = await (await fetch(fileUrl)).arrayBuffer();
  console.log("[g] decoding", buf.byteLength);
  const actx = new OfflineAudioContext(1, 44100, 44100);
  const audio = await actx.decodeAudioData(buf);
  console.log("[g] decoded", audio.duration);
  const sr = audio.sampleRate;
  // mono mixdown
  const n = audio.length;
  const x = new Float32Array(n);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < n; i++) x[i] += ch[i] / audio.numberOfChannels;
  }
  // low-passed copy (one-pole ~150 Hz) — kick emphasis
  const lp = new Float32Array(n);
  const k = 1 - Math.exp(-2 * Math.PI * 150 / sr);
  let acc = 0;
  for (let i = 0; i < n; i++) { acc += k * (x[i] - acc); lp[i] = acc; }

  // onset envelope: half-wave rectified log-energy flux, hop 512
  const HOP = 512, WIN = 1024;
  const H = Math.floor((n - WIN) / HOP);
  const env = new Float32Array(H);
  let prevE = 0, prevEL = 0;
  for (let i = 0; i < H; i++) {
    let e = 0, eL = 0;
    const o = i * HOP;
    for (let j = 0; j < WIN; j++) { e += x[o + j] * x[o + j]; eL += lp[o + j] * lp[o + j]; }
    const le = Math.log(e + 1e-9), leL = Math.log(eL + 1e-9);
    env[i] = Math.max(0, le - prevE) + Math.max(0, leL - prevEL);
    prevE = le; prevEL = leL;
  }
  // z-normalise, clip negatives
  let m = 0; for (let i = 0; i < H; i++) m += env[i]; m /= H;
  let v = 0; for (let i = 0; i < H; i++) v += (env[i] - m) ** 2; v = Math.sqrt(v / H) + 1e-9;
  const z = new Float32Array(H);
  for (let i = 0; i < H; i++) z[i] = Math.max(0, (env[i] - m) / v);

  console.log("[g] envelope done", H);
  // global tempo: autocorrelation over 60–180 bpm, log-normal prior at 125
  // (or the operator's --bpm constraint for stubborn tracks: keeps the DP
  // phase alignment, skips only the tempo search)
  const hopSec = HOP / sr;
  let bestLag = 0, bestScore = -Infinity;
  if (forcedBpm > 0) bestLag = Math.round(60 / forcedBpm / hopSec);
  else
  for (let bpm = 60; bpm <= 180; bpm += 0.25) {
    const lag = Math.round(60 / bpm / hopSec);
    let c = 0;
    for (let i = lag; i < H; i++) c += z[i] * z[i - lag];
    c /= H - lag;
    const prior = Math.exp(-0.5 * ((Math.log2(bpm / 125)) / 0.6) ** 2);
    const s = c * prior;
    if (s > bestScore) { bestScore = s; bestLag = lag; }
  }
  const tau = bestLag;

  console.log("[g] tempo", 60 / (tau * hopSec));
  // DP beat tracking (Ellis-style): forward scores + full backtrack
  const score = new Float32Array(H).fill(-1e9);
  const from = new Int32Array(H).fill(-1);
  const LAMBDA = 20;   // skip-a-beat must never beat a weak onset (octave pen ~9.6 > typical z)
  for (let i = 0; i < H; i++) {
    score[i] = z[i];
    const j0 = Math.max(0, i - Math.round(tau * 2.2));
    const j1 = i - Math.round(tau * 0.45);
    for (let j = j0; j <= j1; j++) {
      if (j < 0 || score[j] < -1e8) continue;
      const pen = LAMBDA * (Math.log((i - j) / tau)) ** 2;
      const s = score[j] + z[i] - pen;
      if (s > score[i]) { score[i] = s; from[i] = j; }
    }
  }
  let end = H - 1, endBest = -Infinity;
  for (let i = Math.max(0, H - Math.round(tau * 2.2)); i < H; i++) {
    if (score[i] > endBest) { endBest = score[i]; end = i; }
  }
  const beatIdx = [];
  for (let i = end; i >= 0; i = from[i]) { beatIdx.push(i); if (from[i] < 0) break; }
  beatIdx.reverse();
  const raw = beatIdx.map((i) => (i * HOP + WIN / 2) / sr * 1000);

  // smooth the raw DP beats into a GRID: sliding least-squares (±16 beats).
  // DP beats jitter a few hops toward local onsets; the beatgrid is the
  // smooth underlying pulse (real tempo shifts survive — the fit is local).
  const beats = raw.map((t, i) => {
    const a = Math.max(0, i - 16), b = Math.min(raw.length - 1, i + 16);
    let n2 = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let j = a; j <= b; j++) { n2++; sx += j; sy += raw[j]; sxx += j * j; sxy += j * raw[j]; }
    const denom = n2 * sxx - sx * sx || 1;
    const c1 = (n2 * sxy - sx * sy) / denom;
    const c0 = (sy - c1 * sx) / n2;
    return Math.round(c0 + c1 * i);
  });
  let jit = 0;
  for (let i = 0; i < raw.length; i++) jit += (raw[i] - beats[i]) ** 2;
  const rmsJitterMs = Math.round(Math.sqrt(jit / (raw.length || 1)) * 10) / 10;

  // confidence: onset z at beats, inter-beat spread, tempo
  const ibis = [];
  for (let i = 1; i < beats.length; i++) ibis.push(beats[i] - beats[i - 1]);
  const med = ibis.slice().sort((a, b) => a - b)[ibis.length >> 1] || 1;
  const spread = ibis.length
    ? Math.sqrt(ibis.reduce((a, b) => a + (b - med) ** 2, 0) / ibis.length) / med * 100
    : 100;
  let zb = 0; for (const i of beatIdx) zb += z[i]; zb /= beatIdx.length || 1;
  return {
    bpm: Math.round(60000 / med * 10) / 10,
    beats,
    confidence: {
      onsetZAtBeats: Math.round(zb * 100) / 100,
      ibiSpreadPct: Math.round(spread * 100) / 100,
      tempo: Math.round(60 / (tau * hopSec) * 10) / 10,
      rmsJitterMs,
    },
    durationSec: Math.round(n / sr),
  };
};

try {
  for (const f of files) {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error(`[gridder] ${f}:`, String(e).slice(0, 200)));
    page.on("console", (m) => { if (m.text().startsWith("[g]")) console.log(`  ${m.text()}`); });
    await page.goto("http://localhost:5173/bench.html", { waitUntil: "domcontentloaded" });
    console.log(`[gridder] analysing ${f} …`);
    try {
      const r = await page.evaluate(analyse(), `/music/${encodeURIComponent(f)}`, Number(flags.bpm ?? 0));
      const sidecar = {
        version: 1, source: "gridder", bpm: r.bpm,
        firstBeatMs: r.beats[0] ?? 0, downbeatEvery: 4,
        beats: r.beats, confidence: r.confidence,
      };
      await fs.writeFile(path.join(ROOT, "music", `${f}.beatgrid.json`), JSON.stringify(sidecar));
      const c = r.confidence;
      const verdict = c.onsetZAtBeats >= 1 && c.ibiSpreadPct < 4 && c.rmsJitterMs < 30 ? "good" : "CHECK BY EAR (consider --tap)";
      console.log(`[gridder] ${f}: ${r.bpm} bpm · ${r.beats.length} beats over ${r.durationSec}s · onset-z ${c.onsetZAtBeats} · ibi-spread ${c.ibiSpreadPct}% · dp-jitter ${c.rmsJitterMs}ms → ${verdict}`);
    } catch (e) {
      failed++;
      console.error(`[gridder] ${f} FAILED:`, String(e).slice(0, 300));
    }
    await page.close();
  }
} finally {
  await browser.close();
}
console.log(`VERIFY:${failed ? "FAIL" : "PASS"} gridder tracks=${files.length - failed}/${files.length}`);
process.exitCode = failed ? 1 : 0;
