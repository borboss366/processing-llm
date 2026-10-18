# processing-llm — brief 17.6 addendum: go for Task 2, plus three T1 corrections

Owner verdicts on T1 (reports/2026-10-18-user-gates.md) are in; Task 2
is a GO. Before Task 2, three corrections to Task 1 — all generic, all
with a check that would have caught them.

## A. Weight signal continuity (T-step "tilt changes immediately")

The pop is in the SIGNAL, not in a missing blend. `tstep-captured`
weight goes −0.97 → +1.00 between phase 0.49 and 0.50 (≈ 20 ms). A full
transfer cannot happen in one frame; the two branches of the rule
disagreed (pelvis says left, the lift detector fired on the left foot —
likely the heel pivot clearing 0.06·L — and overrode to right).

1. The lift branch may only CONFIRM the pelvis branch's sign or move it
   toward the lifted foot's opposite side gradually; it may never flip
   sign within a frame. Sign hysteresis as the brief asked: a sign change
   requires the pelvis branch to have crossed the dead band first, or the
   lifted state to persist for ≥ N frames (N from the SG window, not a
   per-clip number).
2. New contract row **weight-rate**, on every table: the fastest full
   swing (|Δweight| summed over any window of 0.1 beat) must stay below
   a global bound; print the worst table and phase. tstep is the test
   case: before the fix it FAILs at phase 0.49.
3. Re-extract all captured tables; the T1 table in the report gets a
   "max swing / 0.1 beat" column.

## B. Parity guard: compare weight and depth too (the kick)

`extract.mjs` parity guard (≈ line 575) compares even vs odd cycles on
`th:` channels only. On a frontal kick the in-plane legs barely move, so
even/odd look identical and the guard stays silent while weight flips
sign every kick and the lifted shin's depth alternates sides. Include
weight and depth in the parity distance, each normalized to the angle
channels' scale. Expected on basic_kick_1 with the flag-sheet line as is
(cycles 14): "loop DOUBLED by parity", 7 pairs, weight alternating
±1 per kick, kicking foot never carrying weight, both arms' depth
alternating. Drop "recapture with a one-kick window" from STATUS — it
is the per-clip workaround the generality guard forbids.

While there: elbowL depth on the current kick table is a CONSTANT
0.28–0.38 across all keys (elbowR ≈ 0). Report whether it survives the
doubled loop; if it does, print the left forearm's projected/rest ratio
over the clip — constant depth is a pose or a rest-length error, not
motion, and gets its own finding number.

## C. Task 2 expectation: the bob comes from 2.1

With the root solved from the support foot through FK, pelvis height IS
the support leg's FK — the planted knee's bend lowers the body. The front
running man's missing up-and-down should appear from grounding (2.1)
alone. Report the root's vertical range per table after 2.1, BEFORE
adding the sink (2.4). If the range is near zero on runningman, the
support-knee angles in the capture are too shallow — a capture finding,
not an engine one. 2.4 then exaggerates a real bob, it does not invent
one.

## Order

A → B (re-extract, verify) → STOP and report → Task 2 as written, with
C's measurement in the Task 2 report → Task 3 → Task 4. Owner re-judges
all five rating-page items after Task 2 (the trigger USER_GATES already
names).
