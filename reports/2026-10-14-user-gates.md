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

## Second pass (same day, after the rating-page fixes)

### 7c — Cartoon punch at the camera — **PASS**
Looked at: dial 0, 1, 1.5. The verdict button read "no" (left over from
the first pass); the text is the verdict:
> Cartoon punch looks rather good. I think we can accept this one.

### 3 — Running man in profile (A7 re-view) — **PASS for the side view**
Looked at: plain, -x, front version, rotation.
> running man both plain and exaggerated looks quite fun and cartoonish.
> front version is weird - because the body is like nailed in the center
> and legs and arms wiggle, though i would say in transition may be good
> enough. rotation parameter seem to do nothing.

Notes: the front version is the depth-only reinterpretation (no in-plane
leg motion) — "nailed in the center" is the same missing support-leg /
root motion as the kick (7a). "Rotation does nothing" was a real bug:
the setup sent an empty move, which the OSC path drops, so the previous
forced move stayed. Fixed with an explicit 'auto' value (engine + rating
page + the puppet's "(auto by state)", which had sent 'none' = no table);
verified: 40 s of rotation cycles all six captured moves with view switches.

### Thinner goo — **PARTLY**
Looked at: 0.18, 0.24, 0.30, 0.30 + bones.
> I would say became better, but might be that we need exaggerate more.
> Like in cartoons, probably need to think about this one.

## Open after this session
- Support leg / root motion (kick "hanged on the back", front running man
  "nailed in the center") — proposed engine task, awaiting go.
- Goo: thinner helps; cartoon exaggeration to think about (owner).
- Item 5 (engine explorer desk task) and item 6 (explain-it paragraph).
