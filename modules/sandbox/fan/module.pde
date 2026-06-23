// ── Ceiling Fan Module ────────────────────────────────────────────────────────
// Expects shared globals: fft, spectrum, smoothedLevel, bassEnergy, onBeat, width, height, frameCount

final float CEILINGFAN_X_FRAC = {{x}};
final float CEILINGFAN_Y_FRAC = {{y}};
final float CEILINGFAN_W_FRAC = {{width}};
final float CEILINGFAN_H_FRAC = {{height}};
final String CEILINGFAN_ANCHOR = "{{anchor}}";

color   ceilingfanBladeColor     = {{bladeColor}};
int     ceilingfanBaseSize      = {{baseSize}};
float   ceilingfanSpinRate      = {{spinRate}};
float   ceilingfanSpinMultiplier= {{spinMultiplier}};
float   ceilingfanBladeWidth    = {{bladeWidth}};
float   ceilingfanBassSmoothing = {{bassSmoothing}};
boolean ceilingfanSpinOnBass    = {{spinOnBass}};

// state — DECLARE THESE alongside the params; assigning without declaring causes a compile error
float ceilingfanCX, ceilingfanCY;
float ceilingfanSmoothedBass = 0;
float ceilingfanSpinAngle = 0;

void ceilingfan_setup() {
  float ax = CEILINGFAN_X_FRAC * width;
  float ay = CEILINGFAN_Y_FRAC * height;

  // resolve anchor → CENTER of bounding box (single-subject pattern §8.1)
  if      (CEILINGFAN_ANCHOR.equals("top-left"))     { ceilingfanCX = ax + CEILINGFAN_W_FRAC * width / 2; ceilingfanCY = ay + CEILINGFAN_H_FRAC * height / 2; }
  else if (CEILINGFAN_ANCHOR.equals("top-center"))   { ceilingfanCX = ax;                              ceilingfanCY = ay + CEILINGFAN_H_FRAC * height / 2; }
  else if (CEILINGFAN_ANCHOR.equals("top-right"))    { ceilingfanCX = ax - CEILINGFAN_W_FRAC * width / 2; ceilingfanCY = ay + CEILINGFAN_H_FRAC * height / 2; }
  else if (CEILINGFAN_ANCHOR.equals("center"))       { ceilingfanCX = ax;                              ceilingfanCY = ay; }
  else if (CEILINGFAN_ANCHOR.equals("bottom-left"))  { ceilingfanCX = ax + CEILINGFAN_W_FRAC * width / 2; ceilingfanCY = ay - CEILINGFAN_H_FRAC * height / 2; }
  else if (CEILINGFAN_ANCHOR.equals("bottom-center")){ ceilingfanCX = ax;                              ceilingfanCY = ay - CEILINGFAN_H_FRAC * height / 2; }
  else if (CEILINGFAN_ANCHOR.equals("bottom-right")) { ceilingfanCX = ax - CEILINGFAN_W_FRAC * width / 2; ceilingfanCY = ay - CEILINGFAN_H_FRAC * height / 2; }
  else                                            { ceilingfanCX = ax;                              ceilingfanCY = ay; }
}

void ceilingfan_draw() {
  // smooth bass
  ceilingfanSmoothedBass = lerp(ceilingfanSmoothedBass, bassEnergy, ceilingfanBassSmoothing);

  // calculate spin angle
  float spinAngle = frameCount * ceilingfanSpinRate * (1 + smoothedLevel * ceilingfanSpinMultiplier);
  if (ceilingfanSpinOnBass) spinAngle += ceilingfanSmoothedBass * 0.5;

  pushMatrix();
    translate(ceilingfanCX, ceilingfanCY);
    scale(1 + smoothedLevel * 1.5);

    // Blade 1: baseline angle -PI/3, rotates with spinAngle
    pushMatrix();
      translate(0, 0);
      rotate(-PI/3 + spinAngle);
      fill(ceilingfanBladeColor);
      rect(-ceilingfanBaseSize * ceilingfanBladeWidth / 2, 0, ceilingfanBaseSize * ceilingfanBladeWidth, ceilingfanBaseSize);
    popMatrix();

    // Blade 2: baseline angle 0, rotates with spinAngle
    pushMatrix();
      translate(0, 0);
      rotate(0 + spinAngle);
      fill(ceilingfanBladeColor);
      rect(-ceilingfanBaseSize * ceilingfanBladeWidth / 2, 0, ceilingfanBaseSize * ceilingfanBladeWidth, ceilingfanBaseSize);
    popMatrix();

    // Blade 3: baseline angle +PI/3, rotates with spinAngle
    pushMatrix();
      translate(0, 0);
      rotate(PI/3 + spinAngle);
      fill(ceilingfanBladeColor);
      rect(-ceilingfanBaseSize * ceilingfanBladeWidth / 2, 0, ceilingfanBaseSize * ceilingfanBladeWidth, ceilingfanBaseSize);
    popMatrix();
  popMatrix();
}

void ceilingfan_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/ceilingfan/bladeColor"))     ceilingfanBladeColor     = unhex("FF" + msg.get(0).stringValue().substring(1));
  if (msg.checkAddrPattern("/ceilingfan/baseSize"))      ceilingfanBaseSize      = msg.get(0).intValue();
  if (msg.checkAddrPattern("/ceilingfan/spinRate"))      ceilingfanSpinRate      = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/ceilingfan/spinMultiplier"))ceilingfanSpinMultiplier= msg.get(0).floatValue();
  if (msg.checkAddrPattern("/ceilingfan/bladeWidth"))    ceilingfanBladeWidth    = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/ceilingfan/bassSmoothing")) ceilingfanBassSmoothing = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/ceilingfan/spinOnBass"))    ceilingfanSpinOnBass    = msg.get(0).intValue() == 1;
}
