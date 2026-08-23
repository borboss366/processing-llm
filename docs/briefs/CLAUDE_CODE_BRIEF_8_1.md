# processing-llm — brief 8.1 (patch): limb severing

Symptom: in biped captures, mitts detach from forearms and float as balls
(reports/creature4-biped-2.png). Mechanism: pinned wrist cluster travels a
large arc; thin forearm ring-chain stretches; its density falls below
`gooThreshold`; the surface severs. Legs are borderline for the same
reason. Fix as follows, in order; capture after each numbered step so the
report shows which step killed it.

1. **Bone splats (the guarantee).** For every skeleton bone, draw N=5
   interpolated sprites (positions lerped joint→child each frame) into the
   density/colour accumulation buffer, radius = the part's sprite-radius
   floor, colour = part hue, alpha same as tissue sprites. Limbs can then
   never sever regardless of spring state. Param `boneSplats` (default
   on); diag mode renders them as outlines.
2. **Bone-length preservation.** Verify pose/squash transforms joints by
   rotation about parents, not independent scaling of positions. Assert in
   the harness: per-frame |joint−parent| deviates < 3% from rest length
   for all bones; add this to `capture-creature.mjs --verify`.
3. **Pin radius audit.** Wrist pin_r must not exceed the mitt region: pins
   grab only nodes whose part label matches the joint's part (wrist grabs
   armL/armR mitt-region nodes, not forearm ring nodes). Same for ankles.
4. **Per-part radius floors.** Raise floors for armL/armR forearm rings so
   their at-rest density sits ≥ 1.5× `gooThreshold` (measure, don't
   guess: report min density along each limb axis at rest and at max
   pose excursion).
5. Enforce the palette rule: a creature renders with exactly primary (body + limbs), secondary (core-brightening ramp only, not a separate region hue), and accent (head + rim tint). Part-to-hue assignment comes from the shape's json palette, never round-robin per part. Update both shape sidecars accordingly; the diag capture shows the three swatches in a corner.

Acceptance: 30 s biped capture with the current move set; zero frames with
disconnected components (check: count connected components of the
thresholded density mask each frame in the harness — must be 1, or 2 only
when the shadow layer is included separately). Report min-density table
and the component count. `npm run verify` green. STOP after.

Out of scope: new moves, palette, everything else in flight.
