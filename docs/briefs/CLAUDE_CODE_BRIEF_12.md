# processing-llm — brief 12: desktop draw mode, move workbench, ghost

Context: the party has a date and a theme — Halloween, Oct 31. This brief
makes the pipeline playable locally by the operator (mouse, no phone
ceremony), gives the user a tight loop for authoring dance moves, and
adds the first themed shape. CLAUDE.md rules; verify green.

## Task 1 — Desktop draw mode

1. Phone page input goes pointer-events (mouse + touch + pen through one
   path). Desktop layout may simply be the phone layout centered; no
   redesign.
2. Dev friction removal: `npm run submit` prints a clickable
   `http://localhost:<port>/e/<token>` line; the controller's Audience
   panel gets a "Draw" button opening that URL in a new tab (controller
   already knows the service base + token via the queue API — if it
   doesn't, expose them on `GET /api/info`, loopback only).
3. E2E gains a mouse-driven variant of the good-drawing case.

## Task 2 — Move workbench

Goal: edit a move file, see the result in under a second, inspect any
pose frozen.

1. Hot reload: `web/app/moves/*.json` watched (same watcher mechanism as
   loaded-modules); on change the creature reloads tables in place —
   mid-loop, through the existing blend layer, no module restart. A JSON
   parse error shows in the controller log and keeps the last good
   table (never a dead creature).
2. Phase scrub: params `clockMode` = `live` | `manual`; in manual,
   `phaseScrub` (0..1 of the current move loop) drives the move-local
   clock directly; procedural overlays (bounce/Perlin/simmer) freeze at
   their current offsets so the table pose is inspectable. Controller
   panel: a Move section with move selector (from the moves dir),
   clockMode toggle, a scrub slider, and a "play from here" button
   (re-enters live with phase continuity through the blend layer —
   no snap; the spike metric stays on in captures to prove it).
3. README: a ten-line "authoring a move" workflow (force move → manual →
   scrub to each key phase → edit json → save → watch it hot-swap →
   live).

## Task 3 — Ghost shape (Halloween flagship #1)

1. `shapes/ghost.png` + sidecar: floating sheet-ghost — dome head, wavy
   trailing hem, stub arms. No legs, no ground contacts. Implementer
   placeholder art acceptable (`-placeholder` suffix) — the user will
   likely redraw; the sidecar structure is the deliverable: joints
   root/spine/head + 2 arm chains + 3 hem tip joints.
2. Behavior: ghosts skip stance/locomotion states — float drift (slow
   Perlin wander across the full stage, both axes), hem tips trail with
   phase offsets (the tentacle pattern), body sway on beatPhase; hop
   state becomes a swoop (fast drift impulse on bar accents).
   Implemented via shape-level flags (`grounded: false` in the sidecar
   drives the FSM's state set) — no ghost-specific code paths outside
   the flag.
3. Palette presets: add `halloween` set (ectoplasm green/white/orange,
   purple/orange/green, blood/black/white) selectable on the phone page
   and in shape sidecars.
4. Eyes: ghost gets bigger eyes (sidecar-driven radius) — the eye is
   the whole face here.

## Task 4 — Gate

- Workbench: a screen capture (or webm) of the loop — scrub a pose, edit
  a key in the json, save, watch it hot-apply, play from here — plus the
  spike-metric proof that manual→live re-entry is snap-free.
- Ghost: 30 s over a dark preset, halloween palette. STOP for judgment.

Out of scope: spider (brief 13 — needs gait groups), skeleton-hand or
other shapes, phone-page theming beyond the palette presets, move
timing content itself (that is now the user's workbench play).
