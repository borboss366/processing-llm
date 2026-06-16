// ── Equalizer Module ──────────────────────────────────────────────────────────
// Expects shared globals from audio setup:
//   fft (FFT), spectrum (float[]), smoothedAmp (float), onBeat (boolean)

// ── Layout (baked at assembly, pixel values computed in eq_setup) ─────────────
final float EQ_X_FRAC = {{x}};
final float EQ_Y_FRAC = {{y}};
final float EQ_W_FRAC = {{width}};
final float EQ_H_FRAC = {{height}};
final String EQ_ANCHOR      = "{{anchor}}";
final String EQ_ORIENTATION = "{{orientation}}";

// ── Physics (OSC-controllable) ────────────────────────────────────────────────
float eqSpringK   = {{springStiffness}};
float eqSpringKUp = {{springStiffnessUp}};
float eqDamping   = {{damping}};
float eqGravity   = {{gravity}};
float eqFluidDrag = {{fluidDrag}};

// ── Params (OSC-controllable) ─────────────────────────────────────────────────
color   eqBarColor  = {{barColor}};
color   eqPeakColor = {{peakColor}};
float   eqGlow      = {{glowIntensity}};
final int EQ_BAR_COUNT = {{barCount}};
float   eqBarGap    = {{barGap}};
float   eqSmoothing = {{smoothing}};
float   eqFftGain   = {{fftGain}};

// ── Effects (OSC-controllable) ────────────────────────────────────────────────
boolean eqMirror   = {{mirror}};
boolean eqRainbow  = {{rainbow}};
boolean eqPeakHold = {{peakHold}};
boolean eqFilled   = {{filled}};

// ── Internal state ────────────────────────────────────────────────────────────
float[] eqPos;
float[] eqVel;
float[] eqPeak;
float[] eqPeakVel;
float[] eqSmoothed;

float eqPX, eqPY, eqPW, eqPH;  // pixel bounds, set in setup

// ─────────────────────────────────────────────────────────────────────────────

void eq_setup() {
  eqPos      = new float[EQ_BAR_COUNT];
  eqVel      = new float[EQ_BAR_COUNT];
  eqPeak     = new float[EQ_BAR_COUNT];
  eqPeakVel  = new float[EQ_BAR_COUNT];
  eqSmoothed = new float[EQ_BAR_COUNT];

  // Compute pixel bounds from fractions
  eqPW = EQ_W_FRAC * width;
  eqPH = EQ_H_FRAC * height;

  // Resolve anchor to top-left origin of the equalizer rect
  float anchorX = EQ_X_FRAC * width;
  float anchorY = EQ_Y_FRAC * height;

  if      (EQ_ANCHOR.equals("top-left"))       { eqPX = anchorX;         eqPY = anchorY; }
  else if (EQ_ANCHOR.equals("top-center"))     { eqPX = anchorX - eqPW/2; eqPY = anchorY; }
  else if (EQ_ANCHOR.equals("top-right"))      { eqPX = anchorX - eqPW;   eqPY = anchorY; }
  else if (EQ_ANCHOR.equals("center"))         { eqPX = anchorX - eqPW/2; eqPY = anchorY - eqPH/2; }
  else if (EQ_ANCHOR.equals("bottom-left"))    { eqPX = anchorX;          eqPY = anchorY - eqPH; }
  else if (EQ_ANCHOR.equals("bottom-center"))  { eqPX = anchorX - eqPW/2; eqPY = anchorY - eqPH; }
  else if (EQ_ANCHOR.equals("bottom-right"))   { eqPX = anchorX - eqPW;   eqPY = anchorY - eqPH; }
  else                                          { eqPX = anchorX - eqPW/2; eqPY = anchorY - eqPH; }
}

// ── Physics update ────────────────────────────────────────────────────────────

void eq_updateBar(int i, float target) {
  float diff = target - eqPos[i];
  float k    = (diff > 0) ? eqSpringKUp : eqSpringK;

  eqVel[i] += k * diff;
  eqVel[i] -= eqGravity;

  // Velocity-squared fluid drag
  float dragSign = (eqVel[i] > 0) ? 1.0 : -1.0;
  eqVel[i] -= dragSign * eqVel[i] * eqVel[i] * eqFluidDrag;

  eqVel[i] *= (1.0 - eqDamping);
  eqPos[i] += eqVel[i];
  eqPos[i]  = constrain(eqPos[i], 0, eqPH);

  // Peak hold — floats up with bar, falls with gravity when bar drops
  if (eqPos[i] >= eqPeak[i]) {
    eqPeak[i]    = eqPos[i];
    eqPeakVel[i] = 0;
  } else {
    eqPeakVel[i] -= eqGravity * 2.0;
    eqPeakVel[i] *= 0.98;
    eqPeak[i]    += eqPeakVel[i];
    eqPeak[i]     = constrain(eqPeak[i], 0, eqPH);
  }
}

// ── Main update + draw ────────────────────────────────────────────────────────

