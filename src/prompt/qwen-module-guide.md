# Module Authoring Guide (qwen3:8b)

A **module** is a self-contained visual sub-component (e.g. equalizer, particles,
mascot) that the assembler combines with other modules into one Processing sketch.
A module is NOT a standalone sketch.

Each module lives at `modules/<id>/` and consists of two files:

- `module.json` — the schema (id, prefix, layout, params, effects)
- `module.pde` — the implementation, with `{{placeholder}}` substitution

---

## 1. The contract — what your module MUST provide

A module exports three functions, all prefixed with the `oscPrefix` declared
in `module.json`. If your prefix is `mascot`, the function names are:

| Function                       | When called   | Purpose                                |
|--------------------------------|---------------|----------------------------------------|
| `<prefix>_setup()`             | once at start | allocate arrays, compute pixel bounds  |
| `<prefix>_draw()`              | every frame   | render the module (no `background()`)  |
| `<prefix>_osc(OscMessage msg)` | on OSC event  | dispatch updates to OSC-marked params  |

That's it. No `void setup()`, no `void draw()`, no `size()`, no `background(...)`
calls inside the module — the assembler provides all of those.

---

## 2. Shared globals — what you can READ from

The assembler initialises audio analysis and injects these globals BEFORE your
module loads. Read them, do not redeclare them:

```
FFT      fft;            // Minim FFT, with logAverages(22, 3)
float[]  spectrum;       // normalised 0..1 amplitude per FFT bin
float    smoothedLevel;  // 0..~0.5, smoothed RMS volume
float    bassEnergy;     // mean of fft.getBand(0..3), already computed
boolean  onBeat;         // true on the frame a beat is detected
int      width, height;  // Processing canvas size
int      frameCount;     // Processing frame counter
```

You may also use any Processing core API: `fill()`, `triangle()`, `ellipse()`,
`pushMatrix()`, `translate()`, `random()`, `sin()`, `lerp()`, etc.

---

## 3. Forbidden — what NOT to write

These mistakes break the assembled sketch. Never include them in `module.pde`:

- `void setup()` — already exists in the scaffold
- `void draw()` — already exists in the scaffold
- `size(...)` — assembler controls window size
- `background(...)` — assembler clears each frame
- `import ddf.minim.*;` — assembler imports
- `Minim minim;` or `AudioInput input;` declarations — assembler owns them
- `void stop()` — assembler owns lifecycle
- A second `<prefix>_draw()` or duplicate function names

---

## 4. `module.json` shape

Top-level keys are STRICT — exact names, exact types.

```json
{
  "id":          "carrot",
  "name":        "Carrot",
  "description": "Audio-reactive dancing carrot mascot.",
  "version":     "1.0.0",
  "oscPrefix":   "carrot",

  "layout": {
    "x":      { "default": 0.5, "range": [0, 1],    "description": "Horizontal anchor (0=left, 1=right)" },
    "y":      { "default": 0.5, "range": [0, 1],    "description": "Vertical anchor (0=top, 1=bottom)" },
    "width":  { "default": 0.3, "range": [0.05, 1], "description": "Subject width as fraction of canvas" },
    "height": { "default": 0.5, "range": [0.05, 1], "description": "Subject height as fraction of canvas" },
    "anchor": { "default": "center", "values": ["top-left", "top-center", "top-right", "center", "bottom-left", "bottom-center", "bottom-right"] },
    "zOrder": { "default": 0, "range": [-100, 100], "description": "Draw order — lower renders behind" }
  },

  "physics": {
    "<name>": { "default": <number>, "range": [<min>, <max>], "description": "...", "osc": true|false }
  },

  "params": {
    "<name>": { "default": <value>, ...one of:
                "range": [<min>, <max>]   // for floats/ints (add "type":"int" for ints)
                "type":  "color"          // value is "#rrggbb"
                "type":  "string"         // value is a quoted string
              ..., "description": "...", "osc": true|false }
  },

  "effects": {
    "<name>": { "default": true|false, "description": "...", "osc": true|false }
  }
}
```

