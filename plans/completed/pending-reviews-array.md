# Pending Reviews Array Implementation Plan

## Overview

Change `requestHumanReview` state from a single object to an array, including thread IDs for proper validation, and support marking reviews as addressed.

## Current State

- `PendingReview` is a single object on `TaskMetadata.pendingReview`
- Human review validator checks if ANY review exists (`task.pendingReview`)
- No tracking of which thread requested the review
- No way to mark reviews as "addressed" when user responds

## Target State

- `TaskMetadata.pendingReviews` is an array of `PendingReview` objects
- Each review includes `threadId` and `addressed` status
- Validator checks that the CURRENT thread has requested review
- UI shows the LATEST unaddressed review by default
- Creating a thread in response marks that review as addressed

---

## Implementation Steps

### 1. Update Types (`core/types/tasks.ts`)

**PendingReview interface:**
```typescript
export interface PendingReview {
  id: string;             // Unique ID for this review request
  threadId: string;       // Thread that requested this review
  markdown: string;       // The content to display
  defaultResponse: string; // Placeholder text, sent on Enter
  requestedAt: number;    // Timestamp
  onApprove: string;      // Agent type to spawn on approval (Enter)
  onFeedback: string;     // Agent type to spawn on feedback
  isAddressed: boolean;   // Whether user has responded to this review
}
```

**TaskMetadata:**
```typescript
// Change from:
pendingReview: PendingReview | null;

// To:
pendingReviews: PendingReview[];
```

**UpdateTaskInput:**
```typescript
// Add new field for adding reviews:
addPendingReview?: Omit<PendingReview, 'id'>;

// Add new field for marking addressed:
addressPendingReview?: string; // Review ID to mark as addressed
```

### 2. Update ValidationContext (`agents/src/validators/types.ts`)

```typescript
export interface ValidationContext {
  agentType: string;
  taskId: string | null;
  threadId: string | null;  // ADD: Current thread ID
  mortDir: string;
  cwd: string;
}
```

### 3. Update Human Review Validator (`agents/src/validators/human-review.ts`)

```typescript
export const humanReviewValidator: AgentValidator = {
  name: "human-review",

  async validate(context: ValidationContext): Promise<ValidationResult> {
    if (!context.taskId) {
      return { valid: true };
    }

    const persistence = new NodePersistence(context.mortDir);
    const task = await persistence.getTask(context.taskId);

    if (!task) {
      return { valid: true };
    }

    // Check if CURRENT thread has requested review (not addressed)
    const currentThreadReview = task.pendingReviews?.find(
      (r) => r.threadId === context.threadId && !r.isAddressed
    );

    if (currentThreadReview) {
      return { valid: true };
    }

    return {
      valid: false,
      systemMessage: `VALIDATION FAILED: You must request human review before completing. Use the \`mort request-human\` command to request review of your work. This is required for all agents.`,
    };
  },
};
```

### 4. Update CLI (`agents/src/cli/mort.ts`)

**Add `--thread` argument to `request-human` command:**

```typescript
async function requestHuman(args: string[]): Promise<void> {
  const taskId = getArg(args, "--task");
  const threadId = getArg(args, "--thread");  // NEW
  const markdownArg = getArg(args, "--markdown");
  const defaultResponse = getArg(args, "--default") ?? "Proceed";
  const onApproveArg = getArg(args, "--on-approve");
  const onFeedbackArg = getArg(args, "--on-feedback");

  if (!taskId) error("--task is required");
  if (!threadId) error("--thread is required");  // NEW
  // ... rest of validation

  const newReview: PendingReview = {
    id: crypto.randomUUID(),
    threadId,
    markdown,
    defaultResponse,
    requestedAt: Date.now(),
    onApprove,
    onFeedback,
    isAddressed: false,
  };

  // Use new addPendingReview operation
  const task = await persistence.updateTask(taskId, {
    addPendingReview: newReview,
  });
  // ...
}
```

**Update help text** to document `--thread` flag.

### 5. Update Persistence Layer

Need to handle the new update operations in persistence:
- `addPendingReview`: Push new review to array
- `addressPendingReview`: Find review by ID and set `addressed: true`

Check where `updateTask` is implemented and add array manipulation logic.

### 6. Update Action Panel (`src/components/workspace/action-panel.tsx`)

```typescript
// Get the latest unaddressed review
const pendingReviews = task?.pendingReviews ?? [];
const latestReview = pendingReviews
  .filter(r => !r.isAddressed)
  .sort((a, b) => b.requestedAt - a.requestedAt)[0] ?? null;

// Use latestReview instead of pendingReview throughout
```

Update `handleReviewSubmit` to mark the current review as addressed:
```typescript
const handleReviewSubmit = useCallback(async () => {
  if (!taskId || !latestReview) return;

  // Mark this review as addressed
  await taskService.update(taskId, {
    addressPendingReview: latestReview.id
  });

  // ... rest of submission logic
}, [taskId, latestReview, ...]);
```

### 7. Update Task Workspace (`src/components/workspace/task-workspace.tsx`)

When creating a new thread in response to a review, the review is already marked as addressed by the action panel's `handleReviewSubmit`. No additional changes needed here.

### 8. Update Task Service (`src/entities/tasks/service.ts`)

The `refreshTaskBySlug` method needs to handle the new array structure:

```typescript
// Emit action-requested event if there are new unaddressed reviews
const oldUnaddressed = existing?.pendingReviews?.filter(r => !r.isAddressed) ?? [];
const newUnaddressed = task.pendingReviews?.filter(r => !r.isAddressed) ?? [];

if (newUnaddressed.length > oldUnaddressed.length) {
  const latest = newUnaddressed.sort((a, b) => b.requestedAt - a.requestedAt)[0];
  if (latest) {
    eventBus.emit("action-requested", {
      taskId: task.id,
      markdown: latest.markdown,
      defaultResponse: latest.defaultResponse,
    });
  }
}
```

### 9. Update Event Types

Check if `action-requested` event payload needs updating for the new structure.

### 10. Exclude Merge Agent from Human Review Validation

The merge agent should not require human review validation since it's an internal orchestration agent that combines work from other agents.

**Update validator to skip for merge agent:**
```typescript
async validate(context: ValidationContext): Promise<ValidationResult> {
  // Merge agent doesn't require human review
  if (context.agentType === 'merge') {
    return { valid: true };
  }

  // ... rest of validation logic
}
```

Alternatively, this could be handled via agent configuration if there's a mechanism for agents to opt out of specific validators.

---

## Files to Modify

| File | Changes |
|------|---------|
| `core/types/tasks.ts` | Update PendingReview, TaskMetadata, UpdateTaskInput |
| `agents/src/validators/types.ts` | Add threadId to ValidationContext |
| `agents/src/validators/human-review.ts` | Check current thread's review, skip for merge agent |
| `agents/src/cli/mort.ts` | Add --thread flag, push to array |
| `src/components/workspace/action-panel.tsx` | Show latest review, mark addressed |
| `src/entities/tasks/service.ts` | Handle array in event emission |
| Persistence layer (TBD) | Handle addPendingReview, addressPendingReview |

---

## Testing Checklist

- [ ] Agent requests review with thread ID
- [ ] Validator passes when current thread has requested review
- [ ] Validator fails when current thread has NOT requested review
- [ ] UI shows latest unaddressed review
- [ ] Submitting response marks review as addressed
- [ ] Old reviews remain in array for history
