import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { logger } from "../lib/logger.js";

const SYSTEM_PROMPT = `You are a worktree naming assistant. Generate a short name for a git worktree based on the task description.

Rules:
- Keep it under 20 characters if possible (shorter is better)
- Lowercase letters, numbers, and hyphens only
- No spaces or special characters
- Must be descriptive but concise
- Prefer compound words or abbreviations

Examples: auth-fix, new-api, dark-mode, refactor, bug-123, tests, user-settings

Respond with ONLY the worktree name, nothing else.`;

/**
 * Generate a worktree name using Claude Haiku.
 * For short prompts (<= 20 characters), sanitizes and uses directly.
 *
 * @param prompt - The user's task description
 * @param apiKey - Anthropic API key
 * @returns Generated worktree name
 */
export async function generateWorktreeName(
  prompt: string,
  apiKey: string
): Promise<string> {
  logger.info(`[worktree_rename] generateWorktreeName called with prompt="${prompt.slice(0, 50)}${prompt.length > 50 ? '...' : ''}", apiKey=${apiKey ? 'present' : 'missing'}`);

  const trimmedPrompt = prompt.trim();

  // For very short prompts, sanitize and use directly
  if (trimmedPrompt.length > 0 && trimmedPrompt.length <= 20) {
    const sanitized = sanitizeWorktreeName(trimmedPrompt);
    if (sanitized.length > 0) {
      logger.info(`[worktree_rename] Short prompt detected, using sanitized name directly: "${sanitized}"`);
      return sanitized;
    }
    logger.info(`[worktree_rename] Short prompt sanitized to empty string, falling through to LLM`);
  }

  // For longer prompts, use LLM to generate a concise name
  logger.info(`[worktree_rename] Calling Haiku to generate name for prompt: "${prompt.slice(0, 100)}${prompt.length > 100 ? '...' : ''}"`);
  const anthropic = createAnthropic({ apiKey });

  const { text } = await generateText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system: SYSTEM_PROMPT,
    prompt: `Generate a worktree name for this task: "${prompt.slice(0, 200)}"`,
    maxOutputTokens: 20,
  });

  const result = sanitizeWorktreeName(text);
  logger.info(`[worktree_rename] Haiku returned: "${text}", sanitized to: "${result}"`);
  return result;
}

/**
 * Sanitize a string into a valid worktree name.
 * - Lowercase only
 * - Alphanumeric and hyphens only
 * - No leading/trailing hyphens
 */
function sanitizeWorktreeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
