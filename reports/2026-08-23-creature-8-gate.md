# Brief 8, Task 4 — gate captures

30 s per shape over Butterchurn, techno mix seeked across the ~440 s
breakdown (`tools/capture-creature.mjs --seek 425`), primary bg-ON captures
+ black-background diagnostics:

- `creature4-biped-1.png` / `.mp4` / `-diag.png`
- `creature4-biped-2.png` / `.mp4` / `-diag.png`

## Factual description

Both of the user's drawn bipeds render as glossy, lit, translucent soft
bodies: key-lit from the upper left with visible surface relief, dark
saturated silhouette edges, whitened cores riding the kick, accent-tinted
rims, and two dark eyes that blink, saccade with head-looks, and lead the
walking direction. biped-1 walks in teal/green with a pink head; biped-2
in blue/pink with a gold head — palettes entirely from the shape sidecars.
They walk with planted feet, turn with the mirror squish, groove on energy
peaks, idle through the breakdown (breathing, weight-shifting, glancing
around), and the contact shadow tracks the feet — subtle over bright
Butterchurn regions. Observed states across the two 30 s windows:
idle/walk/groove on both, cycling with the music.

Known nits at defaults, visible in the clips: the left hand blob can
momentarily separate from the arm at full swing (thin wrist density);
a faint tissue spray is briefly visible beside the torso in one biped-2
frame.

## Performance (headless swiftshader; fps note per CLAUDE.md)

| shape | nodes | module JS | shade pass (wall) | max stance slide |
|---|---|---|---|---|
| biped-1 | 584 | 1.01 ms/frame | 0.75 ms | 0.15 px |
| biped-2 | 590 | 0.98 ms/frame | 0.74 ms | 0.06 px |

GPU-timer readings under swiftshader (17–29 ms) are software-GL, not the
dev machine's GPU; the shading pass is one half-res-sourced fullscreen
triangle (9 taps) and the ≤3 ms real-GPU budget is expected to hold — to be
confirmed at this judgment on the real display.

## npm run verify (full tier)

```
pll-synthetic             PASS    scenarios=4 (0.3s)
module-load               PASS    modules=8 (0.1s)
director-prompt-stable    PASS    bytes=57585 (0.1s)
pll-real-tracks           FAIL    reason=dnb-174 (326.3s)
replay-smoke              PASS    windows=14 changed=13 holds=0 offlist=0 errors=0 (63.1s)
creature-capture          PASS    shapes=2 seconds=30
```

**The dnb-174 FAIL is real and now diagnosed** (not creature-related; no
audio code was touched in this brief): the DnB lock is **bistable across
runs** — the same command either locks 174.0 (solo runs measured Δ−0.19,
Δ−0.44) or settles into a confidently-wrong attractor: this run read
154.24 with confidence 0.69 (Δ−19.76, wrap-interval CV 0.33). Mechanism:
the octave hysteresis in `core/audio.js` makes an early wrong lock sticky
(174/154 ≈ 1.13 sits outside its half/double correction windows) and
`refinePeriod` then self-confirms the wrong subdivision. Earlier
"CPU-load" and "browser-jank" explanations were partial at best; fresh
browsers and cool-downs did not fix it. Logged in STATUS as a dedicated
PLL work item — deliberately NOT papered over with a wider tolerance.

## STOP — the gate question

On a real GPU with Butterchurn behind it: does it look like a lit,
translucent soft body with anatomy — or still like a flat sticker?