Rules:
- `id` matches the folder name and is lowercase, kebab-case allowed.
- `oscPrefix` is a SHORT lowercase token, used as the variable and function
  prefix throughout the PDE. Conventionally same as or related to `id`.
- `layout` is always present and always has the six fields shown above.
- `physics`, `params`, and `effects` may be empty objects `{}` but must exist.
- Each `osc: true` param will be live-controllable via `/<prefix>/<name>`.
- `osc: false` params are baked at assembly time only.

Substitution: each `{{name}}` in the PDE is replaced as follows:

| JSON type      | Substituted as                                     |
|----------------|----------------------------------------------------|
| boolean        | `true` / `false`                                   |
| int            | rounded integer (no decimals)                      |
| float          | the number as-is                                   |
| color          | the hex string `#rrggbb` (a valid Processing color)|
| string         | the raw string (you wrap with quotes in the PDE)   |

---

## 5. Naming conventions inside `module.pde`

If your `oscPrefix` is `mascot`:

- Layout constants use UPPER_SNAKE prefix: `MASCOT_X_FRAC`, `MASCOT_ANCHOR`
- Live state uses camelCase prefix: `mascotJumpOffset`, `mascotSmoothedBass`
- Functions: `mascot_setup()`, `mascot_draw()`, `mascot_osc(msg)`,
  plus any helpers like `mascot_drawBody()`, `mascot_drawLeaves()`
- This prefix discipline lets multiple modules coexist in one sketch without
  name collisions.

---

## 6. Worked examples — full source (mimic these closely)

Two complete, tested modules. Pick whichever architecture matches what the
task prompt describes, then mirror the structure. These cover ~90% of the
module shapes you'll be asked to write.

| Pick this example if the task describes…                | Pattern         | Key recipe |
|--------------------------------------------------------|-----------------|------------|
| One subject centered/anchored at a single point (mascot, character, logo, dancer) | Single-subject | §6.1 carrot |
| Movement within a rectangular range (flying, scrolling, bars, multiple particles) | Bounding-box   | §6.2 plane  |
| FFT bars / spectrum / waveform                          | Bounding-box   | §6.2 plane (adapt for bars) |
| Audio-reactive multi-instance subjects                  | Bounding-box   | §6.2 plane (loop multiple subjects) |

### 6.1 Single-subject example — `carrot/module.json` + `carrot/module.pde`

Use this pattern when the task asks for one subject centered at an anchor
point. The subject has a body and accessories drawn around `(0, 0)` after
`translate(<prefix>CX, <prefix>CY)`. Geometry primitives only (no SVG).

#### `carrot/module.json`

```json
{
  "id": "carrot",
  "name": "Carrot",
  "description": "Audio-reactive dancing carrot mascot.",
  "version": "1.0.0",
  "oscPrefix": "carrot",

  "layout": {
    "x": { "default": 0.5, "range": [0, 1], "description": "Horizontal anchor (0=left, 1=right)" },
    "y": { "default": 0.5, "range": [0, 1], "description": "Vertical anchor (0=top, 1=bottom)" },
    "width": { "default": 0.2, "range": [0.05, 1], "description": "Subject width as fraction of canvas" },
    "height": { "default": 0.3, "range": [0.05, 1], "description": "Subject height as fraction of canvas" },
    "anchor": { "default": "center", "values": ["top-left", "top-center", "top-right", "center", "bottom-left", "bottom-center", "bottom-right"] },
    "zOrder": { "default": 0, "range": [-100, 100], "description": "Draw order — lower renders behind" }
  },

  "physics": {},

  "params": {
    "bodyColor":     { "default": "#ff8c00", "type": "color",                 "description": "Carrot body fill colour",                    "osc": true },
    "leafColor":     { "default": "#28a040", "type": "color",                 "description": "Leaf fill colour",                           "osc": true },
    "baseSize":      { "default": 60,        "type": "int", "range": [20, 200],   "description": "Half-height of body in pixels at rest",  "osc": true },
    "swayStrength":  { "default": 1.0,                       "range": [0, 3],     "description": "Multiplier for bass-driven sway",        "osc": true },
    "jumpStrength":  { "default": 7.0,                       "range": [0, 20],    "description": "Initial upward velocity on beat",        "osc": true },
    "bassSmoothing": { "default": 0.07,                      "range": [0.02, 0.3],"description": "lerp factor toward bassEnergy",          "osc": true }
  },

  "effects": {
    "tiltOnBass": { "default": true, "description": "Rotate the carrot with smoothed bass", "osc": true }
  }
}
```

