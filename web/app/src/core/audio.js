/**
 * Audio context + analyser + device picker.
 * Shared by main and preview pages.
 */

export function createAudio() {
  let audioCtx = null;
  let analyser = null;
  let mediaSource = null;
  let currentStream = null;

  const fftSize = 1024;
  const freqBins = new Float32Array(fftSize / 2);
  const state = {
    smoothedLevel:    0,
    smoothedBass:     0,
    smoothedMid:      0,
    smoothedTreble:   0,
    smoothedCentroid: 0,     // 0..1 — spectral "brightness"
    bassAvg:          0,     // long-EMA of bass (~10s) — beat detector baseline
    beatsPerSec:      0,     // count of rising-edge beats in last 3 s ÷ 3
    onBeat:           false,
    prevBass:         0,
  };
  const beatTimes = [];      // rising-edge onset timestamps (ms)

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

  /** Call once per frame from the render loop to refresh the analysis. */
  function tick() {
    if (!analyser) return state;
    analyser.getFloatFrequencyData(freqBins);

    let sum = 0, n = 0;
    for (let i = 4; i < 64; i++) { sum += (freqBins[i] + 80) / 80; n++; }
    const level = Math.max(0, Math.min(1, sum / n));
    state.smoothedLevel = state.smoothedLevel * 0.85 + level * 0.15;

    // Band averages — bin width ≈ 46.875 Hz at sr=48 kHz, fftSize=1024.
    // Bass ~ 0-200 Hz (0-4), mid ~ 200-2000 (4-42), treble ~ 2-8 kHz (42-170).
    function bandAvg(lo, hi) {
      let s = 0; const n = hi - lo;
      for (let i = lo; i < hi; i++) s += (freqBins[i] + 80) / 80;
      return Math.max(0, Math.min(1, s / n));
    }
    const bass   = bandAvg(0, 4);
    const mid    = bandAvg(4, 42);
    const treble = bandAvg(42, 170);
    state.smoothedBass   = state.smoothedBass   * 0.88 + bass   * 0.12;
    state.smoothedMid    = state.smoothedMid    * 0.88 + mid    * 0.12;
    state.smoothedTreble = state.smoothedTreble * 0.88 + treble * 0.12;

    // Spectral centroid — amplitude-weighted mean bin index, normalised to 0..1.
    // Stable indicator of timbre brightness (vocals/cymbals push it up, sub-bass
    // pulls it down). Bin range 1..170 covers ~46Hz..8kHz, the musically useful
    // span at our 48kHz sample rate / 1024 fftSize.
    let cTotal = 0, cWeight = 0;
    for (let i = 1; i < 170; i++) {
      const amp = Math.max(0, (freqBins[i] + 80) / 80);
      cTotal  += i * amp;
      cWeight += amp;
    }
    const centroid = cWeight > 0 ? Math.min(1, cTotal / cWeight / 170) : 0;
    state.smoothedCentroid = state.smoothedCentroid * 0.85 + centroid * 0.15;

    // Beat onset detection — relative to a slow-moving baseline of bass so it
    // works at any input volume. Fire when current bass is BOTH significantly
    // above the recent average AND rising. Floor at 0.05 to avoid pure-noise
    // triggers on a silent room.
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
      // decay the rate even when no new beats arrive (silent passages)
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
