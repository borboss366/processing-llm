# Captured T-step: reversed ankles — diagnosed and fixed (brief 16 T2)

User observation on stage: the captured table's ankles read reversed.

## (1) Trace measurement (tools/mocap/ankle-diag.mjs)

Per-foot ankle theta — raw vs Savitzky–Golay vs distilled keys — with
per-frame projected (de-yawed) ankle→toe length over full 3D foot length,
plotted (corpus/ankle-{L,R}.png, gitignored with the corpus; summary):

| window | side | ±π/2 jumps | proj/full min | frames < 0.35 gate |
|---|---|---|---|---|
| L (2.300–4.767) | ankleL | 0 | 0.71 | 0/75 |
| L | ankleR | 0 | 0.48 | 0/75 |
| R (4.767–6.967) | ankleL | 0 | 0.70 | 0/66 |
| R | ankleR | 0 | 0.37 | 0/66 |

Trace is CLEAN — no wrap jumps, no foreshortening collapse, filtered
follows raw faithfully. The user's branch (3) trigger (jumps at small
projected length) does not fire; no foreshorten gate needed.

## (2) Sign convention check → actual root cause

Engine/table ankle sign is consistent: the captured table plays the same
channel fk-check's heel-pivot asserts on (green: 12.1 px ankle swing
about a 0.0 px toe). Not a sign flip.

The plot shows the real fault: the traces sit on LARGE CONSTANT OFFSETS
— ankleL oscillates about −1.5 rad, ankleR about +1.1 rad. Root cause is
a REST-POSE MISMATCH unique to feet: the rig's rest feet are PROFILE
(pointing sideways) while the frontal source's feet point at the camera.
Absolute retargeting (obs − rig rest − parent chain) hands that ~90°
disagreement to the ankle channel as a standing offset, which rotates
the stage foot backwards. Legs/arms don't suffer this — their rest
orientations agree between profile rig and frontal person; feet are the
one segment that lives along the camera axis.

## Fix

extract.mjs re-expresses ankle thetas as DEVIATION from the clip's own
stance (circular mean over the window, removed per side and logged:
L window −1.604/+1.149 rad, R window −1.347/+1.247). The rig's rest foot
stays neutral; the T-step fan reads as oscillation about it — the same
convention the authored placeholder uses. 2D can only fake the foot's
yaw fan as deviation anyway; the true 3D heel→toe yaw per frame is now
recorded as a `footYaw` channel in poses.json (with the stance offsets
in provenance) — ready data for the future yaw-fake/axial-rotation
channel, per the user's (3).

## (3) QA panel

Re-confirmed per-frame retarget (fkPose of thetaFrames[i]); no
table-playback averaging in the QA path, no cycle alignment needed.

## Result

Re-extracted both sides (offsets logged, lag still −0.7/+1.6 ms, cycles
3/3 + 2/2 kept), restitched tstep-captured + ×1.35. Ankle keys now range
−0.52..+1.02 (L) / −0.79..+0.61 (R) around zero instead of riding a
−1.5/+1.1 offset. Note: keys touching ±1.0 clamp at rotLimits.ankle
(console-warned, by design; the ×1.35 variant clamps harder — visible
foot amplitude is capped, not wrapped). Stage re-armed with fresh module
state for the user's re-judgment.
