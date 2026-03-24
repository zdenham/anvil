# Random Worktree Naming with Smart Rename

## Overview

When a worktree is created, it should receive a random "real-sounding" name (max 10 characters) generated using a library. When the first thread is created in that worktree, the system should automatically rename the worktree using an LLM-based approach similar to thread naming.

## Current State

### Worktree Creation
- **Location:** `src-tauri/src/worktree_commands.rs` (Rust backend)
- **Client:** `src/entities/worktrees/service.ts` (TypeScript)
- Worktrees currently require a user-provided name
- Name validation: alphanumeric, hyphens, underscores only (`/^[a-zA-Z0-9_-]+$/`)
- Stored in `~/.anvil/repositories/{slug}/settings.json`

### Thread Naming
- **Service:** `agents/src/services/thread-naming-service.ts`
- Uses Claude Haiku via Vercel AI SDK
- Generates concise names (max 30 chars) based on prompt content
- Runs async (fire-and-forget) during thread creation
- Emits `THREAD_NAME_GENERATED` event when complete

## Implementation Plan

### Step 1: Add Name Generation Library

**File:** `package.json` (root)

Add a library for generating random human-friendly names. Options:
- `unique-names-generator` - Popular, configurable, has short word dictionaries
- `human-id` - Simple, generates readable IDs

**Recommendation:** Use `unique-names-generator` for its flexibility and short-word dictionaries.

```bash
pnpm add unique-names-generator
```

### Step 2: Create Random Name Utility

**New File:** `src/lib/random-name.ts`

```typescript
import { uniqueNamesGenerator, adjectives, colors, animals } from 'unique-names-generator';

export function generateRandomWorktreeName(): string {
  // Use short dictionaries to stay under 10 chars
  // Example outputs: "red-fox", "blue-owl", "swift-cat"
  return uniqueNamesGenerator({
    dictionaries: [colors, animals],
    separator: '-',
    length: 2,
    style: 'lowerCase',
  }).slice(0, 10);
}
```

Note: May need custom short-word dictionaries to guarantee ≤10 chars. Test and adjust.

### Step 3: Update Worktree Creation UI

**Files to modify:**
- Wherever the "create worktree" action is triggered
- Look for the UI component that currently prompts for a worktree name

**Changes:**
1. Remove the name input requirement (or make it optional with auto-generation default)
2. Call `generateRandomWorktreeName()` to provide the initial name
3. Pass generated name to `worktreeService.create(repoName, generatedName)`

### Step 4: Add Worktree Naming Service

**New File:** `agents/src/services/worktree-naming-service.ts`

Similar to `thread-naming-service.ts`:

```typescript
import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

export async function generateWorktreeName(
  prompt: string,
  apiKey: string
): Promise<string> {
  // Short prompts: extract meaningful name directly
  if (prompt.length <= 20) {
    return sanitizeWorktreeName(prompt);
  }

  const anthropic = createAnthropic({ apiKey });

  const { text } = await generateText({
    model: anthropic("claude-3-5-haiku-latest"),
    maxTokens: 20,
    system: `Generate a very short worktree name (max 10 characters) that describes the task.
Rules:
- Maximum 10 characters total
- Lowercase letters, numbers, hyphens only
- No spaces or special characters
- Must be descriptive but very concise
- Prefer compound words or abbreviations
Examples: auth-fix, new-api, dark-mode, refactor`,
    prompt: `Create a short worktree name for this task: "${prompt.slice(0, 200)}"`,
  });

  return sanitizeWorktreeName(text);
}

function sanitizeWorktreeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 10);
}
```

### Step 5: Add Worktree Rename Event

**File:** `core/types/events.ts`

Add new event type:

```typescript
WORKTREE_NAME_GENERATED: "worktree:name:generated",
```

Add payload type:

```typescript
[EventName.WORKTREE_NAME_GENERATED]: {
  worktreeId: string;
  repoId: string;
  name: string;
}
```

**File:** `agents/src/lib/events.ts`

Add event emitter:

```typescript
worktreeNameGenerated: (worktreeId: string, repoId: string, name: string) =>
  emitEvent(EventName.WORKTREE_NAME_GENERATED, { worktreeId, repoId, name })
```

### Step 6: Integrate Worktree Renaming into Thread Creation

**File:** `agents/src/runners/simple-runner-strategy.ts`

Modify the runner to detect first thread in worktree and trigger worktree renaming:

