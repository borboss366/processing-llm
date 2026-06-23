import { Agent } from "undici";

// OLLAMA_HOST env var follows the standard ollama convention.
// Examples: OLLAMA_HOST=192.168.31.70:11434  or  OLLAMA_HOST=http://my-box:11434
// Default: localhost:11434.
const OLLAMA_BASE = (() => {
  const h = process.env["OLLAMA_HOST"];
  if (!h) return "http://localhost:11434";
  return /^https?:\/\//.test(h) ? h.replace(/\/+$/, "") : `http://${h}`;
})();

// undici's default headers/body timeouts are 5 min — too short for large-prompt
// prefill on a slow remote machine. Bump to 30 min and disable keep-alive idle
// reaping so long requests don't get cut.
const OLLAMA_DISPATCHER = new Agent({
  headersTimeout: 30 * 60 * 1000,
  bodyTimeout:    30 * 60 * 1000,
  connect:        { timeout: 10 * 1000 },
  keepAliveTimeout: 60 * 1000,
});

export type OllamaMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type OllamaChatRequest = {
  model: string;
  messages: OllamaMessage[];
  stream: false;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
};

type OllamaChatResponse = {
  message: OllamaMessage;
  done: boolean;
};

export async function chat(
  model: string,
  messages: OllamaMessage[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<string> {
  const body: OllamaChatRequest = {
    model,
    messages,
    stream: false,
    options: {
      temperature: options.temperature ?? 0.7,
      num_predict: options.maxTokens ?? 4096,
    },
  };

  const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    // @ts-expect-error — undici dispatcher is supported by node fetch but not in DOM lib typings
    dispatcher: OLLAMA_DISPATCHER,
  });

  if (!response.ok) {
    throw new Error(
      `Ollama error ${response.status}: ${await response.text()}`
    );
  }

  const data = (await response.json()) as OllamaChatResponse;
  return data.message.content;
}

export async function listModels(): Promise<string[]> {
  const response = await fetch(`${OLLAMA_BASE}/api/tags`);
  if (!response.ok) throw new Error("Failed to list Ollama models");
  const data = (await response.json()) as { models: Array<{ name: string }> };
  return data.models.map((m) => m.name);
}

// ── Single-prompt generate (qwen module-author flow uses this) ───────────────

export type OllamaGenerateOptions = {
  temperature?: number;
  top_p?: number;
  min_p?: number;
  top_k?: number;
  repeat_penalty?: number;
  num_ctx?: number;
  num_predict?: number;
};

export type OllamaGenerateResult = {
  response: string;
  thinking?: string;
  done: boolean;
  done_reason: string;
  total_duration: number;     // nanoseconds
  eval_count: number;
  eval_duration: number;
  prompt_eval_count: number;
};

export async function generate(
  model: string,
  prompt: string,
  opts: { think?: boolean; options?: OllamaGenerateOptions } = {},
): Promise<OllamaGenerateResult> {
  const body = JSON.stringify({
    model,
    prompt,
    stream: false,
    think: opts.think ?? false,
    options: opts.options ?? {},
  });
  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    // @ts-expect-error — undici dispatcher is supported by node fetch but not in DOM lib typings
    dispatcher: OLLAMA_DISPATCHER,
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}: ${await res.text()}`);
  return res.json() as Promise<OllamaGenerateResult>;
}
