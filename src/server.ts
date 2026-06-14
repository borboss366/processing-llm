import "dotenv/config";
import { checkApiKey } from "./llm/anthropic-client.js";
import { startControllerServer } from "./controller/server.js";

try {
  checkApiKey();
} catch (err) {
  console.error(`[Error] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

await startControllerServer();
