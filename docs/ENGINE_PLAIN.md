# The engine, in plain words

This document describes the engine without formulas. The text follows
ASD-STE100 Simplified Technical English (STE): short sentences, one topic
for each paragraph, active voice, and the same five parts for each
stage. The technical version is [ENGINE.md](ENGINE.md).

The engine is all the steps between a move table and the pixels on the
screen. Read this document with an engine explorer open
(`reports/engine-<move>-<shape>.engine.explorer.html`) or with the
"Engine view" on the puppet page.

## The engine in one paragraph

The stage has a **table**. The table is a list of key poses, like sheet
music. For each frame, the engine finds the position in the loop and
reads the pose. When a new move starts, the engine **blends** from the
old move. A **spring** smooths each value, so that no value jumps. The
**liveness** step adds small variations. **Limits** stop each joint at
its natural range. The **stance lock** keeps a planted foot on the
floor. **FK** calculates the position of each joint from the angles.
**Weight** puts the body on the foot that carries it. **Depth cues** show movement toward the camera. The **tissue** is a
cloud of soft points that follows the skeleton. The **goo** step makes
one smooth body from the cloud.

Each stage answers one question:

| stage | question |
|---|---|
| 1 Table playback | Which pose does the table give now? |
| 2 Blend | Does a move change now? |
| 3 Springs | Does a value jump? |
| 4 Liveness | Does the loop look alive? |
| 5 Limits | Is a bend too large? |
| 6 Stance lock | Do the feet stay on the floor? |
| 7 FK | Where is each joint? |
| 7a Weight | Which foot carries the body? |
| 8 Depth | Does a movement toward the camera show? |
| 9 Tissue | Does the soft body follow the bones? |
| 10 Goo | Is the body one smooth shape? |

## 1 · Table playback

**What it does:** It finds the position in the loop. It calculates the
pose between the two nearest key poses.

**Why it is necessary:** The table keeps only a small number of key
poses. This stage makes all the poses between them.

**Comparison:** A pianist plays from one chord to the next chord. The
hands are always between two chords.

**What can go wrong:** The engine and the capture pipeline once gave
different names to the same angle. Each name was one joint from the
correct joint. Thus a knee bend of 100° in the table turned the thigh,
and the leg was straight. Now the engine changes the names when it loads
a captured table.

**How to see it:** In the explorer skeleton panel, the ghost is the
table. If the solid skeleton does not follow the ghost, look at this
stage first.

## 2 · Blend

**What it does:** When the move changes, it decreases the old move and
increases the new move over one bar.

**Why it is necessary:** Without a blend, the body jumps to the new move
in one frame.

**Comparison:** A DJ crossfader. The DJ does not stop one track and
start the next track.

**What can go wrong:** An old version blended the pose but changed the
rhythm immediately. The body moved smoothly, but the beat pattern jumped.
Now the blend changes the rhythm too.

**How to see it:** The "blend" rung on the ladder is almost zero when no
change occurs. A violet band in the flag strip shows each blend.

## 3 · Springs

**What it does:** Each value from the table goes through a small spring.
The spring moves the value to its target smoothly.

**Why it is necessary:** A "snap" key can change a value in one frame.
Without the spring, this change shows as a small jerk.

**Comparison:** A rubber band between the sheet music and the hand. The
hand follows, but a little late.

**What can go wrong:** A slow spring makes a sharp move soft. Captured
tables are already smooth, but they used the same slow spring as the
authored tables. A sharp kick looked soft. Now captured tables use a
spring that is six times faster. The spike count stays zero.

**How to see it:** The "spring" rung on the ladder. On a captured table
it is now small. On an authored table, set `moveSpringWn` to 5 on the
puppet page, and the rung increases.

## 4 · Liveness

**What it does:** It adds small, slow variations to each joint. It makes
the downbeat stronger. It makes one side of the body a little stronger.
The head follows the body a little late.

**Why it is necessary:** An exact loop looks mechanical after one
minute.

**Comparison:** A drummer never plays two bars in exactly the same way,
but the song stays the same.

**What can go wrong:** The head turn was once a step at a threshold. The
head made a small twitch. Now the head turns smoothly to its target.

**How to see it:** The "+gait/liveness" rung on the ladder is small. On
stage, set `liveness` to 0 on the puppet page. The creature moves like a
machine. Set it to 1 again.

## 5 · Limits

**What it does:** It stops each joint at a maximum angle from the body
file. It counts each stop.

**Why it is necessary:** A wrong number in a table must not fold the
body.

**Comparison:** A door stop. Usually the door does not touch it. When
the door touches it, you must know.

**What can go wrong:** A captured foot pointed harder than the limit
allowed. The foot touched the stop on most frames, and the kick looked
flat. Now each stop on a captured table is a failure. The only exception
is a table that lists the joint in its header, with a reason.

**How to see it:** A red band in the flag strip shows each stop. The
"clamps" count in the engine report shows the total.

## 6 · Stance lock

