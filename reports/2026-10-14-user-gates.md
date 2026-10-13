# User gates session — 2026-10-14 (rating page, first use)

Recorded verbatim from judge.html (sessions/judge-2026-10-13.jsonl).

## 7a — Kick thrown at the audience (brief 17.5) — verdict: not given

Looked at: dial 0, dial 1, dial 1 · goo, dial 1.5.

> What I see here, that the depth effect does not look sound. One arm is
> fat the other not, and this does not look like the depth correction
> that we did. Also the feet wiggle, but this does not look like it is
> stepping, like it is hanged on the back and just wiggles the legs.
> Somehow I think what can fix this is that there is one leg, that the
> puppet is standing on, and the other does not hold weight and is
> moving.

## 7b — Running man must stay unchanged (brief 17.5) — verdict: not given

Looked at: dial 0, dial 1.5.

> Running man so far looks the best. I might consider making the goo
> thinner, because now it's wonderful movement is covered in the goo.
> Also the depth cues do not change nothing

## 7c — Cartoon punch at the camera — NOT JUDGED (tool bug)

> I have a feeling something went off here, as it just iterates all the
> movements and I did not see a kick.

## 3 — Running man in profile (A7 re-view) — NOT JUDGED (tool bug)

> same here

## The tool bug (fixed the same session)

After the first two items the stage cycled the rotation instead of the
chosen move. Causes: selecting an item did not touch the stage (the log
shows no setup pressed for 7c / 3), and a stage tab that reloads (e.g.
"open stage window" pressed again — that re-navigates the named window)
comes back with no forced move → rotation. Fixes in judge.js: selecting
an item applies its first setup; the latest press wins (no overlapping
commands); a second "open stage" only focuses the window; the page
watches the stage's forced-move setting and re-applies the setup after a
reload (verified: reload → back to punchcam in ~2 s); only a VISIBLE
judge page steers, so two judge tabs can't fight over one stage.
