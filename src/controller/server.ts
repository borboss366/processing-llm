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
import { mkdirSync, watch } from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";
import {
  DEFAULT_CATALOGUE_WINDOW,
  buildDirectorPrompt,
  callDirectorLLM,
  getStableCatalogue,
  loadPresetDescriptions,
  parseDirectorResponse,
  prefilterCandidates,
  warmDirectorPrompt,
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

  // Local (gitignored) audio files, for the render window's dev-only
  // ?audio=file:/music/<name> input — reproducible validation without a mic.
  app.use("/music", express.static(path.resolve(process.cwd(), "music")));

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

  // ── Move workbench (brief 12): watch moves/*.json, hot-push on save ────
  // The watcher VALIDATES before broadcasting: a JSON parse error goes to
  // the controller log and no version bump reaches the creature, so it
  // keeps the last good table — never a dead creature.
  const MOVES_DIR = path.resolve(process.cwd(), "web/app/moves");
  let movesVersion = 0;
  const movesDebounce = new Map<string, NodeJS.Timeout>();
  try {
    watch(MOVES_DIR, (_event, filename) => {
      if (!filename || !filename.endsWith(".json")) return;
      const name = filename.slice(0, -5);
      clearTimeout(movesDebounce.get(name));
      movesDebounce.set(name, setTimeout(async () => {
        try {
          const raw = await fs.readFile(path.join(MOVES_DIR, filename), "utf8");
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed.keys) || !parsed.keys.length) throw new Error("no keys[]");
          movesVersion++;
          wsBroadcast({ type: "moves-changed", name, v: movesVersion });
          console.log(`[moves] ${name} hot-pushed (v${movesVersion})`);
        } catch (e) {
          wsBroadcast({ type: "moves-error", name, error: String((e as Error).message ?? e) });
          console.warn(`[moves] ${name} NOT pushed:`, e);
        }
      }, 150));
    });
  } catch { /* moves dir absent — workbench simply inert */ }

  // liveness probe (brief 13.2): tools that would evict the director's
  // KV cache refuse to run while browsers are connected, unless --force
  app.get("/status", (_req, res) => {
    res.json({ ok: true, browsers: browsers.size });
  });

  app.get("/shapes-list", async (_req, res) => {
    try {
      const files = await fs.readdir(path.resolve(process.cwd(), "web/app/shapes"));
      res.json({ ok: true, shapes: files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() });
    } catch {
      res.json({ ok: true, shapes: [] });
    }
  });

  app.get("/moves-list", async (_req, res) => {
    try {
      const files = await fs.readdir(MOVES_DIR);
      res.json({ ok: true, moves: files.filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort() });
    } catch {
      res.json({ ok: true, moves: [] });
    }
  });

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

  app.post("/browser-modules/exit", (req, res) => {
    const { id } = req.body as { id?: string };
    if (!id) { res.status(400).json({ error: "id required" }); return; }
    wsBroadcast({ type: "module-exit", id });
    res.json({ ok: true, id });
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
      variant,
    } = req.body as {
      current: Record<string, number>;
      prev?: Record<string, number>;
      recent?: string[];
      max_complexity?: number;
      history?: DirectorMemory[];
      catalogue_window?: number;
      variant?: "memory" | "no-memory";
    };
    if (!current) { res.status(400).json({ ok: false, error: "current features required" }); return; }

    const catalogue = await getStableCatalogue(PRESET_DESC_DIR);
    if (!catalogue.items.length) {
      res.json({ ok: false, error: "no preset descriptions yet — run scripts/visual-bootstrap.mjs" });
      return;
    }

    const candidateNumbers = prefilterCandidates(catalogue.items, {
      recentSlugs,
      ...(typeof maxComplexity === "number" ? { maxComplexity } : {}),
      windowSize: catalogueWindow ?? DEFAULT_CATALOGUE_WINDOW,
    });
    const prompt = buildDirectorPrompt({
      catalogueText: catalogue.text,
      candidateNumbers,
      current,
      prev: prev ?? null,
      history,
      ...(variant ? { variant } : {}),   // default: DEFAULT_PROMPT_VARIANT
    });

    const t0 = Date.now();
    try {
      const llm = await callDirectorLLM(prompt);
      const { description, hold, pick, filter, offList } =
        parseDirectorResponse(llm.raw, catalogue.items, candidateNumbers);
      res.json({
        ok:          true,
        hold,
        description,
        preset:      pick?.name ?? null,
        preset_slug: pick?.slug ?? null,
        filter,
        off_list:    offList,
        raw:         llm.raw,
        ms:          llm.ms,
        prompt_eval_count: llm.promptEvalCount,
        prompt_eval_ms:    llm.promptEvalMs,
        eval_count:        llm.evalCount,
        eval_ms:           llm.evalMs,
      });
    } catch (err) {
      res.json({ ok: false, error: String(err), ms: Date.now() - t0 });
    }
  });

  // Pre-pay prompt eval of the stable prefix (~6k tokens) so the first real
  // pick of a set is already warm. Fire-and-forget; fine if Ollama is down.
  warmDirectorPrompt(PRESET_DESC_DIR)
    .then((r) => console.log(`[Server] director prompt warmed: ${r.promptEvalCount} tokens in ${r.promptEvalMs} ms`))
    .catch(() => console.log("[Server] director warm-up skipped (Ollama unreachable)"));

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
