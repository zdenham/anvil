# Sub-Plan 03: Worktree Naming Service

## Overview
Create an LLM-based worktree naming service, mirroring the existing thread naming service pattern.

## Dependencies
- None (can run in parallel with 01 and 02)

## Reference
Follow the pattern in `agents/src/services/thread-naming-service.ts`

## Steps

### Step 1: Create Worktree Naming Service

**New File:** `agents/src/services/worktree-naming-service.ts`

```typescript
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

const SYSTEM_PROMPT = `You are a worktree naming assistant. Generate a very short name for a git worktree based on the task description.

Rules:
- Maximum 10 characters total
- Lowercase letters, numbers, and hyphens only
- No spaces or special characters
- Must be descriptive but very concise
- Prefer compound words or abbreviations

Examples: auth-fix, new-api, dark-mode, refactor, bug-123, tests

Respond with ONLY the worktree name, nothing else.`;

/**
 * Generate a worktree name using Claude Haiku.
 * For short prompts (<= 10 characters), sanitizes and uses directly.
 *
 * @param prompt - The user's task description
 * @param apiKey - Anthropic API key
 * @returns Generated worktree name (max 10 characters)
 */
export async function generateWorktreeName(
  prompt: string,
  apiKey: string
): Promise<string> {
  const trimmedPrompt = prompt.trim();

  // For very short prompts, sanitize and use directly
  if (trimmedPrompt.length > 0 && trimmedPrompt.length <= 10) {
    const sanitized = sanitizeWorktreeName(trimmedPrompt);
    if (sanitized.length > 0) {
      return sanitized;
    }
  }

  // For longer prompts, use LLM to generate a concise name
  const anthropic = createAnthropic({ apiKey });

  const { text } = await generateText({
    model: anthropic("claude-3-5-haiku-latest"),
    system: SYSTEM_PROMPT,
    prompt: `Generate a worktree name for this task: "${prompt.slice(0, 200)}"`,
    maxOutputTokens: 20,
  });

  return sanitizeWorktreeName(text);
}

/**
 * Sanitize a string into a valid worktree name.
 * - Lowercase only
 * - Alphanumeric and hyphens only
 * - Max 10 characters
 * - No leading/trailing hyphens
 */
function sanitizeWorktreeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 10);
}
```

## Verification
1. TypeScript compiles without errors
2. Service exports `generateWorktreeName` function
3. Short prompts are sanitized directly without API call
4. Long prompts trigger LLM call
5. Output is always ≤10 characters and valid format

## Output
- `agents/src/services/worktree-naming-service.ts` - New service file
