# 01: Types & Events

**Dependencies:** None
**Enables:** 02-cli-command, 03-action-pane

---

## Goal

Add the TypeScript types needed to support pending review requests.

---

## Tasks

### 1. Add `pendingReview` field to TaskMetadata

File: `src/entities/tasks/types.ts`

```typescript
interface TaskMetadata {
  // ... existing fields ...

  /**
   * Pending review request from agent.
   * Null when no review is pending.
   * Cleared when user responds (Enter or feedback).
   */
  pendingReview: {
    markdown: string;       // The content to display
    defaultResponse: string; // Placeholder text, sent on Enter
    requestedAt: number;    // Timestamp
  } | null;
}
```

### 2. Add `action-requested` event type

File: `src/entities/events.ts`

```typescript
export type AppEvents = {
  // ... existing events ...

  /**
   * Emitted when an agent requests user action.
   * The action pane should display the markdown and await user input.
   */
  "action-requested": {
    taskId: string;
    markdown: string;
    defaultResponse: string;
  };
};
```

---

## Acceptance Criteria

- [ ] `pendingReview` field exists on `TaskMetadata` with correct shape
- [ ] `action-requested` event type is defined in `AppEvents`
- [ ] TypeScript compiles without errors
