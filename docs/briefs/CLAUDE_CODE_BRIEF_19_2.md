# processing-llm — brief 19.2: the engine, made legible (owner's brief)

Reframe, stated by the owner: the point of this project is mastery of
the system, not features. Brief 19.1 (engine explorer, in flight)
builds the instrument; this brief builds the UNDERSTANDING on top of
it, and installs the rule that keeps the project the owner's from here
on. Acceptance throughout is "Boris can…", written by Boris. verify
stays the floor, not the goal.

## Task 1 — `docs/ENGINE.md`, written the way PIPELINE.md was

One page per engine stage, in the 19.1 tap order (table playback;
blend/crossfade; springs/follow; liveness; limits & signs; stance
lock/contacts/odometry; FK; depth mapping; tissue; density & goo). Each
page: what goes in, what comes out, the ACTUAL formula or rule (e.g.
the damped-spring update, the clamp, the side-sign reflection, the
stance-lock yield condition, cos(twist) foreshortening), the parameters
and defaults, the failure mode we hit there and how it was detected
(straight knees → stage 5 clamp; frozen near leg → stage 6 contacts;
hiccups → stage 2/3; welds → stage 10), the function pointer
(file:line), and which 19.1 view shows it. Plain language, for the
owner, not for a paper. Cross-link each page to its explorer tap.

Also: `docs/MAP.md` — one page, the whole system in one diagram
(audio clocks → director/FSM → tables → engine stages → compositor),
with the capture pipeline feeding tables from the side, each box
linked to its doc page and its explorer. The thing you'd draw on a
whiteboard to explain the tool to a friend.

## Task 2 — The owner's reading loop (user; the brief's real content)

With the engine explorer open on the running man:
1. Read the three functions that ARE the engine's pose path (table
   sampling + blend, the spring/liveness step, FK with limits/signs —
   ~400 lines), each beside its ENGINE.md page and its explorer tap.
2. Three predictions, written BEFORE running: what happens to the
   stage-3 ladder step if `follow` stiffness halves; what the stage-5
   heatmap shows if the knee limit is set back to one-signed; what the
   stage-6 flags show if contacts are forced planted on the lifted
   leg. Run each; compare; wrong predictions → ENGINE.md revisions.
3. `reports/<date>-engine-review.md`: every sentence in ENGINE.md you
   cannot verify or follow. Revised until empty (same loop as brief
   18, which also completes here — the capture side's list is still
   open).

## Task 3 — The explain-it gate (permanent rule, into CLAUDE.md +
## USER_GATES)

Nothing enters the party set (the halloween-freeze branch) unless the
owner has written, himself, a paragraph explaining what it does and
how — stored next to the feature as `docs/explained/<feature>.md`.
Not the agent's summary; the owner's words. If he can't write it, the
feature waits. CC's role: when a feature is proposed for the set, it
asks for the paragraph and refuses the merge without it. Backfill: the
features already in the set (director, PLL/grid clocks, goo render,
authored moves, FSM, audience pipeline) each get their paragraph over
the coming weeks; any that can't be written yet are flagged, not
removed.

## Task 4 — Briefs change shape

From here, every brief's acceptance section is phrased as "Boris
can…" (point at, predict, explain) alongside the verify rows, and
every feature task ships with its doc page and explorer tap in the
same commit. CLAUDE.md gains the rule; the brief template gains the
section.

## Acceptance

- ENGINE.md + MAP.md exist and are cross-linked to 19.1's views.
- The three engine predictions made and run; engine-review list empty;
  brief 18's capture list also empty (both reading loops closed).
- Explain-it gate live: the first paragraph written (owner's choice of
  feature) and the merge rule enforced in CLAUDE.md.
- Boris can, in his own words, walk a friend from "video of a dancer"
  to "creature dancing on stage," naming each stage and what breaks
  there.

## Out of scope

New features of any kind; Halloween freeze (brief 20 — written after
this, scoped to what passes the explain-it gate by the cutoff).
