import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ImageData } from "../image/preprocessor.js";

export type PromptContext = {
  userDescription: string;
  mp3Path?: string;
  liveInput?: boolean;
  ragExamples?: string[];
  imageData?: ImageData;
  imageExt?: string;
  visionDescription?: string;
  imageDescription?: string;
};

// ── Rage faces catalog ────────────────────────────────────────────────────────

const FACES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../assets/faces"
);

function buildFacesSection(): string {
  let files: string[];
  try {
    files = fs.readdirSync(FACES_DIR).filter(f => f.endsWith(".svg")).sort();
  } catch {
    return "";
  }

  // Group by first hyphen-delimited segment (category)
  const groups: Record<string, string[]> = {};
  for (const f of files) {
    const cat = f.split("-")[0]!;
    (groups[cat] ??= []).push(f);
  }

  const lines = Object.entries(groups).map(([cat, names]) =>
    `  ${cat}: ${names.join(", ")}`
  );

  return `
Rage face SVGs — available in the sketch's data/ folder, load with loadShape():

Usage:
  PShape face = loadShape("troll-troll-face.svg");
  shape(face, x, y, w, h);   // draws at position, transparent background

Available files grouped by category:
${lines.join("\n")}

Tips:
- Scale to any size; SVGs are resolution-independent.
- Combine with tint() to colorise: tint(255, 0, 0); shape(face, x, y, 80, 80); noTint();
- loadShape() is slow — call it in setup() and store in variables or an array/HashMap.
- Use shapeMode(CENTER) to position by centre point instead of top-left corner.`;
}

const FACES_SECTION = buildFacesSection();

const FACES_KEYWORDS = new Set([
  "face", "faces", "meme", "memes", "rage", "troll", "emotion", "emotions",
  "expression", "character", "characters", "avatar", "comic", "funny",
  "angry", "happy", "sad", "foreveralone", "megusta", "okay", "derp",
]);

export function shouldInjectFaces(description: string): boolean {
  const tokens = description.toLowerCase().split(/\W+/);
  return tokens.some(t => FACES_KEYWORDS.has(t));
}

const SYSTEM_PROMPT = `You are an expert creative coder specialising in Processing (the Java-based creative coding environment).

Rules — follow ALL of them, no exceptions:
1. Output ONLY valid Processing source code. No markdown, no code fences, no explanations.
2. The sketch MUST include void setup() and void draw() functions.
3. Use only the Processing standard library — no import statements unless they are Processing built-ins (e.g. processing.sound, processing.video).
4. The sketch must be self-contained and runnable as-is.
5. Target window size: 800×600.
6. Make it visually compelling and responsive to the theme described.
7. Use colour, movement, and generative patterns where appropriate.
8. NEVER call Processing functions (color(), random(), noise(), etc.) in global variable declarations. Global vars must be declared without initialisation and assigned inside setup() instead.

Audio file playback + beat detection (use this when an MP3 path is provided):

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

void setup() {
  song = new SoundFile(this, "/absolute/path/to/file.mp3");
  song.play();
  amp = new Amplitude(this);
  amp.input(song);
  fft = new FFT(this, FFT_SIZE);
  fft.input(song);
}

In draw():
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

Use smoothedAmp (0–1) for continuous motion, bassEnergy for bass-reactive effects,
and onBeat for pulse events. Always guard analysis inside if (song.isPlaying()).

Live audio input via Minim (use this when told to use live input / BlackHole):

import ddf.minim.*;
import ddf.minim.analysis.*;
Minim minim;
AudioInput input;
FFT fft;
BeatDetect beat;
float smoothedLevel = 0;
float bassEnergy = 0;
boolean onBeat = false;

void setup() {
  minim = new Minim(this);
  input = minim.getLineIn(Minim.STEREO, 1024);
  fft = new FFT(input.bufferSize(), input.sampleRate());
  fft.logAverages(22, 3);
  beat = new BeatDetect(input.bufferSize(), input.sampleRate());
  beat.setSensitivity(150);
}

In draw():
  fft.forward(input.mix);
  beat.detect(input.mix);
  smoothedLevel = lerp(smoothedLevel, input.mix.level(), 0.25);
  bassEnergy = 0;
  for (int i = 0; i < 4; i++) bassEnergy += fft.getBand(i);
  bassEnergy /= 4.0;
  onBeat = beat.isOnset();

Use smoothedLevel (0–~0.5) for continuous motion, bassEnergy for bass-reactive effects,
onBeat for pulse events. Access fft.getBand(i) for per-band values.
Always call void stop() { input.close(); minim.stop(); super.stop(); }

OSC effects & parameters — ALWAYS include in every sketch, no exceptions:

1. Invent 2–4 named boolean effects meaningful for this specific sketch
   (e.g. strobeOnBeat, colorInvert, warpMode, particleMode, glitchMode).
2. Invent 1–3 named float parameters meaningful for this sketch
   (e.g. speed, size, intensity, blur, zoom). Each gets a default value in 0.0–1.0.
3. The very first line of the sketch (before any imports) must be exactly:
   // EFFECTS: effectName1, effectName2, ...
   listing every effect variable name, comma-separated, camelCase.
4. The second line must be exactly:
   // PARAMS: paramName1=0.5, paramName2=0.5, ...
   listing every param with its default, comma-separated, camelCase.
5. After those two comment lines, add the required OSC imports:
   import oscP5.*;
   import netP5.*;
6. Declare globals:
   OscP5 oscP5;
   boolean effectName1 = false;   // one per effect
   float paramName1 = 0.5;        // one per param, matching the default above
7. In setup(): oscP5 = new OscP5(this, 12000);
8. Add this handler outside draw():
   void oscEvent(OscMessage msg) {
     if (msg.checkAddrPattern("/effectName1")) effectName1 = msg.get(0).intValue() == 1;
     // one line per effect
     if (msg.checkAddrPattern("/paramName1")) paramName1 = msg.get(0).floatValue();
     // one line per param
   }
9. Use each boolean to toggle a distinct, visually obvious effect in draw().
10. Use each float param to control a continuous aspect in draw() — e.g. multiply a speed,
    scale a size, or blend an intensity. The param value arrives in 0.0–1.0; map it to a
    useful range with map() or direct multiplication.
Do NOT poll HTTP — OSC messages are pushed from the server automatically.`;


