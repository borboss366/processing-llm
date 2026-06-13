void setup() {
  size(800, 600);
  background(0);
  colorMode(HSB, 360, 100, 100, 100);
  noStroke();
}

float t = 0;

void draw() {
  fill(0, 15);
  rect(0, 0, width, height);
  
  t += 0.03;
  
  // Pulsing background grid
  float bass = sin(t * 4) * 0.5 + 0.5;
  
  // Distorted radial bursts
  pushMatrix();
  translate(width/2, height/2);
  rotate(t * 0.3);
  
  int spikes = 24;
  for (int i = 0; i < spikes; i++) {
    float a = TWO_PI / spikes * i;
    float len = 150 + sin(t * 3 + i) * 80 + bass * 100;
    float hue = (i * 15 + t * 50) % 360;
    
    pushMatrix();
    rotate(a);
    fill(hue, 100, 100, 70);
    beginShape();
    vertex(0, 0);
    vertex(len, -8);
    vertex(len + 30, 0);
    vertex(len, 8);
    endShape(CLOSE);
    
    // Eye at the tip
    fill(0, 0, 100);
    ellipse(len + 10, 0, 14, 14);
    fill(0, 0, 0);
    ellipse(len + 10 + cos(t*5)*3, sin(t*5)*3, 6, 6);
    popMatrix();
  }
  popMatrix();
  
  // Glitchy horizontal scan bars
  for (int i = 0; i < 8; i++) {
    float y = (sin(t * (i+1) * 0.7) * 0.5 + 0.5) * height;
    fill((t * 100 + i * 40) % 360, 80, 100, 40);
    rect(0, y, width, 4 + noise(t, i) * 8);
  }
  
  // Floating jittery skulls/orbs
  for (int i = 0; i < 12; i++) {
    float px = width/2 + cos(t * 0.5 + i) * (200 + sin(t + i) * 80);
    float py = height/2 + sin(t * 0.7 + i * 1.3) * (150 + cos(t + i) * 60);
    float sz = 30 + sin(t * 4 + i) * 15;
    
    fill((i * 30 + t * 80) % 360, 90, 100, 80);
    ellipse(px + random(-3,3), py + random(-3,3), sz, sz);
    
    fill(0);
    ellipse(px - sz*0.2, py - sz*0.1, sz*0.25, sz*0.3);
    ellipse(px + sz*0.2, py - sz*0.1, sz*0.25, sz*0.3);
    
    // Jagged mouth
    stroke(0);
    strokeWeight(2);
    noFill();
    beginShape();
    for (int j = 0; j < 6; j++) {
      vertex(px - sz*0.25 + j * sz*0.1, py + sz*0.15 + (j%2)*sz*0.1);
    }
    endShape();
    noStroke();
  }
  
  // Central pulsing core
  fill(random(360), 100, 100, 90);
  ellipse(width/2, height/2, 40 + bass * 60, 40 + bass * 60);
  fill(0, 0, 100);
  ellipse(width/2, height/2, 15 + bass * 20, 15 + bass * 20);
  
  // Random glitch rectangles
  if (random(1) < 0.15) {
    fill(random(360), 100, 100, 80);
    rect(random(width), random(height), random(50, 200), random(5, 30));
  }
  
  // Text flash
  if (frameCount % 60 < 8) {
    fill(0, 100, 100);
    textAlign(CENTER, CENTER);
    textSize(60);
    text("FIRESTARTER", width/2 + random(-5,5), height/2 + random(-5,5));
  }
}