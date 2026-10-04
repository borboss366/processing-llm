# The engine, in plain words

The same system as [ENGINE.md](ENGINE.md), without the math. The
engine is everything between a move table and pixels. Read with an
engine explorer open (`reports/engine-<move>-<shape>.engine.explorer
.html`) or the puppet page's live Engine view.

## The whole thing in one breath

The stage has a **table** — sheet music of key poses. Each frame, the
engine looks up **where in the loop** the music says we are and reads
the pose. If a new move just started, it **crossfades** from the old
one. A **spring** smooths every value so nothing snaps. The
**liveness** layer adds breath — tiny wander, a stronger beat, one side
slightly dominant. **Limits** stop anatomically silly bends. The
**stance lock** holds planted feet on the floor. **FK** turns the
angles into actual joint positions, limb by limb, parent to child.
**Depth** cues fake the third dimension. The **tissue** — a cloud of
soft points — follows the skeleton like flesh. The **goo** renderer
melts the cloud into one shaded body on screen.

One question per stage: 1 *what pose does the music ask for?* · 2 *are
we between moves?* · 3 *is anything snapping?* · 4 *does it breathe?* ·
5 *is any bend impossible?* · 6 *are the feet honest?* · 7 *where is
every joint, actually?* · 8 *does it read as 3D?* · 9 *does the flesh
follow?* · 10 *does the skin hold together?*

## 1 · Table playback — what pose does the music ask for?

**What it does:** finds today's position in the loop and reads the
pose between the two nearest key poses.
**Why it exists:** the table only stores a handful of keys; the
in-betweens are made here.
**The analogy:** a pianist reading between two chords — the hands are
always somewhere en route.
**What can go wrong:** the biggest bug in the project's history lived
here: the engine and the capture pipeline *named* the angles one joint
apart, like two orchestras with the parts shifted one chair over. A
knee bent 100° in the table swung the *thigh* instead, and the leg drew
straight. Captured tables are now translated at load.
**How I'd notice:** the ladder's first rung should be exactly zero —
this stage *is* the reference. The knees bug showed as the final
skeleton ignoring the ghost. ([ENGINE.md §1](ENGINE.md))

## 2 · Blend / crossfade — are we between moves?

**What it does:** when the move changes, fades the old table out and
the new one in over a bar.
**Why it exists:** without it the body teleports to the new dance on a
frame boundary.
**The analogy:** a DJ crossfader, not a track skip.
**What can go wrong:** an early version blended the *pose* but switched
the *rhythm* instantly — the body was continuous but the beat pattern
jumped. The fade now carries both.
**How I'd notice:** the blend rung reads near zero once settled; the
flag strip shows a violet band while a fade is in flight — deviations
inside the band are the fade doing its job. ([ENGINE.md §2](ENGINE.md))

## 3 · Springs — is anything snapping?

**What it does:** every value from the table goes through a small
spring that eases it toward its target.
**Why it exists:** a "snap" key would otherwise jump in one frame — a
visible hiccup.
**The analogy:** a rubber band between the sheet music and the hand:
pull, and the hand arrives a beat of a heart later.
**What can go wrong:** nothing *broke* here — the opposite: this is
where fidelity quietly leaks. The spring is the single biggest gap
between table and screen, the "softness" you feel when a sharp captured
kick lands mushy. It's a known, measured trade: springiness versus
punch.
**How I'd notice:** the spring rung is the tallest bar in the ladder on
every clip. Halve the `moveSpringWn` knob on the puppet page and watch
it grow. ([ENGINE.md §3](ENGINE.md))

## 4 · Liveness — does it breathe?

**What it does:** adds slow wander to each joint, a push on the
downbeat, a slightly dominant side, and the head trailing the body.
**Why it exists:** a perfect loop reads as a screensaver within a
minute.
**The analogy:** a drummer's human timing — never twice exactly the
same, always the same song.
**What can go wrong:** the head's "look around" was once a hard step:
at some threshold it flicked, a literal twitch, our top hiccup source
for a while. It now glides to its target.
**How I'd notice:** the liveness rung should add pennies. On stage,
toggle the `liveness` param: off, the creature goes mannequin; on, it
breathes. ([ENGINE.md §4](ENGINE.md))

## 5 · Limits — is any bend impossible?

**What it does:** caps each joint at an anatomical maximum from the
body's spec; every capped frame is counted and reported.
**Why it exists:** one wrong number in a table shouldn't fold the
puppet inside out.
**The analogy:** a door stopper. Mostly you never touch it; when you
do, you want to *know*.
**What can go wrong:** captured kicks point the foot harder than the
old cap allowed — the kick clip's foot hit the stop for 180 straight
frames and the kick flattened. The rule now: any cap hit on a captured
table is a loud failure unless it's been explicitly waved through with
a written reason.
**How I'd notice:** red marks in the flag strip; the "clamps" count in
the report. The limits rung should add exactly nothing when no cap is
hit. ([ENGINE.md §5](ENGINE.md))

