// ── Stickboy Module ────────────────────────────────────────────────────────
// Expects shared globals: fft, spectrum, smoothedLevel, bassEnergy, onBeat, width, height, frameCount

final float STICKBOY_X_FRAC = {{x}};
final float STICKBOY_Y_FRAC = {{y}};
final float STICKBOY_W_FRAC = {{width}};
final float STICKBOY_H_FRAC = {{height}};
final String STICKBOY_ANCHOR = "{{anchor}}";

color   stickboyBodyColor     = {{bodyColor}};
color   stickboyHandColor     = {{handColor}};
int     stickboyBaseSize      = {{baseSize}};
float   stickboyWaveStrength  = {{waveStrength}};
float   stickboyJumpStrength  = {{jumpStrength}};
float   stickboyBassSmoothing = {{bassSmoothing}};
boolean stickboyWaveOnBass    = {{waveOnBass}};

// state — DECLARE THESE alongside the params; assigning without declaring causes a compile error
float stickboyCX, stickboyCY;
float stickboySmoothedBass = 0;
float stickboyJumpVel      = 0;
float stickboyJumpOffset   = 0;

void stickboy_setup() {
  float ax = STICKBOY_X_FRAC * width;
  float ay = STICKBOY_Y_FRAC * height;

  // resolve anchor → CENTER of bounding box (single-subject pattern §8.1)
  if      (STICKBOY_ANCHOR.equals("top-left"))     { stickboyCX = ax + STICKBOY_W_FRAC * width / 2; stickboyCY = ay + STICKBOY_H_FRAC * height / 2; }
  else if (STICKBOY_ANCHOR.equals("top-center"))   { stickboyCX = ax;                              stickboyCY = ay + STICKBOY_H_FRAC * height / 2; }
  else if (STICKBOY_ANCHOR.equals("top-right"))    { stickboyCX = ax - STICKBOY_W_FRAC * width / 2; stickboyCY = ay + STICKBOY_H_FRAC * height / 2; }
  else if (STICKBOY_ANCHOR.equals("center"))       { stickboyCX = ax;                              stickboyCY = ay; }
  else if (STICKBOY_ANCHOR.equals("bottom-left"))  { stickboyCX = ax + STICKBOY_W_FRAC * width / 2; stickboyCY = ay - STICKBOY_H_FRAC * height / 2; }
  else if (STICKBOY_ANCHOR.equals("bottom-center")){ stickboyCX = ax;                              stickboyCY = ay - STICKBOY_H_FRAC * height / 2; }
  else if (STICKBOY_ANCHOR.equals("bottom-right")) { stickboyCX = ax - STICKBOY_W_FRAC * width / 2; stickboyCY = ay - STICKBOY_H_FRAC * height / 2; }
  else                                            { stickboyCX = ax;                              stickboyCY = ay; }
}

void stickboy_draw() {
  float s = stickboyBaseSize;

  // smooth bass, integrate jump-impulse decay
  stickboySmoothedBass = lerp(stickboySmoothedBass, bassEnergy, stickboyBassSmoothing);
  if (onBeat) stickboyJumpVel = -stickboyJumpStrength;
  stickboyJumpVel    += 0.4;
  stickboyJumpOffset += stickboyJumpVel;
  if (stickboyJumpOffset > 0) { stickboyJumpOffset = 0; stickboyJumpVel = 0; }

  // arm wave — faster with volume, swing amplitude scales with waveStrength
  float waveRate = 0.18 * (1 + smoothedLevel * 2.0);
  float armOsc   = sin(frameCount * waveRate) * 0.5 * stickboyWaveStrength;

  pushMatrix();
    translate(stickboyCX, stickboyCY);
    scale(1 + smoothedLevel * 1.5);
    translate(0, stickboyJumpOffset);

    // static body parts: spine, legs, head
    stroke(stickboyBodyColor); strokeWeight(s * 0.06);
    line(0, -s*0.55, 0, 0);                  // spine
    line(0, 0, -s*0.2, s*0.8);               // left leg
    line(0, 0, +s*0.2, s*0.8);               // right leg
    noStroke(); fill(stickboyBodyColor);
    ellipse(0, -s*0.7, s*0.3, s*0.3);        // head

    // arms — each rotates around the shoulder independently
    // right arm: baseline up-right at -PI/3 (~60° above horizontal), oscillates with armOsc
    pushMatrix();
      translate(0, -s*0.5);
      rotate(-PI/3 + armOsc);
      stroke(stickboyBodyColor); strokeWeight(s * 0.06);
      line(0, 0, s*0.5, 0);                       // arm extends along local +x (now pointing up-right)
      noStroke(); fill(stickboyHandColor);
      ellipse(s*0.5, 0, s*0.4, s*0.4);            // hand at end of arm
    popMatrix();

    // left arm: baseline up-left at -2*PI/3 (mirror of right), oscillates OPPOSITE phase
    pushMatrix();
      translate(0, -s*0.5);
      rotate(-2*PI/3 - armOsc);
      stroke(stickboyBodyColor); strokeWeight(s * 0.06);
      line(0, 0, s*0.5, 0);
      noStroke(); fill(stickboyHandColor);
      ellipse(s*0.5, 0, s*0.4, s*0.4);
    popMatrix();
  popMatrix();
}

void stickboy_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/stickboy/bodyColor"))     stickboyBodyColor     = unhex("FF" + msg.get(0).stringValue().substring(1));
  if (msg.checkAddrPattern("/stickboy/handColor"))     stickboyHandColor     = unhex("FF" + msg.get(0).stringValue().substring(1));
  if (msg.checkAddrPattern("/stickboy/baseSize"))      stickboyBaseSize      = msg.get(0).intValue();
  if (msg.checkAddrPattern("/stickboy/waveStrength"))  stickboyWaveStrength  = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/stickboy/jumpStrength"))  stickboyJumpStrength  = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/stickboy/bassSmoothing")) stickboyBassSmoothing = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/stickboy/waveOnBass"))    stickboyWaveOnBass    = msg.get(0).intValue() == 1;
}
