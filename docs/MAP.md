# The whole system on one whiteboard (brief 19.2 Task 1)

The teaching view — what you'd draw to walk a friend from "video of a
dancer" to "creature dancing on stage." The README's Architecture
diagram stays the canonical component map; this one trades precision
for the story. Every box names its doc page and its instrument.

```mermaid
flowchart TB
  subgraph CAP["capture (offline) — docs/PIPELINE.md · corpus/*.explorer.html"]
    direction LR
    V[dancer video] --> E[landmarks rtmpose<br/>+ SavGol smooth] --> VS[view select<br/>no rotation in 2D]
    VS --> RT[absolute retarget<br/>vs rig rest] --> CY[cycles: octave guard<br/>align · average] --> DI[distill: budgeted keys<br/>constants · contacts]
  end

  DI --> T[(moves/*.json<br/>view-tagged tables)]

  subgraph LIVE["live inputs"]
    direction LR
    subgraph CLK["clocks — core/audio.js · bench.html"]
      A[audio file/mic] --> BC[beat/bar phase + drops<br/>GRID tier · PLL fallback]
    end
    subgraph BR["direction — src/controller · controller.html"]
      DJ[LLM director qwen3] --> FSM[FSM idle/walk/groove/hop<br/>+ move rotation]
    end
    subgraph AUDP["audience"]
      AUD[phone draw] --> SH[(shapes/*.json)]
    end
  end

  subgraph ENG["engine — creature.js · docs/ENGINE.md · reports/engine-*.explorer.html"]
    direction LR
    S12["1 table sample<br/>2 blend/crossfade"] --> S34["3 spring (R2)<br/>4 liveness"] --> S56["5 limits & signs<br/>6 stance lock"] --> S78["7 FK<br/>8 depth mapping"] --> S90["9 tissue<br/>10 density & goo"]
  end

  T --> S12
  BC --> FSM
  BC --> S12
  FSM --> S12
  SH --> S78
  S90 --> C[compositor + post] --> STAGE[stage pixels]
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
