#!/usr/bin/env node
/**
 * Ankle-trace diagnostic (brief 16 — "ankles read reversed on stage").
 * For one loop window: per-foot ankle theta RAW vs FILTERED (SG) vs the
 * DISTILLED keys, with the projected (de-yawed) ankle→toe length per frame.
 * Flags |Δθ| > π/2 frame steps and marks foreshortened frames. Emits a
 * plot via matplotlib + a numeric summary.
 *
 *   node tools/mocap/ankle-diag.mjs <video> --loop-window A-B --move <move.json> [--out prefix]
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sgLandmarks } from "./lib/smooth.mjs";
import { MP, buildRig, detectYSign, frameYaw, deYaw, retargetFrame } from "./lib/retarget.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const video = argv.find((a) => !a.startsWith("--") && !/^\d|-/.test(a[0]) || a.endsWith(".mp4"));
const [winA, winB] = opt("loop-window", "0-99999").split(/[-–]/).map((s) => {
  const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(s);
  return m ? +m[1] * 60 + +m[2] : +s;
});
const movePath = opt("move", null);
const outPrefix = opt("out", video.replace(/\.[^.]+$/, "") + ".ankle");

const sidecar = JSON.parse(fs.readFileSync(path.join(ROOT, "web/app/shapes/biped-1.json"), "utf8"));
const rig = buildRig(sidecar);

const py = path.join(HERE, ".venv/bin/python");
const raw = await new Promise((resolve, reject) => {
  const p = spawn(py, [path.join(HERE, "pose_worker.py"), video, String(winA), String(winB)]);
  let buf = "", err = "";
  const frames = [];
  let meta = null;
  p.stdout.on("data", (d) => {
    buf += d;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      const j = JSON.parse(line);
      if (j.meta) meta = j; else if (!j.error) frames.push(j);
    }
  });
  p.stderr.on("data", (d) => { err += d; });
  p.on("close", (c) => c === 0 ? resolve({ meta, frames }) : reject(new Error(err.slice(-500))));
});
const detected = raw.frames.filter((f) => !f.miss);
const times = detected.map((f) => f.t);
const rawWorld = detected.map((f) => f.world);
const sgWorld = sgLandmarks(rawWorld, { window: 9, order: 3 });

const thetasOf = (world) => {
  const ySign = detectYSign(world);
  const norm = ySign === 1 ? world : world.map((f) => f.map(([x, y, z]) => [x, -y, -z]));
  return norm.map((f) => {
    const yaw = frameYaw(f);
    const d2 = deYaw(f, yaw);
    const th = retargetFrame(d2, rig, false);
    // projected ankle→toe length in the de-yawed frame, per side, plus the
    // FULL 3D foot length for reference (ratio = foreshortening)
    const len = {};
    for (const s of ["L", "R"]) {
      const a2 = d2[MP[`ankle${s}`]], t2 = d2[MP[`toe${s}`]];
      const a3 = f[MP[`ankle${s}`]], t3 = f[MP[`toe${s}`]];
      const proj = Math.hypot(t2[0] - a2[0], t2[1] - a2[1]);
      const full = Math.hypot(t3[0] - a3[0], t3[1] - a3[1], t3[2] - a3[2]);
      len[s] = { proj, full, ratio: proj / (full || 1) };
      // foot yaw from the 3D heel→toe vector (candidate new channel)
      const h3 = f[MP[`heel${s}`]];
      len[s].footYaw = Math.atan2(t3[2] - h3[2], t3[0] - h3[0]);
    }
    return { th, len, yaw };
  });
};
const R = thetasOf(rawWorld);
const F = thetasOf(sgWorld);

const jumps = { L: [], R: [] };
for (const side of ["L", "R"]) {
  const key = `ankle${side}`;
  for (let i = 1; i < R.length; i++) {
    const d = Math.abs(R[i].th[key] - R[i - 1].th[key]);
    if (d > Math.PI / 2) jumps[side].push({ i, t: times[i], d: +d.toFixed(2), ratio: +R[i].len[side].ratio.toFixed(2) });
  }
}

const move = movePath ? JSON.parse(fs.readFileSync(movePath, "utf8")) : null;
const data = {
  t: times,
  rawL: R.map((r) => r.th.ankleL), rawR: R.map((r) => r.th.ankleR),
  filtL: F.map((r) => r.th.ankleL), filtR: F.map((r) => r.th.ankleR),
  ratioL: R.map((r) => r.len.L.ratio), ratioR: R.map((r) => r.len.R.ratio),
  footYawL: R.map((r) => r.len.L.footYaw), footYawR: R.map((r) => r.len.R.footYaw),
  keys: move ? move.keys.map((k) => ({ phase: k.phase, aL: k.joints.ankleL?.rot ?? null, aR: k.joints.ankleR?.rot ?? null })) : [],
  window: [winA, winB], jumps,
};
fs.writeFileSync(`${outPrefix}.json`, JSON.stringify(data));

for (const side of ["L", "R"]) {
  const ratios = data[`ratio${side}`];
  const minR = Math.min(...ratios);
  const lowFrames = ratios.filter((r) => r < 0.35).length;
  console.log(`[ankle-diag] ${side}: jumps>${(Math.PI / 2).toFixed(2)} rad: ${jumps[side].length}` +
    (jumps[side].length ? ` at ${jumps[side].map((j) => `${j.t.toFixed(2)}s(ratio ${j.ratio})`).join(", ")}` : "") +
    ` · proj/full ratio min ${minR.toFixed(2)}, frames<0.35: ${lowFrames}/${ratios.length}`);
}

// plot
const plotPy = `
import json, numpy as np, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
d = json.load(open("${outPrefix}.json"))
t = np.array(d["t"]); t0 = t[0]
fig, axes = plt.subplots(2, 2, figsize=(14, 8), sharex=True)
period = (d["window"][1] - d["window"][0])
for col, side in enumerate(["L", "R"]):
    ax = axes[0][col]
    ax.plot(t - t0, d["raw" + side], color="#bbb", lw=1, label="raw")
    ax.plot(t - t0, d["filt" + side], color="tab:blue", lw=1.6, label="savgol")
    for k in d["keys"]:
        v = k["a" + side]
        if v is None: continue
        for cyc in range(int(period / (period)) + 3):
            x = k["phase"] * period + cyc * period
            if x <= t[-1] - t0:
                ax.plot(x, v, "r.", ms=6)
    for j in d["jumps"][side]:
        ax.axvline(j["t"] - t0, color="orange", alpha=0.5, lw=1)
    ax.set_title(f"ankle{side} theta (rad) — red dots: distilled keys, orange: >pi/2 jumps")
    ax.legend(loc="upper right", fontsize=8)
    ax.grid(alpha=0.3)
    ax2 = axes[1][col]
    ax2.plot(t - t0, d["ratio" + side], color="tab:green", lw=1.4, label="proj/full foot len")
    ax2.plot(t - t0, d["footYaw" + side], color="tab:purple", lw=1, alpha=0.7, label="footYaw (3D heel->toe)")
    ax2.axhline(0.35, color="red", ls="--", lw=1, label="foreshorten gate 0.35")
    ax2.set_title(f"foot{side}: projected-length ratio + 3D foot yaw")
    ax2.legend(loc="upper right", fontsize=8)
    ax2.grid(alpha=0.3)
    ax2.set_xlabel("s in window")
plt.tight_layout()
plt.savefig("${outPrefix}.png", dpi=110)
print("wrote ${outPrefix}.png")
`;
await new Promise((resolve, reject) => {
  const p = spawn(py, ["-c", plotPy], { stdio: "inherit" });
  p.on("close", (c) => c === 0 ? resolve() : reject(new Error(`plot exit ${c}`)));
});
