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
 *   - Session recording: /session/append (controller streams director decisions
 *     + operator actions to sessions/<id>.jsonl for offline replay).
 */

import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  DEFAULT_CATALOGUE_WINDOW,
  buildDirectorPrompt,
  callDirectorLLM,
  loadPresetDescriptions,
  parseDirectorResponse,
  prefilterCandidates,
  type DirectorMemory,
} from "../director/director.js";

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
  // All shared logic (prompt construction, prefilter, parsing, Ollama call)
  // lives in src/director/director.ts so tools/replay.mjs replays the exact
  // same pipeline offline.
  const PRESET_DESC_DIR = path.resolve(process.cwd(), "web/app/preset-descriptions");

  /** POST /director
   *  body: { current, prev?, recent?, max_complexity?, history?, catalogue_window? }
   *  → { description, preset, preset_slug, filter: {hue,sat,bright}, raw, ms }
   *  Fires when the controller detects the audio character changed. The model
   *  sees the last N picks (`history`, memory prompt) plus the current profile
   *  and the prefiltered preset catalogue, and picks ONE preset + a filter.
   *  On error returns ok:false and the controller keeps the current visuals. */
  app.post("/director", async (req, res) => {
    const {
      current,
      prev,
      recent: recentSlugs = [],
      max_complexity: maxComplexity,
      history = [],
      catalogue_window: catalogueWindow,
    } = req.body as {
      current: Record<string, number>;
      prev?: Record<string, number>;
      recent?: string[];
      max_complexity?: number;
      history?: DirectorMemory[];
      catalogue_window?: number;
    };
    if (!current) { res.status(400).json({ ok: false, error: "current features required" }); return; }

    const list = await loadPresetDescriptions(PRESET_DESC_DIR);
    if (!list.length) {
      res.json({ ok: false, error: "no preset descriptions yet — run scripts/visual-bootstrap.mjs" });
      return;
    }

    const items = prefilterCandidates(list, {
      recentSlugs,
      ...(typeof maxComplexity === "number" ? { maxComplexity } : {}),
      windowSize: catalogueWindow ?? DEFAULT_CATALOGUE_WINDOW,
    });
    const prompt = buildDirectorPrompt({ current, prev: prev ?? null, catalogue: items, history });

    const t0 = Date.now();
    try {
      const { raw, ms } = await callDirectorLLM(prompt);
      const { description, pick, filter } = parseDirectorResponse(raw, items);
      res.json({
        ok:          true,
        description,
        preset:      pick.name,
        preset_slug: pick.slug,
        filter,
        raw,
        ms,
      });
    } catch (err) {
      res.json({ ok: false, error: String(err), ms: Date.now() - t0 });
    }
  });

  app.get("/presets/descriptions", async (_req, res) => {
    const list = await loadPresetDescriptions(PRESET_DESC_DIR);
    res.json({ ok: true, count: list.length, presets: list });
  });

  // ── Session recording (controller appends events while Auto-Director runs) ─
  const SESSIONS_DIR = path.resolve(process.cwd(), "sessions");

  /** POST /session/append  body: { session: <file-safe id>, event: object }
   *  Appends one JSON line to sessions/<session>.jsonl. Fire-and-forget from
   *  the controller; replayed offline by tools/replay.mjs. */
  app.post("/session/append", async (req, res) => {
    const { session, event } = req.body as { session?: string; event?: Record<string, unknown> };
    if (!session || !/^[A-Za-z0-9._-]{1,80}$/.test(session)) {
      res.status(400).json({ ok: false, error: "session id required (file-safe chars only)" });
      return;
    }
    if (!event || typeof event !== "object") {
      res.status(400).json({ ok: false, error: "event object required" });
      return;
    }
    try {
      await fs.mkdir(SESSIONS_DIR, { recursive: true });
      await fs.appendFile(
        path.join(SESSIONS_DIR, `${session}.jsonl`),
        JSON.stringify(event) + "\n",
        "utf8",
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  httpServer.listen(CONTROLLER_PORT, () => {
    console.log(`[Server] http://localhost:${CONTROLLER_PORT}`);
    console.log(`[Server] WS bridge → ws://localhost:${CONTROLLER_PORT}/ws`);
    console.log(`[Server] Loaded modules → ${LOADED_MODULES_DIR}`);
  });
}
