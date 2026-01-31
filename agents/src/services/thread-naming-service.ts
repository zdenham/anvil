import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

const SYSTEM_PROMPT = `You are a thread naming assistant. Generate a short name for a conversation thread based on the user's initial message.

Rules:
- Maximum 30 characters
- Use the user's actual words as much as possible - don't abstract or summarize
- Extract the most distinctive/memorable phrase from their message
- Keep their original phrasing and word choice
- Lowercase is fine, match the user's style
- No quotes or special characters
- If the message is a question, preserve key question words
- Prefer specific details over generic descriptions

Examples:
- "Can you help me fix the login bug?" → "fix the login bug"
- "What's the best way to implement caching?" → "implement caching"
- "I need to refactor the auth system" → "refactor the auth system"

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
    model: anthropic("claude-3-5-haiku-latest"),
    system: SYSTEM_PROMPT,
    prompt: `Generate a thread name for this user message:\n\n${prompt}`,
    maxOutputTokens: 50,
  });

  // Ensure max 30 characters and clean up
  return text.trim().slice(0, 30);
}
