# Phase 3: Update Human Review Validator

**File:** `agents/src/validators/human-review.ts`
**Dependencies:** 00-types, 01a-validation-context

## Changes

### 1. Update Validation Logic

Check that the *current thread* has an unaddressed review, not just any review:

```typescript
import type { AgentValidator, ValidationContext, ValidationResult } from "./types.js";
import { NodePersistence } from "../lib/persistence-node.js";
import { logger } from "../lib/logger.js";

export const humanReviewValidator: AgentValidator = {
  name: "human-review",

  async validate(context: ValidationContext): Promise<ValidationResult> {
    // Merge agent doesn't require human review
    if (context.agentType === "merge") {
      return { valid: true };
    }

    // Skip if no task (ephemeral conversation)
    if (!context.taskId) {
      return { valid: true };
    }

    // Fail-closed: missing threadId is an internal error, not a pass
    if (!context.threadId) {
      logger.debug("human-review-validator", "Missing threadId in validation context", {
        taskId: context.taskId,
        agentType: context.agentType,
      });
      return {
        valid: false,
        systemMessage: "INTERNAL ERROR: Thread ID missing from validation context",
      };
    }

    const persistence = new NodePersistence(context.anvilDir);
    const task = await persistence.getTask(context.taskId);

    if (!task) {
      logger.debug("human-review-validator", "Task not found", {
        taskId: context.taskId,
      });
      return { valid: true };
    }

    // Check if CURRENT thread has requested review (not addressed)
    // NOTE: Remove optional chaining on pendingReviews after types migration is complete
    const currentThreadReview = task.pendingReviews?.find(
      (r) => r.threadId === context.threadId && !r.isAddressed
    );

    if (currentThreadReview) {
      return { valid: true };
    }

    logger.debug("human-review-validator", "Validation failed - no pending review for thread", {
      taskId: context.taskId,
      threadId: context.threadId,
      pendingReviewCount: task.pendingReviews?.length ?? 0,
    });

    return {
      valid: false,
      systemMessage: `VALIDATION FAILED: You must request human review before completing. Use the \`anvil request-human\` command to request review of your work. This is required for all agents.`,
    };
  },
};
```

### 2. Runner.ts Integration Note

The runner (`agents/src/runner.ts`) passes the validation context to validators. Ensure it provides `threadId`:

```typescript
// In runner.ts where ValidationContext is constructed:
const validationContext: ValidationContext = {
  anvilDir: this.anvilDir,
  taskId: this.taskId,
  threadId: this.threadId,  // <-- Must be passed through
  agentType: this.agentType,
  // ... other fields
};
```

Verify that `runner.ts` has access to `threadId` and passes it correctly. If `threadId` is not currently available in the runner, it may need to be added as a constructor parameter or derived from the thread path.

### Key Changes

1. **Skip for merge agent** - Merge agent is internal orchestration, doesn't need review
2. **Fail-closed for missing threadId** - Missing threadId indicates an internal error; fail validation rather than silently passing
3. **Check current thread's review** - Only passes if *this thread* requested review
4. **Check isAddressed** - Review must be pending, not already addressed
5. **Debug logging** - Log validation failures with context for debugging

### Post-Migration Cleanup

After the types migration is complete and `pendingReviews` is guaranteed to be an array:

1. Remove optional chaining (`?.`) on `task.pendingReviews`
2. Remove nullish coalescing (`?? 0`) on `task.pendingReviews.length`

```typescript
// Before (during migration):
const currentThreadReview = task.pendingReviews?.find(...);
pendingReviewCount: task.pendingReviews?.length ?? 0,

// After (post-migration):
const currentThreadReview = task.pendingReviews.find(...);
pendingReviewCount: task.pendingReviews.length,
```
