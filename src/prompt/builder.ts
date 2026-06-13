export type PromptContext = {
  userDescription: string;
};

const SYSTEM_PROMPT = `You are an expert creative coder specialising in Processing (the Java-based creative coding environment).

Rules — follow ALL of them, no exceptions:
1. Output ONLY valid Processing source code. No markdown, no code fences, no explanations.
2. The sketch MUST include void setup() and void draw() functions.
3. Use only the Processing standard library — no import statements unless they are Processing built-ins (e.g. processing.sound, processing.video).
4. The sketch must be self-contained and runnable as-is.
5. Target window size: 800×600.
6. Make it visually compelling and responsive to the theme described.
7. Use colour, movement, and generative patterns where appropriate.`;

export function buildCodeGenPrompt(ctx: PromptContext): string {
  return `Create a Processing sketch for the following description:

"${ctx.userDescription}"

Output only the Processing source code. Nothing else.`;
}

export function buildRefinementPrompt(modification: string): string {
  return `Modify the sketch as follows: "${modification}"

Output only the complete modified Processing source code. Nothing else.`;
}

export { SYSTEM_PROMPT };
