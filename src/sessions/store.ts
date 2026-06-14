import fs from "node:fs/promises";
import path from "node:path";
import type { Session } from "../pipeline.js";

const STORE_FILE = path.resolve(process.cwd(), ".sessions.json");

export async function loadSessions(): Promise<Map<string, Session>> {
  try {
    const raw = await fs.readFile(STORE_FILE, "utf8");
    const obj = JSON.parse(raw) as Record<string, Session>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

export async function saveSessions(sessions: Map<string, Session>): Promise<void> {
  await fs.writeFile(STORE_FILE, JSON.stringify(Object.fromEntries(sessions), null, 2), "utf8");
}