**What it does:** It keeps a foot on the floor when the table marks the
foot as planted.

**Why it is necessary:** Without it, the feet move over the floor and
the body looks too light.

**Comparison:** Tape on a stage floor. The tape can come off, because
some moves slide the planted foot.

**What can go wrong:** This happened two times. First, wrong contact
data kept a moving foot on the floor, and only one leg moved. Then the
lock changed a real captured leg. It held the foot in place and made the
knee straight. In the real move, the foot slides back along the floor.
Now, for captured tables, the lock only keeps the foot at floor height.

**How to see it:** Green marks in the flag strip show the lock. Yellow
marks show a release. The "lock+FK" rung on the ladder must stay small.

## 7 · FK (the joint positions)

**What it does:** It calculates the position of each joint from the
angles. It starts at the pelvis and goes along each chain to the hands
and feet.

**Why it is necessary:** The engine calculates positions from angles.
Thus a limb cannot become longer or shorter by error.

**Comparison:** A folding ruler. You set the angle of each hinge, and
the end of the ruler goes to one position only.

**What can go wrong:** In an old version, each joint followed only its
direct parent. A kick moved the thigh, but the foot stayed behind.

**How to see it:** The skeleton panel at "FK positions". The "FK
position" rung on the ladder gives the distance between the table
skeleton and the engine skeleton.

## 7a · Weight

**What it does:** It finds the foot that carries the body. It puts that
foot on the floor and puts the body above it. The pelvis moves over the
foot and tilts a little. The chest leans back a little. At each step the
body drops a little into the new foot.

**Why it is necessary:** Without it, the body does not stand on a foot.
Both feet move, and the body seems to hang in the air.

**Comparison:** A person who stands on one leg. The hip of that leg goes
up and the body moves over the foot.

**What can go wrong:** The first version used a slow signal to find the
support foot. During a fast step, the kicking foot stayed on the floor
and the standing foot was in the air. Now a fast signal finds the
support foot. A slow signal moves the pelvis, so the movement stays
smooth.

**How to see it:** Use the render mode "goo-bones" on stage. Change
`exaggerateWeight` on the puppet page: 0 stops this stage, 1 is normal,
1.5 is stronger. A move that has no weight looks the same at each value.

## 8 · Depth cues

**What it does:** It shows a movement toward the camera or away from the
camera. A part that comes toward the camera is larger, shorter and
brighter. A part that goes away is smaller, shorter and darker. An arm
that comes toward the camera is drawn in front of the body.

**Why it is necessary:** The creature is flat. Without these cues, a
movement toward the camera does not show.

**Comparison:** A cartoon. An animator draws a punch at the viewer as a
large fist on a short arm.

**What can go wrong:** A foot that points at the camera is only a few
pixels long in the video. Its angle is noise. We do not use this angle.
The foot keeps its rest angle, and the depth cues show the movement.

**How to see it:** Use the render mode "goo-bones" on stage. Change
`exaggerateDepth` on the puppet page: 0 stops all cues, 1 is normal,
1.5 is stronger. A standing figure looks the same at each value. The
`punchcam` move shows a punch at the camera with no other movement.

## 9 · Tissue

**What it does:** A cloud of soft points follows the skeleton. Each
joint holds its nearest points. Springs hold the other points.

**Why it is necessary:** The creature is a soft body with bones, not a
stick figure. The cloud is the soft body.

**Comparison:** A sock puppet. The hand moves, and the sock follows a
little late and a little soft.

**What can go wrong:** A fist was once held only by springs. During a
fast swing, the fist came off the arm. Now each hand holds all its points
directly. Extra points along each bone keep each limb in one piece.

**How to see it:** Each test counts the parts of the body. The count
must be 1. A loose fist makes the count 2.

## 10 · Goo

**What it does:** It makes one smooth, lit body from the cloud of
points. The audience sees this body.

**Why it is necessary:** This step gives the creature its look.

**Comparison:** Drops of mercury. Drops that touch become one shape
with one surface.

**What can go wrong:** Where an arm crossed the body, the two
brightnesses were added. This made a white flash. Now the engine uses
the brighter of the two values, not the sum.

**How to see it:** Use the render mode "silhouette". The shape must be
whole. Move an arm across the body: there is no flash and no seam.

## How to read the engine explorer

Open these three views in this sequence:

1. **The ladder.** Each bar shows the distance from the table after one
   stage. Good: all bars are small, and the spring bar is small. Bad:
   one bar is much larger than the others. The name on that bar is the
   stage that loses the movement.
2. **The skeleton panel.** The ghost is the table. The solid skeleton is
   the engine. Good: the solid skeleton follows the ghost, and the bones
   are green. Bad: one limb is red and does a different movement. The
   knee failure looked like this: the ghost kicked, and the solid leg
   stayed straight.
3. **The flag strip.** Each colored mark shows an event: a limit stop, a
   lock, a blend or a spike. Good: few marks, each with a reason. Bad: a
   long red band, for example a foot against its limit for the full
   loop.
