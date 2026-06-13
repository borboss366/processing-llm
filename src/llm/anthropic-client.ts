import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

export const CODE_MODEL = "claude-opus-4-7";

export async function generateCode(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const response = await client.messages.create({
    model: CODE_MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: systemPrompt,
        // Cache the static system prompt — kicks in once it exceeds ~4096 tokens
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userPrompt }],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  if (textBlock == null) throw new Error("No text block in Anthropic response");

  const cached = response.usage.cache_read_input_tokens ?? 0;
  if (cached > 0) {
    console.log(`[LLM] Cache hit: ${cached} tokens served from cache`);
  }

  return textBlock.text;
}

export function checkApiKey(): void {
  if (!process.env["ANTHROPIC_API_KEY"]) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set.\n" +
        "Export it with: export ANTHROPIC_API_KEY=sk-ant-..."
    );
  }
}
