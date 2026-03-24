/**
 * Shared worktree naming logic.
 * Importable by both agents/ (SDK threads) and sidecar/ (TUI threads).
 */

import { generateWithFallback } from "./llm-fallback.js";

const SYSTEM_PROMPT = `You are a worktree naming assistant. Generate a short name for a git worktree based on the task description.

Rules:
- Keep it under 20 characters if possible (shorter is better)
- Lowercase letters, numbers, and hyphens only
- No spaces or special characters
- Must be descriptive but concise
- Prefer compound words or abbreviations

Examples: auth-fix, new-api, dark-mode, refactor, bug-123, tests, user-settings

Respond with ONLY the worktree name, nothing else.`;

/** Short-prompt threshold — prompts at or below this length are sanitized directly. */
const SHORT_PROMPT_THRESHOLD = 20;

export interface WorktreeNameResult {
  name: string;
  usedFallback: boolean;
}

/**
 * Sanitize a string into a valid worktree name.
 * - Lowercase only
 * - Alphanumeric and hyphens only
 * - No leading/trailing hyphens
 */
export function sanitizeWorktreeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Generate a worktree name with automatic model fallback.
 * Tries Haiku first, falls back to Sonnet if Haiku fails.
 * For short prompts (<= 20 characters), sanitizes and uses directly.
 */
export async function generateWorktreeName(
  prompt: string,
  apiKey: string,
): Promise<WorktreeNameResult> {
  const trimmedPrompt = prompt.trim();

  if (trimmedPrompt.length > 0 && trimmedPrompt.length <= SHORT_PROMPT_THRESHOLD) {
    const sanitized = sanitizeWorktreeName(trimmedPrompt);
    if (sanitized.length > 0) {
      return { name: sanitized, usedFallback: false };
    }
  }

  const result = await generateWithFallback({
    apiKey,
    system: SYSTEM_PROMPT,
    prompt: `Generate a worktree name for this task: "${prompt.slice(0, 200)}"`,
    maxOutputTokens: 20,
  });

  return { name: sanitizeWorktreeName(result.text), usedFallback: result.usedFallback };
}
