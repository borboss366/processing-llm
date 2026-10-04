# The capture pipeline, in plain words

The same system as [PIPELINE.md](PIPELINE.md), without the math. Read
this first; go to the technical page when you want the depth. Open a
clip's explorer beside it (`corpus/<clip>.explorer.html`).

## The whole thing in one breath

A video of a dancer goes in. A neural net puts **dots** on his joints,
frame by frame. We **steady** the dots, decide whether we're seeing him
**from the front or the side**, and turn the dots into **angles** — how
much each limb is bent, measured the same way the puppet's limbs bend.
The dance repeats, so we find the **repeat length**, line the
repetitions up, and average them into one clean **loop**. The loop gets
boiled down to a handful of **key poses** with notes about which foot
is on the ground. That file — the **table** — is what the stage plays.

One question per stage: 0 *what did the camera see?* · 1 *where are his
joints?* · 2 *can we trust the dots frame-to-frame?* · 3 *which way is
he facing?* · 4 *bent compared to what?* · 5 *how bent is each limb?* ·
6 *how long is one repeat, and do the repeats agree?* · 7 *which few
poses tell the whole story?* · 8 *what exactly does the stage get?*

## 0 · Input — what did the camera see?

**What it does:** cuts your chosen seconds out of the video and crops
in on the dancer, one fixed crop for the whole clip.
**Why it exists:** the net sees small dancers badly; zooming in helps.
**The analogy:** a camera operator who frames the shot once and then
keeps his hands off.
**What can go wrong:** we once let the crop chase the dancer every
frame — it looked smarter, but the dots got *shakier*, because the net
uses the previous frame to steady itself and we kept yanking its view.
**How I'd notice:** explorer stage 0 shows the actual cropped frame.
If his feet are cut off, nothing downstream can know where the floor
is. ([PIPELINE.md §0](PIPELINE.md))

## 1 · Landmarks — where are his joints?

**What it does:** a pose net marks 21 points — ears to toes — on every
frame, each with a confidence score.
**Why it exists:** everything after this is geometry on those points.
**The analogy:** pinning numbered stickers on a dancer and filming the
stickers.
**What can go wrong:** the leg furthest from the camera is half-hidden,
so the net *guesses*. For weeks the running man's far leg barely moved
on stage; the low confidence scores had been pointing at the guess the
whole time. The net also offers a 3D skeleton — it's a guess too, and
we stopped trusting it entirely.
**How I'd notice:** stage 1 colors each dot by confidence — red dots
are the net admitting it's guessing. ([PIPELINE.md §1](PIPELINE.md))

## 2 · Smoothing — can we trust the dots frame-to-frame?

**What it does:** steadies the jittery dots without making them late.
**Why it exists:** raw dots tremble a few pixels every frame; angles
made from trembling dots tremble worse.
**The analogy:** a steadicam, not a delay line — it averages a little
of the past *and* a little of the future, so it never lags.
**What can go wrong:** our first filter only looked backwards, so every
dot ran about a twentieth of a second late — and *later* the faster he
moved. The whole dance smeared sideways in time before we measured the
lag and swapped the filter.
**How I'd notice:** stage 2's "lag" number should be about zero; in the
trace, the smoothed line should sit *on* the raw one, not behind it.
([PIPELINE.md §2](PIPELINE.md))

## 3 · View select — which way is he facing?

**What it does:** decides front-view or side-view, once per clip, and
nothing else. No rotating.
**Why it exists:** the puppet has a front body and a side body; the
table must know which one it's for.
**The analogy:** you can't turn a photograph to see someone's other
side — you can only squash it. So we don't try.
**What can go wrong:** we used to "rotate" side-view clips to face
front mathematically. With flat 2D dots that rotation is really just a
horizontal squeeze — and it squeezed the running man's knee-lift almost
to nothing. Deleting the rotation brought the lift back, times three.
**How I'd notice:** stage 3 shows the facing decision; if a clearly
sideways clip says "front", everything after is built on a squash.
([PIPELINE.md §3](PIPELINE.md))

## 4 · The rest reference — bent compared to what?