## 6 · Stance lock — are the feet honest?

**What it does:** holds a foot the table marks "planted" down on the
floor.
**Why it exists:** without it feet drift and swim, and the body looks
weightless.
**The analogy:** tape on the stage floor — but tape you can pull off,
because some moves slide the planted foot on purpose.
**What can go wrong:** twice. First the contacts were wrong and the
lock pinned a foot that should have swung — "only one leg moves".
Later the lock *rewrote* a real captured leg: it pinned the foot in
place and straightened the knee above it, while the actual move slides
the foot backward low along the floor. For captured moves the lock now
only holds feet down to floor height and otherwise believes the data.
**How I'd notice:** green (lock) and yellow (yield) marks in the flag
strip; the lock rung must add almost nothing.
([ENGINE.md §6](ENGINE.md))

## 7 · FK — where is every joint, actually?

**What it does:** walks the skeleton parent-to-child, turning angles
into positions: pelvis places the hips, hips place the knees, and so
on.
**Why it exists:** this is the step that guarantees limbs never
stretch — positions are *derived*, never drawn directly.
**The analogy:** a folding ruler: set each hinge's angle and the tip
ends up where the hinges say, never further.
**What can go wrong:** before true chaining, a hip bend didn't carry
the ankle with it — kicks moved the thigh and left the foot behind,
like a marionette with a cut string.
**How I'd notice:** the skeleton panel, "FK positions": the solid
skeleton over the table-ghost. The position row of the ladder measures
their gap in body units — it catches what angle-space can hide.
([ENGINE.md §7](ENGINE.md))

## 8 · Depth — does it read as 3D?

**What it does:** fakes the third dimension: a limb rotating toward
you draws shorter and slightly dimmer, feet fan wider, the body can
squeeze into a three-quarter hint.
**Why it exists:** the puppet is flat; without these cues, any motion
toward the camera simply vanishes.
**The analogy:** a shadow puppeteer tilting the puppet — the shadow
shortens, and you *read* rotation.
**What can go wrong:** before the twist channel, an arm raised toward
the camera looked like a chicken wing — the out-of-plane part of the
motion had nowhere to go, so it just looked broken.
**How I'd notice:** on stage, the goo-bones render mode: a
foreshortened bone should look deliberately short, not missing. The
trace records the per-limb depth factors. ([ENGINE.md §8](ENGINE.md))

## 9 · Tissue — does the flesh follow?

**What it does:** a cloud of soft points rides the skeleton — each
joint drags its nearest points, springs drag the rest, and the spine
bows through bends.
**Why it exists:** the creature is a blob with bones, not a stick
figure; the cloud is the blob.
**What can go wrong:** a fist's points once connected only by springs
whipped clean off the wrist during a fast swing — a severed mitt
floating beside the arm. Fists now grip every nearby point directly,
and extra padding is drawn along every bone so a limb *cannot* come
apart.
**The analogy:** a sock puppet over a hand — the hand moves, the sock
follows, slightly late and slightly soft.
**How I'd notice:** the component count in every harness must be 1 —
one connected body. A severed limb is instantly "components 2".
([ENGINE.md §9](ENGINE.md))

## 10 · Goo — does the skin hold together?

**What it does:** melts the point cloud into one smooth, lit body — the
thing the audience actually sees.
**Why it exists:** it *is* the look.
**The analogy:** mercury droplets pooling: close droplets merge into
one shape with one surface.
**What can go wrong:** where an arm crossed the torso, their
brightnesses used to *add* — a white flash at every overlap, like two
projectors aimed at the same wall. Overlaps now take the brighter of
the two instead of the sum.
**How I'd notice:** silhouette mode shows the pure shape — blobby but
whole. Watch an arm cross the body: no flash, no seam. The render-mode
strip at the bottom of each engine explorer shows bones, silhouette and
goo of the same frame. ([ENGINE.md §10](ENGINE.md))

## How to read the engine explorer like a story

Open three panels, in this order:
1. **The ladder** — one bar per stage, "how far from the sheet music
   after this step". Good: a staircase of pennies with one honest
   bump at the spring. Bad: any bar that dwarfs the spring — that
   stage is eating the dance; its name is on the bar.
2. **The skeleton panel** — ghost (the table) vs solid (the engine).
   Good: the solid shadows the ghost, bones green. Bad: a red limb
   doing its own thing — the knees bug looked exactly like that: ghost
   kicking, solid standing straight.
3. **The flag strip** — time across, colored ticks for caps hit,
   locks engaged, fades in flight, spikes. Good: sparse and
   explainable (locks under planted feet, a violet band at a move
   switch). Bad: a solid red band — a value pinned against its stop
   for the whole loop, like the kick clip's foot.
