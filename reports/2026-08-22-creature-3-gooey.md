# Creature gooey test — rendering pivot (Brief 6, Task 1)

The tissue nodes are now invisible metaball centres: each node draws a soft
radial sprite (pre-rendered gaussian falloff, additive, part-hue tint) onto
a dedicated canvas layer between Butterchurn and the p5 foreground, and the
layer runs the standard gooey filter (`feGaussianBlur stdDeviation=6` →
`feColorMatrix` alpha `18a − 7`, both exposed as `gooBlur`/`gooThreshold`
params). No edges, no outline, no node dots. Physics untouched; the old
wireframe stays available as `renderMode: 'wire'` for diagnostics.

Captures over Butterchurn, techno mix @120 s, 20 s each:
`creature3-quadruped.png/.mp4`, `creature3-jelly.png/.mp4` (+ `-diag.png`
black-background stills).

## Factual description

**Quadruped**: a continuous, smooth-silhouetted soft body — teal torso with
visible internal texture, pink head, warm-hued legs stepping on the beat.
Unmistakably a solid creature rather than a graph. Trade-off: the near/far
leg pairs of the side view fuse into two chunky leg-columns at the default
threshold, so it reads two-legged-chunky rather than four-legged; small
threshold holes appear in the torso where grid sampling thins.

**Jelly**: a complete gooey organism — textured teal bell atop a fused
rainbow tentacle skirt that flows and sways as one mass. Very readable, if
anything *over*-fused: the five tentacles merge into a skirt rather than
reading as separate ribbons.

One iteration was needed to get here: with a single global sprite radius the
thin 2-node tentacle chains fell below the goo threshold and vanished
entirely (only the pinned tip clusters survived as tick marks). Fix:
per-node sprite radius = 1.4× the node's *local* mean incident edge length,
plus an alpha floor of 0.70 so a quiet band can't push a part below
threshold.

## Performance

| shape | nodes | module JS cost | note |
|---|---|---|---|
| quadruped | 594 | 0.33 ms/frame | filter runs in the compositor, off the JS thread |
| jelly | 591 | 0.32 ms/frame | page fps ~20 headless (was ~8 with the wireframe) |

The goo path is *cheaper* for the page than the wireframe was — sprite
blitting replaces ~2200 p5 vertex calls, and the blur/threshold is
GPU-composited.

## Gate verdict (per the brief's criterion)

Continuous glowing soft body with a readable silhouette: **yes, both
shapes** — this is not a blurred mess. The knobs that shape the remaining
trade-offs (leg fusion vs. limb continuity, torso holes) are
`gooThreshold`, `gooBlur`, and the sprite-radius factor, and Task 2's
shader threshold would sharpen the rim further.

STOP — awaiting judgment before Tasks 2–4.
