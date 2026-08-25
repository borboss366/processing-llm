#!/usr/bin/env node
// tools/verify.mjs — umbrella verification runner.
//
// Usage:
//   node tools/verify.mjs                       # fast tier (no audio, no LLM, no browser)
//   node tools/verify.mjs --full                # everything runnable on this machine
//   node tools/verify.mjs --only=replay-smoke   # named checks (runs them even if full-tier)
//
// Contract with harnesses: each check's command prints, as its LAST
// non-empty stdout line,
//   VERIFY:PASS <name> key=val ...
//   VERIFY:FAIL <name> reason=...
// A missing VERIFY line is a FAIL — every harness in the registry prints
// one, so its absence means the harness didn't reach its verdict (or a
// library was invoked as a CLI and silently did nothing).
//
// Checks run SEQUENTIALLY on purpose: parallel headless browsers contend
// for CPU and skew the PLL's BPM low (measured −3.5 under 3-way load).
//
// Exit code: 0 if no FAIL (SKIPs allowed), 1 otherwise.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";

const args = process.argv.slice(2);
const FULL = args.includes("--full");
const onlyIdx = args.findIndex(a => a === "--only" || a.startsWith("--only="));
const ONLY = onlyIdx === -1 ? []
  : (args[onlyIdx].includes("=") ? args[onlyIdx].split("=")[1] : args[onlyIdx + 1] ?? "")
      .split(",").filter(Boolean);

const hasMusic = existsSync("music") &&
  readdirSync("music").some(f => /\.(mp3|wav|flac|m4a)$/i.test(f));
const hasSession = existsSync("sessions") &&
  readdirSync("sessions").some(f => f.endsWith(".jsonl"));
const probe = (url) => {
  try {
    const r = spawnSync("curl", ["-s", "-o", "/dev/null", "-m", "2", url]);
    return r.status === 0;
  } catch { return false; }
};
const ollamaUp = (() => {
  try {
    const r = spawnSync("curl", ["-s", "-m", "2", "http://localhost:11434/api/tags"]);
    return r.status === 0 && r.stdout?.length > 0;
  } catch { return false; }
})();
const stackUp = probe("http://localhost:5173") && probe("http://localhost:3000/browser-modules");
const needStack = () => (stackUp ? null : "server+vite not running (npm run server / npm run dev)");

