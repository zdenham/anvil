# Phase 3: State Machine

**Dependencies:** 01-unified-status-system
**Parallel Group:** B

## Goal

Update the agent state machine to support the new unified status flow and two-phase review.

---

## 3.1 Updated Flow

```
backlog → todo → in_progress → in_review → complete
                 (execution)   (review)
                               (merge)
```

The `in_review` status has two phases:
1. **Review phase**: Review agent examines work, user approves
2. **Merge phase**: Merge agent executes merge strategy

---

## 3.2 Agent Type Mapping

**File:** `src/lib/agent-state-machine.ts`

```typescript
export function getAgentTypeForStatus(status: TaskStatus): string | null {
  switch (status) {
    case "todo":
      return "entrypoint";  // Planning/routing agent
    case "in_progress":
      return "execution";   // Implementation agent
    case "in_review":
      return "review";      // Review agent (then merge agent)
    default:
      return null;
  }
}
```

---

## 3.3 State Machine Updates

```typescript
export function getNextStatus(status: TaskStatus): TaskStatus {
  switch (status) {
    case "backlog":
      return "todo";
    case "todo":
      return "in_progress";
    case "in_progress":
      return "in_review";
    case "in_review":
      return "complete";  // Only after merge succeeds
    default:
      return status;
  }
}

export function canProgress(status: TaskStatus): boolean {
  return status === "todo" || status === "in_progress" || status === "in_review";
}

export function getCurrentPhaseLabel(status: TaskStatus): string {
  switch (status) {
    case "backlog":
      return "Backlog";
    case "todo":
      return "Planning";
    case "in_progress":
      return "Implementation";
    case "in_review":
      return "Review & Merge";
    case "complete":
      return "Complete";
    default:
      return status;
  }
}

export function getNextPhaseLabel(status: TaskStatus): string {
  switch (status) {
    case "backlog":
      return "Plan";
    case "todo":
      return "Implement";
    case "in_progress":
      return "Review";
    case "in_review":
      return "Complete";
    default:
      return "Done";
  }
}
```

---

## 3.4 Determining Review vs Merge Agent

Add helper to determine which agent to spawn during `in_review`:

```typescript
/**
 * Get the specific agent type for in_review status.
 * Returns "review" if review not yet approved, "merge" if approved.
 */
export function getInReviewAgentType(task: TaskMetadata): "review" | "merge" {
  if (task.reviewApproved) {
    return "merge";
  }
  return "review";
}
```

---

## Checklist

- [ ] Update `getAgentTypeForStatus()` for new statuses
- [ ] Update `getNextStatus()` transition logic
- [ ] Update `canProgress()` check
- [ ] Update `getCurrentPhaseLabel()` labels
- [ ] Update `getNextPhaseLabel()` labels
- [ ] Add `getInReviewAgentType()` helper
- [ ] Update any other state machine functions
- [ ] Test status transitions
