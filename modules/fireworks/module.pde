// ── Fireworks Module ────────────────────────────────────────────────────────
// Expects shared globals: fft, spectrum, smoothedLevel, bassEnergy, onBeat, width, height

final int FW_SLOT_COUNT     = 3;
final int FW_PARTICLE_COUNT = {{particleCount}};

// per-slot state
boolean[] fwActive  = new boolean[FW_SLOT_COUNT];
int[]     fwAge     = new int[FW_SLOT_COUNT];
color[]   fwColor   = new color[FW_SLOT_COUNT];

// flat per-particle arrays — slot s, particle p is at index s*FW_PARTICLE_COUNT + p
float[]   fwPx;
float[]   fwPy;
float[]   fwVx;
float[]   fwVy;

// bounding box (computed in fw_setup using the equalizer §6 anchor pattern)
float fwPX, fwPY, fwPW, fwPH;

final float FW_X_FRAC = {{x}};
final float FW_Y_FRAC = {{y}};
final float FW_W_FRAC = {{width}};
final float FW_H_FRAC = {{height}};
final String FW_ANCHOR = "{{anchor}}";

color   fwBaseColor  = {{baseColor}};
float   fwBurstSpeed = {{burstSpeed}};
int     fwLifespan   = {{lifespan}};
float   fwGravity    = {{gravity}};
float   fwSpawnRate  = {{spawnRate}};
float   fwBassSpawnBoost = {{bassSpawnBoost}};
boolean fwRainbowMode = {{rainbowMode}};
boolean fwSpawnOnBeat = {{spawnOnBeat}};

void fw_setup() {
  // Allocate flat arrays
  fwPx = new float[FW_SLOT_COUNT * FW_PARTICLE_COUNT];
  fwPy = new float[FW_SLOT_COUNT * FW_PARTICLE_COUNT];
  fwVx = new float[FW_SLOT_COUNT * FW_PARTICLE_COUNT];
  fwVy = new float[FW_SLOT_COUNT * FW_PARTICLE_COUNT];

  // Resolve bounding box using equalizer pattern
  fwPW = FW_W_FRAC * width;
  fwPH = FW_H_FRAC * height;
  float ax = FW_X_FRAC * width;
  float ay = FW_Y_FRAC * height;

  if      (FW_ANCHOR.equals("top-left"))     { fwPX = ax;                 fwPY = ay; }
  else if (FW_ANCHOR.equals("top-center"))   { fwPX = ax - fwPW/2;        fwPY = ay; }
  else if (FW_ANCHOR.equals("top-right"))    { fwPX = ax - fwPW;          fwPY = ay; }
  else if (FW_ANCHOR.equals("center"))       { fwPX = ax - fwPW/2;        fwPY = ay - fwPH/2; }
  else if (FW_ANCHOR.equals("bottom-left"))  { fwPX = ax;                 fwPY = ay - fwPH; }
  else if (FW_ANCHOR.equals("bottom-center")){ fwPX = ax - fwPW/2;        fwPY = ay - fwPH; }
  else if (FW_ANCHOR.equals("bottom-right")) { fwPX = ax - fwPW;          fwPY = ay - fwPH; }

  // Initialize slots
  for (int s = 0; s < FW_SLOT_COUNT; s++) {
    fwActive[s] = false;
    fwAge[s] = 0;
  }
}

void fw_draw() {
  // Spawn new fireworks
  boolean spawned = false;

  // Check spawn rate
  for (int s = 0; s < FW_SLOT_COUNT && !spawned; s++) {
    if (!fwActive[s]) {
      float chance = fwSpawnRate + bassEnergy * fwBassSpawnBoost;
      if (random(1) < chance) {
        fw_spawn(s);
        spawned = true;
      }
    }
  }

  // Check spawn on beat
  if (fwSpawnOnBeat && onBeat) {
    for (int s = 0; s < FW_SLOT_COUNT && !spawned; s++) {
      if (!fwActive[s]) {
        fw_spawn(s);
        spawned = true;
      }
    }
  }

  // Update and draw active fireworks
  for (int s = 0; s < FW_SLOT_COUNT; s++) {
    if (fwActive[s]) {
      // Integrate particles
      for (int p = 0; p < FW_PARTICLE_COUNT; p++) {
        int idx = s * FW_PARTICLE_COUNT + p;
        fwVy[idx] += fwGravity;
        fwPx[idx] += fwVx[idx];
        fwPy[idx] += fwVy[idx];
      }

      // Age the firework
      fwAge[s]++;
      if (fwAge[s] >= fwLifespan) {
        fwActive[s] = false;
      }

      // Render
      float fade = 1.0 - (float)fwAge[s] / fwLifespan;
      int alpha = (int)(fade * 255);
      color c = fwColor[s];
      fill(red(c), green(c), blue(c), alpha);
      noStroke();
      for (int p = 0; p < FW_PARTICLE_COUNT; p++) {
        int idx = s * FW_PARTICLE_COUNT + p;
        ellipse(fwPx[idx], fwPy[idx], 4, 4);
      }
    }
  }
}

void fw_spawn(int s) {
  // Pick random position inside the box with a 50px inset
  float cx = random(fwPX + 50, fwPX + fwPW - 50);
  float cy = random(fwPY + 50, fwPY + fwPH - 50);

  // Pick color
  if (fwRainbowMode) {
    fwColor[s] = color(random(120, 255), random(120, 255), random(120, 255));
  } else {
    fwColor[s] = fwBaseColor;
  }

  // Initialize particles
  for (int p = 0; p < FW_PARTICLE_COUNT; p++) {
    int idx = s * FW_PARTICLE_COUNT + p;
    float angle = TWO_PI * p / FW_PARTICLE_COUNT + random(-0.15, 0.15);
    float speed = fwBurstSpeed * random(0.5, 1.0);
    fwPx[idx] = cx;
    fwPy[idx] = cy;
    fwVx[idx] = cos(angle) * speed;
    fwVy[idx] = sin(angle) * speed;
  }

  // Reset slot
  fwAge[s] = 0;
  fwActive[s] = true;
}

void fw_osc(OscMessage msg) {
  if (msg.checkAddrPattern("/fw/baseColor")) {
    fwBaseColor = unhex("FF" + msg.get(0).stringValue().substring(1));
  } else if (msg.checkAddrPattern("/fw/burstSpeed")) {
    fwBurstSpeed = msg.get(0).floatValue();
  } else if (msg.checkAddrPattern("/fw/lifespan")) {
    fwLifespan = msg.get(0).intValue();
  } else if (msg.checkAddrPattern("/fw/gravity")) {
    fwGravity = msg.get(0).floatValue();
  } else if (msg.checkAddrPattern("/fw/spawnRate")) {
    fwSpawnRate = msg.get(0).floatValue();
  } else if (msg.checkAddrPattern("/fw/bassSpawnBoost")) {
    fwBassSpawnBoost = msg.get(0).floatValue();
  } else if (msg.checkAddrPattern("/fw/rainbowMode")) {
    fwRainbowMode = msg.get(0).intValue() == 1;
  } else if (msg.checkAddrPattern("/fw/spawnOnBeat")) {
    fwSpawnOnBeat = msg.get(0).intValue() == 1;
  }
}
