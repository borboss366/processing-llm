# CLAUDE.md — standing rules for processing-llm

You are the implementer. The user holds aesthetic judgment; a reviewer
model writes the briefs in `docs/briefs/`. Execute the newest brief,
task by task, under these permanent rules.

## Process

- Do tasks in the brief's order. STOP and report after each task.
- Never start work the brief defers or lists as out of scope, even if it
  seems adjacent or "while I'm here" cheap.
- Any acceptance criterion that ends with a judgment question (does it
  read as X, does it look Y) means: produce the capture, write the
  factual report, STOP. The user judges from a real GPU, not you.
- Deviate from a brief when the repo contradicts it — but say so
  explicitly in the report, with the reason (this has caught real brief
  errors; silent compliance and silent deviation are both failures).

## Engineering rules

- Frames before frameworks: the ugly specific version before the elegant
  general one. No new abstraction until two concrete customers exist.
- No new surfaces (pages, demos, endpoints) unless the brief asks.
- The live path (`server.ts` controller routes, `core/audio.js`,
  `core/registry.js`, `main.js`) stays boring: nothing slow, nothing that
  can throw on a bad LLM response, no writes except session logging.
  Slow or failure-prone work goes in `tools/`.
- One repo. Delete dead code; git is the archive. No `_attic/`, no
  commented-out blocks.
- Typed arrays for anything per-node/per-frame. Module/engine frame
  budget: state it in the report with the measurement.

## Documentation rules

- `STATUS.md` is a SNAPSHOT, rewritten fully at the end of every task:
  (1) one paragraph on what the system does and how to run a set,
  (2) Verified — each capability with the number that proves it and the
  tool that produced it, (3) Open — current problems by user-visible
  impact, (4) Next — the next task by name. Nothing historical, no
  contradictions between sections.
- Evidence goes in `reports/<date>-<topic>.md`, committed. Sessions and
  audio files are never committed (`sessions/`, `music/` are gitignored).
- The README's Architecture section holds ONE Mermaid diagram at component
  level (processes, files, data flows — never functions). Any commit that
  adds, removes, renames, or rewires a component shown there updates the
  diagram in the SAME commit. Do not add a second diagram; do not let it
  grow below component altitude — if a change is invisible at this level,
  the diagram doesn't change.
- Every experiment kept in-tree has a README paragraph: what it is, why
  isolated, what promotes it or kills it.

## Verification rules

- Every numeric acceptance criterion (fps, ms/frame, picks/min, BPM
  error, counts) is checked by a script under `tools/`, and the report
  cites the script and its output. No hand-claimed numbers.
- Anything touching audio analysis re-runs the synthetic beat suite and
  the real-track matrix (`tools/beat-test*.mjs`) and reports both.
- Anything touching the director runs a replay comparison against the
  reference session and commits the table.
- Captures: use the file-audio path (`?audio=file:`) for reproducibility;
  capture over Butterchurn (the black-background version is a secondary
  diagnostic only); note that headless swiftshader fps is not real fps.

## Context you should know

- Beat phase comes from a PLL in `core/audio.js`: `beatPhase`, `barPhase`,
  `beatConfidence`. `barPhase` is NOT anchored to the musical downbeat.
  When `beatConfidence < 0.4`, modules free-run at `lastConfidentBpm`,
  never stop.
- The director's prompt is a stable prefix + variable tail to keep
  Ollama's KV-cache warm. Never reintroduce per-call variation (shuffle,
  timestamps) into the prefix. Do not run bootstrap/modgen against Ollama
  while a set is live — it evicts the cache.
- The long-term architecture (engines / scenes / param registry) is in
  `docs/ARCHITECTURE.md` with explicit trigger conditions. Do not start
  that refactor before the triggers are met.