#### `carrot/module.pde`

```java
// ── Carrot Module ────────────────────────────────────────────────────────
// Expects shared globals: fft, spectrum, smoothedLevel, bassEnergy, onBeat

final float CARROT_X_FRAC = {{x}};
final float CARROT_Y_FRAC = {{y}};
final float CARROT_W_FRAC = {{width}};
final float CARROT_H_FRAC = {{height}};
final String CARROT_ANCHOR = "{{anchor}}";

color   carrotBodyColor     = {{bodyColor}};
color   carrotLeafColor     = {{leafColor}};
int     carrotBaseSize      = {{baseSize}};
float   carrotSwayStrength  = {{swayStrength}};
float   carrotJumpStrength  = {{jumpStrength}};
float   carrotBassSmoothing = {{bassSmoothing}};
boolean carrotTiltOnBass    = {{tiltOnBass}};

// state — DECLARE THESE alongside the params; assigning without declaring causes a compile error
float carrotCX, carrotCY;
float carrotSmoothedBass = 0;
float carrotJumpVel      = 0;
float carrotJumpOffset   = 0;

void carrot_setup() {
  float ax = CARROT_X_FRAC * width;
  float ay = CARROT_Y_FRAC * height;

  // resolve anchor → CENTER of bounding box (single-subject pattern §8.1)
  if      (CARROT_ANCHOR.equals("top-left"))     { carrotCX = ax + CARROT_W_FRAC * width / 2; carrotCY = ay + CARROT_H_FRAC * height / 2; }
  else if (CARROT_ANCHOR.equals("top-center"))   { carrotCX = ax;                              carrotCY = ay + CARROT_H_FRAC * height / 2; }
  else if (CARROT_ANCHOR.equals("top-right"))    { carrotCX = ax - CARROT_W_FRAC * width / 2; carrotCY = ay + CARROT_H_FRAC * height / 2; }
  else if (CARROT_ANCHOR.equals("center"))       { carrotCX = ax;                              carrotCY = ay; }
  else if (CARROT_ANCHOR.equals("bottom-left"))  { carrotCX = ax + CARROT_W_FRAC * width / 2; carrotCY = ay - CARROT_H_FRAC * height / 2; }
  else if (CARROT_ANCHOR.equals("bottom-center")){ carrotCX = ax;                              carrotCY = ay - CARROT_H_FRAC * height / 2; }
  else if (CARROT_ANCHOR.equals("bottom-right")) { carrotCX = ax - CARROT_W_FRAC * width / 2; carrotCY = ay - CARROT_H_FRAC * height / 2; }
  else                                            { carrotCX = ax;                              carrotCY = ay; }
}

void carrot_draw() {
  float s = carrotBaseSize;

  // smooth bass, integrate jump-impulse decay
  carrotSmoothedBass = lerp(carrotSmoothedBass, bassEnergy, carrotBassSmoothing);
  if (onBeat) carrotJumpVel = -carrotJumpStrength;
  carrotJumpVel    += 0.4;
  carrotJumpOffset += carrotJumpVel;
  if (carrotJumpOffset > 0) { carrotJumpOffset = 0; carrotJumpVel = 0; }

  pushMatrix();
    translate(carrotCX, carrotCY);
    scale(1 + smoothedLevel * 2.0);
    if (carrotTiltOnBass) rotate(sin(carrotSmoothedBass * 0.5));  // RADIANS — no *30 / *180
    translate(sin(frameCount * 0.05) * carrotSmoothedBass * 30 * carrotSwayStrength, 0);
    translate(0, carrotJumpOffset);

    // body — apex DOWN (apex at +s, base above origin)
    fill(carrotBodyColor);
    triangle(0, s, -s/3, -2*s/3, +s/3, -2*s/3);

    // 3 distinct leaves above body — apex UP (apex at smaller y), base on body's top edge
    fill(carrotLeafColor);
    triangle(-s/4, -2*s/3, -s/2, -2*s/3 - s*0.7, 0,    -2*s/3 - s*0.4);  // left leaf
    triangle( 0,   -2*s/3, -s/4, -2*s/3 - s,     +s/4, -2*s/3 - s    );  // center leaf — tallest
    triangle(+s/4, -2*s/3,  0,   -2*s/3 - s*0.4, +s/2, -2*s/3 - s*0.7);  // right leaf
  popMatrix();
}

void carrot_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/carrot/bodyColor"))     carrotBodyColor     = unhex("FF" + msg.get(0).stringValue().substring(1));
  if (msg.checkAddrPattern("/carrot/leafColor"))     carrotLeafColor     = unhex("FF" + msg.get(0).stringValue().substring(1));
  if (msg.checkAddrPattern("/carrot/baseSize"))      carrotBaseSize      = msg.get(0).intValue();
  if (msg.checkAddrPattern("/carrot/swayStrength"))  carrotSwayStrength  = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/carrot/jumpStrength")) carrotJumpStrength  = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/carrot/bassSmoothing")) carrotBassSmoothing = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/carrot/tiltOnBass"))    carrotTiltOnBass    = msg.get(0).intValue() == 1;
}
```

