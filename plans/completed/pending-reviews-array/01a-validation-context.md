# Phase 2a: Update ValidationContext

**File:** `agents/src/validators/types.ts`
**Dependencies:** 00-types
**Blocks:** 02-human-review-validator

## Changes

Add `threadId` to ValidationContext so the human review validator can check if the *current* thread has requested review.

```typescript
export interface ValidationContext {
  agentType: string;
  taskId: string | null;
  threadId: string | null;  // ADD: Current thread ID for review validation
  mortDir: string;
  cwd: string;
}
```

## Caller Updates

Update `agents/src/runner.ts` to pass the thread ID when calling the validators:

```typescript
const validationResult = await runValidators({
  agentType: args.agentType,
  taskId: taskId,
  threadId: args.threadId,  // ADD THIS
  mortDir: args.mortDir,
  cwd: cwd,
});
```

The `threadId` should already be available in `args` from the runner's execution context. If not present in `args`, check if it needs to be passed down from `agents/src/orchestration.ts`.
