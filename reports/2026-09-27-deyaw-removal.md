# De-yaw removal + view reinterpretation (user directive, 2026-09-27)

**The diagnosis (user's):** with 2D-only landmarks (no z) a "rotation
by yaw" reduces to scaling x by cos(yaw) — a SQUASH, not a view change.
The explorer's stage-3 "after de-yaw" panel was showing a squashed
profile and calling it a front view. The rotation step was a fake.

## What changed

1. **Stage 3 = view selection only.** The frontness score
   (shoulder width / spine length, front ≥ 0.35) picks the clip's
   NATURAL view; the analysis always runs in it; the table is always
   built from the camera plane. The x-flip for facing-camera front
   clips stays — it is mirror canonicalization, not rotation.
   (`extract.mjs` stage 3.)

2. **Requested view ≠ natural view = REINTERPRETATION** (table-level,
   `reinterpretKeys` in `extract.mjs`): that view's in-plane deviations
   are unobserved (≈ 0), so every rot key becomes a TWIST key (clamped
   ±2, rendered by the engine's cos-foreshortening, brief 17 B).
   Positional channels (dx/dy) and travel — natural-plane quantities —
   drop; contacts and ease pass through. The table carries
   `reinterpreted: "from-<view>"`.

3. **Explorer stage 3 rewritten** ("VIEW SELECT — no rotation exists in
   2D"): per-frame frontness trace with the 0.35 threshold, natural vs
   emitted view, and for a reinterpreted view the twist traces it
   produced (hips + knees). The "after de-yaw" panel, the fake 3D yaw
   trace (`yawDeg`), and the `camPlane` payload are gone. Reinterpreted
   views now get their own explorer page.

4. **Deleted rotation code** (git is the archive): `frameYaw`, `deYaw`
   from `lib/retarget.mjs`; `yawsRaw` provenance (poses `yaw` field);
   `tools/mocap/ankle-diag.mjs` and `root-diag.mjs` (one-off diagnostics
   from closed investigations, built on the removed rotation). Kept:
   `deYaw3` at yaw 0 only — the world-debug projection feeding the
   explorer's fore-vs-world twist overlay — and `detectYSign` (world
   y-normalization for that same debug channel).

5. **stitch --symmetrize extended** to reinterpreted (twist-only)
   tables: twist holds its sign under x-reflection, so the profile
   non-negating side-swap is exactly right; rot-carrying front tables
   are still refused. `scaleKey` also carries `twist` through
   exaggeration (it silently dropped it before).

## Evidence

- **Self-test (new case 7):** a synthetic profile knee-lift (0.7 rad)
  emitted as front round-trips through twist, never the in-plane angle:
  `[self-test] reinterpret front-from-profile: kneeL lift 0.7 → twist
  0.7, in-plane leak false` — `node tools/mocap/extract.mjs
  --self-test` → `VERIFY:PASS mocap-self-test`.
- **Integration (running man, frontness 0.16 → natural profile):**
  `--emit-views profile,front --bpl 2` — the front pass logs
  `REINTERPRETATION (rot→twist at the table level)` and emits 159 twist
  keys; checked: zero rot/dx leak, travel all 0, profile table
  untouched (`view profile · reinterpreted no`). Both passes share one
  analysis: identical measured rests, period 0.337 s ×2, 16 keys.
- **Stage tables rebuilt** from that run: `runningman-captured` /
  `-x` (profile, bpl 2, mean travel −0.0313 u/beat — matches the
  accepted 2026-09-26 rebuild) and `runningman-captured-front` (bpl 2,
  twist-only, symmetrized from R half, amp L 0.84 / R 1.45). The old
  front table was a de-yaw-era squash — the A7 gate's front variant is
  now the honest reinterpretation.
- **Repo verify:** fast tier 4 pass / 0 fail.

## Notes & deviations

- Explorers regenerated: `corpus/runningman.explorer.html`,
  `runningman-front.explorer.html` (new page — REINTERPRETATION text +
  twist traces), `runningman-rtmpose.explorer.html`. The tstep-L and
  bodyroll explorer pages still carry the OLD stage-3 markup — their
  extractions are unaffected (primary natural views); regenerate on
  next touch.
- Engine consumption of twist-only tables rests on the brief 17 B twist
  channel (twist-smoke / twist-stress-dbg precedent); a live look at
  the new front variant belongs to the open A7 gate — no stage harness
  was run (user's session may be armed; OSC is broadcast).
- No QA video is rendered for a reinterpreted view (QA compares the
  natural-view retarget; a twist-only stickman render doesn't exist).
