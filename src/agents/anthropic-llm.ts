import Anthropic from "@anthropic-ai/sdk";
import { BaseLlm, LLMRegistry } from "@google/adk";
import type { LlmRequest, LlmResponse, BaseLlmConnection } from "@google/adk";
import type { Content } from "@google/genai";

const client = new Anthropic();

/**
 * ADK BaseLlm adapter that routes claude-* model strings to the Anthropic API.
 * Translates between ADK's Google GenAI content format and Anthropic's messages format.
 */
export class AnthropicLlm extends BaseLlm {
  static override supportedModels = [/^claude-.+/];

  async *generateContentAsync(
    llmRequest: LlmRequest,
    _stream = false
  ): AsyncGenerator<LlmResponse, void> {
    // System instruction from ADK config
    const systemParts = llmRequest.config?.systemInstruction as Content | undefined;
    const system = systemParts?.parts
      ?.map((p) => ("text" in p ? p.text ?? "" : ""))
      .join("\n")
      .trim() || undefined;

    // Convert Google GenAI Content[] → Anthropic MessageParam[]
    // ADK role "model" → Anthropic "assistant"
    const messages: Anthropic.MessageParam[] = llmRequest.contents
      .filter((c) => c.role === "user" || c.role === "model")
      .map((c) => ({
        role: (c.role === "model" ? "assistant" : "user") as "user" | "assistant",
        content: (c.parts ?? [])
          .filter((p) => "text" in p && p.text != null)
          .map((p) => ("text" in p ? p.text! : ""))
          .join(""),
      }))
      .filter((m) => m.content.length > 0);

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 8096,
      ...(system ? { system } : {}),
      messages,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    yield {
      content: { role: "model", parts: [{ text }] },
    };
  }

  // Live bidirectional connection — not used in this pipeline, stub required by abstract class
  async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error("AnthropicLlm does not support live connections");
  }
}

LLMRegistry.register(AnthropicLlm);