### 6.2 Bounding-box-with-asset example — `plane/module.json` + `plane/module.pde`

Use this pattern when the subject animates inside a rectangular range
(flying, scrolling, an EQ bar row, multiple particle slots). The box's
top-left is `(<prefix>PX, <prefix>PY)` and its size is `(<prefix>PW, <prefix>PH)`.
The example also loads an SVG asset from `<id>/data/` and flips it with
`scale(planeDir, 1)` at edges.

#### `plane/module.json`

```json
{
  "id": "plane",
  "name": "Plane",
  "description": "Small airplane flying back-and-forth across the top.",
  "version": "1.0.0",
  "oscPrefix": "plane",

  "layout": {
    "x":      { "default": 0,    "range": [0, 1],    "description": "Horizontal anchor" },
    "y":      { "default": 0.05, "range": [0, 1],    "description": "Vertical anchor" },
    "width":  { "default": 1.0,  "range": [0.05, 1], "description": "Box width as fraction of canvas" },
    "height": { "default": 0.15, "range": [0.05, 1], "description": "Box height as fraction of canvas" },
    "anchor": { "default": "top-left", "values": ["top-left","top-center","top-right","center","bottom-left","bottom-center","bottom-right"] },
    "zOrder": { "default": 10, "range": [-100, 100], "description": "Draw order" }
  },

  "physics": {},

  "params": {
    "planeColor":    { "default": "#e0e0e0", "type": "color",                  "description": "Aircraft fill colour", "osc": true },
    "planeSize":     { "default": 40,        "type": "int", "range": [20, 120], "description": "Half-length of fuselage in pixels", "osc": true },
    "baseSpeed":     { "default": 3.0,                       "range": [0.5, 10],  "description": "Speed at rest, pixels/frame", "osc": true },
    "speedBoost":    { "default": 1.5,                       "range": [0, 4],     "description": "Multiplier on speed from smoothedLevel", "osc": true },
    "bobAmplitude":  { "default": 8.0,                       "range": [0, 30],    "description": "Vertical bob amplitude on bass", "osc": true },
    "bassSmoothing": { "default": 0.07,                      "range": [0.02, 0.3],"description": "lerp factor toward bassEnergy", "osc": true }
  },

  "effects": {
    "dipOnBeat": { "default": true, "description": "Plane dips momentarily on each beat", "osc": true }
  }
}
```

#### `plane/module.pde`

