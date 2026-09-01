#!/usr/bin/env node
/**
 * Audience pipeline E2E (brief 11 Task 5): spawns an ISOLATED submission
 * service (own port/token/spool in the scratch dir), drives the real phone
 * page headless with canvas ops, and asserts every validation verdict:
 *
 *   good drawing            → accepted, lands in pending
 *   disconnected drawing    → "disconnected pieces"
 *   tiny drawing            → "draw bigger"
 *   joints-uncovered        → "ghost figure"
 *   oversize payload        → 413
 *   bad token               → 403
 *   rate-limit trip         → 429 within a minute
 *
 * Then exercises moderation: approve moves the pair to approved/ and the
 * approved endpoints serve it; reject moves to rejected/.
 *
 *   node tools/audience-e2e.mjs
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { launchBrowser } from "./render-page.mjs";

const PORT = 3215;
const TOKEN = "e2etest";
const SPOOL = await fs.mkdtemp(path.join(os.tmpdir(), "aud-e2e-"));
const BASE = `http://localhost:${PORT}`;

const failures = [];
const check = (name, cond, detail = "") => {
  console.log(`[e2e] ${cond ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!cond) failures.push(name);
};

// ── spawn isolated service ────────────────────────────────────────────────
const svc = spawn("npx", ["tsx", "services/submit/server.ts"], {
  env: { ...process.env, SUBMIT_PORT: String(PORT), SUBMIT_TOKEN: TOKEN, SPOOL_DIR: SPOOL },
  stdio: ["ignore", "pipe", "pipe"],
});
svc.stderr.on("data", (d) => process.stderr.write(`[svc] ${d}`));
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("service didn't boot")), 15_000);
  svc.stdout.on("data", (d) => { if (String(d).includes("phone page")) { clearTimeout(t); res(); } });
});

const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 800 });
  await page.goto(`${BASE}/e/${TOKEN}`, { waitUntil: "networkidle0" });

  // draw on the REAL page canvas: thick white capsules over the template
  // bones (a plausible blob-with-limbs), via the same joints the ghost uses
  const drawFigure = (opts = {}) => page.evaluate(async (o) => {
    const t = await (await fetch("/api/template")).json();
    const ink = document.getElementById("ink");
    const g = ink.getContext("2d");
    const S = ink.width;
    g.clearRect(0, 0, S, S);
    g.strokeStyle = "#fff"; g.fillStyle = "#fff"; g.lineCap = "round";
    const J = {}; t.joints.forEach((j) => (J[j.name] = j));
    const seg = (a, b, w) => {
      g.lineWidth = w;
      g.beginPath(); g.moveTo(J[a].x * S, J[a].y * S); g.lineTo(J[b].x * S, J[b].y * S); g.stroke();
    };
    if (o.mode === "tiny") {
      g.beginPath(); g.arc(0.5 * S, 0.4 * S, 0.05 * S, 0, 7); g.fill();
      return;
    }
    if (o.mode === "torsoOnly") {
      // covers pelvis/chest/neck+head but leaves hands and feet bare
      g.lineWidth = 0.24 * S;
      g.beginPath(); g.moveTo(0.5 * S, 0.15 * S); g.lineTo(0.5 * S, 0.6 * S); g.stroke();
      return;
    }
    const W = 0.11 * S;
    seg("pelvis", "chest", W * 1.5); seg("chest", "neck", W * 1.2);
    seg("pelvis", "kneeL", W); seg("kneeL", "ankleL", W); seg("ankleL", "footL", W);
    seg("pelvis", "kneeR", W); seg("kneeR", "ankleR", W); seg("ankleR", "footR", W);
    seg("chest", "elbowL", W); seg("elbowL", "handL", W);
    seg("chest", "elbowR", W); seg("elbowR", "handR", W);
    g.beginPath(); g.arc(0.5 * S, 0.14 * S, 0.11 * S, 0, 7); g.fill();
    if (o.mode === "disconnected") {
      // a clearly separate island, big enough to bust the 95% invariant
      g.beginPath(); g.arc(0.1 * S, 0.1 * S, 0.07 * S, 0, 7); g.fill();
    }
  }, opts);

  const submit = async () => {
    await page.evaluate(() => { document.getElementById("msg").textContent = ""; });
    await page.click("#submit");
    await page.waitForFunction(() =>
      document.getElementById("done").style.display === "block" ||
      document.getElementById("msg").textContent.length > 0, { timeout: 10_000 });
    return page.evaluate(() => ({
      accepted: document.getElementById("done").style.display === "block",
      reason: document.getElementById("msg").textContent,
    }));
  };
  const resetDone = () => page.evaluate(() => document.getElementById("again")?.click());

  // 1. good drawing
  await drawFigure();
  const good = await submit();
  check("good drawing accepted", good.accepted, good.reason);
  await resetDone();

  // 2. disconnected
  await drawFigure({ mode: "disconnected" });
  const disc = await submit();
  check("disconnected rejected", !disc.accepted && /disconnected/.test(disc.reason), disc.reason || "accepted?!");

  // 3. tiny
  await drawFigure({ mode: "tiny" });
  const tiny = await submit();
  check("tiny rejected", !tiny.accepted && /draw bigger/.test(tiny.reason), tiny.reason || "accepted?!");

  // 4. joints uncovered
  await drawFigure({ mode: "torsoOnly" });
  const torso = await submit();
  check("joints-uncovered rejected", !torso.accepted && /ghost figure/.test(torso.reason), torso.reason || "accepted?!");

  // desktop draw mode (brief 12): the same good figure drawn with REAL
  // mouse drags through the pointer-event path, not canvas ops
  await page.evaluate(() => document.getElementById("ink").getContext("2d").clearRect(0, 0, 512, 512));
  {
    const { rect, paths } = await page.evaluate(async () => {
      const t = await (await fetch("/api/template")).json();
      const r = document.getElementById("ink").getBoundingClientRect();
      const J = {}; t.joints.forEach((j) => (J[j.name] = j));
      const seg = (a, b) => [[J[a].x, J[a].y], [J[b].x, J[b].y]];
      return {
        rect: { x: r.x, y: r.y, w: r.width, h: r.height },
        paths: [
          seg("neck", "pelvis"), seg("pelvis", "kneeL"), seg("kneeL", "ankleL"), seg("ankleL", "footL"),
          seg("pelvis", "kneeR"), seg("kneeR", "ankleR"), seg("ankleR", "footR"),
          seg("chest", "elbowL"), seg("elbowL", "handL"),
          seg("chest", "elbowR"), seg("elbowR", "handR"),
          [[0.42, 0.14], [0.58, 0.14]], [[0.5, 0.06], [0.5, 0.22]],   // head blob
        ],
      };
    });
    const toClient = ([u, v]) => [rect.x + u * rect.w, rect.y + v * rect.h];
    for (const [a, b] of paths) {
      // several parallel passes so the big brush lays enough ink
      for (const off of [-0.015, 0, 0.015]) {
        const [ax, ay] = toClient([a[0] + off, a[1]]);
        const [bx, by] = toClient([b[0] + off, b[1]]);
        await page.mouse.move(ax, ay);
        await page.mouse.down();
        await page.mouse.move(bx, by, { steps: 8 });
        await page.mouse.up();
      }
    }
    const mouseGood = await submit();
    check("mouse-drawn figure accepted", mouseGood.accepted, mouseGood.reason);
    await resetDone();
  }

  // second good drawing so the moderation section always has a reject target
  await drawFigure();
  const good2 = await submit();
  check("second good drawing accepted", good2.accepted, good2.reason);
  await resetDone();

  // 5. oversize payload (direct API — the page can't produce one)
  const bigPng = "data:image/png;base64," + "A".repeat(140 * 1024);
  const over = await fetch(`${BASE}/api/submit`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: TOKEN, png: bigPng, palette: { primary: "#ff0000", secondary: "#00ff00", accent: "#0000ff" } }),
  });
  check("oversize payload → 413", over.status === 413, `status ${over.status}`);

  // 6. bad token
  const goodPng = await page.evaluate(() => {
    const out = document.createElement("canvas");
    out.width = out.height = 512;
    const og = out.getContext("2d");
    og.fillStyle = "#000"; og.fillRect(0, 0, 512, 512);
    og.drawImage(document.getElementById("ink"), 0, 0);
    return out.toDataURL("image/png");
  });
  const bad = await fetch(`${BASE}/api/submit`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "nope", png: goodPng, palette: { primary: "#ff0000", secondary: "#00ff00", accent: "#0000ff" } }),
  });
  check("bad token → 403", bad.status === 403, `status ${bad.status}`);

  // 7. rate limit: hammer until 429 (submissions so far also count)
  let got429 = false;
  for (let i = 0; i < 25 && !got429; i++) {
    const r = await fetch(`${BASE}/api/submit`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: TOKEN, png: goodPng, palette: { primary: "#ff0000", secondary: "#00ff00", accent: "#0000ff" } }),
    });
    if (r.status === 429) got429 = true;
  }
  check("rate limit trips 429", got429);

  // moderation: approve the first pending id → approved endpoints serve it
  const q1 = await (await fetch(`${BASE}/api/queue`)).json();
  check("submissions in pending", q1.pending.length >= 2, `pending=${q1.pending.length}`);
  const id = q1.pending[0];
  const mod = await fetch(`${BASE}/api/moderate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, verdict: "approve" }),
  });
  check("moderate approve ok", mod.ok);
  const apJson = await fetch(`${BASE}/api/approved/${id}.json`);
  const apPng = await fetch(`${BASE}/api/approved/${id}.png`);
  check("approved json+png served", apJson.ok && apPng.ok);
  const sidecar = apJson.ok ? await apJson.json() : {};
  // joint count follows the template (brief 14 enriched it to 15) — compare
  // against the service's own template, not a hardcoded number
  const tmpl = await (await fetch(`${BASE}/api/template`)).json();
  check("sidecar carries template joints + hue palette",
    Array.isArray(sidecar.joints) && sidecar.joints.length === (tmpl.joints?.length ?? -1) &&
    sidecar.joints.length >= 15 &&
    typeof sidecar.palette?.primary === "number");
  const q2 = await (await fetch(`${BASE}/api/queue`)).json();
  if (q2.pending.length) {
    await fetch(`${BASE}/api/moderate`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: q2.pending[0], verdict: "reject" }),
    });
    const q3 = await (await fetch(`${BASE}/api/queue`)).json();
    check("reject moves out of pending", !q3.pending.includes(q2.pending[0]) && q3.rejected.includes(q2.pending[0]));
  }
} catch (e) {
  failures.push(String(e));
  console.error("[e2e]", e);
} finally {
  await browser.close();
  svc.kill();
  await fs.rm(SPOOL, { recursive: true, force: true });
}

console.log(`VERIFY:${failures.length ? "FAIL" : "PASS"} audience-e2e checks=${failures.length ? failures.join(",") : "all"}`);
process.exitCode = failures.length ? 1 : 0;