```typescript
private async initiateWorktreeNaming(
  worktreeId: string,
  repoId: string,
  prompt: string
): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return;

  try {
    const newName = await generateWorktreeName(prompt, apiKey);

    // Emit event for frontend to handle the rename
    events.worktreeNameGenerated(worktreeId, repoId, newName);
  } catch (error) {
    // Non-blocking - log and continue
    console.error("Failed to generate worktree name:", error);
  }
}
```

**Detection Logic:**
- Check if this is the first thread in the worktree
- Could track via metadata or check thread count for worktreeId
- Only trigger renaming for worktrees with auto-generated names

### Step 7: Handle Worktree Rename Event in Frontend

**File:** `src/lib/event-bridge.ts`

Add listener for `WORKTREE_NAME_GENERATED`:

```typescript
case EventName.WORKTREE_NAME_GENERATED: {
  const { worktreeId, repoId, name } = payload;
  // Call worktree rename via Tauri
  await worktreeService.rename(repoId, worktreeId, name);
  break;
}
```

**Note:** The existing `worktree_rename` Tauri command handles the metadata update. Verify it handles name conflicts gracefully.

### Step 8: Handle Name Conflicts

**File:** `src-tauri/src/worktree_commands.rs` or `src/lib/random-name.ts`

Ensure uniqueness:
1. When generating random names: check existing worktree names, append suffix if conflict
2. When LLM generates name: same conflict resolution

```typescript
export function generateUniqueWorktreeName(existingNames: Set<string>): string {
  let name = generateRandomWorktreeName();
  let suffix = 1;

  while (existingNames.has(name)) {
    const base = name.slice(0, 7); // Leave room for suffix
    name = `${base}-${suffix}`;
    suffix++;
  }

  return name;
}
```

### Step 9: Track Auto-Generated Names

**Option A:** Add flag to WorktreeState schema

**File:** `core/types/repositories.ts`

```typescript
export const WorktreeStateSchema = z.object({
  // ... existing fields
  isAutoNamed: z.boolean().optional(), // True if name was auto-generated
});
```

This allows:
- Only triggering LLM rename for auto-named worktrees
- Preserving user-chosen names

**Option B:** Use naming pattern detection

Check if the worktree name matches the random generator pattern (e.g., `{color}-{animal}`).

### Step 10: Update Tests

**New File:** `agents/src/testing/__tests__/worktree-naming.integration.test.ts`

Test cases:
1. Random name generation produces valid names (≤10 chars, valid chars)
2. LLM generates contextual names
3. Event emission works correctly
4. Name conflicts are resolved
5. Only first thread triggers worktree rename
6. User-named worktrees are not auto-renamed

## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `package.json` | Modify | Add `unique-names-generator` dependency |
| `src/lib/random-name.ts` | Create | Random name generation utility |
| `agents/src/services/worktree-naming-service.ts` | Create | LLM-based worktree naming |
| `core/types/events.ts` | Modify | Add `WORKTREE_NAME_GENERATED` event |
| `core/types/repositories.ts` | Modify | Add `isAutoNamed` flag (optional) |
| `agents/src/lib/events.ts` | Modify | Add worktree name event emitter |
| `agents/src/runners/simple-runner-strategy.ts` | Modify | Integrate worktree naming |
| `src/lib/event-bridge.ts` | Modify | Handle worktree rename event |
| Worktree creation UI component | Modify | Use auto-generated names |
| `agents/src/testing/__tests__/worktree-naming.integration.test.ts` | Create | Tests |

## Considerations

### Performance
- LLM call is async/non-blocking (same as thread naming)
- Random name generation is synchronous but fast

### UX
- Worktree starts with friendly random name immediately
- Name updates to contextual name after first prompt is processed
- UI should handle name updates gracefully (already does for threads)

### Edge Cases
- What if worktree is deleted before rename completes? Event handler should check existence.
- What if multiple threads created rapidly? Only first should trigger rename.
- Empty or very short prompts? Use the random name as-is or apply simple heuristics.

## Open Questions

1. **Where is worktree creation triggered?** Need to identify the UI component(s) that create worktrees to modify them.

2. **Should users be able to opt-out of auto-naming?** Could add a checkbox "Let me name this worktree" in creation flow.

3. **Should renamed worktrees update their git branch name?** Currently worktree rename is metadata-only; git worktree path stays the same.

4. **Character limit:** Is 10 characters sufficient? Thread names use 30. Consider 15-20 for more descriptive names.
