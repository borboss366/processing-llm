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
 *     bpm — autocorrelation on ~4 s of onset strength (60-180 BPM range),
 *           using the MEASURED tick interval (works at any refresh rate)
 *     beatPhase      — 0..1 continuous phase, 0 = beat (phase-locked loop:
 *                      advances at the estimated BPM, nudged toward 0 by
 *                      onsets that land near a beat boundary)
 *     barPhase       — 0..1 over 4 beats (anchored to first acquisition,
 *                      NOT to the musical downbeat)
 *     beatConfidence — EMA of how close onsets land to phase 0
 *     lastConfidentBpm — bpm last seen while confidence ≥ 0.4; modules
 *                      free-run on this when confidence drops
 *
 * Plus the legacy aggregates kept for the existing classifier:
 *     smoothedLevel / smoothedBass / smoothedMid / smoothedTreble
 *
 * All "smoothed*" fields are exponential moving averages with ~1 s time constant.
 */

export function createAudio({ phaseNudgeGain = 0.15, phaseNudgeWindow = 0.25 } = {}) {
  let audioCtx = null;
  let analyser = null;
  let mediaSource = null;
  let currentStream = null;
  let fileElement = null;    // set when startFromFile() drives the graph

  const fftSize = 1024;
  const BIN_COUNT = fftSize / 2;     // 512
  const USABLE_BINS = 340;           // ~16 kHz at 48 kHz sample rate
  const freqBins = new Float32Array(BIN_COUNT);

  // Per-bin previous magnitude buffer for spectral flux.
  const prevMag = new Float32Array(USABLE_BINS);

  // Onset-strength ring buffer for BPM autocorrelation. Sized for ~4 s even
  // at 240 Hz ticks; bpmEstimate() reads a window of round(4000 / measured
  // interval) samples, so the buffer *duration* is ~4 s at any refresh rate.
  const MAX_ONSET_BUF = 1024;
  const onsetBuf = new Float32Array(MAX_ONSET_BUF);
  const corrBuf  = new Float32Array(MAX_ONSET_BUF);
  let onsetIdx = 0;
  let onsetCount = 0;
  let bpmTickCounter = 0;          // throttle autocorrelation to every 10 frames

  const MIN_BPM = 60, MAX_BPM = 180;

  // Measured tick cadence — EMA of tick-to-tick deltas. The old code baked
  // 60 fps into lag→BPM (3600/lag), which read 2× wrong on 120 Hz displays.
  let lastTickMs = 0;
  let tickIntervalMs = 1000 / 60;

  // Onset events: adaptive threshold over the weighted flux + refractory.
  let onsetMean = 0, onsetVar = 0, lastOnsetMs = -1e9;
  const onsetTimes = [];           // recent onset timestamps (~8 s, for BPM refine)

  // Beat-phase PLL: which beat of the bar we're on (0..3).
  let beatCounter = 0;

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

    // beat-phase PLL
    beatPhase:      0,   // 0..1, 0 = beat boundary
    barPhase:       0,   // 0..1 over 4 beats
    beatConfidence: 0,   // 0..1, EMA of onset-to-phase-0 closeness
    lastConfidentBpm: 0, // bpm last seen while confidence ≥ 0.4 (module fallback)

    // beat detector
    bassAvg:     0,
    beatsPerSec: 0,
    onBeat:      false,
    prevBass:    0,
  };
  const beatTimes = [];

  /** File-based input for reproducible validation: same analyser graph as
   *  start(), fed by an <audio> element instead of the mic, also routed to
   *  the speakers. Used via the render window's ?audio=file:<url> param. */
  async function startFromFile(url, { seekSec = 0 } = {}) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const el = new Audio();
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.src = url;
    mediaSource = audioCtx.createMediaElementSource(el);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = fftSize;
    analyser.smoothingTimeConstant = 0.7;
    mediaSource.connect(analyser);
    mediaSource.connect(audioCtx.destination);   // audible
    fileElement = el;
    await el.play();
    if (seekSec > 0) el.currentTime = seekSec;
    return { audioCtx, mediaSource, element: el };
  }

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
    // Autocorrelation over the last ~4 s of onset strength. Window size and
    // lag→BPM both come from the measured tick interval, not an assumed 60 fps.
    const dt = tickIntervalMs;
    const n = Math.min(onsetCount, MAX_ONSET_BUF, Math.round(4000 / dt));
    const lagMin = Math.max(2, Math.round(60000 / (MAX_BPM * dt)));
    const lagMax = Math.min(n - 2, Math.round(60000 / (MIN_BPM * dt)));
    if (lagMax <= lagMin + 2) return 0;

    const start = (onsetIdx - n + 2 * MAX_ONSET_BUF) % MAX_ONSET_BUF;
    const x = (i) => onsetBuf[(start + i) % MAX_ONSET_BUF];

    // Octave disambiguation, two layers (a periodic kick correlates equally
    // at T, 2T, 3T…, so raw argmax is a coin flip between tempo octaves —
    // measured 62.5 BPM on a ~125 BPM techno mix):
    //  1. a mild log-normal tempo prior centred ~120 BPM weights the score —
    //     DJ-set content lives there, and it breaks exact harmonic ties;
    //  2. if the double-tempo lag also correlates strongly (≥ 0.7×), it is
    //     the fundamental — covers the high-BPM corner (e.g. 174 vs 87)
    //     where the prior alone slightly favours the subharmonic.
    const priorFor = (lag) => {
      const oct = Math.log2(60000 / (lag * dt) / 120);
      return Math.exp(-0.5 * (oct / 0.7) ** 2);
    };
    let bestLag = 0, bestScore = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let c = 0;
      const limit = n - lag;
      for (let i = 0; i < limit; i++) c += x(i) * x(i + lag);
      corrBuf[lag] = c / limit;              // normalise: long lags sum fewer terms
      const score = corrBuf[lag] * priorFor(lag);
      if (score > bestScore) { bestScore = score; bestLag = lag; }
    }
    if (!bestLag || bestScore <= 0) return 0;
    const half = Math.round(bestLag / 2);
    if (half >= lagMin && corrBuf[half] >= 0.7 * corrBuf[bestLag]) bestLag = half;

    // Parabolic interpolation around the peak — integer lags quantise BPM
    // (±4 BPM steps around 120 at 60 Hz); fractional lag gets inside ±2.
    let lagFrac = bestLag;
    if (bestLag > lagMin && bestLag < lagMax) {
      const c0 = corrBuf[bestLag - 1], c1 = corrBuf[bestLag], c2 = corrBuf[bestLag + 1];
      const denom = c0 - 2 * c1 + c2;
      if (denom < 0) {
        const delta = 0.5 * (c0 - c2) / denom;
        if (Math.abs(delta) <= 1) lagFrac = bestLag + delta;
      }
    }
    return 60000 / refinePeriod(lagFrac * dt);
  }

  // Refine the coarse autocorrelation period against actual onset event
  // times: span between oldest and newest onset ÷ integer beat count. An
  // ~8 s baseline divides the per-onset frame-quantisation error by the
  // number of beats spanned, which interpolation alone can't reach.
  // Rejected (falls back to coarse) when the span doesn't phase-align,
  // e.g. because the oldest onset was an off-beat hit.
  function refinePeriod(coarseMs) {
    if (onsetTimes.length < 3) return coarseMs;
    const span = onsetTimes[onsetTimes.length - 1] - onsetTimes[0];
    const k = Math.round(span / coarseMs);
    if (k < 2) return coarseMs;
    const refined = span / k;
    return Math.abs(refined - coarseMs) < coarseMs * 0.06 ? refined : coarseMs;
  }

  // `nowMs` is injectable so tools/beat-test.mjs can drive a synthetic clock.
  function tick(nowMs = performance.now()) {
    if (!analyser) return state;
    analyser.getFloatFrequencyData(freqBins);

    // Measured tick cadence. Ignore huge gaps (tab switch) and micro-deltas.
    let dtMs = tickIntervalMs;
    if (lastTickMs > 0) {
      const d = nowMs - lastTickMs;
      if (d > 1 && d < 250) {
        tickIntervalMs = tickIntervalMs * 0.95 + d * 0.05;
        dtMs = d;
      }
    }
    lastTickMs = nowMs;

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
    let logSum = 0, fluxSum = 0, wFluxSum = 0;
    for (let i = 1; i < USABLE_BINS; i++) {
      const a = amp(i);
      cTotal   += i * a;
      totalAmp += a;
      if (a > maxMag) maxMag = a;
      logSum   += Math.log(a + 0.0001);     // floor to avoid log(0)
      const d = a - prevMag[i];
      if (d > 0) {
        fluxSum += d;
        // Half-wave-rectified flux weighted toward sub/kick/low bins — beat
        // tracking cares about the low end, not hi-hat sizzle.
        wFluxSum += d * (i < 5 ? 3 : i < 10 ? 2 : 1);
      }
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
    const onsetStrength = wFluxSum / (USABLE_BINS - 1);
    onsetBuf[onsetIdx] = onsetStrength;
    onsetIdx = (onsetIdx + 1) % MAX_ONSET_BUF;
    if (onsetCount < MAX_ONSET_BUF) onsetCount++;
    bpmTickCounter++;
    if (bpmTickCounter >= 10) {            // every ~6 Hz instead of every tick
      bpmTickCounter = 0;
      const detected = bpmEstimate();
      // Heavy smoothing — BPM doesn't change fast. Seed directly on the first
      // estimate so the PLL doesn't chase an EMA climbing up from zero.
      if (detected > 0) state.bpm = state.bpm ? state.bpm * 0.7 + detected * 0.3 : detected;
    }

    // ── onset events (adaptive threshold over the weighted flux) ─────
    const alpha = Math.min(0.2, dtMs / 1000);            // ~1 s time constant
    onsetMean = onsetMean * (1 - alpha) + onsetStrength * alpha;
    const dev = onsetStrength - onsetMean;
    onsetVar = onsetVar * (1 - alpha) + dev * dev * alpha;
    const isOnset =
      dev > 2 * Math.sqrt(onsetVar) &&
      onsetStrength > 0.005 &&
      nowMs - lastOnsetMs > 150;           // refractory: skip double-hits
    if (isOnset) {
      lastOnsetMs = nowMs;
      onsetTimes.push(nowMs);
    }
    while (onsetTimes.length && nowMs - onsetTimes[0] > 8000) onsetTimes.shift();

    // ── beat-phase PLL ───────────────────────────────────────────────
    // Phase free-runs at the estimated BPM; onsets that land near a beat
    // boundary pull it toward 0. Off-beat onsets (snares, fills) are ignored
    // rather than dragging the phase around — they only lower confidence.
    if (state.bpm > 0) {
      state.beatPhase += dtMs / (60000 / state.bpm);
      if (state.beatPhase >= 1) {
        state.beatPhase %= 1;
        beatCounter = (beatCounter + 1) & 3;
      }
      if (isOnset) {
        // signed distance from the nearest beat boundary, in beats
        const err = state.beatPhase < 0.5 ? state.beatPhase : state.beatPhase - 1;
        // Acquisition vs tracking: while confidence is low we snap hard to any
        // onset (a fixed offset outside the window would otherwise never
        // converge — matched frequency means the error can't drift into it).
        // Once locked, only near-boundary onsets nudge, at the gentle gain.
        const acquiring = state.beatConfidence < 0.4;
        const gain   = acquiring ? 1.0 : phaseNudgeGain;
        const window = acquiring ? 0.5 : phaseNudgeWindow;
        state.beatConfidence =
          state.beatConfidence * 0.9 + (1 - 2 * Math.abs(err)) * 0.1;
        if (Math.abs(err) <= window) {
          state.beatPhase -= gain * err;
          if (state.beatPhase < 0)       { state.beatPhase += 1; beatCounter = (beatCounter + 3) & 3; }
          else if (state.beatPhase >= 1) { state.beatPhase -= 1; beatCounter = (beatCounter + 1) & 3; }
        }
      }
      state.barPhase = (beatCounter + state.beatPhase) / 4;
      // Remember the tempo while the lock is trustworthy, so modules can
      // free-run an oscillator at this rate when confidence drops (during
      // acquisition beatPhase is being hard-snapped and is jumpy).
      if (state.beatConfidence >= 0.4) state.lastConfidentBpm = state.bpm;
    }

    // ── beat detector (kept for live UI + beatsPerSec) ───────────────
    state.bassAvg = state.bassAvg * 0.99 + state.smoothedBass * 0.01;
    const wasBeat = state.onBeat;
    state.onBeat =
      state.smoothedBass > Math.max(0.05, state.bassAvg * 1.30) &&
      state.smoothedBass > state.prevBass * 1.02;
    state.prevBass = state.smoothedBass;
    if (state.onBeat && !wasBeat) {
      beatTimes.push(nowMs);
      while (beatTimes.length && nowMs - beatTimes[0] > 3000) beatTimes.shift();
      state.beatsPerSec = beatTimes.length / 3;
    } else if (beatTimes.length) {
      while (beatTimes.length && nowMs - beatTimes[0] > 3000) beatTimes.shift();
      state.beatsPerSec = beatTimes.length / 3;
    }

    return state;
  }

  return {
    start,
    startFromFile,
    switchDevice,
    listDevices,
    tick,
    state,
    freqBins,
    get fileElement() { return fileElement; },
    _injectAnalyser(a) { analyser = a; },   // test seam for tools/beat-test.mjs
    get audioCtx()     { return audioCtx;     },
    get mediaSource()  { return mediaSource;  },
    get analyser()     { return analyser;     },
    get fftSize()      { return fftSize;      },
  };
}
