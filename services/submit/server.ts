/**
 * Audience submission service (brief 11) — the ONLY phone-facing process.
 *
 * Owns the phone drawing page (/e/<token>), submission validation, the
 * spool (disk, no DB) and the approve queue. Nothing from a phone ever
 * reaches the live render path except a server-re-encoded 256×256 mask +
 * template sidecar that passed BOTH validation and operator approval —
 * the render side only reads /api/approved/*.
 *
 *   npm run submit          (port SUBMIT_PORT, default 3210)
 *
 * Boot prints the event URL + token; /api/qr.png is the QR for the stage
 * overlay. Config via env: SUBMIT_PORT, SUBMIT_TOKEN (else random),
 * BASE_URL (else http://<lan-ip>:<port>), SPOOL_DIR (else ./spool).
 */

import express from "express";
import { z } from "zod";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import fs from "node:fs/promises";
import path from "node:path";

const require = createRequire(import.meta.url);
const UPNG = require("upng-js");
const QRCode = require("qrcode");

const PORT = Number(process.env.SUBMIT_PORT ?? 3210);
const TOKEN = process.env.SUBMIT_TOKEN ?? randomBytes(3).toString("hex");
const lanIp = Object.values(networkInterfaces()).flat()
  .find((i) => i && !i.internal && i.family === "IPv4")?.address ?? "localhost";
const BASE_URL = process.env.BASE_URL ?? `http://${lanIp}:${PORT}`;
const SPOOL = path.resolve(process.env.SPOOL_DIR ?? "spool", TOKEN);
const TEMPLATE_PATH = path.resolve("web/app/shapes/biped-front.json");

const MASK = 256;                 // re-encoded mask resolution
const MAX_PAYLOAD = 128 * 1024;   // brief: ≤128 KB
const RATE_PER_MIN = 20;

// ── template (single source of truth: the render side's shape file) ──────
type Joint = { name: string; x: number; y: number; [k: string]: unknown };
const template = JSON.parse(await fs.readFile(TEMPLATE_PATH, "utf8")) as {
  joints: Joint[]; parts: unknown[]; pinRadius: number;
  ground: number; eyes: unknown[]; archetype: string;
};

for (const d of ["pending", "approved", "rejected"]) {
  await fs.mkdir(path.join(SPOOL, d), { recursive: true });
}
const qrPng: Buffer = await QRCode.toBuffer(`${BASE_URL}/e/${TOKEN}`, {
  errorCorrectionLevel: "M", margin: 2, width: 512,
});

// ── validation ───────────────────────────────────────────────────────────
const SubmitSchema = z.object({
  token: z.string(),
  png: z.string().startsWith("data:image/png;base64,"),
  palette: z.object({
    primary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    secondary: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  }),
});

function hexToHue(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}

/** decode → downsample to 256×256 → threshold. White-ish opaque = ink. */
function toMask(pngBuf: Buffer): { mask: Uint8Array; err?: string } {
  let img;
  try { img = UPNG.decode(pngBuf); } catch { return { mask: new Uint8Array(0), err: "could not read the image — try again" }; }
  if (img.width < 64 || img.height < 64 || img.width > 2048 || img.height > 2048) {
    return { mask: new Uint8Array(0), err: "unexpected image size" };
  }
  const rgba = new Uint8Array(UPNG.toRGBA8(img)[0]);
  const mask = new Uint8Array(MASK * MASK);
  for (let my = 0; my < MASK; my++) {
    for (let mx = 0; mx < MASK; mx++) {
      // box-average the source cell, threshold at 50%
      const x0 = Math.floor(mx * img.width / MASK), x1 = Math.max(x0 + 1, Math.floor((mx + 1) * img.width / MASK));
      const y0 = Math.floor(my * img.height / MASK), y1 = Math.max(y0 + 1, Math.floor((my + 1) * img.height / MASK));
      let acc = 0, n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          const lum = 0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2];
          acc += rgba[i + 3] > 127 && lum > 127 ? 1 : 0;
          n++;
        }
      }
      mask[my * MASK + mx] = acc / n > 0.5 ? 1 : 0;
    }
  }
  return { mask };
}

