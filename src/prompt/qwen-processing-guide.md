# Processing 4 (Java mode) — Authoring Guide for qwen3:8b

This guide is prepended to every qwen prompt that asks for a Processing sketch.
It exists because qwen3:8b consistently makes a small number of structural
mistakes that compile fine but render wrong. Follow the rules below verbatim.

---

## 1. Critical rules (most common failures)

These six mistakes are by far the most frequent. Re-check every one before
emitting your answer.

1. **`background(...)` MUST be the first line inside `draw()`.**
   Placing it in `setup()` causes every frame to smear on top of the previous.
   Exception: deliberate trail effects — but you must say so explicitly.

2. **Processing's y-axis points DOWN.** `y = 0` is the top of the window,
   `y = height` is the bottom. A "downward-pointing" triangle has its apex at
   a LARGER y value than its base.

3. **`translate()` must be applied BEFORE the shape is drawn.** A `translate()`
   after `triangle(...)` does nothing visible — it only affects subsequent
   draw calls. Same for `rotate()` and `scale()`.

4. **Wrap any matrix transformation in `pushMatrix()` / `popMatrix()`.**
   Without this, transformations accumulate every frame and the sketch drifts
   off-screen within seconds.

5. **For live audio, always emit `void stop()` at the end:**
   ```java
   void stop() { input.close(); minim.stop(); super.stop(); }
   ```

6. **NEVER apply a raw audio value directly to a transform.** `bassEnergy`,
   `fft.getBand(i)`, and `onBeat` are spiky per-frame — using them directly
   produces jittery, snappy motion. Always either (a) low-pass them with
   `lerp()` into a smoothed variable, or (b) for impulse events like `onBeat`,
   drive a decaying state variable. See §3a "Smoothing & damping".

---

## 2. Minim live-audio boilerplate (copy verbatim)

When a prompt asks for audio-reactive behavior, paste this scaffold EXACTLY.
Do not rename `minim`, `input`, `fft`, `beat`, `smoothedLevel`, `bassEnergy`,
or `onBeat` — they are conventional and downstream prompts depend on them.

```java
import ddf.minim.*;
import ddf.minim.analysis.*;

Minim       minim;
AudioInput  input;
FFT         fft;
BeatDetect  beat;

float   smoothedLevel = 0;   // 0..~0.5, smoothed RMS volume
float   bassEnergy    = 0;   // mean of fft.getBand(0..3)
boolean onBeat        = false;

void setup() {
  size(800, 600);            // override if the prompt specifies a different size
  minim = new Minim(this);
  input = minim.getLineIn(Minim.STEREO, 1024);
  fft   = new FFT(input.bufferSize(), input.sampleRate());
  fft.logAverages(22, 3);
  beat  = new BeatDetect(input.bufferSize(), input.sampleRate());
  beat.setSensitivity(150);
}

void draw() {
  background(0);             // RULE 1 — clear FIRST
  // ── audio read ─────────────────────────────────────────────────────────
  fft.forward(input.mix);
  beat.detect(input.mix);
  smoothedLevel = lerp(smoothedLevel, input.mix.level(), 0.25);
  bassEnergy = 0;
  for (int i = 0; i < 4; i++) bassEnergy += fft.getBand(i);
  bassEnergy /= 4.0;
  onBeat = beat.isOnset();

  // ── sketch-specific drawing goes here ──────────────────────────────────
}

void stop() { input.close(); minim.stop(); super.stop(); }
```

Use `smoothedLevel` (0..~0.5) for continuous motion, `bassEnergy` for
bass-reactive effects, `onBeat` for pulse events. Access `fft.getBand(i)`
for per-band values.

---

## 3. Skeleton template (fill-in-the-blank)

When you have multiple transformations driven by audio, use this exact
ordering inside `draw()`. Note rule §1.6: use the SMOOTHED variables
(`smoothedLevel`, `smoothedBass`, `jumpOffset`) — not the raw ones.

```java
void draw() {
  background(0);                                  // 1. clear
  /* audio read block (see §2) */
  /* smoothing & damping block (see §3a) */

  pushMatrix();                                   // 2. open transform scope
    translate(width / 2, height / 2);             // 3. move to anchor point
    scale(1 + smoothedLevel * 2.0);               // 4. scale (volume) — smoothedLevel is already lerped
    rotate(sin(smoothedBass * 0.5));              // 5. rotate (bass) — use smoothed
    translate(sin(frameCount * 0.05) * smoothedBass * 30, 0);  // 6. x-sway, smoothed
    translate(0, jumpOffset);                     // 7. beat-jump via decaying offset
    drawSubject();                                // 8. draw — last thing
  popMatrix();                                    // 9. close transform scope
}
```

Notes:
- Step 6: x-sway means the FIRST argument moves, y stays 0.
- Step 7: `jumpOffset` is a decaying state value updated in §3a — NEVER use
  `if (onBeat) translate(...)` directly; the jump would last one frame.
- Always pair `pushMatrix` with `popMatrix`.

---

## 3a. Smoothing & damping (rule §1.6 in code)

Declare these alongside the §2 boilerplate, near the top of the file:

```java
// smoothed audio drivers (low-pass of raw bandwidths)
float smoothedBass = 0;     // settles over ~8 frames
// impulse-driven state (decays each frame)
float jumpVel    = 0;       // y-velocity of the beat-bounce
float jumpOffset = 0;       // y-position of the beat-bounce, applied to transform
```

