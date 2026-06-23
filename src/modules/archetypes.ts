/**
 * Module archetypes — pre-decided architectures that the user picks from.
 * Each archetype owns its full task-prompt template; qwen only invents the
 * subject-specific geometry. This eliminates the "qwen guessed the wrong
 * architecture" failure mode that the brief→expansion pipeline had.
 */

export type FieldType = "text" | "number" | "color" | "select";

export type ArchetypeField = {
  key: string;
  label: string;
  type: FieldType;
  default?: string | number;
  placeholder?: string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
};

export type Archetype = {
  id: string;
  name: string;
  description: string;
  fields: ArchetypeField[];
  /** Build the full task prompt sent to qwen (after the guide). */
  buildPrompt: (moduleId: string, prefix: string, inputs: Record<string, string | number>) => string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const POSITION_LAYOUT: Record<string, string> = {
  "top-left":      `x=0.1, y=0.15, width=0.2, height=0.3, anchor="center", zOrder=0`,
  "top-center":    `x=0.5, y=0.15, width=0.2, height=0.3, anchor="center", zOrder=0`,
  "top-right":     `x=0.9, y=0.15, width=0.2, height=0.3, anchor="center", zOrder=0`,
  "center-left":   `x=0.1, y=0.5,  width=0.2, height=0.4, anchor="center", zOrder=0`,
  "center":        `x=0.5, y=0.5,  width=0.2, height=0.4, anchor="center", zOrder=0`,
  "center-right":  `x=0.9, y=0.5,  width=0.2, height=0.4, anchor="center", zOrder=0`,
  "bottom-left":   `x=0.1, y=0.85, width=0.2, height=0.3, anchor="center", zOrder=0`,
  "bottom-center": `x=0.5, y=0.85, width=0.2, height=0.3, anchor="center", zOrder=0`,
  "bottom-right":  `x=0.9, y=0.85, width=0.2, height=0.3, anchor="center", zOrder=0`,
};

const POSITION_OPTIONS = Object.keys(POSITION_LAYOUT);

const layoutFor = (pos: string): string => POSITION_LAYOUT[pos] ?? POSITION_LAYOUT["center"]!;

// ── Archetype definitions ────────────────────────────────────────────────────

export const ARCHETYPES: Archetype[] = [

  // ── 1. MASCOT ─────────────────────────────────────────────────────────────
  {
    id: "mascot",
    name: "Mascot",
    description: "A single subject centered at an anchor, scaling with volume, swaying with bass, jumping on beats. Good for: dancing carrot, smiling sun, tomato, star, logo.",
    fields: [
      { key: "subject",     label: "Subject",       type: "text",   placeholder: "a smiling sun" },
      { key: "position",    label: "Position",      type: "select", default: "center", options: POSITION_OPTIONS },
      { key: "bodyColor",   label: "Body color",    type: "color",  default: "#ff8c00" },
      { key: "accentColor", label: "Accent color",  type: "color",  default: "#ffcc55" },
    ],
    buildPrompt: (id, prefix, i) => `Task: author a \`${id}\` module — a "${i.subject}" mascot.

Spec:
  - id: "${id}", oscPrefix: "${prefix}"
  - SINGLE-SUBJECT — use the §8.1 anchor-to-CENTER recipe.
  - Default layout: ${layoutFor(String(i.position))}
  - Physics: none (empty {}).
  - Params:
      bodyColor      color   default "${i.bodyColor}"    description "Main body fill colour" osc:true
      accentColor    color   default "${i.accentColor}"  description "Accent / detail colour" osc:true
      baseSize       int     default 60                  range [20, 200]    description "Half-height in pixels at rest" osc:true
      swayStrength   float   default 1.0                 range [0, 3]       description "Bass-driven horizontal sway multiplier" osc:true
      jumpStrength   float   default 7.0                 range [0, 20]      description "Initial upward velocity on beat" osc:true
      bassSmoothing  float   default 0.07                range [0.02, 0.3]  description "lerp factor toward bassEnergy" osc:true
  - Effects:
      tiltOnBass     boolean default true                description "Rotate with smoothed bass" osc:true

State (declare at module top):
  float ${prefix}CX, ${prefix}CY;
  float ${prefix}SmoothedBass = 0;
  float ${prefix}JumpVel = 0;
  float ${prefix}JumpOffset = 0;

## Geometry — draw the "${i.subject}" around origin (0, 0)

Origin (0, 0) is the CENTER of the subject. Processing y grows DOWN.
Use \`float s = ${prefix}BaseSize;\` as the size unit. The subject should
fit within roughly [-s, +s] in both axes.

INVENT the drawing code for a "${i.subject}" using \`triangle()\`, \`ellipse()\`,
\`rect()\`, \`line()\`, \`quad()\`. Use \`${prefix}BodyColor\` for the main fill and
\`${prefix}AccentColor\` for highlights, eyes, leaves, sparkles, etc.

Follow §1 critical rules — especially: \`stroke()\` before any \`line()\`,
4-arg \`line()\` only, no animation variables inside the Geometry block,
\`color\` (not \`float\`) for color globals.

## Behaviour in ${prefix}_draw()
  1. ${prefix}SmoothedBass = lerp(${prefix}SmoothedBass, bassEnergy, ${prefix}BassSmoothing);
  2. if (onBeat) ${prefix}JumpVel = -${prefix}JumpStrength;
     ${prefix}JumpVel += 0.4; ${prefix}JumpOffset += ${prefix}JumpVel;
     if (${prefix}JumpOffset > 0) { ${prefix}JumpOffset = 0; ${prefix}JumpVel = 0; }
  3. pushMatrix(); translate(${prefix}CX, ${prefix}CY); scale(1 + smoothedLevel * 2.0);
  4. if (${prefix}TiltOnBass) rotate(sin(${prefix}SmoothedBass * 0.5));
  5. translate(sin(frameCount * 0.05) * ${prefix}SmoothedBass * 30 * ${prefix}SwayStrength, 0);
  6. translate(0, ${prefix}JumpOffset);
  7. Draw subject geometry above.
  8. popMatrix();

## Required: full OSC handler

\`${prefix}_osc(msg)\` must NOT be empty. EXACTLY SEVEN \`checkAddrPattern\`
entries (6 params + 1 effect), addresses \`/${prefix}/<name>\`. Colors via
\`unhex("FF" + msg.get(0).stringValue().substring(1))\`. Booleans via
\`intValue() == 1\`. Floats via \`floatValue()\`. Ints via \`intValue()\`.

Follow §1–§10 of the guide. Output two fenced blocks (json then java).
`,
  },

  // ── 2. SPINNER ────────────────────────────────────────────────────────────
  {
    id: "spinner",
    name: "Spinner",
    description: "N-arm subject rotating continuously, speeds up with audio. Good for: windmill, ceiling fan, propeller, gear, sun-with-rays, pinwheel, satellite dish.",
    fields: [
      { key: "subject",     label: "Subject",       type: "text",   placeholder: "a ceiling fan" },
      { key: "position",    label: "Position",      type: "select", default: "center", options: POSITION_OPTIONS },
      { key: "armCount",    label: "Arm/blade count", type: "number", default: 4, min: 2, max: 12, step: 1 },
      { key: "bodyColor",   label: "Arm/blade color", type: "color",  default: "#cccccc" },
      { key: "hubColor",    label: "Hub / center color", type: "color", default: "#888888" },
    ],
    buildPrompt: (id, prefix, i) => {
      const n = Number(i.armCount) || 4;
      return `Task: author a \`${id}\` module — a "${i.subject}" with ${n} continuously-rotating arms.

Spec:
  - id: "${id}", oscPrefix: "${prefix}"
  - SINGLE-SUBJECT — use the §8.1 anchor-to-CENTER recipe.
  - Default layout: ${layoutFor(String(i.position))}
  - Physics: none (empty {}).
  - Params:
      armColor       color   default "${i.bodyColor}"    description "Arm / blade fill colour" osc:true
      hubColor       color   default "${i.hubColor}"     description "Hub / centre colour" osc:true
      baseSize       int     default 60                  range [20, 200]    description "Half-extent of the subject in pixels" osc:true
      armLength      float   default 0.9                 range [0.3, 1.5]   description "Arm length as fraction of baseSize" osc:true
      spinRate       float   default 0.03                range [0.005, 0.15] description "Base rotation speed (radians per frame). DEFAULT 0.03 is correct — do NOT increase." osc:true
      spinBoost      float   default 1.5                 range [0, 4]       description "Volume-driven spin acceleration multiplier" osc:true
      bassSmoothing  float   default 0.07                range [0.02, 0.3]  description "lerp factor toward bassEnergy" osc:true
  - Effects:
      bassBoost      boolean default true                description "Bass also accelerates the spin" osc:true

State (declare at module top):
  float ${prefix}CX, ${prefix}CY;
  float ${prefix}SmoothedBass = 0;

## Geometry — draw ONE arm and the hub of "${i.subject}"

The spin matrix and the N-arm loop are HANDLED in the Behaviour section.
You only need to provide:

  (a) The hub / centre at origin (0,0) — usually \`ellipse(0, 0, s*0.25, s*0.25)\`
      using \`${prefix}HubColor\` fill.
  (b) The drawing of ONE arm, which is rendered inside an already-rotated
      coordinate system. The arm extends from the hub along local +x and
      should end around \`x = s * ${prefix}ArmLength\`.

INVENT the visual style of ONE arm for "${i.subject}" using \`fill()\`,
\`rect()\`, \`triangle()\`, \`ellipse()\`. Could be a simple paddle, an
angled blade with a tip cap, a slanted rect, etc. Use \`${prefix}ArmColor\`.

Follow §1 critical rules.

## Behaviour in ${prefix}_draw()

  1. ${prefix}SmoothedBass = lerp(${prefix}SmoothedBass, bassEnergy, ${prefix}BassSmoothing);
  2. // continuous rotation — monotonically increasing angle. Speed = baseRate × (1 + volume + optional bass).
     float ${prefix}SpinFactor = 1 + smoothedLevel * ${prefix}SpinBoost;
     if (${prefix}BassBoost) ${prefix}SpinFactor += ${prefix}SmoothedBass * 0.8;
     float ${prefix}SpinAngle = frameCount * ${prefix}SpinRate * ${prefix}SpinFactor;
  3. float s = ${prefix}BaseSize;
  4. pushMatrix(); translate(${prefix}CX, ${prefix}CY); scale(1 + smoothedLevel * 1.0);
  5. // draw the hub (static, at origin)
     // <hub rendering code from Geometry above>
  6. // draw ${n} arms — same spinAngle, baselines TWO_PI/${n} apart
     for (int i = 0; i < ${n}; i++) {
       pushMatrix();
         rotate(${prefix}SpinAngle + i * TWO_PI / ${n});
         // <ONE arm rendering code from Geometry above, extending along +x>
       popMatrix();
     }
  7. popMatrix();

CRITICAL: the spin is CONTINUOUS rotation (\`frameCount * rate\`) — never
\`sin(frameCount * rate)\`. All arms share the SAME ${prefix}SpinAngle plus
a CONSTANT offset of \`i * TWO_PI / ${n}\`. Do not use opposite-phase signs.

## Required: full OSC handler

\`${prefix}_osc(msg)\` must NOT be empty. EXACTLY EIGHT \`checkAddrPattern\`
entries (7 params + 1 effect), addresses \`/${prefix}/<name>\`.

Follow §1–§10 of the guide. Output two fenced blocks (json then java).
`;
    },
  },

  // ── 3. PULSER ─────────────────────────────────────────────────────────────
  {
    id: "pulser",
    name: "Pulser",
    description: "A single subject that pulses/breathes/glows with audio — scale, alpha, or color modulated. Good for: heart, lamp, beacon, jellyfish, sun, planet, eye.",
    fields: [
      { key: "subject",     label: "Subject",       type: "text",   placeholder: "a beating heart" },
      { key: "position",    label: "Position",      type: "select", default: "center", options: POSITION_OPTIONS },
      { key: "bodyColor",   label: "Body color",    type: "color",  default: "#ff3366" },
      { key: "glowColor",   label: "Glow color",    type: "color",  default: "#ffaaaa" },
    ],
    buildPrompt: (id, prefix, i) => `Task: author a \`${id}\` module — a "${i.subject}" that pulses with the music.

Spec:
  - id: "${id}", oscPrefix: "${prefix}"
  - SINGLE-SUBJECT — use the §8.1 anchor-to-CENTER recipe.
  - Default layout: ${layoutFor(String(i.position))}
  - Physics: none (empty {}).
  - Params:
      bodyColor      color   default "${i.bodyColor}"    description "Body fill colour" osc:true
      glowColor      color   default "${i.glowColor}"    description "Outer glow / halo colour" osc:true
      baseSize       int     default 60                  range [20, 200]    description "Half-extent in pixels at rest" osc:true
      pulseDepth     float   default 1.0                 range [0, 3]       description "Scale-pulse magnitude per beat" osc:true
      glowStrength   float   default 0.6                 range [0, 1.5]     description "Glow halo intensity multiplier" osc:true
      bassSmoothing  float   default 0.07                range [0.02, 0.3]  description "lerp factor toward bassEnergy" osc:true
  - Effects:
      pulseOnBeat    boolean default true                description "Sharp size pulse on every onBeat" osc:true
      breathe        boolean default true                description "Continuous slow breathing scale via smoothedBass" osc:true

State (declare at module top):
  float ${prefix}CX, ${prefix}CY;
  float ${prefix}SmoothedBass = 0;
  float ${prefix}PulseImpulse = 0;

## Geometry — draw "${i.subject}" around origin (0, 0)

Origin (0, 0) is the CENTER of the subject. Processing y grows DOWN.
Use \`float s = ${prefix}BaseSize;\` as the size unit.

INVENT a drawing recipe for "${i.subject}" using \`fill()\`, \`ellipse()\`,
\`triangle()\`, \`rect()\`, \`quad()\`. Render in TWO passes:
  (a) Glow halo — set \`fill(red(${prefix}GlowColor), green(${prefix}GlowColor), blue(${prefix}GlowColor), 80 * ${prefix}GlowStrength)\`,
      then draw the subject larger (~1.5×) than the body pass.
  (b) Main body — set \`fill(${prefix}BodyColor)\` and draw the subject at
      normal size using \`s\` coordinates.

Follow §1 critical rules.

## Behaviour in ${prefix}_draw()
  1. ${prefix}SmoothedBass = lerp(${prefix}SmoothedBass, bassEnergy, ${prefix}BassSmoothing);
  2. // beat-impulse decays to 0 over ~10 frames
     if (${prefix}PulseOnBeat && onBeat) ${prefix}PulseImpulse = ${prefix}PulseDepth;
     ${prefix}PulseImpulse *= 0.85;
  3. // compose total scale: 1 + continuous breathing (smoothedBass) + impulse
     float breathScale = ${prefix}Breathe ? (1 + ${prefix}SmoothedBass * 0.6) : 1.0;
     float totalScale  = breathScale + ${prefix}PulseImpulse;
  4. pushMatrix(); translate(${prefix}CX, ${prefix}CY); scale(totalScale);
  5. Draw subject geometry above (glow pass then body pass).
  6. popMatrix();

## Required: full OSC handler

\`${prefix}_osc(msg)\` must NOT be empty. EXACTLY EIGHT \`checkAddrPattern\`
entries (6 params + 2 effects), addresses \`/${prefix}/<name>\`.

Follow §1–§10 of the guide. Output two fenced blocks (json then java).
`,
  },
];

// ── 4. PARTICLE FIELD ─────────────────────────────────────────────────────
ARCHETYPES.push({
  id: "particle-field",
  name: "Particle Field",
  description: "A pool of N independent particles flowing in a direction. Good for: snow, rain, embers, bubbles, drifting stars, dust, autumn leaves, sparks.",
  fields: [
    { key: "subject",       label: "Subject",        type: "text",   placeholder: "snowflakes" },
    { key: "direction",     label: "Flow direction", type: "select", default: "down",  options: ["down", "up", "drift"] },
    { key: "particleCount", label: "Particle count", type: "number", default: 100,     min: 10, max: 500, step: 10 },
    { key: "particleColor", label: "Particle color", type: "color",  default: "#ffffff" },
  ],
  buildPrompt: (id, prefix, i) => {
    const dir   = String(i.direction);
    const count = Number(i.particleCount) || 100;
    const PFX   = prefix.toUpperCase();

    // direction-specific init + boundary blocks
    const initVel = dir === "down"
      ? `${prefix}Vx[i] = random(-0.3, 0.3); ${prefix}Vy[i] = random(0.5, 2.0);`
      : dir === "up"
      ? `${prefix}Vx[i] = random(-0.3, 0.3); ${prefix}Vy[i] = random(-2.0, -0.5);`
      : `${prefix}Vx[i] = random(-1.0, 1.0); ${prefix}Vy[i] = random(-1.0, 1.0);`;

    const boundary = dir === "down" ? `
       // respawn at top when fallen below bottom edge
       if (${prefix}Y[i] > ${prefix}PY + ${prefix}PH) {
         ${prefix}Y[i] = ${prefix}PY;
         ${prefix}X[i] = random(${prefix}PX, ${prefix}PX + ${prefix}PW);
       }`
    : dir === "up" ? `
       // respawn at bottom when risen above top edge
       if (${prefix}Y[i] < ${prefix}PY) {
         ${prefix}Y[i] = ${prefix}PY + ${prefix}PH;
         ${prefix}X[i] = random(${prefix}PX, ${prefix}PX + ${prefix}PW);
       }`
    : `
       // wrap around all four edges (drift mode)
       if (${prefix}X[i] < ${prefix}PX)               ${prefix}X[i] = ${prefix}PX + ${prefix}PW;
       if (${prefix}X[i] > ${prefix}PX + ${prefix}PW) ${prefix}X[i] = ${prefix}PX;
       if (${prefix}Y[i] < ${prefix}PY)               ${prefix}Y[i] = ${prefix}PY + ${prefix}PH;
       if (${prefix}Y[i] > ${prefix}PY + ${prefix}PH) ${prefix}Y[i] = ${prefix}PY;`;

    return `Task: author a \`${id}\` module — a field of ${count} "${i.subject}" particles flowing ${dir}.

Spec:
  - id: "${id}", oscPrefix: "${prefix}"
  - BOUNDING-BOX — the particle field lives WITHIN a rectangle. Compute
    ${prefix}PX, ${prefix}PY, ${prefix}PW, ${prefix}PH using the equalizer §6.2
    anchor-to-top-left pattern.
  - Default layout: x=0, y=0, width=1.0, height=1.0, anchor="top-left", zOrder=10
  - Physics: none (empty {}).
  - Params:
      particleColor   color   default "${i.particleColor}"   description "Particle main colour" osc:true
      particleCount   int     default ${count}               range [10, 500]   description "Number of particles (baked at assembly time)" osc:false
      sizeMin         float   default 2.0                    range [0.5, 20]   description "Minimum particle size in pixels" osc:true
      sizeMax         float   default 6.0                    range [0.5, 40]   description "Maximum particle size in pixels" osc:true
      speedScale      float   default 1.0                    range [0.1, 5.0]  description "Global velocity multiplier" osc:true
      bassSmoothing   float   default 0.07                   range [0.02, 0.3] description "lerp factor toward bassEnergy" osc:true
  - Effects:
      speedOnBass     boolean default true                   description "Speed scales with smoothedLevel + bass" osc:true
      pulseOnBeat     boolean default true                   description "Particles briefly enlarge on every beat" osc:true

State (declare at module top — note the flat parallel arrays, NOT a class):
  final int ${PFX}_COUNT = {{particleCount}};
  float[] ${prefix}X    = new float[${PFX}_COUNT];
  float[] ${prefix}Y    = new float[${PFX}_COUNT];
  float[] ${prefix}Vx   = new float[${PFX}_COUNT];
  float[] ${prefix}Vy   = new float[${PFX}_COUNT];
  float[] ${prefix}Size = new float[${PFX}_COUNT];
  float ${prefix}SmoothedBass = 0;
  float ${prefix}BeatPulse    = 0;          // decays after each beat
  float ${prefix}PX, ${prefix}PY, ${prefix}PW, ${prefix}PH;

## ${prefix}_setup() — REQUIRED structure

  - Compute ${prefix}PW, ${prefix}PH from the layout fractions.
  - Resolve the anchor → TOP-LEFT corner of the bounding box for all 7 anchor
    values (use the equalizer §6.2 pattern).
  - Initialize each particle i in 0..${PFX}_COUNT-1:
        ${prefix}X[i]    = random(${prefix}PX, ${prefix}PX + ${prefix}PW);
        ${prefix}Y[i]    = random(${prefix}PY, ${prefix}PY + ${prefix}PH);
        ${prefix}Size[i] = random(${prefix}SizeMin, ${prefix}SizeMax);
        ${initVel}

## Geometry — draw ONE "${i.subject}" particle at (x, y) with size sz

You will be given local variables \`x\`, \`y\`, \`sz\` (and shared globals) and
must draw ONE single particle. The drawing code goes inside the per-particle
loop in the Behaviour section.

INVENT the shape of one "${i.subject}" using the simplest of these recipes:
  - dot:        \`fill(${prefix}ParticleColor); ellipse(x, y, sz, sz);\`
  - vertical streak (rain-like): \`stroke(${prefix}ParticleColor); strokeWeight(sz * 0.3); line(x, y - sz, x, y + sz); noStroke();\`
  - star/snowflake: a few short \`line()\`s through (x, y) at 60° apart
  - bubble: \`noFill(); stroke(${prefix}ParticleColor); strokeWeight(1); ellipse(x, y, sz, sz); noStroke();\`
  - leaf/spark: small filled triangle around (x, y)

Pick ONE that fits "${i.subject}" — do NOT compose multiple. Coordinates use
\`x\`, \`y\`, \`sz\` directly; do not invent your own per-particle position
variables.

Follow §1 critical rules.

## Behaviour in ${prefix}_draw()

  1. ${prefix}SmoothedBass = lerp(${prefix}SmoothedBass, bassEnergy, ${prefix}BassSmoothing);
  2. if (${prefix}PulseOnBeat && onBeat) ${prefix}BeatPulse = 1.0;
     ${prefix}BeatPulse *= 0.88;
  3. float ${prefix}SpeedFactor = ${prefix}SpeedScale *
        (${prefix}SpeedOnBass ? (1 + smoothedLevel + ${prefix}SmoothedBass * 1.5) : 1);
  4. for (int i = 0; i < ${PFX}_COUNT; i++) {
       ${prefix}X[i] += ${prefix}Vx[i] * ${prefix}SpeedFactor;
       ${prefix}Y[i] += ${prefix}Vy[i] * ${prefix}SpeedFactor;
${boundary}
       float x  = ${prefix}X[i];
       float y  = ${prefix}Y[i];
       float sz = ${prefix}Size[i] * (1 + ${prefix}BeatPulse * 0.8);
       // <invented particle drawing recipe from Geometry above, using x, y, sz>
     }

CRITICAL:
  - The particle render code from the Geometry section goes INSIDE this loop.
  - Use \`x\`, \`y\`, \`sz\` exactly as named — they are scoped local to the loop.
  - Do NOT use \`pushMatrix\`/\`translate\` per-particle — render directly at (x, y).
  - Do NOT call \`background()\`.

## Required: full OSC handler

\`${prefix}_osc(msg)\` must NOT be empty. EXACTLY SEVEN \`checkAddrPattern\`
entries (5 osc:true params + 2 effects), addresses \`/${prefix}/<name>\`.
NOTE: \`particleCount\` is osc:false — do NOT include a handler for it.

Follow §1–§10 of the guide. Output two fenced blocks (json then java).
`;
  },
});

export function getArchetype(id: string): Archetype | undefined {
  return ARCHETYPES.find(a => a.id === id);
}

/** Sanitise a module id into a short osc prefix (lowercase alphanum only). */
export function defaultPrefix(moduleId: string): string {
  return moduleId.replace(/[^a-z0-9]/g, "").slice(0, 12);
}