function buildImageDataSection(
  data: ImageData,
  imageExt: string,
  visionDescription?: string,
  imageDescription?: string,
): string {
  const paletteDesc = data.palette
    .map(c => `rgb(${c.r},${c.g},${c.b}) ${Math.round(c.weight * 100)}%`)
    .join(", ");

  const blobList = data.blobSvgs
    .map((b, i) => `  blob_${i}.svg  cx=${b.cx} cy=${b.cy} area=${b.area} rgb(${b.color.r},${b.color.g},${b.color.b})`)
    .join("\n");

  const n = data.blobSvgs.length;

  const contextLines: string[] = [];
  if (visionDescription) contextLines.push(`Vision analysis: "${visionDescription}"`);
  if (imageDescription) contextLines.push(`Creator's description: "${imageDescription}"`);
  const contextBlock = contextLines.length
    ? `\nImage context — use this to inform the theme, mood, and narrative of the animation:\n${contextLines.join("\n")}\n`
    : "";

  return `${contextBlock}
The sketch's data/ folder contains extracted data from a source image (${data.imageWidth}×${data.imageHeight}px):

Files:
  image_data.json  — structured feature data
  source${imageExt.padEnd(5)} — original image  loadImage("source${imageExt}")
${data.blobSvgs.map((b, i) => `  blob_${i}.svg      — blob shape  loadShape("blob_${i}.svg")`).join("\n")}

Dominant palette (${data.palette.length} colors): ${paletteDesc}
Contours: ${data.contours.length} simplified shape outlines (normalized 0–1 coords)
Blob SVGs: ${n} vectorized blob shapes
${blobList}

─── Loading image_data.json ───
  JSONObject d       = loadJSONObject("image_data.json");
  JSONArray palette  = d.getJSONArray("palette");
  JSONArray contours = d.getJSONArray("contours");
  JSONArray blobSvgs = d.getJSONArray("blobSvgs");

─── Palette color ───
  JSONObject col = palette.getJSONObject(0);
  fill(col.getInt("r"), col.getInt("g"), col.getInt("b"));

─── Contour path (0–1 → canvas) ───
  JSONArray path = contours.getJSONArray(0);
  beginShape();
  for (int i = 0; i < path.size(); i++) {
    JSONArray pt = path.getJSONArray(i);
    curveVertex(pt.getFloat(0) * width, pt.getFloat(1) * height);
  }
  endShape();

─── Blob SVGs — float / expand / morph ───
Load all ${n} shapes in setup():
  PShape[] blobs = new PShape[${n}];
  float[]  bx    = new float[${n}];
  float[]  by    = new float[${n}];
  float[]  bsz   = new float[${n}];
  for (int i = 0; i < ${n}; i++) {
    blobs[i] = loadShape("blob_" + i + ".svg");
    blobs[i].disableStyle();          // lets you override fill/stroke in draw()
    JSONObject meta = blobSvgs.getJSONObject(i);
    bx[i]  = meta.getFloat("cx") * width;
    by[i]  = meta.getFloat("cy") * height;
    bsz[i] = sqrt(meta.getFloat("area")) * width * 2;
  }

Animate in draw() — float, pulse, morph with Perlin noise:
  for (int i = 0; i < ${n}; i++) {
    float t   = frameCount * 0.008 + i * 1.3;
    float ox  = noise(i * 4.1, t)       * 80 - 40;
    float oy  = noise(i * 4.1 + 10, t)  * 80 - 40;
    float sc  = 0.7 + noise(i * 3.7, t + 5) * 0.6;  // 0.7–1.3×
    float rot = noise(i * 2.9, t + 20)  * TWO_PI;

    JSONObject meta = blobSvgs.getJSONObject(i);
    fill(meta.getJSONObject("color").getInt("r"),
         meta.getJSONObject("color").getInt("g"),
         meta.getJSONObject("color").getInt("b"), 200);
    noStroke();

    pushMatrix();
      translate(bx[i] + ox, by[i] + oy);
      rotate(rot);
      scale(sc);
      shape(blobs[i], -bsz[i]/2, -bsz[i]/2, bsz[i], bsz[i]);
    popMatrix();
  }

IMPORTANT rules for blob SVG usage:
- Call loadShape() only in setup(), never in draw().
- Call disableStyle() after loading so fill/stroke set in draw() take effect.
- Use pushMatrix()/popMatrix() around each shape to isolate transforms.
- Drive motion with noise() for organic, non-repeating float and morph.
- If audio is present, modulate sc (scale) and ox/oy offsets with smoothedAmp or bassEnergy.

─── Shape morphing between blobs ───
Every blob in blobSvgs has a "morphPoints" array: exactly 64 normalised [x,y] points
resampled at equal arc-length intervals. Every blob has the same count, so you can
lerp point-by-point between any two for smooth shape morphing.

Load morph points AND colors in setup():
  final int MORPH_N = 64;
  float[][][] morphPts   = new float[${n}][MORPH_N][2];
  color[]     blobColors = new color[${n}];
  for (int i = 0; i < ${n}; i++) {
    JSONObject meta = blobSvgs.getJSONObject(i);
    JSONObject col  = meta.getJSONObject("color");
    blobColors[i]   = color(col.getInt("r"), col.getInt("g"), col.getInt("b"));
    JSONArray mp    = meta.getJSONArray("morphPoints");
    for (int j = 0; j < MORPH_N; j++) {
      morphPts[i][j][0] = mp.getJSONArray(j).getFloat(0);
      morphPts[i][j][1] = mp.getJSONArray(j).getFloat(1);
    }
  }

Draw a morphed shape interpolating both shape AND color:
  void drawMorph(float[][] ptsA, float[][] ptsB, color colA, color colB, float t) {
    fill(lerpColor(colA, colB, t));
    noStroke();
    int n = ptsA.length;
    beginShape();
    curveVertex(lerp(ptsA[n-1][0], ptsB[n-1][0], t) * width,
                lerp(ptsA[n-1][1], ptsB[n-1][1], t) * height);
    for (int i = 0; i < n; i++) {
      curveVertex(lerp(ptsA[i][0], ptsB[i][0], t) * width,
                  lerp(ptsA[i][1], ptsB[i][1], t) * height);
    }
    curveVertex(lerp(ptsA[0][0], ptsB[0][0], t) * width,
                lerp(ptsA[0][1], ptsB[0][1], t) * height);
    endShape(CLOSE);
  }

Cycle through all blobs (A→B→C→A…) with ease-in-out, color transitions included:
  int fromIdx = (int(frameCount / 120)) % ${n};
  int toIdx   = (fromIdx + 1) % ${n};
  float raw   = (frameCount % 120) / 120.0;
  float t     = raw < 0.5 ? 2*raw*raw : 1 - pow(-2*raw+2,2)/2;
  drawMorph(morphPts[fromIdx], morphPts[toIdx], blobColors[fromIdx], blobColors[toIdx], t);

When drawing blobs as SVGs (not morphing), always use the blob's own color:
  fill(blobColors[i]);
  shape(blobs[i], ...);

Use the palette as the overall colour scheme. Animate contours as particle trails or path followers. Let the blob SVGs float and morph as the primary visual elements.`;
}

