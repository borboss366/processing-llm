// ── Plane Module ────────────────────────────────────────────────────────
// Expects shared globals: fft, spectrum, smoothedLevel, bassEnergy, onBeat, width, height, frameCount

final float PLANE_X_FRAC = {{x}};
final float PLANE_Y_FRAC = {{y}};
final float PLANE_W_FRAC = {{width}};
final float PLANE_H_FRAC = {{height}};
final String PLANE_ANCHOR = "{{anchor}}";

color planeColor = {{planeColor}};
int planeSize = {{planeSize}};
float baseSpeed = {{baseSpeed}};
float speedBoost = {{speedBoost}};
float bobAmplitude = {{bobAmplitude}};
float bassSmoothing = {{bassSmoothing}};
boolean dipOnBeat = {{dipOnBeat}};

float planeX = -9999;
int planeDir = 1;
float planeSmoothedBass = 0;
float planeDipVel = 0;
float planeDipOffset = 0;
float planePX, planePY, planePW, planePH;

PShape planeSvg;

void plane_setup() {
  planePW = PLANE_W_FRAC * width;
  planePH = PLANE_H_FRAC * height;
  float ax = PLANE_X_FRAC * width;
  float ay = PLANE_Y_FRAC * height;

  if (PLANE_ANCHOR.equals("top-left")) {
    planePX = ax;
    planePY = ay;
  } else if (PLANE_ANCHOR.equals("top-center")) {
    planePX = ax - planePW / 2;
    planePY = ay;
  } else if (PLANE_ANCHOR.equals("top-right")) {
    planePX = ax - planePW;
    planePY = ay;
  } else if (PLANE_ANCHOR.equals("center")) {
    planePX = ax - planePW / 2;
    planePY = ay - planePH / 2;
  } else if (PLANE_ANCHOR.equals("bottom-left")) {
    planePX = ax;
    planePY = ay - planePH;
  } else if (PLANE_ANCHOR.equals("bottom-center")) {
    planePX = ax - planePW / 2;
    planePY = ay - planePH;
  } else if (PLANE_ANCHOR.equals("bottom-right")) {
    planePX = ax - planePW;
    planePY = ay - planePH;
  }

  planeX = planePX + planeSize;

  planeSvg = loadShape("plane/plane.svg");
}

void plane_draw() {
  float s = planeSize;

  // Smooth bassEnergy
  planeSmoothedBass = lerp(planeSmoothedBass, bassEnergy, bassSmoothing);

  // Dip-on-beat
  if (dipOnBeat && onBeat) {
    planeDipVel = 5;
  }
  planeDipVel *= 0.85; // decay
  planeDipOffset += planeDipVel;
  planeDipOffset *= 0.92; // return to rest

  // Compute speed
  float speed = baseSpeed * (1 + smoothedLevel * speedBoost);

  // Move the plane
  planeX += speed * planeDir;

  // Bounce at edges
  if (planeX > planePX + planePW - planeSize) {
    planeDir = -1;
  }
  if (planeX < planePX + planeSize) {
    planeDir = 1;
  }

  // Compute Y position
  float baseY = planePY + planePH / 2;
  float bob = sin(frameCount * 0.05) * bobAmplitude * planeSmoothedBass;
  float y = baseY + bob + planeDipOffset;

  pushMatrix();
  translate(planeX, y);
  scale(planeDir, 1); // mirror horizontally when going left

  // SVG plane — viewBox is 100×60, drawn at 2s × 1.2s centered at origin
  shape(planeSvg, -s, -s * 0.6, 2 * s, s * 1.2);

  popMatrix();
}

void plane_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/plane/planeColor")) {
    planeColor = unhex("FF" + msg.get(0).stringValue().substring(1));
  }
  if (msg.checkAddrPattern("/plane/planeSize")) {
    planeSize = msg.get(0).intValue();
  }
  if (msg.checkAddrPattern("/plane/baseSpeed")) {
    baseSpeed = msg.get(0).floatValue();
  }
  if (msg.checkAddrPattern("/plane/speedBoost")) {
    speedBoost = msg.get(0).floatValue();
  }
  if (msg.checkAddrPattern("/plane/bobAmplitude")) {
    bobAmplitude = msg.get(0).floatValue();
  }
  if (msg.checkAddrPattern("/plane/bassSmoothing")) {
    bassSmoothing = msg.get(0).floatValue();
  }
  if (msg.checkAddrPattern("/plane/dipOnBeat")) {
    dipOnBeat = msg.get(0).intValue() == 1;
  }
}
