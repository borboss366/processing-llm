# PLL 4-genre matrix — 2026-08-22

Harness: `tools/beat-test-real.mjs` (headless Chrome, real render window,
file audio), one run at a time. BPM judged as median over samples with
`beatConfidence ≥ 0.5`; PASS bound ±2 BPM. Ground truth for Sandstorm
arbitrated with `tools/wav-tempo.mjs` (offline autocorrelation on decoded
PCM, independent implementation): rip measures 136.01.

| track | trait exercised | truth | confident median | Δ | conf mean | <0.4 | verdict |
|---|---|---|---|---|---|---|---|
| Brejcha-style minimal techno mix (@120 s, 60 s) | four-on-the-floor | ~125 | 125.03 | +0.03 | 0.65 | 4% | PASS |
| MJ Cole – Sincere (@40 s, 90 s) | syncopated 2-step, bass carries groove | 134 | 132.63 | −1.37 | 0.65 | 1% | PASS |
| Pendulum – Hold Your Colour (@100 s, 90 s) | DnB, snare-heavy, top of range | 174 | 172.56 | −1.44 | 0.55 | 8% | PASS |
| Darude – Sandstorm (@30 s, 120 s) | repeated breakdowns | 136 | 136.00 | −0.00 | 0.76 | 0% | PASS |

Synthetic suite (`tools/beat-test.mjs`) after all fixes: 120 BPM @ 60 Hz,
120 @ 120 Hz, 128 @ 60 Hz, 174 @ 60 Hz — BPM Δ0.00 each, max phase error
≤ 0.033 beats over 60 s, confidence ≥ 0.97.

## Fixes the matrix forced

- **Half-tempo lock on real techno** (read 62.5 for ~125): log-normal tempo
  prior centred ~120 BPM breaks exact harmonic ties; a comb score could not
  (score(T) = score(2T) for periodic kicks).
- **DnB octave flip-flop** (read ~105 mush for 174 in three different
  segments): kick→snare spacing puts the autocorrelation peak on the 2-step
  (87) and raw estimates alternated octaves, which the EMA averaged into
  garbage. Half-lag preference raised to 0.55 (only the 60–90 band can flip;
  doubling past 180 is range-capped) + octave hysteresis on the BPM EMA.
- **False −3.5 BPM "bias" on Sandstorm** was CPU contention from three
  parallel headless browsers (solo: Δ−0.00). Testing rule: solo runs only.

## Known gaps

- 60–90 BPM band untested and now eager to double (the 0.55 preference):
  Brief 3 Task 2 covers it with ~93 and ~81 BPM tracks.
- Breakbeat, triplet swing, rubato: outside the matrix; `beatConfidence` is
  the on-stage indicator.
