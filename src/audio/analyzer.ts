import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type BandName = "sub_bass" | "bass" | "low_mid" | "mid" | "high_mid" | "high";

export type AudioAnalysis = {
  bpm: number;
  key: string;
  scale: "major" | "minor";
  keyLabel: string;
  keyConfidence: number;
  durationSeconds: number;
  /** Average spectral centroid in Hz — perceived brightness (low = warm/dark, high = bright/harsh) */
  spectralCentroid: number;
  /** 0 = fully percussive, 1 = fully harmonic/melodic */
  harmonicRatio: number;
  /** Frequency band carrying the most energy */
  dominantBand: BandName;
  /** Relative energy per band, sums to 1 */
  bandEnergies: Record<BandName, number>;
};

const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), "analyze.py");

export function analyzeAudio(audioPath: string, durationSeconds?: number): AudioAnalysis {
  const args = [SCRIPT, audioPath];
  if (durationSeconds != null) args.push("--duration", String(durationSeconds));

  const result = spawnSync("python3", args, { encoding: "utf8" });
  if (result.error) throw new Error(`Audio analyzer launch failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`Audio analyzer exited ${result.status}: ${result.stderr}`);

  const data = JSON.parse(result.stdout) as { error?: string } & AudioAnalysis;
  if (data.error) throw new Error(`Audio analyzer error: ${data.error}`);
  return data;
}
