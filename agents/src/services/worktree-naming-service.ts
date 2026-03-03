import { generateWithFallback, type FallbackResult } from "./llm-fallback.js";
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

export interface WorktreeNameResult {
  name: string;
  usedFallback: boolean;
}

/**
 * Generate a worktree name with automatic model fallback.
 * Tries Haiku first, falls back to Sonnet if Haiku fails.
 * For short prompts (<= 20 characters), sanitizes and uses directly.
 */
export async function generateWorktreeName(
  prompt: string,
  apiKey: string
): Promise<WorktreeNameResult> {
  logger.info(
    `[worktree_rename] generateWorktreeName called with prompt="${prompt.slice(0, 50)}${prompt.length > 50 ? "..." : ""}", apiKey=${apiKey ? "present" : "missing"}`
  );

  const trimmedPrompt = prompt.trim();

  if (trimmedPrompt.length > 0 && trimmedPrompt.length <= 20) {
    const sanitized = sanitizeWorktreeName(trimmedPrompt);
    if (sanitized.length > 0) {
      logger.info(
        `[worktree_rename] Short prompt detected, using sanitized name directly: "${sanitized}"`
      );
      return { name: sanitized, usedFallback: false };
    }
    logger.info(
      `[worktree_rename] Short prompt sanitized to empty string, falling through to LLM`
    );
  }

  logger.info(
    `[worktree_rename] Calling LLM to generate name for prompt: "${prompt.slice(0, 100)}${prompt.length > 100 ? "..." : ""}"`
  );

  const result: FallbackResult = await generateWithFallback({
    apiKey,
    system: SYSTEM_PROMPT,
    prompt: `Generate a worktree name for this task: "${prompt.slice(0, 200)}"`,
    maxOutputTokens: 20,
  });

  const name = sanitizeWorktreeName(result.text);
  logger.info(
    `[worktree_rename] LLM returned: "${result.text}", sanitized to: "${name}", usedFallback: ${result.usedFallback}`
  );
  return { name, usedFallback: result.usedFallback };
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
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
