// ── Sun Mascot Module ────────────────────────────────────────────────────────
// Expects shared globals: fft, spectrum, smoothedLevel, bassEnergy, onBeat, width, height, frameCount

final float SUNMASCOT_X_FRAC = {{x}};
final float SUNMASCOT_Y_FRAC = {{y}};
final float SUNMASCOT_W_FRAC = {{width}};
final float SUNMASCOT_H_FRAC = {{height}};
final String SUNMASCOT_ANCHOR = "{{anchor}}";

color   sunmascotBodyColor     = {{bodyColor}};
color   sunmascotAccentColor   = {{accentColor}};
int     sunmascotBaseSize      = {{baseSize}};
float   sunmascotSwayStrength  = {{swayStrength}};
float   sunmascotJumpStrength  = {{jumpStrength}};
float   sunmascotBassSmoothing = {{bassSmoothing}};
boolean sunmascotTiltOnBass    = {{tiltOnBass}};

// state — DECLARE THESE alongside the params; assigning without declaring causes a compile error
float sunmascotCX, sunmascotCY;
float sunmascotSmoothedBass = 0;
float sunmascotJumpVel      = 0;
float sunmascotJumpOffset   = 0;

void sunmascot_setup() {
  float ax = SUNMASCOT_X_FRAC * width;
  float ay = SUNMASCOT_Y_FRAC * height;

  // resolve anchor → CENTER of bounding box (single-subject pattern §8.1)
  if      (SUNMASCOT_ANCHOR.equals("top-left"))     { sunmascotCX = ax + SUNMASCOT_W_FRAC * width / 2; sunmascotCY = ay + SUNMASCOT_H_FRAC * height / 2; }
  else if (SUNMASCOT_ANCHOR.equals("top-center"))   { sunmascotCX = ax;                              sunmascotCY = ay + SUNMASCOT_H_FRAC * height / 2; }
  else if (SUNMASCOT_ANCHOR.equals("top-right"))    { sunmascotCX = ax - SUNMASCOT_W_FRAC * width / 2; sunmascotCY = ay + SUNMASCOT_H_FRAC * height / 2; }
  else if (SUNMASCOT_ANCHOR.equals("center"))       { sunmascotCX = ax;                              sunmascotCY = ay; }
  else if (SUNMASCOT_ANCHOR.equals("bottom-left"))  { sunmascotCX = ax + SUNMASCOT_W_FRAC * width / 2; sunmascotCY = ay - SUNMASCOT_H_FRAC * height / 2; }
  else if (SUNMASCOT_ANCHOR.equals("bottom-center")){ sunmascotCX = ax;                              sunmascotCY = ay - SUNMASCOT_H_FRAC * height / 2; }
  else if (SUNMASCOT_ANCHOR.equals("bottom-right")) { sunmascotCX = ax - SUNMASCOT_W_FRAC * width / 2; sunmascotCY = ay - SUNMASCOT_H_FRAC * height / 2; }
  else                                            { sunmascotCX = ax;                              sunmascotCY = ay; }
}

void sunmascot_draw() {
  float s = sunmascotBaseSize;

  // smooth bass, integrate jump-impulse decay
  sunmascotSmoothedBass = lerp(sunmascotSmoothedBass, bassEnergy, sunmascotBassSmoothing);
  if (onBeat) sunmascotJumpVel = -sunmascotJumpStrength;
  sunmascotJumpVel    += 0.4;
  sunmascotJumpOffset += sunmascotJumpVel;
  if (sunmascotJumpOffset > 0) { sunmascotJumpOffset = 0; sunmascotJumpVel = 0; }

  pushMatrix();
    translate(sunmascotCX, sunmascotCY);
    scale(1 + smoothedLevel * 2.0);
    if (sunmascotTiltOnBass) rotate(sin(sunmascotSmoothedBass * 0.5));  // RADIANS — no *30 / *180
    translate(sin(frameCount * 0.05) * sunmascotSmoothedBass * 30 * sunmascotSwayStrength, 0);
    translate(0, sunmascotJumpOffset);

    // Body - a circle with rays for the sun
    fill(sunmascotBodyColor);
    ellipse(0, 0, 2*s, 2*s);
    
    // Rays (16 rays)
    stroke(sunmascotAccentColor);
    strokeWeight(2);
    noFill();
    for (int i = 0; i < 16; i++) {
      float angle = TWO_PI * i / 16;
      float x = cos(angle) * s * 1.5;
      float y = sin(angle) * s * 1.5;
      line(0, 0, x, y);
    }

    // Eyes
    fill(sunmascotAccentColor);
    ellipse(-s/4, -s/4, s/6, s/6);
    ellipse(+s/4, -s/4, s/6, s/6);

    // Smile
    stroke(sunmascotAccentColor);
    strokeWeight(2);
    line(-s/3, +s/2, 0, +s/2);
    line(0, +s/2, +s/3, +s/2);
  popMatrix();
}

void sunmascot_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/sunmascot/bodyColor"))     sunmascotBodyColor     = unhex("FF" + msg.get(0).stringValue().substring(1));
  if (msg.checkAddrPattern("/sunmascot/accentColor"))   sunmascotAccentColor   = unhex("FF" + msg.get(0).stringValue().substring(1));
  if (msg.checkAddrPattern("/sunmascot/baseSize"))      sunmascotBaseSize      = msg.get(0).intValue();
  if (msg.checkAddrPattern("/sunmascot/swayStrength"))  sunmascotSwayStrength  = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/sunmascot/jumpStrength")) sunmascotJumpStrength  = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/sunmascot/bassSmoothing")) sunmascotBassSmoothing = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/sunmascot/tiltOnBass"))    sunmascotTiltOnBass    = msg.get(0).intValue() == 1;
}
