import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";

const client = new Anthropic();

const VISION_MODEL = "claude-haiku-4-5-20251001";

type SupportedMediaType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

function mediaType(imagePath: string): SupportedMediaType {
  const ext = extname(imagePath).toLowerCase();
  const map: Record<string, SupportedMediaType> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  return map[ext] ?? "image/png";
}

const VISION_PROMPT = `Analyse this image for use as the basis of a generative animation in Processing.
Describe in 3–5 sentences:
- What shapes, forms, or objects are present and how they relate spatially
- The mood, energy, and any implied motion or tension in the composition
- Qualities that should translate into animated behaviour (organic, mechanical, chaotic, rhythmic, fragile, explosive, etc.)

Be specific and visual. Focus entirely on what would inform an animation — not context or backstory.`;

export async function analyzeImage(imagePath: string): Promise<string> {
  const imageBytes = await readFile(imagePath);
  const base64Data = imageBytes.toString("base64");

  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType(imagePath), data: base64Data },
          },
          { type: "text", text: VISION_PROMPT },
        ],
      },
    ],
  });

  const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!text) throw new Error("No text in vision response");
  return text.text.trim();
}
