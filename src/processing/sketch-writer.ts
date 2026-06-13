import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const SKETCHES_DIR = resolve("sketches");

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

export async function writeSketch(code: string): Promise<WrittenSketch> {
  const name = sketchName();
  const dir = join(SKETCHES_DIR, name);
  const file = join(dir, `${name}.pde`);

  await mkdir(dir, { recursive: true });
  await writeFile(file, code, "utf8");

  return { name, dir, file };
}