**What it does:** picks the neutral pose that every angle is measured
against: the *puppet's own* standing pose.
**Why it exists:** "the elbow is bent 40°" only means something
relative to some zero.
**The analogy:** measuring your height against a wall mark, not against
however you happened to slouch this morning.
**What can go wrong:** we once used the *dancer's average pose* as the
zero. A running man holds his arms pumped forward the entire clip — so
"arms forward" became his zero and was subtracted out. On stage the
arms just hung. The fix: the puppet's standing pose is the zero, and
whatever the dancer habitually holds is part of the dance.
**How I'd notice:** stage 4 draws two stickmen — his habitual pose and
the puppet's rest. The difference between them is exactly what the old
bug erased. ([PIPELINE.md §4](PIPELINE.md))

## 5 · Retarget — how bent is each limb?

**What it does:** turns dots into one bend-angle per joint, every
frame, in the puppet's terms.
**Why it exists:** the puppet is driven by angles, not positions — that
way its limbs never stretch.
**The analogy:** telling a marionette operator "upper arm 30° forward,
elbow folded 90°" instead of handing him a photo.
**What can go wrong:** for side views, one of the dancer's legs maps
onto the puppet's *mirrored* leg, and for a while that leg got every
bend backwards — it kicked back when the near leg lifted. The giveaway
was that its error was always exactly *double* the movement.
**How I'd notice:** stage 5's table has a "round-trip" column — rebuild
the dots from the angles and compare. It should be all green zeros; any
red row is a mismapped joint. ([PIPELINE.md §5](PIPELINE.md))

## 6 · Period & cycles — how long is one repeat?

**What it does:** finds the loop length, lines the repetitions up, and
averages them into one clean cycle.
**Why it exists:** one averaged loop is steadier than any single
repetition — if the repetitions are truly lined up.
**The analogy:** a stack of tracing-paper drawings of the same step;
aligned, the stack sharpens; misaligned, it blurs.
**What can go wrong:** the detector once decided the running man's loop
was a single *step*, not the left-right pair. Every second sheet in the
stack was the wrong leg, and averaging halved the stride — that was the
famous "lost stride". Now the system checks whether the sheets only
agree when the loop is doubled, and doubles it.
**How I'd notice:** stage 6 overlays the repetitions as ghosts. Ghosts
that alternate strong-leg / weak-leg mean the loop length is half of
the truth. ([PIPELINE.md §6](PIPELINE.md))

## 7 · Distill — which few poses tell the whole story?

**What it does:** reduces the averaged loop to key poses — at the
extremes and turning points — plus which foot is planted, and how far
he travels.
**Why it exists:** the stage interpolates between keys; a small file
plays cheaply and edits easily.
**The analogy:** an animator's keyframes: draw the extremes, let the
in-betweens be filled in.
**What can go wrong:** a limb that barely *moves* but is strongly
*held* — an arm kept raised — once got dropped entirely for "not
moving", and the puppet's arm fell to its side. Held poses are kept now
even when they don't wiggle.
**How I'd notice:** stage 7 draws the dots (keys) on the curve; the
curve rebuilt from the dots should hug the original. The stage-8 table
lists every key. ([PIPELINE.md §7](PIPELINE.md))

## 8 · The table — what exactly does the stage get?

**What it does:** writes the final file: key poses, foot contacts,
travel, facing, and where it came from.
**Why it exists:** it's the handoff — the only thing the live stage
ever reads from this whole pipeline.
**The analogy:** sheet music. The band (the engine) still has to play
it.
**What can go wrong:** everything above can be perfect and the *playing*
still wrong — the knees-that-wouldn't-bend bug lived entirely on the
band's side of the handoff.
**How I'd notice:** that's the engine explorer's job —
[ENGINE_PLAIN.md](ENGINE_PLAIN.md). ([PIPELINE.md §8](PIPELINE.md))

## How to read the explorer like a story

Open three panels, in this order:
1. **The on-frame overlay (OV)** — the puppet skeleton drawn on the
   video. Good: it shadows the dancer like a fencing partner. Bad: it
   faces the wrong way, a limb hangs while his is raised, or it stands
   straight through his knee-lift.
2. **The cycle ghosts (stage 6)** — the repetitions overlaid. Good:
   one thick confident line. Bad: two alternating families of ghosts
   (wrong loop length) or one ghost far from the rest (a bad rep).
3. **The heatmap (DIAG)** — joints down the side, time across. Good:
   calm and dark. Bad: one bright row — that joint, at those moments,
   is where the story breaks; click it and the scrubber takes you
   there.
