import { copyFile, mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import type { ImageData } from "../image/preprocessor.js";

const SKETCHES_DIR = resolve("sketches");
const FACES_DIR = resolve("assets/faces");

function sketchName(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return [
    "viz",
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

export type WrittenSketch = {
  name: string;
  dir: string;
  file: string;
};

export type SketchAssets = {
  imageData: ImageData;
  imagePath: string;
  /** Directory holding the blob SVG files written by the preprocessor. */
  svgDir: string;
};

export async function writeSketch(code: string, assets?: SketchAssets): Promise<WrittenSketch> {
  const name = sketchName();
  const dir = join(SKETCHES_DIR, name);
  const file = join(dir, `${name}.pde`);
  const dataDir = join(dir, "data");

  await mkdir(dataDir, { recursive: true });
  await writeFile(file, code, "utf8");

  // Symlink SVG faces into data/ individually
  try {
    const svgs = (await readdir(FACES_DIR)).filter(f => f.endsWith(".svg"));
    await Promise.all(
      svgs.map(svg => symlink(join(FACES_DIR, svg), join(dataDir, svg)).catch(() => {}))
    );
  } catch {}

  if (assets) {
    // Write JSON feature data
    await writeFile(
      join(dataDir, "image_data.json"),
      JSON.stringify(assets.imageData, null, 2),
      "utf8"
    );
    // Copy original image
    const ext = extname(assets.imagePath) || ".png";
    await copyFile(assets.imagePath, join(dataDir, `source${ext}`));
    // Copy blob SVG files
    try {
      const svgFiles = (await readdir(assets.svgDir)).filter(f => f.endsWith(".svg"));
      await Promise.all(
        svgFiles.map(f => copyFile(join(assets.svgDir, f), join(dataDir, f)))
      );
    } catch {}
  }

  return { name, dir, file };
}