function validateMask(mask: Uint8Array): string | null {
  let ink = 0;
  for (let i = 0; i < mask.length; i++) ink += mask[i];
  const cov = ink / mask.length;
  if (cov < 0.08) return "draw bigger — your figure fills too little of the canvas";
  if (cov > 0.6) return "too much ink — leave some background around the figure";

  // largest connected component ≥95% of ink (same invariant the creature
  // build enforces — disconnected pieces would be dropped and not move)
  const seen = new Uint8Array(mask.length);
  let largest = 0;
  const stack: number[] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    let area = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const q = stack.pop()!; area++;
      const qx = q % MASK, qy = (q / MASK) | 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = qx + dx, ny = qy + dy;
        if (nx < 0 || nx >= MASK || ny < 0 || ny >= MASK) continue;
        const ni = ny * MASK + nx;
        if (mask[ni] && !seen[ni]) { seen[ni] = 1; stack.push(ni); }
      }
    }
    largest = Math.max(largest, area);
  }
  if (largest < ink * 0.95) {
    return "your drawing has disconnected pieces — connect them or they won't move";
  }

  // every template joint inside ink; pin disc ≥60% covered — but only for
  // the joints that pin rigid clusters (paws, root/chest/head). The brief-14
  // mid-chain joints (shoulder, ankle) sit on naturally THIN limb sections:
  // requiring a fat disc there rejected legitimate thin-limbed drawings
  // (found live, gate G1 2026-08-31). Inside-ink still applies to all.
  const R = template.pinRadius * MASK;
  for (const J of template.joints) {
    const jx = J.x * MASK, jy = J.y * MASK;
    if (!mask[(jy | 0) * MASK + (jx | 0)]) {
      console.log(`[submit] reject: joint ${J.name} not inside ink at ${jx | 0},${jy | 0}`);
      return `keep your drawing over the ghost figure — the ${J.name} marker is outside your ink`;
    }
    if (J.role === "shoulder" || J.role === "ankle") continue;
    let inDisc = 0, covered = 0;
    for (let y = Math.max(0, (jy - R) | 0); y <= Math.min(MASK - 1, (jy + R) | 0); y++) {
      for (let x = Math.max(0, (jx - R) | 0); x <= Math.min(MASK - 1, (jx + R) | 0); x++) {
        if ((x - jx) ** 2 + (y - jy) ** 2 > R * R) continue;
        inDisc++;
        covered += mask[y * MASK + x];
      }
    }
    if (covered < inDisc * 0.6) {
      console.log(`[submit] reject: joint ${J.name} disc only ${(covered / inDisc).toFixed(2)} covered`);
      return `keep your drawing over the ghost figure — draw thicker around the ${J.name} marker`;
    }
  }
  return null;
}

function encodeMaskPng(mask: Uint8Array): Buffer {
  const rgba = new Uint8Array(MASK * MASK * 4);
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i] ? 255 : 0;
    rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = mask[i] ? 255 : 0;
  }
  return Buffer.from(UPNG.encode([rgba.buffer], MASK, MASK, 0));
}

// ── rate limiting (per IP, sliding minute) ───────────────────────────────
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > RATE_PER_MIN;
}

// ── spool helpers ────────────────────────────────────────────────────────
const idOk = (id: string) => /^[a-z0-9-]+$/.test(id);
async function listIds(dir: string): Promise<string[]> {
  const files = await fs.readdir(path.join(SPOOL, dir)).catch(() => []);
  return files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
}

// ── app ──────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "160kb" }));   // hard cap just above MAX_PAYLOAD

const phonePage = await fs.readFile(path.resolve("services/submit/phone.html"), "utf8");

app.get("/e/:token", (req, res) => {
  if (req.params.token !== TOKEN) { res.status(404).send("event not found"); return; }
  res.type("html").send(phonePage.replaceAll("__TOKEN__", TOKEN));
});

app.get("/api/template", (_req, res) => { res.json(template); });
app.get("/api/qr.png", (_req, res) => { res.type("png").send(qrPng); });

// operator info (loopback only): lets the controller open the draw page
// without the operator copying tokens around
app.get("/api/info", (req, res) => {
  if (!loopback(req.ip)) { res.status(403).json({ ok: false }); return; }
  res.json({ ok: true, token: TOKEN, port: PORT, baseUrl: BASE_URL, localUrl: `http://localhost:${PORT}/e/${TOKEN}` });
});

