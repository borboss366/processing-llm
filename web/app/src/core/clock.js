/**
 * Beat clocks (brief 13). A clock owns ONLY the four public phase fields of
 * `audio.state` — beatPhase, barPhase, bpm, beatConfidence (+ clockTier) —
 * plus lookahead: `phaseAt(wallMs)` and `nextDownbeatIn()`. Feature
 * extraction and the PLL always run regardless of tier (the PLL is the
 * fallback and stays visible at `state.pll` for diagnostics).
 *
 *   PLLClock  — publishes the causal tracker's estimate; phaseAt is the
 *               click scheduler's extrapolation, formalized.
 *   GridClock — file playback with a `music/<file>.beatgrid.json` sidecar
 *               ({ firstBeatMs, downbeatEvery, bpm } and/or beats:[ms…]);
 *               phase derived from element.currentTime each tick;
 *               confidence 1; phaseAt exact.
 *
 * Consumers never branch on tier — they read the same fields either way.
 * Clock switches are phase discontinuities absorbed downstream by the
 * move clock's capped-debt smoothing, same as PLL re-acquisition.
 */

const frac = (x) => ((x % 1) + 1) % 1;

export function createPLLClock(pll) {
  let lastState = null;
  return {
    tier: 'pll',
    apply(state) {
      state.bpm = pll.bpm;
      state.beatPhase = pll.beatPhase;
      state.barPhase = pll.barPhase;
      state.beatConfidence = pll.beatConfidence;
      state.lastConfidentBpm = pll.lastConfidentBpm;
      state.clockTier = 'pll';
      lastState = state;
    },
    phaseAt(wallMs) {
      if (!lastState || lastState.bpm <= 0) return 0;
      const beatMs = 60000 / lastState.bpm;
      return frac(lastState.beatPhase + (wallMs - lastState.clockNowMs) / beatMs);
    },
    nextDownbeatIn() {
      if (!lastState || lastState.bpm <= 0) return Infinity;
      return (1 - lastState.barPhase) * 4 * (60000 / lastState.bpm);
    },
  };
}

/** Fractional beat index at a media time, from the sidecar. */
function makeBeatIndex(grid) {
  const beats = Array.isArray(grid.beats) && grid.beats.length >= 2 ? grid.beats : null;
  if (beats) {
    return (mediaMs) => {
      // binary search the surrounding pair; extrapolate at the edges from
      // the local interval so pre-roll and outro keep a steady phase
      let lo = 0, hi = beats.length - 1;
      if (mediaMs <= beats[0]) {
        const iv = beats[1] - beats[0];
        return (mediaMs - beats[0]) / iv;
      }
      if (mediaMs >= beats[hi]) {
        const iv = beats[hi] - beats[hi - 1];
        return hi + (mediaMs - beats[hi]) / iv;
      }
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (beats[mid] <= mediaMs) lo = mid; else hi = mid;
      }
      return lo + (mediaMs - beats[lo]) / (beats[hi] - beats[lo]);
    };
  }
  // constant-bpm form: { bpm, firstBeatMs }
  const beatMs = 60000 / (grid.bpm || 120);
  const first = grid.firstBeatMs ?? 0;
  return (mediaMs) => (mediaMs - first) / beatMs;
}

export function createGridClock(grid, mediaMsNow) {
  const beatIndexAt = makeBeatIndex(grid);
  const every = Math.max(1, grid.downbeatEvery ?? 4);
  const localBpm = (mediaMs) => {
    // derivative of the beat index ≈ instantaneous bpm (exact per segment)
    const db = beatIndexAt(mediaMs + 250) - beatIndexAt(mediaMs - 250);
    return db * 120 || grid.bpm || 120;   // beats per 500 ms → beats per minute
  };
  let lastWall = 0, lastMedia = 0;
  let estMedia = null, lastTickWall = null;
  return {
    tier: 'grid',
    grid,
    apply(state) {
      // element.currentTime is quantized (~10–25 ms chunks in Chrome) —
      // advance an estimate on the wall clock and pull it gently toward the
      // element, so phase stays smooth; hard-reset on seeks/big jumps
      const raw = mediaMsNow();
      const wall = state.clockNowMs;
      if (estMedia === null || Math.abs(raw - estMedia) > 250) {
        estMedia = raw;
      } else {
        estMedia += wall - (lastTickWall ?? wall);
        estMedia += 0.05 * (raw - estMedia);
      }
      lastTickWall = wall;
      const m = estMedia;
      state.mediaMs = m;
      lastWall = wall;
      lastMedia = m;
      const b = beatIndexAt(m);
      state.beatPhase = frac(b);
      state.barPhase = frac(b / every);
      state.bpm = Math.round(localBpm(m) * 10) / 10;
      state.beatConfidence = 1;
      state.lastConfidentBpm = state.bpm;
      state.clockTier = 'grid';
    },
    phaseAt(wallMs) {
      // media time advances 1:1 with wall while playing (playbackRate 1)
      return frac(beatIndexAt(lastMedia + (wallMs - lastWall)));
    },
    nextDownbeatIn() {
      const b = beatIndexAt(lastMedia);
      const beatsLeft = (Math.ceil(b / every) * every) - b || every;
      return beatsLeft * 60000 / (localBpm(lastMedia) || 120);
    },
  };
}