```java
// ── Plane Module ────────────────────────────────────────────────────────
// Expects shared globals: fft, spectrum, smoothedLevel, bassEnergy, onBeat, width, height, frameCount

final float PLANE_X_FRAC = {{x}};
final float PLANE_Y_FRAC = {{y}};
final float PLANE_W_FRAC = {{width}};
final float PLANE_H_FRAC = {{height}};
final String PLANE_ANCHOR = "{{anchor}}";   // EXACT spelling — typos here break compile

color   planeColor    = {{planeColor}};      // `color` not `float`
int     planeSize     = {{planeSize}};
float   baseSpeed     = {{baseSpeed}};
float   speedBoost    = {{speedBoost}};
float   bobAmplitude  = {{bobAmplitude}};
float   bassSmoothing = {{bassSmoothing}};
boolean dipOnBeat     = {{dipOnBeat}};

// state — must be DECLARED here even if computed in setup
float planeX = -9999;
int   planeDir = 1;
float planeSmoothedBass = 0;
float planeDipVel = 0;
float planeDipOffset = 0;
float planePX, planePY, planePW, planePH;

PShape planeSvg;   // module-owned SVG asset; loadShape ONLY in setup, never in draw

void plane_setup() {
  planePW = PLANE_W_FRAC * width;
  planePH = PLANE_H_FRAC * height;
  float ax = PLANE_X_FRAC * width;
  float ay = PLANE_Y_FRAC * height;

  // resolve anchor → TOP-LEFT corner of bounding box (bounding-box pattern)
  if      (PLANE_ANCHOR.equals("top-left"))     { planePX = ax;             planePY = ay; }
  else if (PLANE_ANCHOR.equals("top-center"))   { planePX = ax - planePW/2; planePY = ay; }
  else if (PLANE_ANCHOR.equals("top-right"))    { planePX = ax - planePW;   planePY = ay; }
  else if (PLANE_ANCHOR.equals("center"))       { planePX = ax - planePW/2; planePY = ay - planePH/2; }
  else if (PLANE_ANCHOR.equals("bottom-left"))  { planePX = ax;             planePY = ay - planePH; }
  else if (PLANE_ANCHOR.equals("bottom-center")){ planePX = ax - planePW/2; planePY = ay - planePH; }
  else if (PLANE_ANCHOR.equals("bottom-right")) { planePX = ax - planePW;   planePY = ay - planePH; }

  planeX = planePX + planeSize;
  planeSvg = loadShape("plane/plane.svg");  // path is "<id>/<file>" — namespaced under the sketch's data/
}

void plane_draw() {
  float s = planeSize;

  // smooth bass + dip-on-beat impulse pattern
  planeSmoothedBass = lerp(planeSmoothedBass, bassEnergy, bassSmoothing);
  if (dipOnBeat && onBeat) planeDipVel = 5;
  planeDipVel    *= 0.85;
  planeDipOffset += planeDipVel;
  planeDipOffset *= 0.92;

  // speed = base * (1 + smoothedLevel * boost); integrate position; bounce at edges
  float speed = baseSpeed * (1 + smoothedLevel * speedBoost);
  planeX += speed * planeDir;
  if (planeX > planePX + planePW - planeSize) planeDir = -1;
  if (planeX < planePX + planeSize)           planeDir =  1;

  // vertical = box centre + bass-driven bob + dip
  float baseY = planePY + planePH/2;
  float y = baseY + sin(frameCount * 0.05) * bobAmplitude * planeSmoothedBass + planeDipOffset;

  pushMatrix();
    translate(planeX, y);
    scale(planeDir, 1);  // mirror horizontally when going left
    // SVG viewBox is 100×60; draw at 2s × 1.2s centered at origin
    shape(planeSvg, -s, -s * 0.6, 2 * s, s * 1.2);
  popMatrix();
}

void plane_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/plane/planeColor"))    planeColor    = unhex("FF" + msg.get(0).stringValue().substring(1));
  if (msg.checkAddrPattern("/plane/planeSize"))     planeSize     = msg.get(0).intValue();
  if (msg.checkAddrPattern("/plane/baseSpeed"))     baseSpeed     = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/plane/speedBoost"))    speedBoost    = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/plane/bobAmplitude"))  bobAmplitude  = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/plane/bassSmoothing")) bassSmoothing = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/plane/dipOnBeat"))     dipOnBeat     = msg.get(0).intValue() == 1;
}
```

