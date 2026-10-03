# The whole system on one whiteboard (brief 19.2 Task 1)

The teaching view — what you'd draw to walk a friend from "video of a
dancer" to "creature dancing on stage." The README's Architecture
diagram stays the canonical component map; this one trades precision
for the story. Every box names its doc page and its instrument.

```mermaid
flowchart LR
  subgraph CAPTURE["capture (offline) — docs/PIPELINE.md · corpus/*.explorer.html"]
    V[dancer video] --> E[estimator rtmpose<br/>21-pt schema] --> S[SavGol smooth]
    S --> VS[view select<br/>no rotation in 2D] --> RT[absolute retarget<br/>vs rig rest]
    RT --> CY[period · octave guard<br/>align · average] --> DI[distill: budgeted keys<br/>+ constants · contacts]
    DI --> T[(moves/*.json<br/>view-tagged tables)]
  end

  subgraph CLOCKS["clocks — core/audio.js · bench.html"]
    A[audio file/mic] --> G[beatgrid GRID tier] & P[PLL fallback]
    G --> BC[beat/bar phase + drops]
    P --> BC
  end

  subgraph BRAIN["direction — src/controller · controller.html"]
    DJ[LLM director qwen3] --> FSM[FSM idle/walk/groove/hop<br/>+ move rotation]
  end

  subgraph ENGINE["engine — creature.js · docs/ENGINE.md · reports/engine-*.explorer.html"]
    T --> S1[1 table sample] --> S2[2 blend] --> S3[3 spring R2] --> S4[4 liveness]
    S4 --> S5[5 limits/signs] --> S6[6 stance lock] --> S7[7 FK] --> S8[8 depth]
    S8 --> S9[9 tissue] --> S10[10 goo]
  end

  BC --> FSM & S1
  FSM --> S1
  S10 --> C[compositor + post] --> STAGE[stage pixels]
  AUD[audience phone draw] --> SHAPES[(shapes/*.json)] --> S7
```

Where each judgment lives:
- capture fidelity → the clip's explorer (overlays 1–8, heatmap) and
  `table-vs-raw.mjs` (R1 — distill ≤ 0.012 everywhere, floor =
  rep-to-rep variation).
- engine fidelity → the engine explorer ladder (`engine-fidelity`
  verify row): spring 0.355 (R2, the named next rung), everything
  else < 0.03.
- the look (R4) → render-mode strip, goo+bones on stage (`m`/`o`).
- the rules of the house → CLAUDE.md (explain-it gate: nothing enters
  the party set without the owner's own paragraph in
  `docs/explained/`).

What breaks where, one line each: wrong landmarks → stage 0–1 picture;
lag → stage 2 (capture) or spring (engine 3); fake depth → view
select / twist; erased posture → rest reference (capture 4) — or the
old measured-rest/midpoint-knee bugs; straight knees → engine
convention remap + lock; weak amplitude → distill budget or octave
guard; feet wrong → contacts + lock yield; welds/flash → goo
union-by-max.
