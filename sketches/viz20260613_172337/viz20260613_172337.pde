import processing.sound.*;

SoundFile song;
Amplitude amp;
FFT fft;
final int FFT_SIZE = 512;
float[] spectrum = new float[FFT_SIZE];
float smoothedAmp = 0;
float bassEnergy = 0;
float prevBassEnergy = 0;
boolean onBeat = false;

float beatPulse = 0;
float gridRotation = 0;
float horizonY = 350;
int cols = 20;
int rows = 15;

ArrayList<Ripple> ripples = new ArrayList<Ripple>();

void setup() {
  size(800, 600, P3D);
  song = new SoundFile(this, "/Users/borboss366/WebstormProjects/processing-llm/music/Prodigy - Girls.mp3");
  song.play();
  amp = new Amplitude(this);
  amp.input(song);
  fft = new FFT(this, FFT_SIZE);
  fft.input(song);
}

void draw() {
  if (song.isPlaying()) {
    fft.analyze(spectrum);
    float rawAmp = amp.analyze();
    smoothedAmp = lerp(smoothedAmp, rawAmp, 0.25);
    bassEnergy = 0;
    for (int i = 0; i < 8; i++) bassEnergy += spectrum[i];
    bassEnergy /= 8.0;
    onBeat = (bassEnergy - prevBassEnergy) > 0.02;
    prevBassEnergy = lerp(prevBassEnergy, bassEnergy, 0.1);
  }
  
  // Fade background with magenta tint
  background(8, 0, 20);
  
  if (onBeat) {
    beatPulse = 1.0;
    ripples.add(new Ripple());
  }
  beatPulse *= 0.9;
  
  // Sun/horizon glow
  drawSun();
  
  // Floor grid (perspective)
  drawFloorGrid();
  
  // Ceiling grid
  drawCeilingGrid();
  
  // Side ripples
  for (int i = ripples.size() - 1; i >= 0; i--) {
    Ripple r = ripples.get(i);
    r.update();
    r.display();
    if (r.life <= 0) ripples.remove(i);
  }
  
  // Vignette / scanlines
  drawScanlines();
  
  // Bass burst
  if (beatPulse > 0.3) {
    noStroke();
    fill(255, 20, 147, beatPulse * 40);
    rect(0, 0, width, height);
  }
}

void drawSun() {
  noStroke();
  int sunX = width / 2;
  int sunY = (int)horizonY;
  float sunR = 180 + beatPulse * 60 + bassEnergy * 200;
  
  for (int i = 30; i > 0; i--) {
    float t = i / 30.0;
    float r = sunR * t;
    fill(lerpColor(color(255, 20, 100), color(255, 200, 50), 1 - t), 15);
    ellipse(sunX, sunY, r, r);
  }
  
  // Sun bands
  for (int i = 0; i < 8; i++) {
    float y = sunY - sunR/2 + (i * sunR / 8) + 20;
    if (y < sunY) {
      float bandH = 3 + i * 1.5;
      fill(255, 50 + i*20, 100, 200);
      rect(sunX - sunR/2, y, sunR, bandH);
    }
  }
}

void drawFloorGrid() {
  float gridOffset = (millis() * 0.05) % 40;
  float pulse = 0.5 + beatPulse * 0.5;
  
  strokeWeight(1.5 + beatPulse * 2);
  
  // Horizontal lines (receding)
  for (int i = 0; i < 25; i++) {
    float t = i / 25.0;
    float y = horizonY + pow(t, 2) * (height - horizonY) * 1.2 + gridOffset * (1 + t * 3);
    if (y > height) continue;
    
    float alpha = (1 - t) * 255;
    stroke(0, 255 * pulse, 255, alpha);
    line(0, y, width, y);
  }
  
  // Vertical lines (perspective converge)
  int vLines = 30;
  for (int i = -vLines/2; i <= vLines/2; i++) {
    float xTop = width/2 + i * 5;
    float xBot = width/2 + i * 80;
    
    float dist = abs(i) / (float)(vLines/2);
    float alpha = 255 * (1 - dist * 0.5);
    stroke(255, 20, 200, alpha);
    line(xTop, horizonY, xBot, height);
  }
}

void drawCeilingGrid() {
  float gridOffset = (millis() * 0.03) % 30;
  
  strokeWeight(1);
  
  for (int i = 0; i < 12; i++) {
    float t = i / 12.0;
    float y = horizonY - pow(t, 2) * horizonY * 1.2 - gridOffset * (1 + t * 2);
    if (y < 0) continue;
    
    float alpha = (1 - t) * 150;
    stroke(180, 0, 255, alpha);
    line(0, y, width, y);
  }
  
  int vLines = 20;
  for (int i = -vLines/2; i <= vLines/2; i++) {
    float xBot = width/2 + i * 5;
    float xTop = width/2 + i * 60;
    
    float dist = abs(i) / (float)(vLines/2);
    float alpha = 120 * (1 - dist * 0.5);
    stroke(100, 0, 200, alpha);
    line(xBot, horizonY, xTop, 0);
  }
}

void drawScanlines() {
  stroke(0, 30);
  strokeWeight(1);
  for (int y = 0; y < height; y += 3) {
    line(0, y, width, y);
  }
}

class Ripple {
  float life = 1.0;
  float size = 0;
  color col;
  
  Ripple() {
    col = color(random(180, 255), random(0, 100), random(150, 255));
  }
  
  void update() {
    size += 15;
    life -= 0.02;
  }
  
  void display() {
    noFill();
    strokeWeight(2 * life);
    stroke(red(col), green(col), blue(col), life * 200);
    ellipse(width/2, horizonY, size, size * 0.4);
  }
}