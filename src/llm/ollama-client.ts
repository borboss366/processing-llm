const OLLAMA_BASE = "http://localhost:11434";

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
