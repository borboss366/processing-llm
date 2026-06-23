import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync, mkdirSync, writeFileSync, copyFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseFile } from "music-metadata";
import multer from "multer";
import { generateAndLaunch, refineAndLaunch, relaunchSession } from "../pipeline.js";
import { sendOsc, OSC_PORT } from "../osc/client.js";
import { loadSessions, saveSessions } from "../sessions/store.js";
import { assembleSketch } from "../modules/assembler.js";
import { generateModule } from "../modules/qwen-generator.js";
import { ARCHETYPES, getArchetype, defaultPrefix } from "../modules/archetypes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const CONTROLLER_PORT = 3000;

export const MUSIC_DIR = path.resolve(
  process.cwd(),
  process.env["MUSIC_DIR"] ?? "music"
);

// ── State ──────────────────────────────────────────────────────────────────

const toggleState: Record<string, boolean> = {};
const paramState: Record<string, number> = {};

function resetEffects(effects: string[]): void {
  for (const key of Object.keys(toggleState)) delete toggleState[key];
  for (const e of effects) toggleState[e] = false;
}

function resetParams(params: Record<string, number>): void {
  for (const key of Object.keys(paramState)) delete paramState[key];
  Object.assign(paramState, params);
}

export const UPLOADS_DIR = path.resolve(process.cwd(), "assets/uploads");

const upload = multer({ dest: path.join(process.cwd(), "tmp_uploads") });

// ── App ────────────────────────────────────────────────────────────────────

