import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type PaletteColor = { r: number; g: number; b: number; weight: number };

export type BlobSvg = {
  filename: string;
  svgWidth: number;
  svgHeight: number;
  cx: number;
  cy: number;
  area: number;
  color: { r: number; g: number; b: number };
  /** 64 equally arc-length-spaced points, normalised 0–1 image coords. Same length for every blob. */
  morphPoints: number[][];
};

export type ImageData = {
  imageWidth: number;
  imageHeight: number;
  palette: PaletteColor[];
  contours: number[][][];
  blobSvgs: BlobSvg[];
};

export type PreprocessResult = {
  data: ImageData;
  /** Temp directory that holds the blob SVG files — caller must delete after writeSketch. */
  svgDir: string;
};

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "preprocess.py");

export function preprocessImage(imagePath: string, svgDir: string): ImageData {
  const result = spawnSync(
    "python3",
    [SCRIPT, imagePath, "--output-dir", svgDir],
    { encoding: "utf8" }
  );
  if (result.error) throw new Error(`Preprocessor launch failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Preprocessor exited ${result.status}: ${result.stderr}`);
  const data = JSON.parse(result.stdout) as { error?: string } & ImageData;
  if (data.error) throw new Error(`Preprocessor error: ${data.error}`);
  return data;
}
