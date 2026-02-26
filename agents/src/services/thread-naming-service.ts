import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

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

/**
 * Generate a thread name using Claude Haiku.
 * For short prompts (<= 25 characters), uses the prompt directly to save API costs.
 *
 * @param prompt - The user's initial prompt
 * @param apiKey - Anthropic API key
 * @returns Generated thread name (max 30 characters)
 */
export async function generateThreadName(
  prompt: string,
  apiKey: string
): Promise<string> {
  // For short prompts, use the prompt directly as the thread name
  // This saves API costs and improves latency
  const trimmedPrompt = prompt.trim();
  if (trimmedPrompt.length > 0 && trimmedPrompt.length <= 25) {
    return trimmedPrompt;
  }

  // For longer prompts, use LLM to generate a concise name
  const anthropic = createAnthropic({ apiKey });

  const { text } = await generateText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system: SYSTEM_PROMPT,
    prompt: `Generate a thread name for this user message:\n\n${prompt}`,
    maxOutputTokens: 50,
  });

  return text.trim();
}
