# Brief 12 — desktop draw mode, move workbench, ghost

Date: 2026-08-24. Verify fast tier 4/4 PASS; new full-tier check:
`workbench`.

## Task 1 — desktop draw mode

The phone page already routed all input through pointer events (mouse +
touch + pen share one path) and its layout centres on desktop — no page
change needed. Added: `GET /api/info` (loopback only: token/port/
localUrl), the boot log now prints the clickable
`http://localhost:<port>/e/<token>` line, and the controller's Audience
panel has a **Draw** button that opens it. E2E gained a REAL mouse-drag
variant of the good drawing (puppeteer `page.mouse` over the template
bones): accepted — `audience-e2e` PASS with all previous verdicts.

## Task 2 — move workbench

- **Hot reload**: `web/app/moves/*.json` watched server-side (deviation:
  the brief's "same watcher mechanism as loaded-modules" doesn't exist —
  modules load via explicit POST; a small fs.watch was added). The
  watcher VALIDATES before broadcasting: good JSON → `moves-changed`
  version bump → the creature refetches that table in place; bad JSON →
  `moves-error` into the controller's director log, no bump, creature
  keeps the last good table.
- **Phase scrub**: `clockMode live|manual` + `phaseScrub` (0..1 of the
  current loop). Manual pins the move clock loop-aligned, zeroes
  applied-phase (odometry stops), holds the FSM, and freezes the
  procedural overlays by pinning `tSec` and the audio level — the table
  pose is inspectable. Leaving manual resumes the live clock exactly at
  the scrubbed phase with `mvLast` re-latched (no debt) and re-poses
  through the blend layer.
- **Controller panel**: move selector (from `GET /moves-list`), Manual
  toggle, scrub slider (30 Hz throttled), Play-from-here.
- README: the ten-step authoring workflow.

`tools/workbench-check.mjs` (verify --full) drives the loop headless and
recorded it (`reports/workbench.webm` + scrub stills): scrub poses at
0/0.25/0.5/0.75, edit `groove.json` on disk (pelvis dip −0.035 → −0.09)
→ pose moved 0.495 → 0.44 (the exact delta), a deliberate parse error
was broadcast and the pose held, then play-from-here — **joint-speed
spikes: 0 all, 0 flagged** across the whole session including the
manual→live re-entry (the brief's snap-free proof).

**Bug found by the check**: hot-swaps used to `startBlend()`, but blend
progress rides `moveAcc`, which manual pins — the blend froze at t=0 and
masked every edit (measured: pose never moved). In manual, edits now
apply instantly (offset springs still smooth them); the blend fires only
on live re-entry.

## Task 3 — ghost (Halloween flagship #1)

`shapes/ghost-placeholder.{png,json}` — generated placeholder art (dome
+ widening sheet + three-scallop hem + arm stubs; the user will likely
redraw). Sidecar structure is the deliverable: root/spine/head, two arm
chains (limb2/3), THREE hem tip joints (limb0/1/4 — the builder is fully
generic about limb count) with tentacle phases 0/0.33/0.66,
`grounded: false`, `archetype: ghost`, big eyes (r 0.032 — the face is
the eyes), ectoplasm palette.

- `grounded: false` forces the float state set through the existing
  `hasFeet` gate — no ghost-specific code paths; a new `ghost` gait
  table (data, like biped/trot/pulse) gives hem trailing + beat sway.
- Float drift: slow Perlin wander across the full stage on BOTH axes
  (new `world.yOff`, clamped so the figure stays on stage); `hop` bar
  accents fire a swoop — a decaying fast-drift impulse toward the
  wander target.
- Halloween palette presets (ecto/witch/blood) one-tap on the phone
  page; hue-approximated in the sidecar (palette system is hue-based —
  same caveat as brief 11).

Gate: 30 s over the dark `_Geiss - Artifact 01` preset, post on
(`reports/creature4-ghost-placeholder-ghost.png/.webm`): floats
mid-stage, drift/groove/swoop cycling, components 1, **0 spikes**,
bone dev 0%, 2.15 ms/frame, 580 nodes.

## Open finding (pre-existing, logged)

A fully idle render page (bg off + post bypass + nothing painting) runs
headless rAF at ~120 Hz and the PLL loses real-track confidence at that
rate (measured: conf 0.01–0.19 vs 0.55 with anything painting). Never
hit before because no harness combined those flags. Same family as the
dnb-174 item: PLL frame-rate sensitivity. Workaround everywhere: keep a
layer painting (harnesses pin the clean preset). Not fixed here — out
of brief scope.

## STOP

Ghost verdict on the real GPU (does the placeholder structure read as a
sheet ghost; is the float/swoop motion right), and the workbench loop is
ready for the user's own move-timing play. Placeholder move timing and
the brief-10/11 judgment items remain open.
