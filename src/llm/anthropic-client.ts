import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

export const CODE_MODEL = "claude-opus-4-7";

export type Turn = {
  role: "user" | "assistant";
  content: string;
};

export async function callLLM(
  systemPrompt: string,
  turns: Turn[]
): Promise<string> {
  const response = await client.messages.create({
    model: CODE_MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: turns,
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  if (textBlock == null) throw new Error("No text block in Anthropic response");

  const cached = response.usage.cache_read_input_tokens ?? 0;
  if (cached > 0) {
    console.log(`[LLM] Cache hit: ${cached} tokens`);
  }

  return textBlock.text;
}

export function checkApiKey(): void {
  if (!process.env["ANTHROPIC_API_KEY"]) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set.\n" +
        "Add it to your .env file: ANTHROPIC_API_KEY=sk-ant-..."
    );
  }
}
