// ── Windmill Module ────────────────────────────────────────────────────────
// Expects shared globals: fft, spectrum, smoothedLevel, bassEnergy, onBeat, width, height, frameCount

final float WINDMILL_X_FRAC = {{x}};
final float WINDMILL_Y_FRAC = {{y}};
final float WINDMILL_W_FRAC = {{width}};
final float WINDMILL_H_FRAC = {{height}};
final String WINDMILL_ANCHOR = "{{anchor}}";

color   windmillBladeColor     = {{bladeColor}};
int     windmillBaseSize      = {{baseSize}};
float   windmillSpinRate      = {{spinRate}};
float   windmillSpinMultiplier= {{spinMultiplier}};
float   windmillBladeLength   = {{bladeLength}};
float   windmillBassSmoothing = {{bassSmoothing}};
boolean windmillSpinOnBass    = {{spinOnBass}};

// state — DECLARE THESE alongside the params; assigning without declaring causes a compile error
float windmillCX, windmillCY;
float windmillSmoothedBass = 0;
float windmillSpinOffset   = 0;

void windmill_setup() {
  float ax = WINDMILL_X_FRAC * width;
  float ay = WINDMILL_Y_FRAC * height;

  // resolve anchor → CENTER of bounding box (single-subject pattern §8.1)
  if      (WINDMILL_ANCHOR.equals("top-left"))     { windmillCX = ax + WINDMILL_W_FRAC * width / 2; windmillCY = ay + WINDMILL_H_FRAC * height / 2; }
  else if (WINDMILL_ANCHOR.equals("top-center"))   { windmillCX = ax;                              windmillCY = ay + WINDMILL_H_FRAC * height / 2; }
  else if (WINDMILL_ANCHOR.equals("top-right"))    { windmillCX = ax - WINDMILL_W_FRAC * width / 2; windmillCY = ay + WINDMILL_H_FRAC * height / 2; }
  else if (WINDMILL_ANCHOR.equals("center"))       { windmillCX = ax;                              windmillCY = ay; }
  else if (WINDMILL_ANCHOR.equals("bottom-left"))  { windmillCX = ax + WINDMILL_W_FRAC * width / 2; windmillCY = ay - WINDMILL_H_FRAC * height / 2; }
  else if (WINDMILL_ANCHOR.equals("bottom-center")){ windmillCX = ax;                              windmillCY = ay - WINDMILL_H_FRAC * height / 2; }
  else if (WINDMILL_ANCHOR.equals("bottom-right")) { windmillCX = ax - WINDMILL_W_FRAC * width / 2; windmillCY = ay - WINDMILL_H_FRAC * height / 2; }
  else                                            { windmillCX = ax;                              windmillCY = ay; }
}

void windmill_draw() {
  float s = windmillBaseSize;

  // smooth bass
  windmillSmoothedBass = lerp(windmillSmoothedBass, bassEnergy, windmillBassSmoothing);

  // continuous rotation — monotonically increasing angle, speed scales with volume + (optional) bass
  float spinFactor = 1 + smoothedLevel * windmillSpinMultiplier;
  if (windmillSpinOnBass) spinFactor += windmillSmoothedBass * 0.8;
  float spinAngle = frameCount * windmillSpinRate * spinFactor;

  pushMatrix();
    translate(windmillCX, windmillCY);
    scale(1 + smoothedLevel * 1.5);

    // tower base (rectangle below the hub)
    noStroke(); fill(windmillBladeColor);
    rect(-s*0.1, 0, s*0.2, s*0.8);

    // central hub (drawn once, not per blade)
    fill(windmillBladeColor);
    ellipse(0, 0, s*0.3, s*0.3);

    // 4 blades — same spinAngle, baselines 90° apart. All extend along local +x.
    for (int i = 0; i < 4; i++) {
      pushMatrix();
        rotate(spinAngle + i * HALF_PI);    // baselines: 0, π/2, π, 3π/2
        stroke(windmillBladeColor); strokeWeight(s * 0.10);
        line(0, 0, s*windmillBladeLength, 0);
        // simple paddle at blade tip
        noStroke();
        fill(windmillBladeColor);
        ellipse(s*windmillBladeLength, 0, s*0.15, s*0.4);
      popMatrix();
    }
  popMatrix();
}

void windmill_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/windmill/bladeColor"))     windmillBladeColor     = unhex("FF" + msg.get(0).stringValue().substring(1));
  if (msg.checkAddrPattern("/windmill/baseSize"))      windmillBaseSize      = msg.get(0).intValue();
  if (msg.checkAddrPattern("/windmill/spinRate"))      windmillSpinRate      = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/windmill/spinMultiplier")) windmillSpinMultiplier = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/windmill/bladeLength"))   windmillBladeLength   = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/windmill/bassSmoothing")) windmillBassSmoothing = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/windmill/spinOnBass"))    windmillSpinOnBass    = msg.get(0).intValue() == 1;
}
