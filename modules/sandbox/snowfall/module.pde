// ── Snowfall Module ────────────────────────────────────────────────────────
// Expects shared globals: fft, spectrum, smoothedLevel, bassEnergy, onBeat, width, height, frameCount

final float SNOWFALL_X_FRAC = {{x}};
final float SNOWFALL_Y_FRAC = {{y}};
final float SNOWFALL_W_FRAC = {{width}};
final float SNOWFALL_H_FRAC = {{height}};
final String SNOWFALL_ANCHOR = "{{anchor}}";

color   snowfallParticleColor = {{particleColor}};
int     snowfallParticleCount = {{particleCount}};
float   snowfallSizeMin       = {{sizeMin}};
float   snowfallSizeMax       = {{sizeMax}};
float   snowfallSpeedScale    = {{speedScale}};
float   snowfallBassSmoothing = {{bassSmoothing}};
boolean snowfallSpeedOnBass   = {{speedOnBass}};
boolean snowfallPulseOnBeat   = {{pulseOnBeat}};

// state — must be DECLARED here even if computed in setup
final int SNOWFALL_COUNT = {{particleCount}};
float[] snowfallX    = new float[SNOWFALL_COUNT];
float[] snowfallY    = new float[SNOWFALL_COUNT];
float[] snowfallVx   = new float[SNOWFALL_COUNT];
float[] snowfallVy   = new float[SNOWFALL_COUNT];
float[] snowfallSize = new float[SNOWFALL_COUNT];
float snowfallSmoothedBass = 0;
float snowfallBeatPulse    = 0;
float snowfallPX, snowfallPY, snowfallPW, snowfallPH;

void snowfall_setup() {
  snowfallPW = SNOWFALL_W_FRAC * width;
  snowfallPH = SNOWFALL_H_FRAC * height;
  float ax = SNOWFALL_X_FRAC * width;
  float ay = SNOWFALL_Y_FRAC * height;

  // resolve anchor → TOP-LEFT corner of bounding box (bounding-box pattern)
  if      (SNOWFALL_ANCHOR.equals("top-left"))     { snowfallPX = ax;             snowfallPY = ay; }
  else if (SNOWFALL_ANCHOR.equals("top-center"))   { snowfallPX = ax - snowfallPW/2; snowfallPY = ay; }
  else if (SNOWFALL_ANCHOR.equals("top-right"))    { snowfallPX = ax - snowfallPW;   snowfallPY = ay; }
  else if (SNOWFALL_ANCHOR.equals("center"))       { snowfallPX = ax - snowfallPW/2; snowfallPY = ay - snowfallPH/2; }
  else if (SNOWFALL_ANCHOR.equals("bottom-left"))  { snowfallPX = ax;             snowfallPY = ay - snowfallPH; }
  else if (SNOWFALL_ANCHOR.equals("bottom-center")){ snowfallPX = ax - snowfallPW/2; snowfallPY = ay - snowfallPH; }
  else if (SNOWFALL_ANCHOR.equals("bottom-right")) { snowfallPX = ax - snowfallPW;   snowfallPY = ay - snowfallPH; }

  for (int i = 0; i < SNOWFALL_COUNT; i++) {
    snowfallX[i] = random(snowfallPX, snowfallPX + snowfallPW);
    snowfallY[i] = random(snowfallPY, snowfallPY + snowfallPH);
    snowfallSize[i] = random(snowfallSizeMin, snowfallSizeMax);
    snowfallVx[i] = random(-0.3, 0.3);
    snowfallVy[i] = random(0.5, 2.0);
  }
}

void snowfall_draw() {
  // smooth bass + beat pulse
  snowfallSmoothedBass = lerp(snowfallSmoothedBass, bassEnergy, snowfallBassSmoothing);
  if (snowfallPulseOnBeat && onBeat) snowfallBeatPulse = 1.0;
  snowfallBeatPulse *= 0.88;

  // speed factor
  float speedFactor = snowfallSpeedScale *
    (snowfallSpeedOnBass ? (1 + smoothedLevel + snowfallSmoothedBass * 1.5) : 1);

  for (int i = 0; i < SNOWFALL_COUNT; i++) {
    snowfallX[i] += snowfallVx[i] * speedFactor;
    snowfallY[i] += snowfallVy[i] * speedFactor;

    // respawn at top when fallen below bottom edge
    if (snowfallY[i] > snowfallPY + snowfallPH) {
      snowfallY[i] = snowfallPY;
      snowfallX[i] = random(snowfallPX, snowfallPX + snowfallPW);
    }

    float x  = snowfallX[i];
    float y  = snowfallY[i];
    float sz = snowfallSize[i] * (1 + snowfallBeatPulse * 0.8);

    // draw a dot
    fill(snowfallParticleColor);
    ellipse(x, y, sz, sz);
  }
}

void snowfall_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/snowfall/particleColor")) {
    snowfallParticleColor = unhex("FF" + msg.get(0).stringValue().substring(1));
  } else if (msg.checkAddrPattern("/snowfall/sizeMin")) {
    snowfallSizeMin = msg.get(0).floatValue();
  } else if (msg.checkAddrPattern("/snowfall/sizeMax")) {
    snowfallSizeMax = msg.get(0).floatValue();
  } else if (msg.checkAddrPattern("/snowfall/speedScale")) {
    snowfallSpeedScale = msg.get(0).floatValue();
  } else if (msg.checkAddrPattern("/snowfall/bassSmoothing")) {
    snowfallBassSmoothing = msg.get(0).floatValue();
  } else if (msg.checkAddrPattern("/snowfall/speedOnBass")) {
    snowfallSpeedOnBass = msg.get(0).intValue() == 1;
  } else if (msg.checkAddrPattern("/snowfall/pulseOnBeat")) {
    snowfallPulseOnBeat = msg.get(0).intValue() == 1;
  }
}
