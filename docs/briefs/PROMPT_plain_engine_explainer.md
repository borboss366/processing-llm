Write `docs/ENGINE_PLAIN.md` and `docs/PIPELINE_PLAIN.md`: the same
two systems described in ENGINE.md and PIPELINE.md, but for a reader
who wants to UNDERSTAND them without the math — me, when I'm not in
the mood to derive anything, and later a curious friend at a party.

Audience: a smart engineer who has never seen this codebase and does
not want formulas. If a formula is unavoidable, it goes in a footnote
with a one-line gloss ("this just means: the spring lags the target").

Rules:
- Plain words. No Greek letters, no "RMS", no "second-order"; say "how
  far off, on average" and "a smoothing that lags fast motion".
- Every stage gets the same five short parts, in this order:
  WHAT IT DOES (one sentence) · WHY IT EXISTS (what goes wrong without
  it) · THE ANALOGY (one concrete everyday comparison — a camera, a
  puppet, a rubber band, a stack of tracing paper) · WHAT CAN GO WRONG
  (the real bug we had there, told as a two-sentence story, no jargon)
  · HOW I'D NOTICE (which explorer panel shows it and what it looks
  like when it's wrong).
- Keep each stage under ~150 words. The whole doc should read in
  fifteen minutes.
- Use the project's own history as the examples: the running man that
  lost its stride, the knees that wouldn't bend, the arms that hung
  when the dancer held them up, the "rotation" that was only a squeeze,
  the 3D skeleton that lost the step. These are the stories; the math
  is the footnote.
- Open each doc with a half-page "the whole thing in one breath":
  video → dots on the dancer → angles at the joints → a loop of key
  poses → the creature plays the loop → springs and liveness make it
  breathe → the goo skin → the screen. Name the ONE question each
  stage answers.
- End each doc with "how to read the explorer like a story": the
  three panels to open first and what a good vs bad picture looks
  like, in words.
- Cross-link each plain stage to its technical page in ENGINE.md /
  PIPELINE.md and to the explorer tap, so the plain doc is the entry
  and the technical doc is the depth.

Do not simplify by omitting a stage. Simplify by choosing the words.
I will read it against the explorer and send back every sentence I
still can't follow; revise until there are none.
