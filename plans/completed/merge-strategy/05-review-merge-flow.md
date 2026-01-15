# Phase 5: Review → Merge Flow

**Dependencies:** 03-state-machine, 04-merge-agent
**Parallel Group:** C

## Goal

Implement the two-phase `in_review` flow: review agent → user approval → merge agent → completion.

---

## 5.1 Flow Diagram

```
in_review
    │
    ▼
┌──────────────────┐
│   Review Agent   │  Examines code, provides review
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  pendingReview   │  "Review complete. Press Enter to merge."
│  (from review)   │
└────────┬─────────┘
         │ User presses Enter
         ▼
┌──────────────────┐
│   Merge Agent    │  Executes merge strategy via CLI
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  pendingReview   │  "Merge complete." or "Conflicts found."
│  (from merge)    │
└────────┬─────────┘
         │ User confirms (Enter) or provides feedback
         ▼
    ┌────┴────┐
    │         │
 Success    Failure
    │         │
    ▼         ▼
complete   Stay in in_review
           (agent tries again)
```

---

## 5.2 Tracking Review Approval

**File:** `src/entities/tasks/types.ts`

Add fields to TaskMetadata:

```typescript
export interface TaskMetadata {
  // ... existing fields

  /**
   * Set to true when user approves the review (presses Enter).
   * Triggers merge agent instead of review agent.
   * Reset to false if merge fails and user wants to re-review.
   */
  reviewApproved?: boolean;

  /**
   * PR URL if merge strategy created a pull request.
   * Stored for reference after completion.
   */
  prUrl?: string;
}
```

---

## 5.3 Action Panel Logic

**File:** `src/components/workspace/action-panel.tsx`

Update the response handling for `in_review`:

```typescript
case "in_review":
  if (isDefaultResponse(inputValue)) {
    if (!task.reviewApproved) {
      // User approves review → mark approved, spawn merge agent
      await taskService.update(task.id, { reviewApproved: true });
      // Spawn merge agent (stays in in_review)
      return { type: "spawn_merge" };
    } else {
      // User confirms merge result → complete
      return { type: "complete", nextStatus: "complete" };
    }
  } else {
    // User provides feedback → stay with current agent
    return { type: "stay", message: inputValue.trim() };
  }
```

---

## 5.4 Agent Spawning Logic

Update agent spawning to check `reviewApproved`:

```typescript
function getAgentToSpawn(task: TaskMetadata): string | null {
  const baseAgent = getAgentTypeForStatus(task.status);

  if (task.status === "in_review") {
    return getInReviewAgentType(task); // "review" or "merge"
  }

  return baseAgent;
}
```

---

## 5.5 Handling Merge Results

When merge agent completes:

**Success:**
- Set `pendingReview` with success message
- If PR created, store URL in `task.prUrl`
- User confirms → transition to `complete`

**Failure:**
- Set `pendingReview` with error details
- Keep `reviewApproved: true` (still in merge phase)
- User can provide feedback or retry
- Optionally: user can request re-review by setting `reviewApproved: false`

---

## Checklist

- [ ] Add `reviewApproved` field to `TaskMetadata`
- [ ] Add `prUrl` field to `TaskMetadata`
- [ ] Update action panel logic for two-phase in_review
- [ ] Update agent spawning to use `getInReviewAgentType()`
- [ ] Handle merge success → complete transition
- [ ] Handle merge failure → stay in in_review
- [ ] Store PR URL when created
- [ ] Display PR URL in UI after completion
- [ ] Test full flow: review → approve → merge → complete
