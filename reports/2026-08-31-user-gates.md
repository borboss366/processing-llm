# 2026-08-31 — user gates session #3 (filled copy of docs/USER_GATES.md)

Live session over the gridded techno mix (GRID tier confirmed), items
1–6 of the user's reordered gates file. Three real defects were found
BY the session, fixed live, and re-verified. Session verdicts are the
user's; diagnoses and fixes are Claude Code's.

## Verdicts

- **G1 ✓ — fresh audience drawing on the 15-joint template**: works
  end-to-end after three live fixes (below); the fresh drawing's arm
  wave reads. Foot finding below.
- **C7a ✓ (per the file's own criterion)** — tstep mechanism right,
  movement more natural; NOT yet legible as a t-step. Root cause named
  by the user: the foot renders as a round blob — a blob pivoting about
  an interior point looks like nothing. An amplification hot-push
  (ankle ×2) only made the blob wobble; reverted. Legibility is bounded
  by foot GEOMETRY, not animation.
- **C7b ✓** — the wave TRAVELS shoulder→elbow→wrist on the enriched
  rig. User finding for the next brief: elbow bends read always-convex
  in projection; a front-facing arm silhouette should flex both ways.
- **T1 ✓** — transition feel: "all good for now" (rhythm crossfade,
  bounce ducking, walk→idle stop, turn carry — judged as one).
- **B5 ✓** — bgDim depth approved as shipped (×0.45 / ×0.7).
- **E11 — deferred again** (user: web UI enough for testing for now).

## Defects found live and fixed (all re-verified green)

1. **Enriched template silently over-tightened audience validation.**
   The 4 new mid-chain joints each demanded a ≥60% ink-covered pin
   disc; ankles/shoulders sit on naturally thin limb sections, so
   legitimate drawings were rejected. Fix: inside-ink still required
   for all joints; the disc rule now applies only to cluster-pinning
   joints (paws, root/chest/head). Bonus UX: rejections now NAME the
   failing joint — which immediately revealed the user's actual
   blocker was `handL` at 54% (drawn thin), not the new joints.
2. **Controller Perform ▶ race — the 2026-08-30 watch-item, root-caused
   and CLOSED.** `registry.load()` is an unconditional hot-reload;
   Perform's load→shape→trigger raced, the reload finished after the
   shape OSC landed and reset params to defaults — the default biped
   entered instead of the picked drawing. Fix: hot-reload carries the
   live instance's params forward (`{...defaults, ...prev.ctx.params,
   ...paramsOverride}`) — the whole race class is gone, and OSC
   mutations now survive module hot-reloads generally (modgen included).
3. **Drawn feet cut off** — the brief-8.1 severed-mitt mechanism: feet
   drawn past the template's built-art-sized limb circles became
   orphan body tissue and were dropped. Fix: audience-template limb
   regions enlarged (legs y 0.77→0.79, r 0.155→0.18, covering to the
   ground line; arms r→0.17); the user's approved sidecar patched in
   the spool. Note: the submit service memoizes the template — every
   template change needs a service restart (SUBMIT_TOKEN pins the URL
   across restarts; used live to keep the user's open page working).

## The FEET workstream (headline item for the next creature brief)

User formulation, consolidated from C7a + G1: a foot is PERPENDICULAR
to the leg, but the ring-chain sampler fits rings along the limb
region's principal axis — drawn foot flesh becomes wider bottom rings
on a vertical chain ("the ankle is just two joints following the
direction"), never an L that can pivot. Needs: a dedicated foot part
treatment (own region, rings along the foot's own axis, welded at the
ankle), drawn heel/toe geometry in the built-in shape art, and then
C7a's tstep legibility re-check. Also queued: elbow concave/convex
flex. Positive art note from the user: the figure's rear reads nicely —
the goo flatters the right curves.

## Verification after the live fixes

verify fast 4/4, audience-e2e PASS (checks=all — including the renamed
rejection messages), puppet-check PASS (load/enable/param flows over
the params-carry-forward registry).

## Watch items

- Perform ▶: CLOSED (root-caused above; remove from watch list).
- No audible pauses, no speed surges, no disappearances this session.
- Render-window occlusion freeze: not re-triggered (window kept visible).