void eq_draw() {
  // Map FFT spectrum bins → bars (log-spaced grouping feels more musical)
  int specLen = spectrum.length;
  for (int i = 0; i < EQ_BAR_COUNT; i++) {
    int lo = (int) map(i,       0, EQ_BAR_COUNT, 0, specLen);
    int hi = (int) map(i + 1,   0, EQ_BAR_COUNT, 0, specLen);
    hi     = max(hi, lo + 1);

    float bandMax = 0;
    for (int b = lo; b < hi; b++) bandMax = max(bandMax, spectrum[b]);

    // spectrum is normalised 0-1 by the scaffold; scale to pixel height
    eqSmoothed[i] = lerp(eqSmoothed[i], bandMax * eqPH * eqFftGain, 1.0 - eqSmoothing);

    // Target bar height in pixels
    float target = constrain(eqSmoothed[i], 0, eqPH);
    eq_updateBar(i, target);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  int drawCount  = eqMirror ? EQ_BAR_COUNT / 2 : EQ_BAR_COUNT;
  float barSlot  = eqPW / (eqMirror ? drawCount : EQ_BAR_COUNT);
  float barW     = barSlot * (1.0 - eqBarGap);
  float barOff   = barSlot * eqBarGap * 0.5;

  // Glow pass (draw wider, transparent bars behind)
  if (eqGlow > 0.01) {
    noStroke();
    for (int i = 0; i < drawCount; i++) {
      int idx = eqMirror ? (drawCount - 1 - i) : i;
      color c = eq_barColor(i, drawCount);
      fill(red(c), green(c), blue(c), eqGlow * 60);

      float bx    = eqPX + i * barSlot + barOff;
      float glowW = barW + barW * eqGlow * 1.5;
      eq_drawBar(bx - (glowW - barW) / 2, glowW, eqPos[idx]);

      if (eqMirror) {
        float bxR = eqPX + eqPW - (i + 1) * barSlot + barOff;
        eq_drawBar(bxR - (glowW - barW) / 2, glowW, eqPos[i]);
      }
    }
  }

  // Main bars
  noStroke();
  for (int i = 0; i < drawCount; i++) {
    int idx  = eqMirror ? (drawCount - 1 - i) : i;
    float bx = eqPX + i * barSlot + barOff;

    fill(eq_barColor(i, drawCount));
    if (eqFilled) eq_drawBar(bx, barW, eqPos[idx]);
    else { noFill(); stroke(eq_barColor(i, drawCount)); eq_drawBar(bx, barW, eqPos[idx]); noStroke(); }

    // Peak indicator
    if (eqPeakHold && eqPeak[idx] > 2) {
      fill(eqPeakColor);
      float peakY = eq_peakY(eqPeak[idx]);
      rect(bx, peakY - 2, barW, 3);
    }

    // Mirrored right half
    if (eqMirror) {
      float bxR = eqPX + eqPW - (i + 1) * barSlot + barOff;
      fill(eq_barColor(i, drawCount));
      if (eqFilled) eq_drawBar(bxR, barW, eqPos[i]);
      if (eqPeakHold && eqPeak[i] > 2) {
        fill(eqPeakColor);
        rect(bxR, eq_peakY(eqPeak[i]) - 2, barW, 3);
      }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

color eq_barColor(int i, int total) {
  if (eqRainbow) return color(map(i, 0, total, 0, 360), 80, 100);
  return eqBarColor;
}

void eq_drawBar(float bx, float bw, float barH) {
  if (EQ_ORIENTATION.equals("bottom-up")) {
    rect(bx, eqPY + eqPH - barH, bw, barH);
  } else if (EQ_ORIENTATION.equals("top-down")) {
    rect(bx, eqPY, bw, barH);
  } else if (EQ_ORIENTATION.equals("center-out")) {
    float half = barH / 2.0;
    float mid  = eqPY + eqPH / 2.0;
    rect(bx, mid - half, bw, barH);
  }
}

float eq_peakY(float peakH) {
  if (EQ_ORIENTATION.equals("bottom-up"))  return eqPY + eqPH - peakH;
  if (EQ_ORIENTATION.equals("top-down"))   return eqPY + peakH;
  return (eqPY + eqPH / 2.0) - peakH / 2.0;
}

// ── OSC handler snippet (assembler injects into oscEvent) ─────────────────────
// eq_osc(msg) — call this from the main oscEvent function
void eq_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/eq/springK"))    eqSpringK     = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/eq/springKUp"))  eqSpringKUp   = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/eq/damping"))    eqDamping     = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/eq/gravity"))    eqGravity     = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/eq/fluidDrag"))  eqFluidDrag   = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/eq/glow"))       eqGlow        = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/eq/barGap"))     eqBarGap      = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/eq/smoothing"))  eqSmoothing   = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/eq/fftGain"))    eqFftGain     = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/eq/mirror"))     eqMirror      = msg.get(0).intValue() == 1;
  if (msg.checkAddrPattern("/eq/rainbow"))    eqRainbow     = msg.get(0).intValue() == 1;
  if (msg.checkAddrPattern("/eq/peakHold"))   eqPeakHold    = msg.get(0).intValue() == 1;
  if (msg.checkAddrPattern("/eq/filled"))     eqFilled      = msg.get(0).intValue() == 1;
}
