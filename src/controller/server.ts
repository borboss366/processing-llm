import express from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseFile } from "music-metadata";
import multer from "multer";
import { generateAndLaunch, refineAndLaunch, relaunchSession } from "../pipeline.js";
import { sendOsc, OSC_PORT } from "../osc/client.js";
import { loadSessions, saveSessions } from "../sessions/store.js";

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