// ---------------------------------------------------------------------------
// Check registry. tier "fast" always runs; "full" needs --full (or --only).
// skip: () => string | null — a reason string skips the check.
// ---------------------------------------------------------------------------
const CHECKS = [
  {
    name: "move-clock",
    tier: "fast",
    cmd: ["node", "tools/move-clock-test.mjs"],
    desc: "move clock caps acquisition snaps (0.46 → ≥1 beat spread) and low-passes BPM swings",
  },
  {
    name: "pll-synthetic",
    tier: "fast",
    cmd: ["node", "tools/beat-test.mjs"],
    desc: "PLL locks synthetic beats at 60/120 Hz, 4 tempi ±2 BPM",
  },
  {
    name: "module-load",
    tier: "fast",
    cmd: ["node", "tools/check-modules.mjs"],
    desc: "every loaded-module imports and satisfies the ABI basics",
  },
  {
    name: "director-prompt-stable",
    tier: "fast",
    cmd: ["node", "tools/replay.mjs", "--check-prefix"],
    desc: "director prompt prefix is byte-identical across two builds",
  },
  {
    name: "pll-real-tracks",
    tier: "full",
    skip: () => needStack() ?? (hasMusic ? null : "no files in music/"),
    cmd: ["node", "tools/beat-test-real.mjs", "--verify"],
    desc: "genre matrix ±2 BPM on confident samples (~5 min, real-time)",
  },
  {
    name: "replay-smoke",
    tier: "full",
    skip: () => !hasSession ? "no sessions/*.jsonl"
              : !ollamaUp   ? "Ollama not reachable" : null,
    cmd: ["node", "tools/replay.mjs", "--latest", "--seed", "1"],
    desc: "latest session replays with 0 errors / 0 off-list picks",
  },
  {
    name: "creature-capture",
    tier: "full",
    skip: () => needStack() ?? (hasMusic ? null : "no files in music/"),
    cmd: ["node", "tools/capture-creature.mjs", "--verify", "--shape", "biped-1", "--seconds", "5"],
    desc: "creature runs headless; ≤6 ms/frame, stance slide ≤5 px",
  },
  {
    name: "weld-sweep",
    tier: "full",
    skip: () => needStack() ?? (hasMusic ? null : "no files in music/"),
    cmd: ["node", "tools/weld-sweep.mjs", "--shape", "biped-1"],
    desc: "arm-across-torso sweep: union-by-max removes the additive weld-flash (≥10% A/B divergence in the flash band)",
  },
  {
    name: "workbench",
    tier: "full",
    skip: () => needStack() ?? (hasMusic ? null : "no files in music/"),
    cmd: ["node", "tools/workbench-check.mjs"],
    desc: "move workbench: scrub, hot edit applies, parse error kept safe, manual→live snap-free",
  },
  {
    name: "bench-check",
    tier: "full",
    skip: () => needStack() ?? (hasMusic ? null : "no files in music/"),
    cmd: ["node", "tools/bench-check.mjs", "--seconds", "45"],
    desc: "bench live over WS; click track ≤60 ms median vs the live estimate; rotation visible",
  },
  {
    name: "audience-e2e",
    tier: "full",
    cmd: ["node", "tools/audience-e2e.mjs"],
    desc: "phone-page submission E2E: all validation verdicts + moderation (self-contained service)",
  },
  {
    name: "post-ab",
    tier: "full",
    skip: () => needStack() ?? (hasMusic ? null : "no files in music/"),
    cmd: ["node", "tools/post-ab.mjs", "--shape", "biped-1", "--seconds", "6"],
    desc: "compositor active, post/bypass A/B differs, no page errors",
  },
];

// ---------------------------------------------------------------------------
const results = [];
for (const c of CHECKS) {
  if (ONLY.length && !ONLY.includes(c.name)) continue;
  const named = ONLY.includes(c.name);          // --only overrides the tier gate
  if (!FULL && !named && c.tier === "full") { results.push([c, "SKIP", "fast tier"]); continue; }
  const why = c.skip?.();
  if (why) { results.push([c, "SKIP", why]); continue; }

  const t0 = Date.now();
  const r = spawnSync(c.cmd[0], c.cmd.slice(1), {
    encoding: "utf8", timeout: 10 * 60 * 1000,
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const lines = (r.stdout ?? "").trim().split("\n").filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  const m = last.match(/^VERIFY:(PASS|FAIL)\s+(\S+)\s*(.*)$/);

  let status, detail;
  if (r.error) {
    status = "FAIL"; detail = String(r.error);
  } else if (m) {
    status = m[1];
    detail = `${m[3]} (${secs}s)`;
  } else {
    status = "FAIL";
    detail = `no VERIFY line; exit=${r.status ?? "signal"} (${secs}s)`;
  }
  results.push([c, status, detail]);
  if (status === "FAIL") {
    if (r.stdout) console.error(`--- stdout tail: ${c.name} ---\n${r.stdout.trim().slice(-2000)}`);
    if (r.stderr?.trim()) console.error(`--- stderr tail: ${c.name} ---\n${r.stderr.trim().slice(-2000)}`);
  }
}

// ---------------------------------------------------------------------------
const pad = (s, n) => String(s).padEnd(n);
console.log("\n" + pad("CHECK", 26) + pad("STATUS", 8) + "DETAIL");
for (const [c, status, detail] of results)
  console.log(pad(c.name, 26) + pad(status, 8) + (detail || c.desc));

const fails = results.filter(r => r[1] === "FAIL").length;
const skips = results.filter(r => r[1] === "SKIP").length;
console.log(`\n${results.length - fails - skips} pass, ${fails} fail, ${skips} skip` +
  (FULL ? "" : "  (fast tier — use --full for everything)"));
process.exit(fails ? 1 : 0);
