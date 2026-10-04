#!/usr/bin/env node
/**
 * Owner CLI: clip acquisition (brief 19.2 follow-up).
 *
 *   npm run fetch -- <url> [--name <slug>] [--section 1:32-1:58]
 *
 * yt-dlp → corpus/<slug>.mp4 (best mp4 video+audio; slug from the video
 * title when --name is omitted), --section uses --download-sections with
 * --force-keyframes-at-cuts (so long videos cut cleanly), then re-encodes
 * to corpus/<slug>-h264.mp4 for the OpenCV reader. Prints path, duration,
 * fps, frame size; appends a stub line to docs/MOTION_SOURCES.md for the
 * owner to fill in. Prints every underlying command.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runShown } from "./lib/run.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const HELP = `npm run fetch -- <url> [--name <slug>] [--section M:SS-M:SS]
  downloads into corpus/<slug>.mp4, re-encodes to corpus/<slug>-h264.mp4
  (the OpenCV-safe copy every other command reads), prints duration/fps/size,
  and appends a loop/cycles/mirror stub to docs/MOTION_SOURCES.md.`;
if (argv.includes("--help") || !argv.length) { console.log(HELP); process.exit(argv.length ? 0 : 1); }

const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const url = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--name" && argv[i - 1] !== "--section");
if (!url) { console.error(HELP); process.exit(1); }

for (const [bin, verArg, hint] of [["yt-dlp", "--version", "brew install yt-dlp"],
                                   ["ffmpeg", "-version", "brew install ffmpeg"],
                                   ["ffprobe", "-version", "brew install ffmpeg"]]) {
  try { execFileSync(bin, [verArg], { stdio: "ignore" }); }
  catch { console.error(`[fetch] ${bin} is missing — install it first:  ${hint}`); process.exit(1); }
}

let slug = opt("name", null);
if (!slug) {
  const title = execFileSync("yt-dlp", ["--print", "%(title)s", "--no-download", url], { encoding: "utf8" }).trim();
  slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  console.log(`[fetch] slug from title: "${title}" → ${slug}`);
}
const raw = path.join(ROOT, `corpus/${slug}.mp4`);
const h264 = path.join(ROOT, `corpus/${slug}-h264.mp4`);

const dlArgs = ["-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b", "--merge-output-format", "mp4",
  "-o", raw, "--no-playlist"];
const section = opt("section", null);
if (section) dlArgs.push("--download-sections", `*${section}`, "--force-keyframes-at-cuts");
dlArgs.push(url);
await runShown("yt-dlp", dlArgs);

// OpenCV-safe re-encode: constant-ish H.264, yuv420p, faststart; audio kept
await runShown("ffmpeg", ["-y", "-loglevel", "error", "-i", raw,
  "-c:v", "libx264", "-preset", "fast", "-crf", "18", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-movflags", "+faststart", h264]);

const probe = JSON.parse(execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json",
  "-show_streams", "-show_format", h264], { encoding: "utf8" }));
const v = probe.streams.find((s) => s.codec_type === "video");
const fps = v.avg_frame_rate.includes("/") ? (+v.avg_frame_rate.split("/")[0] / +v.avg_frame_rate.split("/")[1]) : +v.avg_frame_rate;
console.log(`\n──── fetched ─────────────────────────────────────────────────`);
console.log(`  ${path.relative(ROOT, h264)}  ·  ${(+probe.format.duration).toFixed(2)} s  ·  ${fps.toFixed(2)} fps  ·  ${v.width}×${v.height}`);
console.log(`  raw download kept at ${path.relative(ROOT, raw)}`);

const stub = `FETCHED ${new Date().toISOString().slice(0, 10)} ${url} corpus/${slug}-h264.mp4 loop: ____–____; cycles: ____; mirror: ____\n`;
fs.appendFileSync(path.join(ROOT, "docs/MOTION_SOURCES.md"), stub);
console.log(`  MOTION_SOURCES.md stub appended — fill loop/cycles/mirror, then:`);
console.log(`  npm run capture -- corpus/${slug}-h264.mp4   (or npm run move -- …)`);
console.log(`──────────────────────────────────────────────────────────────`);
