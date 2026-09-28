# processing-llm — brief 18.2: draw every stage back onto the frame

Principle: stage 1 is judged against the video; every other stage
should be too. The explorer gets per-frame overlays on the source frame
and whole-clip diagnostics, so "which bone, when, against what" is read
off a picture instead of reconstructed from screenshots. Extends the
brief-18 explorer (same file, same scrub); nothing in the pipeline
changes except emitting the data the overlays need. Priority order is
the build order — 1, 9, 2 first (they cover "wrong / where-when /
compared to what").

## Task 1 — On-frame overlays (scrubbable, toggleable, composable)

1. **Rig-on-source**: the retargeted rig skeleton superimposed on the
   frame, aligned at hip-center, scaled by hip→shoulder distance; the
   QA panel's DEFAULT mode. Bones colored by round-trip error.
2. **Rest ghost**: the rig's per-view rest pose drawn faintly in the
   same alignment — "zero deviation" made visible.
3. **Goniometer**: at each joint, an arc + label: observed abs /
   reference abs / theta; label color = round-trip bucket.
4. **Foreshortening heat**: each bone colored by projected/rest length
   ratio; an arrow toward/away camera for the twist sign; sign source
   (continuity / score) shown on hover.
5. **Contacts**: ground marker under each foot (planted / swing), the
   ankle-height trace as a small inset; contact-derivation source
   labeled.
6. **Raw vs smoothed**: two dot colors; trailing shows lag.
7. **Velocity arrows** per joint (scaled, clamped).
8. **Table ghost**: the final distilled table played at the clip's
   phase, superimposed — R1 on the video.
All overlays share one scrub; any subset can be on; export the current
composite as PNG/webm (goes to reports/).

## Task 2 — Whole-clip diagnostics

9. **Bone × time heatmap**: x = frame, y = bone; color = selectable
   metric (round-trip error, R1 error vs raw, foreshortening ratio,
   score). Click a cell → scrub jumps there.
10. **Onion-skin cycles**: all cycles' skeletons at the scrubbed phase
    overlaid as ghost trails, dropped cycles red.
11. **Flag filmstrip**: thumbnails along the timeline with markers for
    jumps, gates, clamps, sign decisions, dropped cycles, distill keys;
    click → scrub.
12. **Key-pose ghosts**: the distill keys drawn as poses along the
    strip.

## Task 3 — Plumbing

- Stages emit what overlays need (per-frame theta, reference, round-
  trip, projected/rest ratios, sign decisions, contact flags, key
  indices) into poses.json `debug` — sizes bounded; no live-path
  impact (offline only).
- Explorer stays a single self-contained HTML; add a compact index at
  the top listing which overlays are on.
- Stale caption fix: stage 1 panel labels the ACTUAL estimator.

## Acceptance

- Explorer regenerated for the three clips; a report with three
  stills: rig-on-source at a knee-lift frame, the bone×time heatmap
  for the running man, and rest ghost vs measured pose at the frame
  that exposed the measured-rest bug — each captioned with what it
  shows.
- The user can, in the explorer alone, point at (a) the bone and frame
  of the worst round-trip error, (b) a contact flag that is wrong, (c)
  which cycles were dropped and why — without reading any report.

## Out of scope

Pipeline fixes (absolute-angle retarget is its own in-flight change),
brief 19 ladder (consumes these overlays), live-path anything.