export function buildCodeGenPrompt(ctx: PromptContext): string {
  let audioLine = "";
  if (ctx.liveInput) {
    audioLine = "\nUse live audio input via Minim (BlackHole / system input). Do NOT use SoundFile.\n";
  } else if (ctx.mp3Path != null) {
    audioLine = `\nAudio file to play and sync to: "${ctx.mp3Path}"\n`;
  }

  let ragSection = "";
  if (ctx.ragExamples?.length) {
    ragSection =
      "\n\nReference examples from the official Processing library — use these for correct API usage, structure, and visual inspiration:\n\n" +
      "```\n" +
      ctx.ragExamples.join("\n\n---\n\n") +
      "\n```\n";
  }

  const facesSection = shouldInjectFaces(ctx.userDescription) && FACES_SECTION
    ? `\n\n${FACES_SECTION}`
    : "";

  const imageSection = ctx.imageData
    ? `\n\n${buildImageDataSection(ctx.imageData, ctx.imageExt ?? ".png", ctx.visionDescription, ctx.imageDescription)}`
    : "";

  return `Create a Processing sketch for the following description:
${audioLine}
"${ctx.userDescription}"
${ragSection}${facesSection}${imageSection}
Output only the Processing source code. Nothing else.`;
}

export function buildRefinementPrompt(modification: string): string {
  return `Modify the sketch as follows: "${modification}"

Output only the complete modified Processing source code. Nothing else.`;
}

export { SYSTEM_PROMPT };