Inside `draw()`, place this block AFTER the audio-read block from §2 and
BEFORE the `pushMatrix()`:

```java
// low-pass: lerp factor 0.10–0.15 settles in ~7–10 frames at 60 fps.
// Smaller = smoother + laggier; larger = snappier + jitterier.
smoothedBass = lerp(smoothedBass, bassEnergy, 0.12);

// impulse → bounce: onBeat sets velocity, gravity pulls it back, lands at 0.
if (onBeat) jumpVel = -10;
jumpVel    += 0.6;          // gravity (positive = downward in Processing y)
jumpOffset += jumpVel;
if (jumpOffset > 0) {       // landed
  jumpOffset = 0;
  jumpVel    = 0;
}
```

Tuning knobs:
- `lerp(... , 0.12)` — the smoothing factor. Range 0.05 (very slow / dreamy)
  to 0.30 (responsive but a bit jittery). 0.12 is a safe default.
- `jumpVel = -10` — initial pop height. -6 is a small hop, -15 is a big jump.
- `0.6` — gravity. Higher = lands faster (snappier), lower = floaty arc.

Apply the same pattern for any other raw signal you want to use:
- `smoothedHigh = lerp(smoothedHigh, fft.getBand(20), 0.10);`
- For a flash effect on `onBeat`: `if (onBeat) flash = 1.0; flash *= 0.85;`
- For a "shake" on `onBeat`: `if (onBeat) shake = 8.0; shake *= 0.85;`
  then `translate(random(-shake, shake), random(-shake, shake))`.

Rule of thumb: any place you'd write `if (onBeat) X = some-impulse`, also
add `X *= 0.85;` (or similar decay) on the very next line so the value
returns to rest smoothly.

---

## 4. Coordinate system primer

Origin (0, 0) is the top-left corner of the window. Positive x goes right,
positive y goes DOWN.

```
(0,0)──────────────► +x
  │
  │
  │
  ▼
  +y
```

After `translate(width/2, height/2)`, the local origin is the center of the
window. Negative y is now "up on the screen".

A **downward-pointing** triangle (apex at the bottom):

```
   (-w, -h)          (+w, -h)        ← these two form the top edge
        \             /
         \           /
          \         /
           (0,  +h)                  ← apex BELOW (positive y)
```

```java
triangle( 0, +h,
        -w, -h,
        +w, -h);
```

An **upward-pointing** triangle (apex at the top, e.g. a leaf):

```
              (0, -h)                ← apex ABOVE (negative y)
              /     \
             /       \
            /         \
       (-w,+h)       (+w,+h)
```

```java
triangle( 0, -h,
        -w, +h,
        +w, +h);
```

---

## 5. Shape recipes (battle-tested)

These compile and look right. Prefer adapting these over inventing geometry.

**Centered circle, audio-scaled:**
```java
float r = 40 * (1 + smoothedLevel * 2);
ellipse(0, 0, r * 2, r * 2);
```

**N-sided regular polygon centered at (0,0):**
```java
beginShape();
for (int i = 0; i < N; i++) {
  float a = TWO_PI * i / N - HALF_PI;
  vertex(cos(a) * R, sin(a) * R);
}
endShape(CLOSE);
```

**Carrot (downward apex, leaves at top), drawn after `translate(cx, cy)`:**
```java
// body — apex at bottom, base at top
fill(255, 140, 0);                                // orange
triangle(0, 40, -20, -40, 20, -40);

// 3 leaves — apex up, base on the body's top edge
fill(40, 160, 60);                                // green
triangle(-15, -40, -25, -75, -5,  -75);           // left leaf
triangle(  0, -40, -10, -85, 10,  -85);           // center leaf (tallest)
triangle( 15, -40,   5, -75, 25,  -75);           // right leaf
```

---

## 6. Output format

- Output ONLY the .pde code, wrapped in a single fenced code block.
- No prose before or after the fence.
- No `// thinking:` comments.
- Do not add `println()` calls unless the prompt requires debugging output.

---

## 7. Self-check (run mentally before answering)

Tick every box. If any is uncertain, re-read the relevant section.

- [ ] `background(...)` is the first executable line of `draw()`
- [ ] Every `pushMatrix()` has a matching `popMatrix()`
- [ ] Transformations are applied BEFORE the shape they affect is drawn
- [ ] A "downward-pointing" shape has its apex at a LARGER y value than its base
- [ ] Horizontal motion uses the FIRST argument of `translate(x, y)` (y = 0)
- [ ] Vertical motion uses the SECOND argument (x = 0)
- [ ] If using Minim, `void stop()` is present and closes `input`, `minim`,
      and calls `super.stop()`
- [ ] No variable named `minim`/`input`/`fft`/`beat` has been renamed
- [ ] No raw `bassEnergy` / `fft.getBand(i)` is used directly in a transform —
      either lerp into `smoothedBass`/etc. or drive a decaying state value
- [ ] `onBeat` is NOT used as `if (onBeat) translate(...)`; instead it sets
      a velocity/impulse on a decaying state variable like `jumpVel`/`jumpOffset`
- [ ] Output is a single fenced code block, no commentary
