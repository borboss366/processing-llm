import { generate } from "../llm/ollama-client.js";

const QWEN_MODEL = "qwen3:8b";

// Two short examples of how to expand a brief into a structured task prompt.
// These are deliberately compact — they teach the SHAPE of an expansion,
// not the full guide (the second-stage generator has the guide for that).
const EXPANDER_EXAMPLES = `
# Example expansions

## Example 1 — single-subject (mascot) brief

BRIEF: A dancing carrot in the center of the screen.

EXPANSION:
Task: author a \`carrot\` module — an audio-reactive dancing carrot mascot.

Spec:
  - id: "carrot", oscPrefix: "carrot"
  - SINGLE-SUBJECT — use the §8.1 anchor-to-CENTER recipe.
  - Default layout: x=0.5, y=0.5, width=0.2, height=0.3, anchor="center", zOrder=0.
  - Physics: none (empty {}).
  - Params:
      bodyColor      color   default "#ff8c00"    description "Carrot body fill colour" osc:true
      leafColor      color   default "#28a040"    description "Leaf fill colour" osc:true
      baseSize       int     default 60           range [20, 200]    description "Half-height of body in pixels at rest" osc:true
      swayStrength   float   default 1.0          range [0, 3]       description "Multiplier for bass-driven sway" osc:true
      jumpStrength   float   default 7.0          range [0, 20]      description "Initial upward velocity on beat" osc:true
      bassSmoothing  float   default 0.07         range [0.02, 0.3]  description "lerp factor toward bassEnergy" osc:true
  - Effects:
      tiltOnBass     boolean default true         description "Rotate with smoothed bass" osc:true

State (declare at module top):
  float carrotCX, carrotCY;
  float carrotSmoothedBass = 0;
  float carrotJumpVel = 0;
  float carrotJumpOffset = 0;

## Geometry — copy this VERBATIM

Inside carrot_draw(), after the transforms, set \`float s = carrotBaseSize;\`
and use these EXACT calls. Origin (0, 0) is the WAIST. Body apex DOWN
(apex at +s, base above origin); leaves apex UP (apex above the body).

\`\`\`java
fill(carrotBodyColor);
triangle(0, s, -s/3, -2*s/3, +s/3, -2*s/3);

fill(carrotLeafColor);
triangle(-s/4, -2*s/3, -s/2, -2*s/3 - s*0.7, 0,    -2*s/3 - s*0.4);
triangle( 0,   -2*s/3, -s/4, -2*s/3 - s,     +s/4, -2*s/3 - s    );
triangle(+s/4, -2*s/3,  0,   -2*s/3 - s*0.4, +s/2, -2*s/3 - s*0.7);
\`\`\`

## Behaviour in carrot_draw()
  1. carrotSmoothedBass = lerp(carrotSmoothedBass, bassEnergy, carrotBassSmoothing);
  2. if (onBeat) carrotJumpVel = -carrotJumpStrength;
     carrotJumpVel += 0.4; carrotJumpOffset += carrotJumpVel;
     if (carrotJumpOffset > 0) { carrotJumpOffset = 0; carrotJumpVel = 0; }
  3. pushMatrix(); translate(carrotCX, carrotCY); scale(1 + smoothedLevel * 2.0);
  4. if (carrotTiltOnBass) rotate(sin(carrotSmoothedBass * 0.5));
  5. translate(sin(frameCount * 0.05) * carrotSmoothedBass * 30 * carrotSwayStrength, 0);
  6. translate(0, carrotJumpOffset);
  7. Draw body + leaves using verbatim geometry above.
  8. popMatrix();

## Required: full OSC handler

\`carrot_osc(msg)\` must NOT be empty. Exactly SEVEN \`checkAddrPattern\` entries
(6 params + 1 effect), addresses \`/carrot/<name>\`.

---

## Example 2 — single-subject WITH jointed-limb animation (skeletal)

BRIEF: A stick boy on the right waving his arms.

EXPANSION:
Task: author a \`stickboy\` module — a stick figure on the right side of the
screen, waving his arms to the music.

Spec:
  - id: "stickboy", oscPrefix: "stickboy"
  - SINGLE-SUBJECT — use the §8.1 anchor-to-CENTER recipe.
  - Default layout: x=0.85, y=0.5, width=0.25, height=0.6, anchor="center", zOrder=5.
  - Physics: none (empty {}).
  - Params:
      bodyColor      color   default "#3a6fb5"    description "Body / limb stroke colour" osc:true
      handColor      color   default "#ffcc55"    description "Hand fill colour" osc:true
      baseSize       int     default 80           range [30, 200]    description "Half-height in pixels at rest" osc:true
      waveRate       float   default 0.18         range [0.05, 0.5]  description "Arm wave rate (radians per frame)" osc:true
      waveAmplitude  float   default 0.5          range [0, 1.2]     description "Max arm swing in radians from baseline" osc:true
      jumpStrength   float   default 7.0          range [0, 20]      description "Initial upward velocity on beat" osc:true
      bassSmoothing  float   default 0.07         range [0.02, 0.3]  description "lerp factor toward bassEnergy" osc:true
  - Effects:
      jumpOnBeat     boolean default true         description "Whole figure jumps on beat" osc:true

State (declare at module top):
  float stickboyCX, stickboyCY;
  float stickboySmoothedBass = 0;
  float stickboyJumpVel = 0;
  float stickboyJumpOffset = 0;

## Geometry — copy this VERBATIM

Origin (0, 0) is the WAIST. Static body parts drawn first; arms drawn with
per-joint pushMatrix so each rotates independently around its SHOULDER.
Replace \`armOsc\` inside the rotate() call — it's a behaviour variable
declared in the next section.

\`\`\`java
// static body parts: spine, legs, head
stroke(stickboyBodyColor); strokeWeight(s * 0.06);
line(0, -s*0.55, 0, 0);              // spine
line(0, 0, -s*0.2, s*0.8);           // left leg
line(0, 0, +s*0.2, s*0.8);           // right leg
noStroke(); fill(stickboyBodyColor);
ellipse(0, -s*0.7, s*0.3, s*0.3);    // head

// RIGHT arm — own joint matrix, baseline up-right at -PI/3, swings with armOsc
pushMatrix();
  translate(0, -s*0.5);              // shoulder
  rotate(-PI/3 + armOsc);
  stroke(stickboyBodyColor); strokeWeight(s * 0.06);
  line(0, 0, s*0.5, 0);              // arm extends along local +x
  noStroke(); fill(stickboyHandColor);
  ellipse(s*0.5, 0, s*0.4, s*0.4);   // hand
popMatrix();

// LEFT arm — own joint matrix, baseline up-left at -2*PI/3, OPPOSITE phase
pushMatrix();
  translate(0, -s*0.5);
  rotate(-2*PI/3 - armOsc);          // note the MINUS for opposite phase
  stroke(stickboyBodyColor); strokeWeight(s * 0.06);
  line(0, 0, s*0.5, 0);
  noStroke(); fill(stickboyHandColor);
  ellipse(s*0.5, 0, s*0.4, s*0.4);
popMatrix();
\`\`\`

## Behaviour in stickboy_draw()
  1. stickboySmoothedBass = lerp(stickboySmoothedBass, bassEnergy, stickboyBassSmoothing);
  2. if (stickboyJumpOnBeat && onBeat) stickboyJumpVel = -stickboyJumpStrength;
     stickboyJumpVel += 0.4; stickboyJumpOffset += stickboyJumpVel;
     if (stickboyJumpOffset > 0) { stickboyJumpOffset = 0; stickboyJumpVel = 0; }
  3. // limb-local angle: rate scales with smoothedLevel; amplitude with waveAmplitude
     float armOsc = sin(frameCount * stickboyWaveRate * (1 + smoothedLevel * 2.0)) * stickboyWaveAmplitude;
  4. pushMatrix(); translate(stickboyCX, stickboyCY); scale(1 + smoothedLevel * 1.5);
  5. translate(0, stickboyJumpOffset);
  6. Draw body + arms using verbatim geometry above (armOsc is in scope).
  7. popMatrix();

## Required: full OSC handler

\`stickboy_osc(msg)\` must NOT be empty. Exactly EIGHT \`checkAddrPattern\` entries
(7 params + 1 effect), addresses \`/stickboy/<name>\`.

---

## Example 3 — bounding-box brief

BRIEF: A small plane flying back and forth across the top.

EXPANSION:
Task: author a \`plane\` module — a small airplane flying back-and-forth
across the top of the canvas, reacting to live audio.

Spec:
  - id: "plane", oscPrefix: "plane"
  - BOUNDING-BOX (subject animates within a rect). Compute planePX, planePY,
    planePW, planePH using the equalizer §6.2 anchor-to-top-left pattern.
  - Default layout: x=0, y=0.05, width=1.0, height=0.15, anchor="top-left", zOrder=10.
  - Physics: none (empty {}).
  - Params:
      planeColor     color   default "#e0e0e0"    description "Aircraft fill colour" osc:true
      planeSize      int     default 40           range [20, 120]    description "Half-length of fuselage" osc:true
      baseSpeed      float   default 3.0          range [0.5, 10]    description "Speed at rest, pixels/frame" osc:true
      speedBoost     float   default 1.5          range [0, 4]       description "Multiplier from smoothedLevel" osc:true
      bobAmplitude   float   default 8.0          range [0, 30]      description "Vertical bob with bass" osc:true
      bassSmoothing  float   default 0.07         range [0.02, 0.3]  description "lerp factor toward bassEnergy" osc:true
  - Effects:
      dipOnBeat      boolean default true         description "Dip momentarily on beat" osc:true

State (declare at module top):
  float planeX = -9999;
  int planeDir = 1;
  float planeSmoothedBass = 0, planeDipVel = 0, planeDipOffset = 0;
  float planePX, planePY, planePW, planePH;

## Geometry — copy this VERBATIM

The plane is drawn facing RIGHT in local coords; \`scale(planeDir, 1)\` flips it
when going left. Set \`float s = planeSize;\` inside plane_draw().

\`\`\`java
fill(planeColor);
triangle(-s, -s*0.15, -s, s*0.15, s, 0);
triangle(-s*0.4, 0, s*0.3, 0, -s*0.1, s*0.5);
triangle(-s, -s*0.1, -s*0.6, -s*0.5, -s*0.6, -s*0.1);
\`\`\`

## Behaviour in plane_draw()
  1. planeSmoothedBass = lerp(planeSmoothedBass, bassEnergy, planeBassSmoothing);
  2. if (planeDipOnBeat && onBeat) planeDipVel = 5;
     planeDipVel *= 0.85; planeDipOffset += planeDipVel; planeDipOffset *= 0.92;
  3. float speed = planeBaseSpeed * (1 + smoothedLevel * planeSpeedBoost);
  4. planeX += speed * planeDir;
     if (planeX > planePX + planePW - planeSize) planeDir = -1;
     if (planeX < planePX + planeSize) planeDir = 1;
  5. float baseY = planePY + planePH/2;
     float y = baseY + sin(frameCount * 0.05) * planeBobAmplitude * planeSmoothedBass + planeDipOffset;
  6. pushMatrix(); translate(planeX, y); scale(planeDir, 1);
  7. Draw plane using verbatim geometry above.
  8. popMatrix();

## Required: full OSC handler

\`plane_osc(msg)\` must NOT be empty. Exactly SEVEN \`checkAddrPattern\` entries
(6 params + 1 effect), addresses \`/plane/<name>\`.
`;

