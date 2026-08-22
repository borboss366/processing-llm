// Independent offline tempo check: energy-envelope autocorrelation on PCM.
// Completely separate implementation from core/audio.js — used to arbitrate
// "estimator bias vs pitched-down source file".
import fs from "node:fs";

const [file, fromSec = "30", durSec = "120"] = process.argv.slice(2);
const buf = fs.readFileSync(file);
// naive WAV parse: find 'data' chunk
let off = 12;
let dataOff = -1, dataLen = 0;
while (off < buf.length - 8) {
  const id = buf.toString("ascii", off, off + 4);
  const len = buf.readUInt32LE(off + 4);
  if (id === "data") { dataOff = off + 8; dataLen = len; break; }
  off += 8 + len + (len % 2);
}
const SR = 44100;
const start = dataOff + Math.floor(Number(fromSec) * SR) * 2;
const n = Math.min(Math.floor(Number(durSec) * SR), (dataOff + dataLen - start) / 2 | 0);

// onset envelope: RMS per 512-sample hop, half-wave-rectified diff
const HOP = 512;
const hops = Math.floor(n / HOP);
const env = new Float64Array(hops);
for (let h = 0; h < hops; h++) {
  let s = 0;
  const base = start + h * HOP * 2;
  for (let i = 0; i < HOP; i++) { const v = buf.readInt16LE(base + i * 2) / 32768; s += v * v; }
  env[h] = Math.sqrt(s / HOP);
}
const onset = new Float64Array(hops);
for (let h = 1; h < hops; h++) onset[h] = Math.max(0, env[h] - env[h - 1]);

const hopSec = HOP / SR;                       // 11.61 ms
const lagMin = Math.round(60 / 180 / hopSec);  // 180 BPM
const lagMax = Math.round(60 / 60 / hopSec);   // 60 BPM
let best = 0, bestC = 0;
const corr = new Float64Array(lagMax + 2);
for (let lag = lagMin; lag <= lagMax; lag++) {
  let c = 0;
  for (let i = 0; i < hops - lag; i++) c += onset[i] * onset[i + lag];
  corr[lag] = c / (hops - lag);
  if (corr[lag] > bestC) { bestC = corr[lag]; best = lag; }
}
// parabolic
let lagF = best;
const c0 = corr[best - 1], c1 = corr[best], c2 = corr[best + 1];
const den = c0 - 2 * c1 + c2;
if (den < 0) lagF = best + Math.max(-1, Math.min(1, 0.5 * (c0 - c2) / den));
const bpm = 60 / (lagF * hopSec);
// report peak and its half/double for octave context
console.log(`offline tempo: ${bpm.toFixed(2)} BPM (lag ${lagF.toFixed(1)} hops) — halves/doubles: ${(bpm / 2).toFixed(1)} / ${(bpm * 2).toFixed(1)}`);
