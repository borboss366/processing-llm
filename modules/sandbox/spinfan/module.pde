// ── Spin Fan Module ────────────────────────────────────────────────────────
// Expects shared globals: fft, spectrum, smoothedLevel, bassEnergy, onBeat, width, height, frameCount

final float SPINFAN_X_FRAC = {{x}};
final float SPINFAN_Y_FRAC = {{y}};
final float SPINFAN_W_FRAC = {{width}};
final float SPINFAN_H_FRAC = {{height}};
final String SPINFAN_ANCHOR = "{{anchor}}";

color   spinfanArmColor     = {{armColor}};
color   spinfanHubColor     = {{hubColor}};
int     spinfanBaseSize     = {{baseSize}};
float   spinfanArmLength    = {{armLength}};
float   spinfanSpinRate     = {{spinRate}};
float   spinfanSpinBoost    = {{spinBoost}};
float   spinfanBassSmoothing= {{bassSmoothing}};
boolean spinfanBassBoost    = {{bassBoost}};

// state — DECLARE THESE alongside the params; assigning without declaring causes a compile error
float spinfanCX, spinfanCY;
float spinfanSmoothedBass = 0;

void spinfan_setup() {
  float ax = SPINFAN_X_FRAC * width;
  float ay = SPINFAN_Y_FRAC * height;

  // resolve anchor → CENTER of bounding box (single-subject pattern)
  if      (SPINFAN_ANCHOR.equals("top-left"))     { spinfanCX = ax + SPINFAN_W_FRAC * width / 2; spinfanCY = ay + SPINFAN_H_FRAC * height / 2; }
  else if (SPINFAN_ANCHOR.equals("top-center"))   { spinfanCX = ax;                              spinfanCY = ay + SPINFAN_H_FRAC * height / 2; }
  else if (SPINFAN_ANCHOR.equals("top-right"))    { spinfanCX = ax - SPINFAN_W_FRAC * width / 2; spinfanCY = ay + SPINFAN_H_FRAC * height / 2; }
  else if (SPINFAN_ANCHOR.equals("center"))       { spinfanCX = ax;                              spinfanCY = ay; }
  else if (SPINFAN_ANCHOR.equals("bottom-left"))  { spinfanCX = ax + SPINFAN_W_FRAC * width / 2; spinfanCY = ay - SPINFAN_H_FRAC * height / 2; }
  else if (SPINFAN_ANCHOR.equals("bottom-center")){ spinfanCX = ax;                              spinfanCY = ay - SPINFAN_H_FRAC * height / 2; }
  else if (SPINFAN_ANCHOR.equals("bottom-right")) { spinfanCX = ax - SPINFAN_W_FRAC * width / 2; spinfanCY = ay - SPINFAN_H_FRAC * height / 2; }
  else                                            { spinfanCX = ax;                              spinfanCY = ay; }
}

void spinfan_draw() {
  // smooth bass
  spinfanSmoothedBass = lerp(spinfanSmoothedBass, bassEnergy, spinfanBassSmoothing);

  // continuous rotation — monotonically increasing angle. Speed = baseRate × (1 + volume + optional bass).
  float spinfanSpinFactor = 1 + smoothedLevel * spinfanSpinBoost;
  if (spinfanBassBoost) spinfanSpinFactor += spinfanSmoothedBass * 0.8;
  float spinfanSpinAngle = frameCount * spinfanSpinRate * spinfanSpinFactor;

  float s = spinfanBaseSize;

  pushMatrix();
    translate(spinfanCX, spinfanCY);
    scale(1 + smoothedLevel * 1.0);

    // draw the hub (static, at origin)
    fill(spinfanHubColor);
    ellipse(0, 0, s * 0.25, s * 0.25);

    // draw 3 arms — same spinAngle, baselines TWO_PI/3 apart
    for (int i = 0; i < 3; i++) {
      pushMatrix();
        rotate(spinfanSpinAngle + i * TWO_PI / 3);
        
        // draw one arm: a rectangle with a triangular tip
        fill(spinfanArmColor);
        rect(-s/4, -s/2, s/2, s/8); // main blade
        triangle(0, -s/2, s/4, -s/2 - s*0.3, 0, -s/2 - s*0.6); // tip
        
      popMatrix();
    }
  popMatrix();
}

void spinfan_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/spinfan/armColor"))     spinfanArmColor     = unhex("FF" + msg.get(0).stringValue().substring(1));
  if (msg.checkAddrPattern("/spinfan/hubColor"))     spinfanHubColor     = unhex("FF" + msg.get(0).stringValue().substring(1));
  if (msg.checkAddrPattern("/spinfan/baseSize"))     spinfanBaseSize     = msg.get(0).intValue();
  if (msg.checkAddrPattern("/spinfan/armLength"))    spinfanArmLength    = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/spinfan/spinRate"))     spinfanSpinRate     = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/spinfan/spinBoost"))    spinfanSpinBoost    = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/spinfan/bassSmoothing")) spinfanBassSmoothing = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/spinfan/bassBoost"))    spinfanBassBoost    = msg.get(0).intValue() == 1;
}
