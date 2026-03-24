# Sub-Plan 04: Runner Integration

## Overview
Integrate worktree naming into the simple-runner-strategy, triggering LLM-based naming when the first thread is created in a worktree.

## Dependencies
- **02-event-system.md** - Needs `WORKTREE_NAME_GENERATED` event
- **03-worktree-naming-service.md** - Needs `generateWorktreeName` function

## Reference
Follow the existing `initiateThreadNaming` pattern in `agents/src/runners/simple-runner-strategy.ts`

## Steps

### Step 1: Add Import

**File:** `agents/src/runners/simple-runner-strategy.ts`

Add import at top:

```typescript
import { generateWorktreeName } from "../services/worktree-naming-service.js";
```

### Step 2: Add Worktree Naming Method

Add new private method to `SimpleRunnerStrategy` class (after `initiateThreadNaming`):

```typescript
/**
 * Initiate worktree naming in parallel (fire and forget).
 * Generates a name using Claude Haiku and emits event for frontend.
 * Only called for new threads (not resumes) and only for the first thread in a worktree.
 */
private initiateWorktreeNaming(
  worktreeId: string,
  repoId: string,
  prompt: string
): void {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    emitLog("WARN", "[worktree-naming] No API key available, skipping name generation");
    return;
  }

  generateWorktreeName(prompt, apiKey)
    .then((name) => {
      emitLog("INFO", `[worktree-naming] Generated name: "${name}"`);
      // Emit event for frontend to handle the rename
      events.worktreeNameGenerated(worktreeId, repoId, name);
    })
    .catch((error) => {
      // Log error but don't fail the main agent flow
      emitLog("WARN", `[worktree-naming] Failed to generate name: ${error instanceof Error ? error.message : String(error)}`);
    });
}
```

### Step 3: Integrate into Setup Method

In the `setup` method, after the new thread creation block (after `this.initiateThreadNaming`), add:

```typescript
// Start worktree naming in parallel (fire and forget)
// TODO: Only trigger for first thread in worktree - need to track this
// For now, always trigger (frontend will handle deduplication/ignoring)
this.initiateWorktreeNaming(worktreeId, repoId, prompt);
```

### Step 4: Consider First-Thread Detection

**Option A (Simple - Recommended for now):** Always emit the event, let frontend decide whether to apply based on worktree's `isAutoNamed` flag.

**Option B (Agent-side):** Check if this is the first thread by counting existing threads for this worktreeId. This would require reading thread metadata files in the anvilDir.

For simplicity, start with Option A.

## Verification
1. TypeScript compiles without errors
2. New thread creation triggers worktree naming
3. Resume does NOT trigger worktree naming
4. Events emit correctly to stdout
5. Errors don't crash the agent

## Output
- Modified `agents/src/runners/simple-runner-strategy.ts`
