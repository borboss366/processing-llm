#!/usr/bin/env node
/**
 * weight-probe (brief 17.6 T2 report): one render page, each move at each
 * `exaggerateWeight` dial value, engine-trace rows read back. Per case:
 *   - hang: how far the SUPPORT foot's lowest point (ankle or toe) sits
 *     above its rest floor after the whole engine (lock included), in leg
 *     lengths L — "the figure hangs" in numbers. Support = the TABLE's
 *     weight at that instant (|w| ≥ 0.6, the contacts rule); shared stance
 *     → the lower foot. (Not the layer's sprung weight: it lags ~0.25 s
 *     and would score a foot that is legitimately still kicking.)
 *   - sink-in: how far any foot goes BELOW its floor (grounding by weight
 *     puts the weighted foot on the floor; if the free foot is lower in FK
 *     it is pushed through) — L;
 *   - root range: pelvis vertical travel over the window (the bob), and the
 *     same before the transfer sink (addendum C: grounding's own bob);
 *   - layer displacement: the largest joint move the layer made in a frame
 *     (weight ≡ 0 identity: must be ~0);
 *   - spikes added during the window;
 *   - module cost: creature ms/frame (window.__creaturePerf), median over
 *     3 s with the trace OFF (the trace itself costs). Headless swiftshader
 *     — compare dials against each other, not against real-GPU fps.
 *
 *   node tools/weight-probe.mjs [--dials 0,1] [--seconds 6] [--moves a,b]
 */
import { assertStackRunning, launchBrowser, openRenderWithFile } from "./render-page.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const DIALS = opt("dials", "0,1").split(",").map(Number);
const SECONDS = +opt("seconds", 6);
const MOVES = opt("moves", "none,groove,runningman-captured,runningman-captured-front,tstep-captured,bodyroll-captured,basic_kick_1-captured-front,tstep-placeholder").split(",");
const MIX = "/music/Y2Mate.is - Boris Brejcha Style Minimal Techno Mix 2025 - Mixed by Granada.mp3";
const post = (p, body) => fetch(`http://localhost:3000${p}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}).then((r) => r.json());
const osc = (address, value) => post("/osc", { address, value });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function score(tr) {
  const names = tr.meta.jointNames, rest = tr.meta.rigJoints;
  const ix = (nm) => names.indexOf(nm);
  const iP = ix("pelvis");
  const legL = ["L", "R"].reduce((a, sd) => {
    const d = (p, q) => Math.hypot(rest[p][0] - rest[q][0], rest[p][1] - rest[q][1]);
    return a + (d("hip" + sd, "knee" + sd) + d("knee" + sd, "ankle" + sd)) / 2;
  }, 0);
  const floor = (sd) => Math.max(rest["ankle" + sd][1], rest["foot" + sd][1]);
  const pen = [], hang = [], rootY = [], preSink = [], disp = [], ws = [];
  for (const f of tr.frames) {
    const P = f.lockP;
    if (!P) continue;
    const lowest = (sd) => Math.max(P[ix("ankle" + sd)][1], P[ix("foot" + sd)][1]);
    const hL = floor("L") - lowest("L"), hR = floor("R") - lowest("R");
    const w = f.wtT ?? 0;
    hang.push(w >= 0.6 ? hR : w <= -0.6 ? hL : Math.min(hL, hR));
    pen.push(Math.max(0, -hL, -hR));
    rootY.push(P[iP][1]);
    if (f.wl) { preSink.push(f.wl.rootYpreSink); disp.push(f.wl.maxDisp); }
    ws.push(f.wt ?? 0);
  }
  const rng = (a) => (a.length ? Math.max(...a) - Math.min(...a) : 0);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const sp = tr.frames.map((f) => f.flags?.spikes ?? 0);
  return {
    played: [...new Set(tr.frames.map((f) => f.mv ?? tr.meta.move))].join("+"), frames: tr.frames.length, legL: +legL.toFixed(4),
    w: ws.length ? [+Math.min(...ws).toFixed(2), +Math.max(...ws).toFixed(2)] : null,
    hangMaxL: +(Math.max(...hang) / legL).toFixed(3), hangMeanL: +(mean(hang) / legL).toFixed(3),
    sinkInL: +(Math.max(...pen) / legL).toFixed(3),
    rootRangeL: +(rng(rootY) / legL).toFixed(3), preSinkRangeL: preSink.length ? +(rng(preSink) / legL).toFixed(3) : null,
    maxDispL: disp.length ? +(Math.max(...disp) / legL).toFixed(4) : 0,
    spikes: sp.length ? sp[sp.length - 1] - sp[0] : 0,
  };
}

await assertStackRunning();
const browser = await launchBrowser();
const rows = [];
try {
  const page = await openRenderWithFile(browser, MIX, { seekSec: 300 });
  await post("/browser-modules/load", { id: "creature" });
  await sleep(1500);
  await osc("/creature/entryConf", 0);
  await osc("/creature/behavior", "groove");
  await osc("/post/post", 0);
  await post("/browser-modules/trigger", { id: "creature" });
  await sleep(3000);
  for (const mv of MOVES) {
    await osc("/creature/move", mv);
    await sleep(9000);                                  // view switch (bar-quantized) + 4-beat xfade in
    for (const k of DIALS) {
      await osc("/creature/exaggerateWeight", k);
      await sleep(2500);
      await osc("/creature/engineTrace", 1);
      await page.evaluate(() => window.__engineTraceReset?.());
      await sleep(SECONDS * 1000);
      const tr = await page.evaluate(() => window.__engineTraceDump?.() ?? null);
      await osc("/creature/engineTrace", 0);
      if (!tr?.frames?.length) { console.log(`${mv} dial ${k}: NO TRACE`); continue; }
      await sleep(1000);
      const ms = await page.evaluate(async () => {
        const xs = [];
        for (let i = 0; i < 30; i++) { await new Promise((r) => setTimeout(r, 100)); if (window.__creaturePerf?.ms) xs.push(window.__creaturePerf.ms); }
        xs.sort((a, b) => a - b);
        return xs.length ? xs[xs.length >> 1] : null;
      });
      const r = { move: mv, dial: k, ...score(tr), ms: ms == null ? null : +ms.toFixed(2) };
      rows.push(r);
      console.log(JSON.stringify(r));
    }
  }
  await osc("/creature/exaggerateWeight", 0);
  await osc("/creature/move", "auto");
} finally {
  await browser.close();
}
console.log("\n| move (played) | dial | weight range | support-foot hang max / mean (L) | foot below floor max (L) | root range (L) | before sink (L) | layer max move (L) | spikes | ms/frame |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) console.log(`| ${r.move}${r.played !== r.move ? ` (${r.played})` : ""} | ${r.dial} | ${r.w?.join("…")} | ${r.hangMaxL} / ${r.hangMeanL} | ${r.sinkInL} | ${r.rootRangeL} | ${r.preSinkRangeL ?? "—"} | ${r.maxDispL} | ${r.spikes} | ${r.ms ?? "—"} |`);
