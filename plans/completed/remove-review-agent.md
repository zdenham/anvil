# Remove Review Agent

## Summary

Remove the automated review agent. The human (user) should review code directly, with the execution agent transitioning tasks to "in-review" state and suggesting the merge agent.

## Current Flow

```
execution → in-review → review agent → user approval → merge agent → done
```

## New Flow

```
execution → in-review → human review → merge agent → done
```

## Changes Required

### 1. Delete Review Agent

**File:** `agents/src/agent-types/review.ts`

Delete this file entirely.

### 2. Update Agent Exports

**File:** `agents/src/agent-types/index.ts`

- Remove `import { review } from "./review.js";`
- Remove `review` from the `agents` record

### 3. Update Shared Prompts

**File:** `agents/src/agent-types/shared-prompts.ts`

Update the `HUMAN_REVIEW_TOOL` section:

- Remove the `review` row from the agent types table
- Change "Execution ready for review" pattern from:
  ```
  --on-approve review --on-feedback execution
  ```
  to:
  ```
  --on-approve merge --on-feedback execution
  ```
- Remove the "Review approving work" pattern entirely

### 4. Update Action Panel Default

**File:** `src/components/workspace/action-panel.tsx`

Line 135 - Change the default fallback from `"review"` to `"merge"`:

```typescript
// Before:
: pendingReview?.onApprove ?? "review";

// After:
: pendingReview?.onApprove ?? "merge";
```

### 5. Update Type Comments

**File:** `core/types/tasks.ts`

Update the comment for `reviewApproved` (lines 74-77) to reflect that human reviews, not an agent:

```typescript
/**
 * Whether the user has approved the work for merge.
 * When true and status is in-review, the merge agent should be spawned.
 */
reviewApproved?: boolean;
```

## Files to Modify

| File | Action |
|------|--------|
| `agents/src/agent-types/review.ts` | Delete |
| `agents/src/agent-types/index.ts` | Remove review import/export |
| `agents/src/agent-types/shared-prompts.ts` | Update agent table and patterns |
| `src/components/workspace/action-panel.tsx` | Change default from "review" to "merge" |
| `core/types/tasks.ts` | Update comment |

## Verification

1. Build agents package: `pnpm --filter agents typecheck`
2. Build frontend: `pnpm --filter frontend typecheck`
3. Test the flow:
   - Start a task, let execution agent complete
   - Verify task goes to in-review with merge suggested (not review)
   - User reviews, approves
   - Merge agent runs