### 6.3 Notice across both examples

- Layout constants use UPPER_SNAKE `final`s (`CARROT_X_FRAC`, `PLANE_ANCHOR`).
- OSC-controllable values are bare `color`/`int`/`float`/`boolean` — never `final`.
- **Colors use `color` type** — never `float`. A `float foo = #ff0000;` declaration is wrong; `fill(foo)` will treat the value as grayscale.
- **Every variable assigned in `_setup()` is also declared at the module top** — `carrotCX, carrotCY` exist alongside the params; `planePX, planePY` etc. exist alongside the params. Missing declarations are the #1 compile error.
- The anchor `if/else if` chain uses the **same constant name** in every branch (`CARROT_ANCHOR`, `PLANE_ANCHOR`). A single-character typo like `CARROT_ANCHZ` in one branch fails to compile.
- `_osc(msg)` lists one `checkAddrPattern` per OSC-true field. The handler body is NEVER empty.
- `rotate(...)` arguments are in radians; `sin(x * 0.5)` produces a sane ~±1 rad tilt — never multiply by 30 or 180.
- Drawing happens between `pushMatrix()` and `popMatrix()`; transforms are applied BEFORE the shapes that use them.

---

## 7. Audio-reactive smoothing inside a module

The shared globals (`bassEnergy`, `fft.getBand(i)`, `onBeat`) are spiky. If
your module animates with them, lerp into smoothed state or drive a decaying
impulse value. Replace `<prefix>` with your module's `oscPrefix`:

```java
// declare module-scoped state alongside the params:
float <prefix>SmoothedBass = 0;
float <prefix>JumpVel      = 0;
float <prefix>JumpOffset   = 0;

// inside <prefix>_draw(), BEFORE rendering:
<prefix>SmoothedBass = lerp(<prefix>SmoothedBass, bassEnergy, 0.07);
if (onBeat) <prefix>JumpVel = -7;
<prefix>JumpVel    += 0.4;
<prefix>JumpOffset += <prefix>JumpVel;
if (<prefix>JumpOffset > 0) { <prefix>JumpOffset = 0; <prefix>JumpVel = 0; }
```

---

## 8. Geometry & anchor recipes

Processing's y-axis points DOWN: `y = 0` is the top of the screen, `y = height`
is the bottom. A "downward-pointing" shape has its apex at a LARGER y value
than its base. Modules consistently get this wrong unless they copy from a
literal recipe.

### 8.1 Anchor resolution (anchor → pixel center)

When the prompt asks for a single subject centered inside its bounding box,
do not translate to the box's top-left. Compute the center of the box for
each anchor variant:

```java
void <prefix>_setup() {
  <PREFIX>_PW = <PREFIX>_W_FRAC * width;
  <PREFIX>_PH = <PREFIX>_H_FRAC * height;
  float ax = <PREFIX>_X_FRAC * width;
  float ay = <PREFIX>_Y_FRAC * height;

  // resolve to the CENTER of the bounding box, regardless of anchor
  if      (<PREFIX>_ANCHOR.equals("top-left"))     { <prefix>CX = ax + <PREFIX>_PW/2; <prefix>CY = ay + <PREFIX>_PH/2; }
  else if (<PREFIX>_ANCHOR.equals("top-center"))   { <prefix>CX = ax;                 <prefix>CY = ay + <PREFIX>_PH/2; }
  else if (<PREFIX>_ANCHOR.equals("top-right"))    { <prefix>CX = ax - <PREFIX>_PW/2; <prefix>CY = ay + <PREFIX>_PH/2; }
  else if (<PREFIX>_ANCHOR.equals("center"))       { <prefix>CX = ax;                 <prefix>CY = ay; }
  else if (<PREFIX>_ANCHOR.equals("bottom-left"))  { <prefix>CX = ax + <PREFIX>_PW/2; <prefix>CY = ay - <PREFIX>_PH/2; }
  else if (<PREFIX>_ANCHOR.equals("bottom-center")){ <prefix>CX = ax;                 <prefix>CY = ay - <PREFIX>_PH/2; }
  else if (<PREFIX>_ANCHOR.equals("bottom-right")) { <prefix>CX = ax - <PREFIX>_PW/2; <prefix>CY = ay - <PREFIX>_PH/2; }
  else                                              { <prefix>CX = ax;                 <prefix>CY = ay; }
}
```

