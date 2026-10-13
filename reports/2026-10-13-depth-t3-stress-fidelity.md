# Brief 17.5 Task 3 — depth stress, ladder, sign sanity

## Render stress row (`tools/depth-stress.mjs`, in verify, PASS)

Every limb's depth sweeps −1 → +1 → −1 (authored stress tables, removed
after the run):

| mode | loops | overlap flips L / R | bound | zero-crossing excess | size vs formula | components | spikes | NaN |
|---|---|---|---|---|---|---|---|---|
| slow (8 beats) | 1.7 | 8 / 8 | 8 | 0 | 6e-8 | 1 | +0 | no |
| beat (1 beat) | 8.0 | 15 / 15 | 32 | 0 | 6e-8 | 1 | +0 | no |
| snap (1 beat, snap) | 8.0 | 29 / 29 | 32 | 0 | 6e-8 | 1 | +0 | no |

No pop at zero: wherever |depth| < 0.05 the size factor is within
gain·0.05 of 1, and it matches its formula everywhere. The overlap
switch never chatters: at most behind → neutral → front → neutral →
behind (4) per loop started. In beat mode the authored 100 ms spring
keeps depth from always reaching ±0.3, so it flips less — correct.

## Depth on the engine ladder (`npm run engine-report`, explorer ladder)

| | depth: spring | depth: final | angle fidelity |
|---|---|---|---|
| basic_kick_1-front × biped-1 | 0.002 | 0.002 (worst kneeR 0.003) | PASS |
| runningman × biped-profile | 0.005 | 0.005 (worst elbowR 0.012) | PASS |

(depth units; table depth vs the value the engine holds.) Angle
fidelity rows unchanged.

## Sign sanity

- **basic_kick_1, kicking leg (the clearly lifted foot):** the SHIN
  reads toward the camera on 39 of 40 frames (left) and 37 of 37
  (right) — the kick is thrown at the audience, correct sign. The FOOT
  bone (heel→toe) is weaker: left +20 / −0 frames past ±0.05; right
  only +4 / −5 (mean 0.00). Per the brief this is a separate finding
  with its own number: foot-bone sign is unreliable on the right foot
  (9 decisive frames, split).
- **runningman (profile), legs:** left leg ≈ 0 (mean |depth| ≤ 0.016,
  max 0.07, 0 frames past 0.1). Right leg NOT ≈ 0: hipR mean 0.064,
  max 0.19, 29 of 82 frames past 0.1 (kneeR 9, ankleR 16); the stage
  table carries up to 0.216 on legs → at dial 1 the right foot would
  render up to ~1.14× size. Whether that is real (the far leg crossing)
  or noise that must not show on an in-plane move is the Task 4
  judgment ("runningman: unchanged").
