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
 *   - Director: /director (LLM picks preset + CSS filter from feature profile).
 *   - Preset catalogue: /presets/descriptions (lists the .md description set).
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

  // ── Director (qwen3:8b picks preset + CSS filter from feature profile) ─
  const OLLAMA_URL = process.env["OLLAMA_HOST"]
    ? `http://${process.env["OLLAMA_HOST"]}/api/generate`
    : "http://localhost:11434/api/generate";

  /** POST /director  body: { current: WindowStats, prev?: WindowStats }
   *  → { description, preset: <name>, filter: {hue,sat,bright}, raw, ms }
   *  Fires when the controller detects the audio character changed significantly.
   *  qwen3:8b reads current (and optionally previous) feature profile + the
   *  preset description catalogue, then picks ONE preset and a colour filter.
   *  Returns a one-sentence description of what changed. On error returns a
   *  null preset and the controller keeps the current visualisation. */
  app.post("/director", async (req, res) => {
    const {
      current,
      prev,
      recent: recentSlugs = [],
      max_complexity: maxComplexity,
    } = req.body as {
      current: Record<string, number>;
      prev?: Record<string, number>;
      recent?: string[];
      max_complexity?: number;
    };
    if (!current) { res.status(400).json({ ok: false, error: "current features required" }); return; }

    const list = await loadPresetDescriptions();
    if (!list.length) {
      res.json({ ok: false, error: "no preset descriptions yet — run scripts/visual-bootstrap.mjs" });
      return;
    }

    // Prefilter:
    //   - drop any preset we just played (recency = anti-repeat)
    //   - drop any preset whose complexity exceeds the operator's max
    const recentSet = new Set(recentSlugs);
    let candidates = list.filter(p => {
      if (recentSet.has(p.slug)) return false;
      if (typeof maxComplexity === "number" && typeof p.tags.complexity === "number") {
        if (p.tags.complexity > maxComplexity) return false;
      }
      return true;
    });
    // Always keep ≥1 candidate — if recency or complexity excluded everything,
    // fall back to the full list so the director still picks something.
    if (!candidates.length) candidates = list;

    // Shuffle so each call sees a fresh window — without this, alphabetical
    // readdir order meant the prompt only ever contained the first N presets.
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }

    // Cap at 60 entries to keep the LLM prompt fast (~3-5s warm).
    const items = candidates.slice(0, 60);
    const catalogue = items.map((p, i) => {
      const t = p.tags;
      const tagStr = [
        t.complexity != null ? `c${t.complexity}` : null,
        t.energy, t.density, t.brightness, t.motion,
      ].filter(Boolean).join(' ');
      return `${i + 1}. [${tagStr}] ${p.name} — ${p.description}`;
    }).join("\n");

    function profileLine(f: Record<string, number>): string {
      const g = (k: string) => (typeof f[k] === "number" ? f[k].toFixed(2) : "0.00");
      const bpm = Math.round(Number(f.mean_bpm) || 0);
      return (
        `level=${g("mean_level")} dyn=${g("dynRange")} bpm=${bpm} bps=${g("mean_beatsPerSec")} ` +
        `bri=${g("mean_centroid")} roll=${g("mean_rolloff")} flat=${g("mean_flatness")} crest=${g("mean_crest")} flux=${g("mean_flux")} ` +
        `bands sub=${g("mean_b_sub")} kick=${g("mean_b_kick")} low=${g("mean_b_low")} ` +
        `lowMid=${g("mean_b_lowMid")} mid=${g("mean_b_mid")} upMid=${g("mean_b_upperMid")} ` +
        `pres=${g("mean_b_presence")} air=${g("mean_b_air")}`
      );
    }

    const prompt =
      `You are a VJ director for a live music set. The audio character just changed.\n\n` +
      `Available butterchurn presets (numbered):\n${catalogue}\n\n` +
      (prev
        ? `Previous section: ${profileLine(prev)}\n`
        : `(No previous section — this is the start of the set.)\n`) +
      `Current section:  ${profileLine(current)}\n\n` +
      `Pick a visualisation that fits the CURRENT section, and a colour filter for it.\n` +
      `Filter parameters:\n` +
      `  hue    : -180..180 degrees (hue rotation; 0 = no shift)\n` +
      `  sat    : 0..2     (saturation multiplier; 1 = unchanged)\n` +
      `  bright : 0.5..1.5 (brightness multiplier; 1 = unchanged)\n\n` +
      `Output one-line JSON only:\n` +
      `{"description":"<one sentence, ≤15 words, on what the new section sounds like>",` +
      `"preset":<number>,` +
      `"filter":{"hue":<deg>,"sat":<num>,"bright":<num>}}`;

    const t0 = Date.now();
    try {
      const r = await fetch(OLLAMA_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen3:8b", prompt, stream: false, think: false, keep_alive: -1,
          options: { num_predict: 200, temperature: 0.5, stop: ["\n\n"] },
        }),
      });
      const j = await r.json() as { response?: string };
      const raw = (j.response ?? "").trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("no JSON found in response");
      const parsed = JSON.parse(jsonMatch[0]);

      const idx = Math.max(1, Math.min(items.length, parseInt(String(parsed.preset), 10) || 1)) - 1;
      const pick = items[idx];                       // filtered list
      const filter = parsed.filter ?? {};
      const safe = (n: number, lo: number, hi: number, fallback: number) => {
        const v = Number(n);
        if (!Number.isFinite(v)) return fallback;
        return Math.max(lo, Math.min(hi, v));
      };
      const cleanFilter = {
        hue:    safe(filter.hue,    -180, 180, 0),
        sat:    safe(filter.sat,    0,    2,   1),
        bright: safe(filter.bright, 0.5,  1.5, 1),
      };
      res.json({
        ok:          true,
        description: String(parsed.description ?? "").slice(0, 200),
        preset:      pick.name,
        preset_slug: pick.slug,
        filter:      cleanFilter,
        raw,
        ms:          Date.now() - t0,
      });
    } catch (err) {
      res.json({ ok: false, error: String(err), ms: Date.now() - t0 });
    }
  });

  // ── Preset descriptions (loaded fresh on each call so adding/editing
  //    .md files in web/app/preset-descriptions/ takes effect immediately) ─
  const PRESET_DESC_DIR = path.resolve(process.cwd(), "web/app/preset-descriptions");
  type PresetDesc = {
    name: string; description: string; slug: string; tags: PresetTags;
  };

  type PresetTags = {
    motion?: string; density?: string; brightness?: string; palette?: string;
    energy?: string; geometry?: string; complexity?: number; colors?: string[];
  };

  function parseTagsFromFrontmatter(fm: string): PresetTags {
    const tags: PresetTags = {};
    for (const k of ['motion', 'density', 'brightness', 'palette', 'energy', 'geometry'] as const) {
      const m = new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(fm);
      if (m) tags[k] = m[1].trim();
    }
    const cm = /^complexity:\s*([1-5])/m.exec(fm);
    if (cm) tags.complexity = parseInt(cm[1], 10);
    const colm = /^colors:\s*\[(.+)\]/m.exec(fm);
    if (colm) {
      tags.colors = colm[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    return tags;
  }

  async function loadPresetDescriptions(): Promise<PresetDesc[]> {
    try {
      const files = (await fs.readdir(PRESET_DESC_DIR)).filter(f => f.endsWith(".md"));
      const out: PresetDesc[] = [];
      for (const f of files) {
        const raw = await fs.readFile(path.join(PRESET_DESC_DIR, f), "utf8");
        const m = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]+)$/.exec(raw);
        if (!m) continue;
        const nm = /^name:\s*(.+)$/m.exec(m[1]);
        if (!nm) continue;
        let name = nm[1].trim();
        if ((name.startsWith('"') && name.endsWith('"')) || (name.startsWith("'") && name.endsWith("'"))) {
          try { name = JSON.parse(name); } catch {}
        }
        out.push({
          name,
          description: m[2].trim(),
          slug: f.replace(/\.md$/, ""),
          tags: parseTagsFromFrontmatter(m[1]),
        });
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

  httpServer.listen(CONTROLLER_PORT, () => {
    console.log(`[Server] http://localhost:${CONTROLLER_PORT}`);
    console.log(`[Server] WS bridge → ws://localhost:${CONTROLLER_PORT}/ws`);
    console.log(`[Server] Loaded modules → ${LOADED_MODULES_DIR}`);
  });
}