In `<prefix>_draw()`, then `translate(<prefix>CX, <prefix>CY)` puts the
origin at the CENTER of the subject — draw shapes around (0, 0).

The equalizer in §6 doesn't use this pattern because its subject (a row of
bars) fills the entire box top-left to bottom-right. Single-subject modules
do.

### 8.2 Geometry rules of thumb

When the task prompt supplies a "use this recipe verbatim" geometry block,
copy it literally — do not retype, re-derive, or normalize the numbers.
When the task prompt asks you to invent geometry, follow these rules:

- "Apex down" means the apex vertex has the **largest y value** of the
  three triangle vertices, not the smallest. Origin's `(0, 0)` and a vertex
  at `(0, +N)` sits BELOW the origin on screen.
- If you draw multiple repeated shapes (petals, leaves, spokes), they must
  use **different** triangle/polygon coordinates — do not copy the same
  call N times. Vary apex position, height, or angle.
- Pick one unit of scale and stick to it. Mixing `baseSize * leafScale * 2`
  causes coordinates to explode off-screen.

### 8.3 rotate() takes RADIANS, not degrees

`rotate(theta)` in Processing measures `theta` in radians. Do NOT multiply
by 30, 180, or PI/180 unless explicitly converting:

```java
// CORRECT — sin(...) outputs roughly -1..+1 radians, which is a sensible tilt
rotate(sin(smoothedBass * 0.5));

// WRONG — turns the radian into "degrees-feel" but Processing reads it as
// 30 radians (~1700°), causing runaway spin
rotate(sin(smoothedBass * 0.5) * 30);

// If you want degree-mode reasoning, convert explicitly:
rotate(radians(30));     // 30 degrees → ~0.52 rad
```

## 9. Output format

Output TWO fenced code blocks, in this exact order, with no prose between
or around them:

````
```json
{ ... module.json content ... }
```

```java
// ... module.pde content ...
```
````

No explanation. No `// thinking:` comments. No extra text.

---

## 10. Self-check (run before answering)

- [ ] `module.json` has all of `id`, `name`, `description`, `version`, `oscPrefix`,
      `layout`, `physics`, `params`, `effects`
- [ ] Every `{{placeholder}}` in PDE has a matching declaration in JSON (in
      `layout`, `physics`, `params`, or `effects`)
- [ ] Every JSON declaration with `osc: true` (other than `layout`) appears
      in `<prefix>_osc(msg)` with the address `/<prefix>/<name>`
- [ ] PDE contains NO `void setup()`, `void draw()`, `size()`, `background()`,
      `import`, `Minim`, `AudioInput`, or `void stop()`
- [ ] PDE exposes `<prefix>_setup()` and `<prefix>_draw()`
- [ ] All module globals are prefixed (no naked `pos`, `vel`, etc.)
- [ ] Layout constants are UPPER_SNAKE `final`s; OSC-mutable values are
      bare `float`/`color`/`boolean`
- [ ] For single-subject modules, `<prefix>_setup()` resolves anchor to the
      CENTER of the bounding box (§8.1) — not the top-left
- [ ] No "downward-pointing" shape has its apex at a smaller y than its base
- [ ] When the task prompt supplies a verbatim geometry block, it was copied
      literally — coordinates were not renamed, re-derived, or normalized
- [ ] `rotate(...)` arguments are radians; no naked `* 30` or `* 180` (§8.3)
- [ ] `<prefix>_osc(msg)` body is NOT empty — every `osc: true` JSON param
      has its own `checkAddrPattern` line inside the function
- [ ] Output is two fenced blocks (json then java), nothing else