app.post("/api/submit", async (req, res) => {
  const ip = req.ip ?? "?";
  if (rateLimited(ip)) { res.status(429).json({ ok: false, reason: "too many submissions — wait a minute" }); return; }
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ ok: false, reason: "bad submission format" }); return; }
  const { token, png, palette } = parsed.data;
  if (token !== TOKEN) { res.status(403).json({ ok: false, reason: "this event has ended — rescan the QR" }); return; }
  const b64 = png.slice("data:image/png;base64,".length);
  if (b64.length > MAX_PAYLOAD) { res.status(413).json({ ok: false, reason: "drawing too large — try clearing and redrawing" }); return; }

  const { mask, err } = toMask(Buffer.from(b64, "base64"));
  if (err) { res.status(400).json({ ok: false, reason: err }); return; }
  const reason = validateMask(mask);
  if (reason) { res.status(422).json({ ok: false, reason }); return; }

  const id = `${Date.now().toString(36)}-${randomBytes(2).toString("hex")}`;
  const sidecar = {
    ...template,
    name: `audience-${id}`,
    palette: {
      primary: hexToHue(palette.primary),
      secondary: hexToHue(palette.secondary),
      accent: hexToHue(palette.accent),
    },
    receivedAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(SPOOL, "pending", `${id}.png`), encodeMaskPng(mask));
  await fs.writeFile(path.join(SPOOL, "pending", `${id}.json`), JSON.stringify(sidecar));
  console.log(`[submit] accepted ${id} from ${ip}`);
  res.json({ ok: true, id });
});

app.get("/api/queue", async (_req, res) => {
  res.json({
    pending: await listIds("pending"),
    approved: await listIds("approved"),
    rejected: await listIds("rejected"),
  });
});

app.get("/api/thumb/:id.png", async (req, res) => {
  const id = req.params.id;
  if (!idOk(id)) { res.status(400).end(); return; }
  for (const dir of ["pending", "approved", "rejected"]) {
    try {
      const buf = await fs.readFile(path.join(SPOOL, dir, `${id}.png`));
      res.type("png").send(buf); return;
    } catch { /* next dir */ }
  }
  res.status(404).end();
});

// operator only: the controller talks from the same box
const loopback = (ip: string | undefined) => !!ip && (/^(::1|::ffff:)?127\./.test(ip) || ip === "::1");
app.post("/api/moderate", async (req, res) => {
  if (!loopback(req.ip)) { res.status(403).json({ ok: false }); return; }
  const { id, verdict } = req.body ?? {};
  if (!idOk(String(id)) || !["approve", "reject"].includes(verdict)) {
    res.status(400).json({ ok: false }); return;
  }
  const dest = verdict === "approve" ? "approved" : "rejected";
  try {
    for (const ext of [".png", ".json"]) {
      await fs.rename(path.join(SPOOL, "pending", `${id}${ext}`), path.join(SPOOL, dest, `${id}${ext}`));
    }
    console.log(`[submit] ${verdict}d ${id}`);
    res.json({ ok: true });
  } catch {
    res.status(404).json({ ok: false });
  }
});

// the ONLY files the render side ever reads
app.get("/api/approved/:id.json", async (req, res) => {
  if (!idOk(req.params.id)) { res.status(400).end(); return; }
  try { res.type("json").send(await fs.readFile(path.join(SPOOL, "approved", `${req.params.id}.json`))); }
  catch { res.status(404).end(); }
});
app.get("/api/approved/:id.png", async (req, res) => {
  if (!idOk(req.params.id)) { res.status(400).end(); return; }
  try { res.type("png").send(await fs.readFile(path.join(SPOOL, "approved", `${req.params.id}.png`))); }
  catch { res.status(404).end(); }
});

app.listen(PORT, () => {
  console.log(`[submit] event token: ${TOKEN}`);
  console.log(`[submit] phone page:  ${BASE_URL}/e/${TOKEN}`);
  console.log(`[submit] local draw:  http://localhost:${PORT}/e/${TOKEN}`);
  console.log(`[submit] spool:       ${SPOOL}`);
});