const EXPANDER_INSTRUCTIONS = `You are an EXPANDER. Given a brief description
of a Processing visualiser module, write a structured task prompt for a
second-stage generator that knows the full module API.

# A task prompt has these sections in this exact order:

1. Task: one-line description
2. Spec block:
   - id (lowercase kebab-case) + oscPrefix (3-8 chars, related to id)
   - SINGLE-SUBJECT (subject drawn around one anchor point) OR BOUNDING-BOX (subject animates within a rectangle) — choose based on the brief
   - Default layout: x, y, width, height (as 0..1 fractions), anchor, zOrder
   - Physics: empty {}
   - Params: 5-7 OSC-controllable values. Always include "baseSize" or similar size knob, color(s), at least one motion-strength multiplier, "bassSmoothing"
   - Effects: 1-3 booleans toggling motion modes
3. State variables declaration block
4. Geometry section: ACTUAL triangle()/line()/ellipse()/quad()/vertex() calls
   that draw THIS specific subject. Use \`s\` as the size unit. NEVER copy the
   carrot or plane geometry verbatim if the subject is different — invent
   coordinates appropriate to the subject.
5. Behaviour section: numbered transformation/animation steps
6. OSC handler section: exact count of checkAddrPattern entries

# Geometry rules — STRICT

When inventing geometry, draw the subject around (0, 0) so it sits centered.
Processing y grows DOWN. Use \`s\` (= baseSize) as the unit. FOLLOW THESE RULES:

1. **stroke() + strokeWeight() before any line() call.** Processing's default
   stroke is invisible against a black background. If your subject uses lines
   (stick figure, branches, antennae, etc.), the FIRST two lines inside the
   Geometry block must be:
       stroke(<prefix>BodyColor);
       strokeWeight(s * 0.06);
   …followed by the actual line() calls. Without this, lines do not render.

2. **line() takes EXACTLY 4 arguments** — \`line(x1, y1, x2, y2)\`. Never use
   the 6-argument form \`line(x1,y1,z1, x2,y2,z2)\` — that's a 3D-only overload
   that silently suppresses rendering in 2D mode. If you want a bent arm,
   draw TWO separate 4-arg lines (shoulder → elbow, elbow → hand), not one
   6-arg line.

3. **No animation variables inside the Geometry block.** Geometry coordinates
   must be PURE constants of \`s\` (e.g. \`-s*0.5, +s*0.8\`). Any animation
   (waving, jumping, swinging) goes in the Behaviour section as transforms
   applied BEFORE the geometry draws, never as offsets baked into the
   triangle/line/ellipse arguments. Example WRONG: \`line(0, -s*0.5, x, y + jumpOffset)\`.
   Example RIGHT: in Behaviour: \`translate(0, jumpOffset)\`; in Geometry: \`line(0, -s*0.5, x, y)\`.

4. **Mix fill() with stroke() correctly.** Shapes with closed area (ellipse,
   rect, triangle, quad) use \`fill()\` for their interior — set fill before
   each one. Pure-line shapes (line, polyline) use \`stroke()\` — set stroke
   before each one. If a shape needs both an interior and an outline, set
   both before drawing.

5. **noStroke() and noFill()** disable each. Useful if you have a section of
   filled shapes followed by lines — call noFill() before line() if you
   don't want filled artefacts, or noStroke() before ellipse() if you don't
   want an outline.

6. **Skeletal animation for jointed limbs.** When the brief asks for parts
   that move INDEPENDENTLY of the body (waving arms, swinging legs, fins,
   antennae, propellers, jaws, swaying tails, blinking eyes, articulated
   wings, windmill blades), do NOT animate via the figure-wide transform
   stack — the whole figure would rotate. Instead, wrap EACH limb in its
   own per-joint matrix:

       pushMatrix();
         translate(jointX, jointY);            // joint (shoulder, hip, hinge, hub)
         rotate(<prefix>LimbAngle);            // limb-local angle in RADIANS
         // draw the limb along local +x (it extends from the joint outward)
         stroke(<prefix>BodyColor); strokeWeight(s * 0.06);
         line(0, 0, limbLength, 0);
         noStroke(); fill(<prefix>HandColor);
         ellipse(limbLength, 0, s*0.4, s*0.4); // end-cap (hand, foot, tip, paddle)
       popMatrix();

   The limb angle goes in the Behaviour section, not Geometry. **Choose the
   angle equation by motion VERB in the brief** — this is a hard distinction:

   - **SPIN / ROTATE / TWIRL / WHIRL / TURN / REVOLVE → CONTINUOUS rotation**
     (monotonically increasing angle, never wraps with sin):
         float <prefix>SpinAngle = frameCount * <prefix>SpinRate *
                                  (1 + smoothedLevel * <prefix>SpinMultiplier);
     **Sensible default for SpinRate: 0.02–0.04** rad/frame
     (≈ 0.2–0.4 rev/sec at 60fps). NEVER 0.1+ for a windmill/wheel/propeller
     — that's a blender, not a windmill. Range typically [0.005, 0.15].
     Multiple symmetric limbs (4 blades, 8 spokes) all share the SAME
     spinAngle plus a CONSTANT offset (\`HALF_PI\`, \`TWO_PI/N\`, etc.) — never
     sign-flipped, that would split them into counter-rotating halves.

   - **WAVE / SWING / SWAY / OSCILLATE / WOBBLE / NOD / FLAP → OSCILLATION**
     (sin-wrapped, bounces between extremes):
         float <prefix>WaveAngle = baselineAngle + sin(frameCount * rate) * amplitude;
     **Sensible default for WaveRate: 0.10–0.20** rad/frame, amplitude
     ≈ 0.4–0.7 radians. Paired oscillating limbs use OPPOSITE phase:
     \`+ sin(...)\` on one side, \`- sin(...)\` on the other.

   Mixed cases (e.g. "propeller wobble"): start with spin, add a small
   sin-based wobble inside the rotate(): \`rotate(spinAngle + sin(...) * 0.1)\`.

# Geometry hint examples for common subjects

- **Stick figure**:
    \`\`\`
    stroke(<prefix>BodyColor); strokeWeight(s * 0.06);
    line(0, -s*0.55, 0, 0);                  // spine
    line(0, -s*0.5, -s*0.5, -s*0.5);         // left arm (static — animation via transform)
    line(0, -s*0.5, +s*0.5, -s*0.5);         // right arm
    line(0, 0, -s*0.2, s*0.8);               // left leg
    line(0, 0, +s*0.2, s*0.8);               // right leg
    noStroke(); fill(<prefix>BodyColor);
    ellipse(0, -s*0.7, s*0.3, s*0.3);        // head
    \`\`\`
- **Cloud**: noStroke(); fill(<prefix>Color); 3-4 overlapping ellipse(±s*0.4, ±s*0.2, s*0.8, s*0.5)
- **Tree**: fill(brown); rect(-s*0.1, 0, s*0.2, s*0.8); fill(green); ellipse(0, -s*0.4, s, s*1.2)
- **Flower**: fill(yellow); ellipse(0, 0, s*0.4, s*0.4) center; loop of petal ellipses around it
- **Star**: noStroke(); fill(<prefix>Color); beginShape() + vertex loop alternating outer/inner radii
- **Fish**: triangle body + triangle tail + noStroke() + small ellipse eye
- **Robot**: stroke(<prefix>Color); strokeWeight(s*0.06); 4 lines for limbs; fill() for head/body rects
- **Spaceship**: triangle hull + triangle wings + ellipse cockpit
- **Lightning bolt**: stroke(); strokeWeight(); zigzag via 3-5 separate 4-arg line() calls
- **Eye**: noStroke(); ellipse outer + ellipse iris + small ellipse pupil
- **Wave/scroll**: stroke(); noFill(); beginShape() + vertex loop along horizontal line

Behaviours common to most modules (pick what fits the brief):
- Volume scaling: scale(1 + smoothedLevel * 1.5..2.5)
- Bass-driven rotation/tilt: rotate(sin(smoothedBass * 0.5))   // RADIANS
- Bass-driven horizontal sway: translate(sin(frameCount * 0.05) * smoothedBass * 30, 0)
- Beat-driven jump: impulse-velocity pattern with gravity 0.4
- Beat-driven flash: decay-towards-0 alpha value
- Continuous oscillation: sin(frameCount * rate) → angle or offset

REMEMBER: rotate() takes RADIANS — never multiply by 30 or 180.

# Output

Output ONLY the expanded task prompt. NO preamble, NO commentary, NO \`Sure here is\`.
The very first line must start with \`Task: author a\`.
`;

export type ExpandBriefResult = {
  expandedPrompt: string;
  durationSec: number;
  evalCount: number;
  promptTokens: number;
};

export async function expandBrief(brief: string): Promise<ExpandBriefResult> {
  const fullPrompt =
    EXPANDER_INSTRUCTIONS +
    "\n" + EXPANDER_EXAMPLES +
    "\n---\n\n# Now expand this brief\n\nBRIEF: " +
    brief.trim() +
    "\n\nEXPANSION:\n";

  const result = await generate(QWEN_MODEL, fullPrompt, {
    think: false,
    options: {
      temperature: 0.3,
      top_p: 0.9,
      repeat_penalty: 1.05,
      num_ctx: 12288,
      num_predict: 3500,
    },
  });

  // Strip any preamble before the first "Task:" line.
  let text = result.response.trim();
  const taskIdx = text.search(/^Task:/m);
  if (taskIdx > 0) text = text.slice(taskIdx);

  return {
    expandedPrompt: text,
    durationSec:    result.total_duration / 1e9,
    evalCount:      result.eval_count,
    promptTokens:   result.prompt_eval_count,
  };
}
