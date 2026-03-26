/**
 * Shared thread naming logic.
 * Importable by both agents/ (SDK threads) and sidecar/ (TUI threads).
 */

import { generateWithFallback, type LlmCaller } from "./llm-fallback.js";

const SYSTEM_PROMPT = `You are a thread naming assistant. Generate a short name for a conversation thread based on the user's initial message.

Rules:
- Maximum 30 characters
- Use the user's actual words as much as possible - don't abstract or summarize
- Extract the most distinctive/memorable phrase from their message
- Keep their original phrasing and word choice
- lowercase is fine, match the user's style
- No quotes or special characters
- NEVER use kebab-case (no-dashes-between-words) — always use natural spaces
- If the message is a question, preserve key question words
- Prefer specific details over generic descriptions
- If the message is vague, find concrete nouns (file names, features, components) and use those instead

Good examples:
- "Can you help me fix the login bug?" → "fix the login bug"
- "What's the best way to implement caching?" → "implement caching"
- "I need to refactor the auth system" → "refactor the auth system"
- "Implement this plan for credit billing" → "implement credit billing"
- "Work on the thread naming improvements" → "thread naming improvements"

Bad examples (NEVER do these):
- "implement this plan" — too generic, no distinguishing info
- "fix-the-login-bug" — never use kebab-case

Respond with ONLY the thread name, nothing else.`;

/** Short-prompt threshold — prompts at or below this length are used directly. */
const SHORT_PROMPT_THRESHOLD = 25;

export interface ThreadNameResult {
  name: string;
  usedFallback: boolean;
}

/**
 * Generate a thread name with automatic model fallback.
 * Tries Haiku first, falls back to Sonnet if Haiku fails.
 * For short prompts (<= 25 characters), uses the prompt directly to save API costs.
 *
 * @param prompt - The user's initial message.
 * @param caller - LLM caller function provided by the consumer.
 */
export async function generateThreadName(
  prompt: string,
  caller: LlmCaller,
): Promise<ThreadNameResult> {
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length > 0 && trimmedPrompt.length <= SHORT_PROMPT_THRESHOLD) {
    return { name: trimmedPrompt, usedFallback: false };
  }

  const result = await generateWithFallback({
    system: SYSTEM_PROMPT,
    prompt: `Generate a thread name for this user message:\n\n${prompt}`,
    maxOutputTokens: 50,
  }, caller);

  return { name: result.text.trim(), usedFallback: result.usedFallback };
}