export async function startControllerServer(): Promise<void> {
  const sessions = await loadSessions();
  console.log(`[Server] Loaded ${sessions.size} saved session(s)`);

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, "public")));

  // ── Music browser ──────────────────────────────────────────────────────

  app.get("/music", async (_req, res) => {
    try {
      const entries = await fs.readdir(MUSIC_DIR);
      const mp3s = entries.filter((f) => f.toLowerCase().endsWith(".mp3")).sort();
      res.json(mp3s);
    } catch {
      res.json([]);
    }
  });

  app.get("/music/metadata", async (req, res) => {
    const file = req.query["file"];
    if (typeof file !== "string") {
      res.status(400).json({ error: "file query param required" });
      return;
    }
    const filepath = path.join(MUSIC_DIR, path.basename(file));
    try {
      const meta = await parseFile(filepath, { duration: true });
      const pic = meta.common.picture?.[0];
      const cover = pic
        ? `data:${pic.format};base64,${Buffer.from(pic.data).toString("base64")}`
        : null;
      res.json({
        title: meta.common.title ?? null,
        artist: meta.common.artist ?? null,
        album: meta.common.album ?? null,
        year: meta.common.year ?? null,
        genre: meta.common.genre?.[0] ?? null,
        duration: meta.format.duration ?? null,
        cover,
      });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Sketch generation ──────────────────────────────────────────────────

  /**
   * POST /generate
   * Multipart body: description (text), mp3File? (text), liveInput? (text), image? (file)
   * Returns: { sessionId, file }
   */
  app.post("/generate", upload.single("image"), async (req, res) => {
    const { description, mp3File, liveInput, imageDescription } = req.body as {
      description?: string;
      mp3File?: string;
      liveInput?: string;
      imageDescription?: string;
    };
    if (!description?.trim()) {
      if (req.file) await fs.unlink(req.file.path).catch(() => {});
      res.status(400).json({ error: "description required" });
      return;
    }
    const isLive = liveInput === "true" || liveInput === "1";
    const mp3Path = !isLive && mp3File
      ? path.join(MUSIC_DIR, path.basename(mp3File))
      : undefined;
    const tempPath = req.file?.path;
    let imagePath: string | undefined;
    if (tempPath && req.file) {
      await fs.mkdir(UPLOADS_DIR, { recursive: true });
      const ext = path.extname(req.file.originalname) || ".png";
      imagePath = path.join(UPLOADS_DIR, `${randomUUID()}${ext}`);
      await fs.copyFile(tempPath, imagePath);
      await fs.unlink(tempPath).catch(() => {});
    }
    try {
      const result = await generateAndLaunch(description.trim(), mp3Path, isLive, imagePath, imageDescription?.trim() || undefined);
      const sessionId = randomUUID();
      sessions.set(sessionId, result.session);
      await saveSessions(sessions);
      resetEffects(result.session.effects);
      resetParams(result.session.params);
      res.json({ sessionId, file: result.sketch.file, effects: result.session.effects, params: result.session.params });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /refine
   * Body: { sessionId: string, modification: string }
   * Returns: { sessionId, file }
   */
  app.post("/refine", async (req, res) => {
    const { sessionId, modification } = req.body as {
      sessionId?: string;
      modification?: string;
    };
    if (!sessionId || !modification?.trim()) {
      res.status(400).json({ error: "sessionId and modification required" });
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    try {
      const result = await refineAndLaunch(session, modification.trim());
      sessions.set(sessionId, result.session);
      await saveSessions(sessions);
      resetEffects(result.session.effects);
      resetParams(result.session.params);
      res.json({ sessionId, file: result.sketch.file, effects: result.session.effects, params: result.session.params });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * POST /relaunch
   * Body: { sessionId: string }
   * Re-launches the sketch using the stored code — no LLM call.
   */
  app.post("/relaunch", async (req, res) => {
    const { sessionId } = req.body as { sessionId?: string };
    if (!sessionId) {
      res.status(400).json({ error: "sessionId required" });
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      res.status(404).json({ error: "session not found" });
      return;
    }
    try {
      const sketch = await relaunchSession(session);
      resetEffects(session.effects ?? []);
      resetParams(session.params ?? {});
      res.json({ sessionId, file: sketch.file, effects: session.effects ?? [], params: session.params ?? {} });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /**
   * GET /sessions
   * Returns list of active session IDs with descriptions.
   */
  app.get("/sessions", (_req, res) => {
    const list = Array.from(sessions.entries()).map(([id, s]) => ({
      sessionId: id,
      description: s.description,
      mp3Path: s.mp3Path ?? null,
      effects: s.effects ?? [],
      params: s.params ?? {},
    }));
    res.json(list);
  });

  // ── DJ toggles ─────────────────────────────────────────────────────────

  /** GET /state — current toggle states */
  app.get("/state", (_req, res) => {
    res.json(toggleState);
  });

  /** POST /toggle/:name — flip a toggle and push via OSC */
  app.post("/toggle/:name", (req, res) => {
    const { name } = req.params;
    toggleState[name] = !(toggleState[name] ?? false);
    sendOsc(`/${name}`, toggleState[name] ? 1 : 0);
    res.json(toggleState);
  });

  // ── DJ params ──────────────────────────────────────────────────────────

  /** GET /params — current param values */
  app.get("/params", (_req, res) => {
    res.json(paramState);
  });

  /** POST /param/:name — set a float param (0–1) and push via OSC */
  app.post("/param/:name", (req, res) => {
    const { name } = req.params;
    const value = Math.max(0, Math.min(1, parseFloat(req.body.value ?? 0)));
    paramState[name] = value;
    sendOsc(`/${name}`, value);
    res.json(paramState);
  });

  // ── Modules console ────────────────────────────────────────────────────

  type LoadedManifest = {
    moduleIds: string[];
    modules: Array<{ id: string; name: string; oscPrefix: string; description: string }>;
    oscPort: number;
  };
  let currentManifest: LoadedManifest | null = null;
  const moduleEnabled: Record<string, boolean> = {};

  const MODULES_DIR = path.resolve(process.cwd(), "modules");

  /** GET /modules — list ALL modules available on disk */
  app.get("/modules", async (_req, res) => {
    try {
      const entries = await fs.readdir(MODULES_DIR, { withFileTypes: true });
      const out: Array<{ id: string; name: string; description: string; oscPrefix: string }> = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name === "sandbox") continue;
        try {
          const raw = await fs.readFile(path.join(MODULES_DIR, entry.name, "module.json"), "utf8");
          const m = JSON.parse(raw);
          out.push({ id: m.id, name: m.name, description: m.description, oscPrefix: m.oscPrefix });
        } catch {}
      }
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** GET /modules/loaded — manifest of modules in the currently-running sketch */
  app.get("/modules/loaded", (_req, res) => {
    if (!currentManifest) { res.json({ moduleIds: [], modules: [], oscPort: 12000 }); return; }
    const withState = currentManifest.modules.map(m => ({
      ...m, enabled: moduleEnabled[m.id] ?? true,
    }));
    res.json({ ...currentManifest, modules: withState });
  });

  /** POST /modules/manifest — launcher posts the list of modules just assembled */
  app.post("/modules/manifest", (req, res) => {
    const m = req.body as LoadedManifest;
    if (!m?.moduleIds || !Array.isArray(m.moduleIds)) {
      res.status(400).json({ error: "moduleIds[] required" });
      return;
    }
    currentManifest = m;
    // Reset enabled state on a new launch
    for (const id of m.moduleIds) moduleEnabled[id] = true;
    res.json({ ok: true, loaded: m.moduleIds.length });
  });

  /** POST /modules/:id/enabled — body {enabled:bool}, sends /modules/<id>/enabled */
  app.post("/modules/:id/enabled", (req, res) => {
    const { id } = req.params;
    const enabled = !!req.body.enabled;
    moduleEnabled[id] = enabled;
    sendOsc(`/modules/${id}/enabled`, enabled ? 1 : 0);
    res.json({ id, enabled });
  });

  // ── Module generation + preview (sandbox) ─────────────────────────────
  const PROCESSING_BIN = "/Applications/Processing.app/Contents/MacOS/Processing";
  const PREVIEW_OSC_PORT = 12001;
  const SANDBOX_DIR = path.join(MODULES_DIR, "sandbox");
  let previewProc: ReturnType<typeof spawn> | null = null;

  /** GET /modules/sandbox — list modules in modules/sandbox/ */
  app.get("/modules/sandbox", async (_req, res) => {
    try {
      if (!existsSync(SANDBOX_DIR)) { res.json([]); return; }
      const dirs = (await fs.readdir(SANDBOX_DIR, { withFileTypes: true }))
        .filter(d => d.isDirectory());
      const out: Array<{ id: string; name: string; description: string }> = [];
      for (const d of dirs) {
        try {
          const raw = await fs.readFile(path.join(SANDBOX_DIR, d.name, "module.json"), "utf8");
          const m = JSON.parse(raw);
          out.push({ id: m.id, name: m.name, description: m.description });
        } catch {}
      }
      res.json(out);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /modules/generate { id, prompt, mode? } — runs qwen, saves to modules/sandbox/<id>/.
   *  mode "brief" runs a two-stage flow (expand → generate); "detailed" runs one stage as before. */
  app.post("/modules/generate", async (req, res) => {
    const { id, prompt, mode } = req.body as { id?: string; prompt?: string; mode?: "brief" | "detailed" };
    if (!id?.trim() || !prompt?.trim()) {
      res.status(400).json({ error: "id and prompt required" });
      return;
    }
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(id)) {
      res.status(400).json({ error: "id must be lowercase, kebab-case, start with a letter" });
      return;
    }
    try {
      const twoStage = mode === "brief";
      const result = await generateModule(id.trim(), prompt.trim(), { twoStage });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /modules/preview { id } — assembles ONLY this sandboxed module
   *  and launches it as a standalone Processing window on OSC port 12001. */
  app.post("/modules/preview", async (req, res) => {
    const { id } = req.body as { id?: string };
    if (!id?.trim()) { res.status(400).json({ error: "id required" }); return; }

    const moduleDir = path.join(SANDBOX_DIR, id);
    if (!existsSync(path.join(moduleDir, "module.json"))) {
      res.status(404).json({ error: `sandbox module '${id}' not found` });
      return;
    }

    try {
      const { code, manifest } = assembleSketch({
        moduleIds: [id],
        configs:   {},
        modulesDir: SANDBOX_DIR,
        liveInput: true,
        oscPort:   PREVIEW_OSC_PORT,
      });

      const sketchDir = path.join(process.cwd(), "sketches", "preview");
      mkdirSync(sketchDir, { recursive: true });
      writeFileSync(path.join(sketchDir, "preview.pde"), code);
      writeFileSync(path.join(sketchDir, "manifest.json"), JSON.stringify(manifest, null, 2));

      // Copy module assets, namespaced under data/<id>/
      const moduleAssets = path.join(moduleDir, "data");
      if (existsSync(moduleAssets)) {
        const dst = path.join(sketchDir, "data", id);
        mkdirSync(dst, { recursive: true });
        for (const f of readdirSync(moduleAssets)) {
          copyFileSync(path.join(moduleAssets, f), path.join(dst, f));
        }
      }

      // Kill any previous preview
      if (previewProc) {
        try { previewProc.kill("SIGKILL"); } catch {}
        previewProc = null;
      }

      // Launch
      const proc = spawn(PROCESSING_BIN, ["cli", `--sketch=${sketchDir}`, "--run"], {
        detached: true,
      });
      previewProc = proc;
      proc.on("close", () => { if (previewProc === proc) previewProc = null; });
      proc.unref();

      res.json({ ok: true, id, oscPort: PREVIEW_OSC_PORT, sketchDir });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /modules/promote/:id — move modules/sandbox/<id>/ → modules/<id>/ */
  app.post("/modules/promote/:id", (req, res) => {
    const id  = req.params.id;
    const src = path.join(SANDBOX_DIR, id);
    const dst = path.join(MODULES_DIR, id);
    if (!existsSync(src))  { res.status(404).json({ error: "sandbox module not found" }); return; }
    if (existsSync(dst))   { res.status(409).json({ error: `modules/${id} already exists — delete it first or rename in sandbox` }); return; }
    try {
      renameSync(src, dst);
      res.json({ ok: true, from: src, to: dst });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** GET /modules/archetypes — list available archetypes for the UI dropdown */
  app.get("/modules/archetypes", (_req, res) => {
    res.json(ARCHETYPES.map(a => ({
      id: a.id,
      name: a.name,
      description: a.description,
      fields: a.fields,
    })));
  });

  /** POST /modules/generate-archetype { archetypeId, id, inputs } — qwen with a pre-built archetype prompt */
  app.post("/modules/generate-archetype", async (req, res) => {
    const { archetypeId, id, inputs } = req.body as {
      archetypeId?: string;
      id?: string;
      inputs?: Record<string, string | number>;
    };
    if (!archetypeId?.trim() || !id?.trim() || !inputs) {
      res.status(400).json({ error: "archetypeId, id, and inputs required" });
      return;
    }
    const arch = getArchetype(archetypeId);
    if (!arch) { res.status(404).json({ error: `unknown archetype: ${archetypeId}` }); return; }
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(id)) {
      res.status(400).json({ error: "id must be lowercase, kebab-case, start with a letter" });
      return;
    }
    try {
      const prefix = defaultPrefix(id);
      const prompt = arch.buildPrompt(id, prefix, inputs);
      const result = await generateModule(id, prompt, { twoStage: false });
      res.json({ ...result, archetypeId, archetypePrompt: prompt });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** DELETE /modules/sandbox/:id — discard a sandboxed module */
  app.delete("/modules/sandbox/:id", (req, res) => {
    const id  = req.params.id;
    const dir = path.join(SANDBOX_DIR, id);
    if (!existsSync(dir)) { res.status(404).json({ error: "sandbox module not found" }); return; }
    try {
      rmSync(dir, { recursive: true, force: true });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // ──────────────────────────────────────────────────────────────────────

  app.listen(CONTROLLER_PORT, () => {
    console.log(`[Server] http://localhost:${CONTROLLER_PORT}`);
    console.log(`[Server] Music folder → ${MUSIC_DIR}`);
    console.log(`[OSC]    Sending to localhost:${OSC_PORT}`);
    console.log(`\nREST API:`);
    console.log(`  GET  /music`);
    console.log(`  GET  /music/metadata?file=<name>`);
    console.log(`  POST /generate          { description, mp3File? }`);
    console.log(`  POST /refine            { sessionId, modification }`);
    console.log(`  GET  /sessions`);
    console.log(`  GET  /state`);
    console.log(`  POST /toggle/:name`);
  });
}
