# processing-llm — brief 16.1 (patch): hip rotation DOF

Found by the brief-16 extraction (first data-discovered anatomy debt):
sideways leg swings are femur rotation about the hip; the rig has no
hip rot DOF, so the retargeter pushes abduction into knee/ankle —
bent-leg fakes instead of a swinging leg. Applies to authored kicks
too. Land mid-flight in 16; small.

1. **DOF**: hipL/hipR gain `rot` as first-class chain rotations (whole
   leg swings about the hip point), FK-propagating like shoulders.
   `rotLimits` hip ±0.9 signed (2D projection of abduction/flexion;
   signed per the elbow rationale). Pins/tissue/bone-splats unchanged
   (positions already flow from FK).
2. **Stress harness**: leg-swing row — hip ±0.9 at slow/beat/snap,
   swing-across-stance paths; the usual asserts (components, density,
   bones, spikes outside declared snaps).
3. **Retarget mapping**: femur direction (hip→knee landmark) → hip
   rot; knee rot becomes the RELATIVE femur–tibia angle; ankle
   relative tibia–foot. Same decomposition discipline as arms.
4. **Proof by re-extraction** (pipeline is deterministic): re-run the
   T-step clip; acceptance = knee/ankle rotation variance during the
   swing phase drops materially now that the hip absorbs it (report
   before/after variance per joint + overlay in the QA video), and the
   retargeted swing reads as a straight-ish swinging leg in the
   stickman comparison.
5. **Housekeeping**: authored tables audit — kicks in tstep-placeholder
   and any leg keys re-expressed via hip rot where they were faking it
   (fk-check updated: kick = hip-led); MODULE_ABI joint table updated;
   anatomy-lint corpus stats include hip once re-extracted.

Out of scope: everything else in 16 (in flight).
