# processing-llm — brief 14: gate findings (rig depth + transition quality)

Source: reports/2026-08-30-user-gates.md. The C7 verdict class — "rig
depth, not timing" — reorders the realism arc: joints before sculpting.
This brief clears work items 1–3 from that report; micro-variation and
the user's sculpting session follow in 15. CLAUDE.md rules; verify
green; USER_GATES.md updated with the re-check items.

## Task 1 — Rig enrichment (C7)

1. **Reconcile spec vs auto-rig first**: the original biped-front.json
   declared shoulderL/R which the built arm chain (elbow→hand) lacks —
   find where they were dropped and report it. Ankles were never
   specced; they are new.
2. Chains become: spine→shoulder→elbow→wrist (per arm) and
   hip→knee→ankle→toe (per leg; toe may be the existing foot tip).
   Sidecar spec, auto-rig, part regions, pins, bone-splat routing and
   the group-channel mapping all updated; existing shapes migrate
   (ghost unaffected beyond schema).
3. Bone-length asserts extend to the new bones; stance/contacts move
   to heel/toe so a foot can PIVOT while planted (heel-pivot = ankle
   rot with toe contact held — the tstep mechanism).
4. **Re-author the tables to use the new joints** (still
   `-placeholder`):
   - tstep: weight-side heel/toe pivots via ankle rot; kick carries
     through hip+knee+ankle; contacts per phase honest.
   - armwave: originates at the SHOULDER; elbow opens through
     ~0.7–1.3 rad; consistent shoulder→elbow→wrist phase lag
     (~0.15–0.25 beat per link) so the wave TRAVELS.
   - groove: shoulders participate subtly (counter-sway).
5. Acceptance: workbench scrub stills at key phases — ankle pivot
   visible with toe planted; wave rotation peak migrating
   shoulder→elbow→wrist; webm of all three; spike/bone/component
   metrics green. USER_GATES gains C7-recheck items.

## Task 2 — Transition quality (C8 findings)

1. **Rhythm crossfade**: a move switch blends not only pose but
   rhythmic content — incoming move's oscillation amplitude ramps over
   ~1 bar while outgoing ramps down (phase-aligned at the bar). The
   0.75-beat pose blend stays for pose continuity; the AMPLITUDE
   envelope is what kills the instant-rhythm-switch read.
2. **Bounce ducking**: move tables declare `verticalContent` (0–1);
   the global beat bounce scales down by it during that move (armwave
   low, tstep high vertical → duck accordingly). Kills the tiring
   constant bounce under every move.
3. **Walk→idle keeps stepping**: during decel the gait continues with
   shrinking stride until root velocity ≈ 0, THEN blends to idle —
   odometry and feet always agree; no sideways glide. Same on
   walk-entry (already eased) — verify feet agree there too.
4. **Turn carries motion**: turning while walking keeps root velocity
   and gait running through the mirror (single blend, no halt); the
   400 ms facingVis completes unconditionally (a855206 already
   guarantees completion — this task removes the motion halt and the
   double blend).
5. Acceptance: scripted webm — walk→turn→walk→groove→armwave→tstep→
   idle over the gridded mix; no rhythm snaps, no glide, no turn
   stutter; spike metric 0; per-fix before/after clips or plots in the
   report.

## Task 3 — bgDim reimplementation (B5)

Background-yields-to-creature, compositor-native this time: a per-layer
dim uniform on the background texture (brightness ×~0.45, saturation
×~0.7, eased over the creature fade time), driven by creature
entering/active/exiting, param `bgDim` (default on), restore on exit.
Director grade unaffected (it operates on the composite). Acceptance:
scripted A/B capture over a bright preset; USER_GATES B5 re-check item.

## Out of scope

Micro-variation/swing/downbeat accents + sculpting (brief 15), audience
shape fidelity (post-animation), phone gate E11 (user), spider, field
scene, B6 (wontfix at MVP, per gates report).
