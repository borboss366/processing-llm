// ── ProjectM Syphon Receiver ──────────────────────────────────────────────────
// Receives frames from a Syphon server published by a projectM (MilkDrop) renderer
// and composites them at the configured rectangle. Requires the Syphon-Processing
// library (https://github.com/Syphon/Processing) and a P2D-backed sketch.

import codeanticode.syphon.*;

// ── Layout (baked) ────────────────────────────────────────────────────────────
final float  PM_X_FRAC = {{x}};
final float  PM_Y_FRAC = {{y}};
final float  PM_W_FRAC = {{width}};
final float  PM_H_FRAC = {{height}};
final String PM_ANCHOR = "{{anchor}}";

// ── Server identity (baked) ───────────────────────────────────────────────────
final String PM_APP    = "{{appName}}";
final String PM_SERVER = "{{serverName}}";

// ── Params (OSC-controllable) ─────────────────────────────────────────────────
float pmOpacity    = {{opacity}};
float pmBrightness = {{brightness}};

// ── Internal state ────────────────────────────────────────────────────────────
SyphonClient pmClient;
PGraphics    pmCanvas;
float pmPX, pmPY, pmPW, pmPH;

void pm_setup() {
  pmPW = PM_W_FRAC * width;
  pmPH = PM_H_FRAC * height;
  float anchorX = PM_X_FRAC * width;
  float anchorY = PM_Y_FRAC * height;

  if      (PM_ANCHOR.equals("top-left"))      { pmPX = anchorX;          pmPY = anchorY; }
  else if (PM_ANCHOR.equals("top-center"))    { pmPX = anchorX - pmPW/2; pmPY = anchorY; }
  else if (PM_ANCHOR.equals("top-right"))     { pmPX = anchorX - pmPW;   pmPY = anchorY; }
  else if (PM_ANCHOR.equals("center"))        { pmPX = anchorX - pmPW/2; pmPY = anchorY - pmPH/2; }
  else if (PM_ANCHOR.equals("bottom-left"))   { pmPX = anchorX;          pmPY = anchorY - pmPH; }
  else if (PM_ANCHOR.equals("bottom-center")) { pmPX = anchorX - pmPW/2; pmPY = anchorY - pmPH; }
  else if (PM_ANCHOR.equals("bottom-right"))  { pmPX = anchorX - pmPW;   pmPY = anchorY - pmPH; }
  else                                         { pmPX = anchorX;          pmPY = anchorY; }

  pmCanvas = createGraphics(max(1, int(pmPW)), max(1, int(pmPH)), P2D);
  try {
    pmClient = new SyphonClient(this, PM_APP, PM_SERVER);
  } catch (Exception e) {
    println("[projectm] Syphon client init failed: " + e.getMessage());
  }
}

void pm_draw() {
  if (pmClient != null && pmClient.available()) {
    pmCanvas = pmClient.getGraphics(pmCanvas);
  }
  if (pmCanvas != null) {
    pushStyle();
    int b = int(255 * constrain(pmBrightness, 0, 1));
    int a = int(255 * constrain(pmOpacity,    0, 1));
    tint(b, b, b, a);
    image(pmCanvas, pmPX, pmPY, pmPW, pmPH);
    popStyle();
  }
}

void pm_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/pm/opacity"))    pmOpacity    = msg.get(0).floatValue();
  if (msg.checkAddrPattern("/pm/brightness")) pmBrightness = msg.get(0).floatValue();
}
