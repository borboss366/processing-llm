# Review finding: "lateral leg spread lost by the engine" — measured, resolved

**Claim:** opposite-sign hip deviations (hipL −0.4 / hipR +0.3) splay the
ghost's legs but the engine draws legs together; the theta ladder reads
0.048 because it compares thetas, not positions — suspect FK sign/pivot
on the front rig.

**(a) The position rung now exists** everywhere the theta ladder does:
pelvis-normalized |table-FK − engine| joint positions
(`tools/lib/fk-ext.mjs`), printed by `npm run engine-report`
("FK POSITION RMS … worst …"), a bar in every engine explorer's ladder,
and an `engine-fidelity` budget (0.10 u; measured runningman 0.040,
tstep 0.036).

**(b) The hip convention is CLEAN — measured, not argued.** At
basic_kick_1's widest-stance frame (table hipL −0.327 / hipR +0.212):
ghost vs engine hips identical, knees within 0.005 u. The spread loss
is in the ANKLES (ghost ankle spread 0.186 u, engine 0.133) with two
named causes, both already instrumented:
1. **The ankle clamp** — the kick table carries ankleL −1.36 rad
   against the engine's ±1.0 limit: clamped 180 frames (fidelity
   correctly FAILs it unwhitelisted). This is the front-view foot
   convention gap's THIRD witness (tstep, absolute-retarget report,
   now basic_kick) — the heel→toe observation vs the front shape's
   foot-splay rest parks a constant that eats the limit headroom
   before the kick even starts. The real fix (front-view ankle
   reference) is owned by the T-step depth re-run; until then the
   owner chooses per table: whitelist (loses the kick peak) or raise
   rotLimits.ankle in the shape sidecars.
2. **Spring lag** (R2) on the fast kick — 0.19 rad RMS here.

**Exhibit:** `2026-10-04-kick-widestance-ghost.png` — lock-stage
skeleton panel at the widest frame: hips/thighs green on the ghost,
shins/feet yellow-red. The "legs together" impression was the flattened
FEET, not a hip sign error.
