int numBalls = 50;
float[] ballX = new float[numBalls];
float[] ballY = new float[numBalls];
float[] ballSpeed = new float[numBalls];
float[] ballSize = new float[numBalls];
color[] ballColor = new color[numBalls];

int numStars = 100;
float[] starX = new float[numStars];
float[] starY = new float[numStars];
float[] starPhase = new float[numStars];

float beat = 0;
float beatTarget = 0;
int beatCount = 0;

void setup() {
  size(800, 600);
  colorMode(HSB, 360, 100, 100, 100);
  
  for (int i = 0; i < numBalls; i++) {
    ballX[i] = random(width);
    ballY[i] = random(height);
    ballSpeed[i] = random(1, 5);
    ballSize[i] = random(20, 80);
    ballColor[i] = color(random(360), 80, 100);
  }
  
  for (int i = 0; i < numStars; i++) {
    starX[i] = random(width);
    starY[i] = random(height);
    starPhase[i] = random(TWO_PI);
  }
}

void draw() {
  // Beat detection simulation
  if (frameCount % 20 == 0) {
    beatTarget = 1.0;
    beatCount++;
  }
  beat = lerp(beat, beatTarget, 0.3);
  beatTarget = lerp(beatTarget, 0, 0.2);
  
  // Pulsing background with gradient
  float bgHue = (frameCount * 0.5) % 360;
  for (int y = 0; y < height; y += 4) {
    float h = (bgHue + y * 0.3) % 360;
    stroke(h, 70, 20 + beat * 15);
    line(0, y, width, y);
  }
  
  // Dance floor checkered pattern
  pushMatrix();
  translate(width/2, height * 0.75);
  rotate(sin(frameCount * 0.01) * 0.1);
  for (int x = -10; x < 10; x++) {
    for (int y = 0; y < 8; y++) {
      float px = x * 60 + (y % 2) * 30;
      float py = y * 30;
      float scale = map(py, 0, 240, 0.3, 1.5);
      fill((frameCount * 2 + x * 30 + y * 20) % 360, 90, 90 + beat * 10);
      noStroke();
      rect(px * scale, py, 50 * scale, 25 * scale);
    }
  }
  popMatrix();
  
  // Stars/sparkles
  for (int i = 0; i < numStars; i++) {
    float twinkle = sin(frameCount * 0.1 + starPhase[i]) * 0.5 + 0.5;
    fill((frameCount + i * 10) % 360, 30, 100, twinkle * 80);
    noStroke();
    float sz = 2 + twinkle * 4 + beat * 3;
    ellipse(starX[i], starY[i], sz, sz);
  }
  
  // Disco ball in center
  pushMatrix();
  translate(width/2, 130);
  float discoSize = 100 + beat * 20;
  
  // Glow
  for (int g = 5; g > 0; g--) {
    fill((frameCount * 3) % 360, 50, 100, 10);
    ellipse(0, 0, discoSize + g * 20, discoSize + g * 20);
  }
  
  // Ball facets
  for (int a = 0; a < 360; a += 15) {
    for (int r = 0; r < 90; r += 15) {
      float angle = radians(a + frameCount * 2);
      float rad = r;
      float fx = cos(angle) * rad * (discoSize/100);
      float fy = sin(angle) * rad * 0.3 * (discoSize/100);
      float bright = 50 + sin(angle * 3 + frameCount * 0.1) * 50;
      fill((frameCount + a + r) % 360, 40, bright);
      noStroke();
      rect(fx - 8, fy - 8, 16, 16);
    }
  }
  
  // String
  stroke(200, 20, 80);
  strokeWeight(2);
  line(0, -discoSize/2, 0, -200);
  popMatrix();
  
  // Light beams from disco ball
  for (int b = 0; b < 8; b++) {
    float ang = radians(b * 45 + frameCount * 1.5);
    float bx = width/2 + cos(ang) * 400;
    float by = 130 + sin(ang) * 400;
    stroke((b * 45 + frameCount) % 360, 80, 100, 30 + beat * 30);
    strokeWeight(3 + beat * 5);
    line(width/2, 130, bx, by);
  }
  
  // Funky bouncing balls
  for (int i = 0; i < numBalls; i++) {
    ballX[i] += sin(frameCount * 0.05 + i) * ballSpeed[i];
    ballY[i] += cos(frameCount * 0.03 + i * 0.5) * ballSpeed[i];
    
    if (ballX[i] < 0) ballX[i] = width;
    if (ballX[i] > width) ballX[i] = 0;
    if (ballY[i] < 0) ballY[i] = height;
    if (ballY[i] > height) ballY[i] = 0;
    
    float sz = ballSize[i] * (1 + beat * 0.3);
    noStroke();
    fill(hue(ballColor[i]) + frameCount % 360, 80, 100, 60);
    ellipse(ballX[i], ballY[i], sz, sz);
    fill(hue(ballColor[i]) + frameCount % 360, 40, 100, 90);
    ellipse(ballX[i] - sz*0.2, ballY[i] - sz*0.2, sz*0.4, sz*0.4);
  }
  
  // Text "DISCO" pulsing
  textAlign(CENTER, CENTER);
  textSize(60 + beat * 20);
  for (int o = 5; o > 0; o--) {
    fill((frameCount * 5) % 360, 80, 100, 20);
    text("~ FUNKY ~", width/2 + o, height/2 + 50 + o);
  }
  fill((frameCount * 5) % 360, 90, 100);
  text("~ FUNKY ~", width/2, height/2 + 50);
  
  textSize(30 + beat * 10);
  fill((frameCount * 5 + 180) % 360, 90, 100);
  text("BONEY M GROOVE", width/2, height/2 + 110);
}