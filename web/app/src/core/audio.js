/**
 * Audio context + analyser + feature extraction.
 *
 * Per-frame `tick()` computes a rich feature snapshot the controller can use
 * for mood classification:
 *
 *   Energy bands (8, log-spaced, amplitude-normalised 0..1):
 *     sub  kick  low  lowMid  mid  upperMid  presence  air
 *
 *   Spectral shape:
 *     centroid  — amplitude-weighted mean bin index (timbre brightness)
 *     rolloff   — bin at 85% cumulative energy, normalised 0..1
 *     flatness  — geometric÷arithmetic mean of magnitudes (tonal vs noise)
 *     crest     — peak ÷ RMS of magnitudes (punchy vs sustained)
 *     flux      — sum of positive frame-to-frame magnitude change
 *
 *   Time/tempo:
 *     onBeat / beatsPerSec — rising-edge detector on bass against slow baseline
 *     bpm — autocorrelation on a 4-second onset-strength buffer (60-180 BPM range)
 *
 * Plus the legacy aggregates kept for the existing classifier:
 *     smoothedLevel / smoothedBass / smoothedMid / smoothedTreble
 *
 * All "smoothed*" fields are exponential moving averages with ~1 s time constant.
 */

export function createAudio() {
  let audioCtx = null;
  let analyser = null;
  let mediaSource = null;
  let currentStream = null;

  const fftSize = 1024;
  const BIN_COUNT = fftSize / 2;     // 512
  const USABLE_BINS = 340;           // ~16 kHz at 48 kHz sample rate
  const freqBins = new Float32Array(BIN_COUNT);

  // Per-bin previous magnitude buffer for spectral flux.
  const prevMag = new Float32Array(USABLE_BINS);

  // Onset-strength ring buffer for BPM autocorrelation.
  // 240 samples at ~60 Hz = ~4 seconds, covers down to 15 BPM.
  const ONSET_BUF_LEN = 240;
  const onsetBuf = new Float32Array(ONSET_BUF_LEN);
  let onsetIdx = 0;
  let prevTotalEnergy = 0;
  let bpmTickCounter = 0;          // throttle autocorrelation to every 10 frames

  // Narrow energy band ranges (bin start, bin end-exclusive).
  // Bin width ≈ 46.875 Hz at sr=48 kHz / fftSize=1024.
  const BAND_RANGES = {
    sub:      [0,   2],     // 0-94 Hz
    kick:     [2,   5],     // 94-235 Hz
    low:      [5,  10],     // 235-470 Hz
    lowMid:   [10, 25],     // 470 Hz - 1.2 kHz
    mid:      [25, 50],     // 1.2 - 2.3 kHz
    upperMid: [50, 100],    // 2.3 - 4.7 kHz
    presence: [100, 200],   // 4.7 - 9.4 kHz
    air:      [200, 340],   // 9.4 - 16 kHz
  };

  const state = {
    // legacy aggregates (kept for the existing rule classifier)
    smoothedLevel:    0,
    smoothedBass:     0,
    smoothedMid:      0,
    smoothedTreble:   0,
    smoothedCentroid: 0,

    // new wide feature set
    bands:    { sub: 0, kick: 0, low: 0, lowMid: 0, mid: 0, upperMid: 0, presence: 0, air: 0 },
    rolloff:  0,
    flatness: 0,
    crest:    0,
    flux:     0,
    bpm:      0,

    // beat detector
    bassAvg:     0,
    beatsPerSec: 0,
    onBeat:      false,
    prevBass:    0,
  };
  const beatTimes = [];

  async function start({ deviceId } = {}) {
    const constraints = {
      audio: {
        echoCancellation:  false,
        noiseSuppression:  false,
        autoGainControl:   false,
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      },
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    mediaSource = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0.7;
    mediaSource.connect(analyser);

    return { audioCtx, mediaSource };
  }

  async function switchDevice(deviceId) {
    if (!audioCtx) return null;
    if (currentStream) currentStream.getTracks().forEach((t) => t.stop());
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: { exact: deviceId },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl:  false,
      },
    });
    currentStream = stream;
    const newSource = audioCtx.createMediaStreamSource(stream);
    try { mediaSource.disconnect(); } catch {}
    mediaSource = newSource;
    mediaSource.connect(analyser);
    return mediaSource;
  }

  async function listDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'audioinput');
  }

  // Convert raw freqBins[i] (dB, range ~-100..0) into amp ∈ [0,1].
  // Add 80 dB and scale so -80 dB → 0, 0 dB → 1.
  function amp(i) { return Math.max(0, (freqBins[i] + 80) / 80); }

  function bpmEstimate() {
    // Autocorrelation on the onset-strength buffer at lags corresponding to
    // 60..180 BPM (lag = 60fps × 60s ÷ bpm → 60..20 frames).
    let bestLag = 0, bestCorr = 0;
    const N = ONSET_BUF_LEN;
    for (let lag = 20; lag <= 60; lag++) {
      let c = 0;
      const limit = N - lag;
      for (let i = 0; i < limit; i++) {
        const a = onsetBuf[(onsetIdx + i)         % N];
        const b = onsetBuf[(onsetIdx + i + lag)   % N];
        c += a * b;
      }
      if (c > bestCorr) { bestCorr = c; bestLag = lag; }
    }
    return bestLag > 0 ? 3600 / bestLag : 0;     // 3600 = 60fps × 60s
  }

  function tick() {
    if (!analyser) return state;
    analyser.getFloatFrequencyData(freqBins);

    // ── legacy aggregates ─────────────────────────────────────────────
    let sum = 0, n = 0;
    for (let i = 4; i < 64; i++) { sum += amp(i); n++; }
    const level = Math.max(0, Math.min(1, sum / n));
    state.smoothedLevel = state.smoothedLevel * 0.85 + level * 0.15;

    let bSum = 0, mSum = 0, tSum = 0;
    for (let i = 0;  i < 4;   i++) bSum += amp(i);
    for (let i = 4;  i < 42;  i++) mSum += amp(i);
    for (let i = 42; i < 170; i++) tSum += amp(i);
    const bass   = Math.min(1, bSum / 4);
    const mid    = Math.min(1, mSum / 38);
    const treble = Math.min(1, tSum / 128);
    state.smoothedBass   = state.smoothedBass   * 0.88 + bass   * 0.12;
    state.smoothedMid    = state.smoothedMid    * 0.88 + mid    * 0.12;
    state.smoothedTreble = state.smoothedTreble * 0.88 + treble * 0.12;

    // ── 8 narrow energy bands ─────────────────────────────────────────
    for (const name of Object.keys(BAND_RANGES)) {
      const [lo, hi] = BAND_RANGES[name];
      let s = 0;
      for (let i = lo; i < hi; i++) s += amp(i);
      const v = Math.min(1, s / (hi - lo));
      state.bands[name] = state.bands[name] * 0.85 + v * 0.15;
    }

    // ── spectral shape (single pass over usable bins) ────────────────
    let cTotal = 0, totalAmp = 0, maxMag = 0;
    let logSum = 0, fluxSum = 0;
    for (let i = 1; i < USABLE_BINS; i++) {
      const a = amp(i);
      cTotal   += i * a;
      totalAmp += a;
      if (a > maxMag) maxMag = a;
      logSum   += Math.log(a + 0.0001);     // floor to avoid log(0)
      const d = a - prevMag[i];
      if (d > 0) fluxSum += d;
      prevMag[i] = a;
    }
    const meanAmp = totalAmp / (USABLE_BINS - 1);

    const centroid = totalAmp > 0 ? Math.min(1, cTotal / totalAmp / USABLE_BINS) : 0;
    state.smoothedCentroid = state.smoothedCentroid * 0.85 + centroid * 0.15;

    // rolloff: bin where cumulative energy >= 85% of total
    let cum = 0;
    let rolloffBin = USABLE_BINS - 1;
    const target = 0.85 * totalAmp;
    for (let i = 1; i < USABLE_BINS; i++) {
      cum += amp(i);
      if (cum >= target) { rolloffBin = i; break; }
    }
    state.rolloff = state.rolloff * 0.85 + (rolloffBin / USABLE_BINS) * 0.15;

    // flatness — geometric mean / arithmetic mean. 0 = tonal, 1 = white noise.
    const geoMean = Math.exp(logSum / (USABLE_BINS - 1));
    state.flatness = state.flatness * 0.85 + (meanAmp > 0 ? geoMean / meanAmp : 0) * 0.15;

    // crest factor — peak/mean. High = transient/punchy. Low = compressed/sustained.
    state.crest = state.crest * 0.85 + (meanAmp > 0 ? maxMag / meanAmp : 0) * 0.15;

    // flux — total magnitude going UP across bins this frame. Normalise per bin.
    state.flux = state.flux * 0.85 + (fluxSum / (USABLE_BINS - 1)) * 0.15;

    // ── onset strength + BPM ──────────────────────────────────────────
    const onsetStrength = Math.max(0, totalAmp - prevTotalEnergy);
    prevTotalEnergy = totalAmp;
    onsetBuf[onsetIdx] = onsetStrength;
    onsetIdx = (onsetIdx + 1) % ONSET_BUF_LEN;
    bpmTickCounter++;
    if (bpmTickCounter >= 10) {            // every ~6 Hz instead of 60 Hz
      bpmTickCounter = 0;
      const detected = bpmEstimate();
      // heavy smoothing — BPM doesn't change fast
      state.bpm = state.bpm * 0.7 + detected * 0.3;
    }

    // ── beat detector (kept for live UI + beatsPerSec) ───────────────
    state.bassAvg = state.bassAvg * 0.99 + state.smoothedBass * 0.01;
    const wasBeat = state.onBeat;
    state.onBeat =
      state.smoothedBass > Math.max(0.05, state.bassAvg * 1.30) &&
      state.smoothedBass > state.prevBass * 1.02;
    state.prevBass = state.smoothedBass;
    if (state.onBeat && !wasBeat) {
      const now = performance.now();
      beatTimes.push(now);
      while (beatTimes.length && now - beatTimes[0] > 3000) beatTimes.shift();
      state.beatsPerSec = beatTimes.length / 3;
    } else if (beatTimes.length) {
      const now = performance.now();
      while (beatTimes.length && now - beatTimes[0] > 3000) beatTimes.shift();
      state.beatsPerSec = beatTimes.length / 3;
    }

    return state;
  }

  return {
    start,
    switchDevice,
    listDevices,
    tick,
    state,
    freqBins,
    get audioCtx()     { return audioCtx;     },
    get mediaSource()  { return mediaSource;  },
    get analyser()     { return analyser;     },
    get fftSize()      { return fftSize;      },
  };
}
