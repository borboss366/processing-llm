// ── Stick Girl Module ────────────────────────────────────────────────────────
// Expects shared globals: fft, spectrum, smoothedLevel, bassEnergy, onBeat, width, height

final float GIRL_X_FRAC = {{x}};
final float GIRL_Y_FRAC = {{y}};
final float GIRL_W_FRAC = {{width}};
final float GIRL_H_FRAC = {{height}};
final String GIRL_ANCHOR = "{{anchor}}";

color girlBodyColor = {{bodyColor}};
color girlHairColor = {{hairColor}};
int girlBaseSize = {{baseSize}};
float girlSwayStrength = {{swayStrength}};
float girlJumpStrength = {{jumpStrength}};
float girlArmSwingRate = {{armSwingRate}};
float girlBassSmoothing = {{bassSmoothing}};
boolean girlHipShake = {{hipShake}};
boolean girlBounceOnBeat = {{bounceOnBeat}};

float girlSmoothedBass = 0;
float girlJumpVel = 0;
float girlJumpOffset = 0;
float girlCX, girlCY;

void girl_setup() {
  float pw = GIRL_W_FRAC * width;
  float ph = GIRL_H_FRAC * height;
  float ax = GIRL_X_FRAC * width;
  float ay = GIRL_Y_FRAC * height;

  // Resolve to the center of the bounding box
  if (GIRL_ANCHOR.equals("top-left")) {
    girlCX = ax + pw / 2;
    girlCY = ay + ph / 2;
  } else if (GIRL_ANCHOR.equals("top-center")) {
    girlCX = ax;
    girlCY = ay + ph / 2;
  } else if (GIRL_ANCHOR.equals("top-right")) {
    girlCX = ax - pw / 2;
    girlCY = ay + ph / 2;
  } else if (GIRL_ANCHOR.equals("center")) {
    girlCX = ax;
    girlCY = ay;
  } else if (GIRL_ANCHOR.equals("bottom-left")) {
    girlCX = ax + pw / 2;
    girlCY = ay - ph / 2;
  } else if (GIRL_ANCHOR.equals("bottom-center")) {
    girlCX = ax;
    girlCY = ay - ph / 2;
  } else if (GIRL_ANCHOR.equals("bottom-right")) {
    girlCX = ax - pw / 2;
    girlCY = ay - ph / 2;
  } else {
    girlCX = ax;
    girlCY = ay;
  }
}

void girl_draw() {
  // Smooth bassEnergy
  girlSmoothedBass = lerp(girlSmoothedBass, bassEnergy, girlBassSmoothing);

  // Beat-jump (only if girlBounceOnBeat)
  if (girlBounceOnBeat && onBeat) {
    girlJumpVel = -girlJumpStrength;
  }
  girlJumpVel += 0.4;
  girlJumpOffset += girlJumpVel;
  if (girlJumpOffset > 0) {
    girlJumpOffset = 0;
    girlJumpVel = 0;
  }

  pushMatrix();
  translate(girlCX, girlCY);
  scale(1 + smoothedLevel * 1.5);

  // Hip shake horizontal sway (only if girlHipShake)
  if (girlHipShake) {
    translate(sin(frameCount * 0.1) * girlSmoothedBass * 30 * girlSwayStrength, 0);
  }

  translate(0, girlJumpOffset);

  // Draw stick figure
  float s = girlBaseSize;

  strokeWeight(s * 0.06);
  stroke(girlBodyColor);

  float armAngle = sin(frameCount * girlArmSwingRate) * 0.7;

  line(0, -s * 0.6, 0, 0);

  line(0, -s * 0.55, cos(-PI/2 - armAngle) * s * 0.45, -s * 0.55 + sin(-PI/2 - armAngle) * s * 0.45);
  line(0, -s * 0.55, cos(-PI/2 + armAngle) * s * 0.45, -s * 0.55 + sin(-PI/2 + armAngle) * s * 0.45);

  line(0, 0, -s * 0.2, s * 0.8);
  line(0, 0, s * 0.2, s * 0.8);

  noStroke();
  fill(girlBodyColor);
  ellipse(0, -s * 0.78, s * 0.32, s * 0.36);

  fill(girlHairColor);
  ellipse(0, -s * 0.92, s * 0.30, s * 0.18);

  triangle(s * 0.10, -s * 0.85, s * 0.35, -s * 0.55, s * 0.10, -s * 0.55);

  fill(girlBodyColor);
  triangle(0, -s * 0.05, -s * 0.30, s * 0.30, s * 0.30, s * 0.30);

  popMatrix();
}

void girl_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/girl/bodyColor")) {
    girlBodyColor = unhex("FF" + msg.get(0).stringValue().substring(1));
  }
  if (msg.checkAddrPattern("/girl/hairColor")) {
    girlHairColor = unhex("FF" + msg.get(0).stringValue().substring(1));
  }
  if (msg.checkAddrPattern("/girl/baseSize")) {
    girlBaseSize = msg.get(0).intValue();
  }
  if (msg.checkAddrPattern("/girl/swayStrength")) {
    girlSwayStrength = msg.get(0).floatValue();
  }
  if (msg.checkAddrPattern("/girl/jumpStrength")) {
    girlJumpStrength = msg.get(0).floatValue();
  }
  if (msg.checkAddrPattern("/girl/armSwingRate")) {
    girlArmSwingRate = msg.get(0).floatValue();
  }
  if (msg.checkAddrPattern("/girl/bassSmoothing")) {
    girlBassSmoothing = msg.get(0).floatValue();
  }
  if (msg.checkAddrPattern("/girl/hipShake")) {
    girlHipShake = msg.get(0).intValue() == 1;
  }
  if (msg.checkAddrPattern("/girl/bounceOnBeat")) {
    girlBounceOnBeat = msg.get(0).intValue() == 1;
  }
}
