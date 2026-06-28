/**
 * VJ controller server — minimal backend for the two-window browser MVP.
 *
 * Responsibilities:
 *   - Serve generated p5 modules from web/app/loaded-modules/ at /loaded/*
 *   - Browser-modules REST endpoints: load / unload / trigger / enable /
 *     preset-next / preset-prev, with state replay on WS connect.
 *   - WebSocket bridge at /ws with browser-to-browser relay so render and
 *     controller windows can talk directly.
 *   - /osc — pure WS broadcast (modules consume it client-side).
 *   - Pad mapping persistence (/mappings GET/POST → .mappings.json).
 *   - Mood pipeline: /mood/classify (deterministic rules over window stats)
 *     and /mood/pick-preset (LLM ranks preset descriptions for a mood).
 */

import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CONTROLLER_PORT = 3000;

export async function startControllerServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Generated p5 modules — served as static .js, hot-imported by browsers.
  const LOADED_MODULES_DIR = path.resolve(process.cwd(), "web/app/loaded-modules");
  mkdirSync(LOADED_MODULES_DIR, { recursive: true });
  app.use("/loaded", express.static(LOADED_MODULES_DIR));

  // ── WebSocket bridge ──────────────────────────────────────────────────
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const browsers = new Set<WebSocket>();

  // Source of truth for which modules are loaded across all browsers.
  // Replayed to fresh connections so a page refresh doesn't lose state.
  const loadedModuleIds = new Set<string>();
  const browserModuleEnabled: Record<string, boolean> = {};

  const MAPPINGS_FILE = path.resolve(process.cwd(), ".mappings.json");

  wss.on("connection", async (ws) => {
    browsers.add(ws);
    ws.on("close", () => browsers.delete(ws));
    // Browser-to-browser relay. The ws lib delivers `raw` as a Buffer; force
    // .toString("utf8") so receivers get a TEXT frame and JSON.parse works.
    ws.on("message", (raw) => {
      const text = (raw as Buffer).toString("utf8");
      for (const other of browsers) {
        if (other !== ws && other.readyState === 1) other.send(text);
      }
    });
    ws.send(JSON.stringify({ type: "log", level: "info", text: "controller connected" }));
    for (const id of loadedModuleIds) {
      ws.send(JSON.stringify({ type: "module-load", id }));
    }
    try {
      const raw = await fs.readFile(MAPPINGS_FILE, "utf8");
      ws.send(JSON.stringify({ type: "mapping-update", mapping: JSON.parse(raw) }));
    } catch { /* no mapping yet, controller falls back to its default */ }
  });

  function wsBroadcast(msg: Record<string, unknown>): void {
    const text = JSON.stringify(msg);
    for (const ws of browsers) {
      if (ws.readyState === 1) ws.send(text);
    }
  }

  // ── /osc — pure WS broadcast (browser registry consumes /<prefix>/<param>) ─
  app.post("/osc", (req, res) => {
    const { address, value } = req.body as { address?: string; value?: unknown };
    if (typeof address !== "string" || !address.startsWith("/")) {
      res.status(400).json({ error: "address must start with '/'" });
      return;
    }
    let oscValue: number | string | boolean;
    if (typeof value === "number" || typeof value === "boolean") {
      oscValue = value;
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed === "") { res.status(400).json({ error: "value required" }); return; }
      const asNum = Number(trimmed);
      oscValue = (!Number.isNaN(asNum) && /^-?\d+(\.\d+)?$/.test(trimmed)) ? asNum : trimmed;
    } else {
      res.status(400).json({ error: "value must be number, boolean, or string" });
      return;
    }
    wsBroadcast({ type: "osc", address, value: oscValue });
    res.json({ ok: true, address, value: oscValue });
  });

  // ── Browser-module REST endpoints ─────────────────────────────────────
  app.get("/browser-modules", async (_req, res) => {
    try {
      const entries = await fs.readdir(LOADED_MODULES_DIR);
      res.json(entries.filter((f) => f.endsWith(".js")).map((f) => f.replace(/\.js$/, "")));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.post("/browser-modules/load", (req, res) => {
    const { id } = req.body as { id?: string };
    if (!id || !/^[a-z][a-z0-9-]{0,30}$/.test(id)) {
      res.status(400).json({ error: "id required (lowercase kebab-case)" });
      return;
    }
    loadedModuleIds.add(id);
    wsBroadcast({ type: "module-load", id });
    res.json({ ok: true, id, loaded: [...loadedModuleIds] });
  });

  app.post("/browser-modules/unload", (req, res) => {
    const { id } = req.body as { id?: string };
    if (!id) { res.status(400).json({ error: "id required" }); return; }
    loadedModuleIds.delete(id);
    wsBroadcast({ type: "module-unload", id });
    res.json({ ok: true, id });
  });

  app.get("/browser-modules/loaded", (_req, res) => {
    res.json([...loadedModuleIds]);
  });

  app.post("/browser-modules/trigger", (req, res) => {
    const { id, args } = req.body as { id?: string; args?: Record<string, unknown> };
    if (!id) { res.status(400).json({ error: "id required" }); return; }
    wsBroadcast({ type: "trigger", id, args: args ?? null });
    res.json({ ok: true, id });
  });

  app.post("/browser-modules/enable", (req, res) => {
    const { id, enabled } = req.body as { id?: string; enabled?: boolean };
    if (!id) { res.status(400).json({ error: "id required" }); return; }
    browserModuleEnabled[id] = !!enabled;
    wsBroadcast({ type: "module-enable", id, enabled: !!enabled });
    res.json({ ok: true, id, enabled: !!enabled });
  });

  app.get("/browser-modules/enabled-state", (_req, res) => {
    res.json(browserModuleEnabled);
  });

  app.post("/browser-modules/preset-next", (_req, res) => {
    wsBroadcast({ type: "preset-next" });
    res.json({ ok: true });
  });

  app.post("/browser-modules/preset-prev", (_req, res) => {
    wsBroadcast({ type: "preset-prev" });
    res.json({ ok: true });
  });

  // ── Mappings persistence ──────────────────────────────────────────────
  app.get("/mappings", async (_req, res) => {
    try {
      const raw = await fs.readFile(MAPPINGS_FILE, "utf8");
      res.json({ ok: true, mapping: JSON.parse(raw) });
    } catch (err: any) {
      if (err.code === "ENOENT") res.json({ ok: true, mapping: null });
      else res.status(500).json({ ok: false, error: String(err) });
    }
  });

  app.post("/mappings", async (req, res) => {
    const mapping = req.body;
    if (!mapping || typeof mapping !== "object" || !mapping.pads) {
      res.status(400).json({ ok: false, error: "body must have a `pads` object" });
      return;
    }
    try {
      await fs.writeFile(MAPPINGS_FILE, JSON.stringify(mapping, null, 2), "utf8");
      wsBroadcast({ type: "mapping-update", mapping });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // ── Mood classifier (deterministic rules over rich window stats) ──────
  const OLLAMA_URL = process.env["OLLAMA_HOST"]
    ? `http://${process.env["OLLAMA_HOST"]}/api/generate`
    : "http://localhost:11434/api/generate";
  const MOOD_CHOICES = ["hype", "mellow", "dark", "dreamy", "punchy", "chill"] as const;
  type Mood = typeof MOOD_CHOICES[number];
  type WindowStats = {
    mean_level: number; mean_bass: number; mean_mid: number; mean_treble: number;
    mean_centroid: number; mean_beatsPerSec: number;
    dynRange: number;
    rawPeak?: number;
  };

  function classifyMoodFromRules(f: WindowStats): { mood: Mood; rule: string } {
    const lvl  = f.mean_level;        // normalised [0,1]
    const bass = f.mean_bass;
    const mid  = f.mean_mid;
    const tre  = f.mean_treble;
    const bri  = f.mean_centroid;     // absolute brightness
    const bps  = f.mean_beatsPerSec;  // absolute rate
    const dyn  = f.dynRange;
    const rawPeak = f.rawPeak ?? 1;

    if (rawPeak < 0.05)
      return { mood: "chill",  rule: "true silence (rawPeak<0.05)" };
    if (bass > 0.6 && bri < 0.25 && tre < 0.30)
      return { mood: "dark",   rule: "heavy lows + dim + no treble" };
    if (bri > 0.45 && tre > 0.35 && bass < 0.45 && bps < 1.5)
      return { mood: "dreamy", rule: "bright + airy + soft lows" };
    if (bass > 0.6 && lvl > 0.45 && bps >= 1.5)
      return { mood: "hype",   rule: "loud bass + fast beats" };
    if (mid > 0.45 && dyn > 0.20 && lvl > 0.4)
      return { mood: "punchy", rule: "dynamic mid-heavy" };
    if (lvl < 0.3 && bps < 1.0)
      return { mood: "chill",  rule: "low energy + slow" };
    return { mood: "mellow",   rule: "fallback" };
  }

  app.post("/mood/classify", async (req, res) => {
    const b = req.body as Partial<WindowStats>;
    const features: WindowStats = {
      mean_level:       Number(b?.mean_level)       || 0,
      mean_bass:        Number(b?.mean_bass)        || 0,
      mean_mid:         Number(b?.mean_mid)         || 0,
      mean_treble:      Number(b?.mean_treble)      || 0,
      mean_centroid:    Number(b?.mean_centroid)    || 0,
      mean_beatsPerSec: Number(b?.mean_beatsPerSec) || 0,
      dynRange:         Number(b?.dynRange)         || 0,
      rawPeak:          Number(b?.rawPeak)          || 0,
    };
    const t0 = Date.now();
    const { mood, rule } = classifyMoodFromRules(features);
    res.json({ ok: true, mood, rule, features, ms: Date.now() - t0 });
  });

  // ── Preset descriptions + LLM-based mood→preset selection ────────────
  const PRESET_DESC_DIR = path.resolve(process.cwd(), "web/app/preset-descriptions");
  type PresetDesc = { name: string; description: string; slug: string };

  async function loadPresetDescriptions(): Promise<PresetDesc[]> {
    try {
      const files = (await fs.readdir(PRESET_DESC_DIR)).filter(f => f.endsWith(".md"));
      const out: PresetDesc[] = [];
      for (const f of files) {
        const raw = await fs.readFile(path.join(PRESET_DESC_DIR, f), "utf8");
        const m = /^---\s*\nname:\s*(.+?)\n---\s*\n([\s\S]+)$/.exec(raw);
        if (!m) continue;
        let name = m[1].trim();
        if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
          try { name = JSON.parse(name); } catch {}
        }
        out.push({ name, description: m[2].trim(), slug: f.replace(/\.md$/, "") });
      }
      return out;
    } catch {
      return [];
    }
  }

  app.get("/presets/descriptions", async (_req, res) => {
    const list = await loadPresetDescriptions();
    res.json({ ok: true, count: list.length, presets: list });
  });

  app.post("/mood/pick-preset", async (req, res) => {
    const mood = String(req.body?.mood ?? "").trim().toLowerCase();
    if (!mood) { res.status(400).json({ ok: false, error: "mood required" }); return; }

    const list = await loadPresetDescriptions();
    if (!list.length) {
      res.json({ ok: false, error: "no preset descriptions yet — run scripts/bootstrap-preset-descriptions.mjs" });
      return;
    }
    const items = list.slice(0, 150);
    const catalogue = items.map((p, i) => `${i + 1}. ${p.name} — ${p.description}`).join("\n");
    const prompt =
      `You are a VJ picking a music visualization for the current mood.\n\n` +
      `Available presets (numbered):\n${catalogue}\n\n` +
      `Current music mood: ${mood}\n\n` +
      `Pick the SINGLE preset number that best matches this mood. ` +
      `Output ONLY the number, nothing else.`;
    const t0 = Date.now();
    try {
      const r = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3:8b", prompt, stream: false, think: false, keep_alive: -1,
          options: { num_predict: 12, temperature: 0.4, stop: ["\n"] },
        }),
      });
      const j = await r.json() as { response?: string };
      const raw = (j.response ?? "").trim();
      const nm = /(\d+)/.exec(raw);
      const idx = nm ? Math.max(1, Math.min(items.length, parseInt(nm[1], 10))) - 1 : 0;
      const pick = items[idx];
      res.json({ ok: true, preset: pick.name, slug: pick.slug, description: pick.description, raw, ms: Date.now() - t0 });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err), ms: Date.now() - t0 });
    }
  });

  httpServer.listen(CONTROLLER_PORT, () => {
    console.log(`[Server] http://localhost:${CONTROLLER_PORT}`);
    console.log(`[Server] WS bridge → ws://localhost:${CONTROLLER_PORT}/ws`);
    console.log(`[Server] Loaded modules → ${LOADED_MODULES_DIR}`);
  });

  // Silence the unused-but-imported warning while letting Mood type carry
  void MOOD_CHOICES;
}
