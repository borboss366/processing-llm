# Front-view ankle reference (feet only, front view)

**Change:** in front view the ankle deviation is measured from the
dancer's OWN standing foot direction (circular median of heel→toe over the
planted/slow calibration frames — the same frames used for bone lengths)
and applied onto the rig's rest foot. Everything else, and profile feet,
stay gravity-referenced. Foreshortening gate unchanged. Code:
`retargetFrame(..., footRef)` in `tools/mocap/lib/retarget.mjs`; extract
logs the reference per clip; poses/explorer `restRef` carry it so the
explorer's stage-5 round-trip recomputes the same transfer.

**Self-tests (`extract.mjs --self-test`, PASS):** splayed frontal stance
(±0.6 rad) → rendered foot deviation 0.0000 / 0.0000 (the old rig-rest
reference reads |ankle| 1.01 on the same stance); front side kick (leg
abducted 0.5, foot +0.8) → full ±0.800 foot deviation, |ankle θ| 0.18 /
0.22 — inside ±1.0.

## Clamp counts

| | before | after |
|---|---|---|
| basic_kick_1 extract (ankle θ past ±1.0, of 140) | L 108 · R 70 | L 19 · R 22 |
| basic_kick_1-front ENGINE (biped-1) | footL 185 · footR 69 | **0 · 0** |
| tstep-L extract (of 75) | L 47 · R 65 | L 24 · R 6 |
| tstep-R extract (of 66) | L 28 · R 38 | L 0 · R 31 |
| tstep-captured ENGINE (biped-1) | footL 83 · footR 28 | footL 46 · footR 52 |

(before: extract counts from the 2026-09-28 R0 run, engine counts from
the 2026-10-13 / 19.1 traces.)

## Engine fidelity row (`tools/engine-fidelity.mjs`, PASS)

| | spring | lock Δ | position | clamps |
|---|---|---|---|---|
| runningman × profile | 0.034 | 0.014 | 0.018 u | 0 |
| tstep × biped-1 | 0.025 | 0.061 | 0.020 u | 46/52 whitelisted |
| basic_kick_1-front × biped-1 | 0.015 | 0.019 | 0.017 u | **0** |

basic_kick_1-front on biped-2: 0 foot clamps; one handR frame (elbow
channel — the clip's ±3 rad habitual elbows, flagged earlier), not feet.

## Why the t-step is not at 0 (deviation from the brief, stated)

The residual t-step clamps are on frames where the foot is LONG in the
image (length ratio ~0.8 vs ~0.55 standing): standing, the toes point at
the camera (foreshortened); the fan swivels them sideways — a floor-plane
rotation that projects as a ~90° heel→toe sweep. No 2D in-plane
reference can absorb that; it is the depth problem the t-step is parked
on (USER_GATES item 2). So the brief's "revert the bridge once green" is
not applied to the t-step: its `clampWhitelist` stays, reason updated
with this evidence. (Note: the rig's ankle limits were never raised —
all shapes still `ankle: 1`; the only bridge in the tree was this
whitelist.) The rebuild via stitch had silently dropped the header
field; fidelity failed loudly on it and it was re-added.
