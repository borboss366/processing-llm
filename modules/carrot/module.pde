// ── Carrot Module ────────────────────────────────────────────────────────
// Expects shared globals: fft, spectrum, smoothedLevel, onBeat

final float CARROT_X_FRAC = {{x}};
final float CARROT_Y_FRAC = {{y}};
final float CARROT_W_FRAC = {{width}};
final float CARROT_H_FRAC = {{height}};
final String CARROT_ANCHOR = "{{anchor}}";

color carrotBodyColor = {{bodyColor}};
color carrotLeafColor = {{leafColor}};
int carrotBaseSize = {{baseSize}};
float carrotSwayStrength = {{swayStrength}};
float carrotJumpStrength = {{jumpStrength}};
float carrotBassSmoothing = {{bassSmoothing}};
boolean carrotTiltOnBass = {{tiltOnBass}};

float carrotCX, carrotCY;
float carrotSmoothedBass = 0;
float carrotJumpVel = 0;
float carrotJumpOffset = 0;

void carrot_setup() {
  float ax = CARROT_X_FRAC * width;
  float ay = CARROT_Y_FRAC * height;

  // resolve to the CENTER of the bounding box, regardless of anchor
  if (CARROT_ANCHOR.equals("top-left")) {
    carrotCX = ax + CARROT_W_FRAC * width / 2;
    carrotCY = ay + CARROT_H_FRAC * height / 2;
  } else if (CARROT_ANCHOR.equals("top-center")) {
    carrotCX = ax;
    carrotCY = ay + CARROT_H_FRAC * height / 2;
  } else if (CARROT_ANCHOR.equals("top-right")) {
    carrotCX = ax - CARROT_W_FRAC * width / 2;
    carrotCY = ay + CARROT_H_FRAC * height / 2;
  } else if (CARROT_ANCHOR.equals("center")) {
    carrotCX = ax;
    carrotCY = ay;
  } else if (CARROT_ANCHOR.equals("bottom-left")) {
    carrotCX = ax + CARROT_W_FRAC * width / 2;
    carrotCY = ay - CARROT_H_FRAC * height / 2;
  } else if (CARROT_ANCHOR.equals("bottom-center")) {
    carrotCX = ax;
    carrotCY = ay - CARROT_H_FRAC * height / 2;
  } else if (CARROT_ANCHOR.equals("bottom-right")) {
    carrotCX = ax - CARROT_W_FRAC * width / 2;
    carrotCY = ay - CARROT_H_FRAC * height / 2;
  } else {
    carrotCX = ax;
    carrotCY = ay;
  }
}

void carrot_draw() {
  float s = carrotBaseSize;

  // Smooth bassEnergy into carrotSmoothedBass
  carrotSmoothedBass = lerp(carrotSmoothedBass, bassEnergy, carrotBassSmoothing);

  // On beat, set jump velocity and apply gravity
  if (onBeat) {
    carrotJumpVel = -carrotJumpStrength;
  }
  carrotJumpVel += 0.4;
  carrotJumpOffset += carrotJumpVel;
  if (carrotJumpOffset > 0) {
    carrotJumpOffset = 0;
    carrotJumpVel = 0;
  }

  pushMatrix();
  translate(carrotCX, carrotCY);
  scale(1 + smoothedLevel * 2.0);

  // Apply tilt based on bass
  if (carrotTiltOnBass) {
    rotate(sin(carrotSmoothedBass * 0.5));
  }

  // Add horizontal sway based on bass
  translate(sin(frameCount * 0.05) * carrotSmoothedBass * 30 * carrotSwayStrength, 0);

  // Apply vertical jump offset
  translate(0, carrotJumpOffset);

  // Draw body — apex DOWN (larger y), base above origin (smaller y)
  fill(carrotBodyColor);
  triangle(
    0, s,
    -s / 3, -2 * s / 3,
    +s / 3, -2 * s / 3
  );

  // Draw leaves — apex UP, base on body's top edge
  fill(carrotLeafColor);

  // Left leaf
  triangle(
    -s / 4, -2 * s / 3,
    -s / 2, -2 * s / 3 - s * 0.7,
    0, -2 * s / 3 - s * 0.4
  );

  // Center leaf — tallest
  triangle(
    0, -2 * s / 3,
    -s / 4, -2 * s / 3 - s,
    +s / 4, -2 * s / 3 - s
  );

  // Right leaf
  triangle(
    +s / 4, -2 * s / 3,
    0, -2 * s / 3 - s * 0.4,
    +s / 2, -2 * s / 3 - s * 0.7
  );

  popMatrix();
}

void carrot_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/carrot/bodyColor")) {
    carrotBodyColor = unhex("FF" + msg.get(0).stringValue().substring(1));
  }
  if (msg.checkAddrPattern("/carrot/leafColor")) {
    carrotLeafColor = unhex("FF" + msg.get(0).stringValue().substring(1));
  }
  if (msg.checkAddrPattern("/carrot/baseSize")) {
    carrotBaseSize = msg.get(0).intValue();
  }
  if (msg.checkAddrPattern("/carrot/swayStrength")) {
    carrotSwayStrength = msg.get(0).floatValue();
  }
  if (msg.checkAddrPattern("/carrot/jumpStrength")) {
    carrotJumpStrength = msg.get(0).floatValue();
  }
  if (msg.checkAddrPattern("/carrot/bassSmoothing")) {
    carrotBassSmoothing = msg.get(0).floatValue();
  }
  if (msg.checkAddrPattern("/carrot/tiltOnBass")) {
    carrotTiltOnBass = msg.get(0).intValue() == 1;
  }
}
