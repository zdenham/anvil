# Sub-Plan 07: Permission System Integration

## Overview

Extend the event system and tool execution state to support pending edits with accept/reject flow. This connects the inline diff UI to the broader permission prompts feature.

## Dependencies

- **External: permission-prompts.md** - This plan depends on the Permission Prompts feature which handles:
  - `PreToolUse` hook integration in the agent
  - Permission request/response event flow via stdin/stdout
  - The underlying accept/reject mechanism

## Depends On This

- None - This is an extension point

---

## Scope

### Files to Modify

1. `core/types/events.ts` - Add event types and extend ToolExecutionState

---

## Implementation Details

### 7.1 Add Event Types

**File:** `core/types/events.ts`

Add to `EventName` enum:

```typescript
export const EventName = {
  // ... existing events ...

  // Pending edit events
  EDIT_PENDING: "edit:pending",
  EDIT_ACCEPTED: "edit:accepted",
  EDIT_REJECTED: "edit:rejected",
} as const;
```

Add to `EventPayloads` type:

```typescript
export type EventPayloads = {
  // ... existing payloads ...

  // NOTE: Per event-bridge pattern, payloads are SIGNALS only.
  // The diff data is stored in ToolExecutionState on disk/memory,
  // NOT carried in the event payload.
  [EventName.EDIT_PENDING]: {
    toolUseId: string;
    threadId: string;
  };
  [EventName.EDIT_ACCEPTED]: {
    toolUseId: string;
    threadId: string;
  };
  [EventName.EDIT_REJECTED]: {
    toolUseId: string;
    threadId: string;
  };
};
```

### 7.2 Extend ToolExecutionState

**File:** `core/types/events.ts`

Update the `ToolExecutionStateSchema`:

```typescript
export const ToolExecutionStateSchema = z.object({
  status: z.enum(["running", "complete", "error", "pending"]), // Add "pending"
  result: z.string().optional(),
  isError: z.boolean().optional(),
  toolName: z.string().optional(),
  // New fields for pending edits
  pendingDiff: z.string().optional(),
  filePath: z.string().optional(),
});

export type ToolExecutionState = z.infer<typeof ToolExecutionStateSchema>;
```

### 7.3 Event Flow

The expected flow for pending edits:

1. Agent emits `EDIT_PENDING` event with `toolUseId`
2. UI receives event, fetches `ToolExecutionState` from disk
3. `ToolExecutionState` contains `status: "pending"`, `pendingDiff`, and `filePath`
4. UI renders `InlineDiffBlock` with `isPending={true}`
5. User clicks Accept/Reject
6. UI emits `EDIT_ACCEPTED` or `EDIT_REJECTED` event
7. Agent receives event, proceeds or aborts tool execution

**Important**: The diff data is NOT in the event payload. The event is just a signal. The actual diff data lives in `ToolExecutionState` on disk.

### 7.4 Consumer Side Updates

The following components need to handle the new events (but this is outside the scope of this plan):

- Agent runner: Emit `EDIT_PENDING` before executing Edit/Write
- Agent runner: Listen for `EDIT_ACCEPTED`/`EDIT_REJECTED` to continue
- Thread store: Subscribe to pending edit events
- ToolUseBlock: Read pending state and wire accept/reject

---

## Verification

```bash
# Type check
pnpm tsc --noEmit

# Verify Zod schema works
# Write a quick test that validates a ToolExecutionState with pending status
```

---

## Acceptance Criteria

- [ ] `EDIT_PENDING`, `EDIT_ACCEPTED`, `EDIT_REJECTED` events defined
- [ ] Event payloads contain only `toolUseId` and `threadId` (signals, not data)
- [ ] `ToolExecutionStateSchema` includes "pending" status
- [ ] `ToolExecutionStateSchema` includes `pendingDiff` and `filePath` fields
- [ ] No TypeScript errors
- [ ] Zod schema validates correctly

---

## Notes

This sub-plan is intentionally limited to the type/schema changes. The actual integration with the agent runner and permission prompts system is handled by the `permission-prompts.md` plan.

The key principle followed here is **Events are Signals, Not Data Carriers**:
- Events notify that something happened
- Full data is read from disk/state after event triggers refresh
- This avoids data duplication and staleness issues

**State Cleanup After Accept/Reject:**

After an `EDIT_ACCEPTED` or `EDIT_REJECTED` event is processed:
1. The `ToolExecutionState` should be updated:
   - `status` changes from `"pending"` to `"complete"` (accepted) or `"error"` (rejected)
   - `pendingDiff` field should be cleared (set to `undefined`)
2. The UI components listening to state changes will automatically re-render
3. The `InlineDiffBlock` will no longer show accept/reject buttons since `isPending` will be false
4. Any focused state for keyboard navigation should be reset

This cleanup is the responsibility of the agent runner / event handlers, not the UI components.

**Relationship with permission-prompts.md:**

The `permission-prompts.md` plan handles:
- The `PreToolUse` hook that triggers permission requests
- The stdin/stdout protocol for permission request/response
- The agent-side logic for pausing and resuming tool execution

This sub-plan (07) handles:
- The TypeScript types and Zod schemas for the events
- The `ToolExecutionState` schema extensions

The two plans work together: `permission-prompts.md` defines the behavior, this plan defines the data structures. Implementers should read both plans to understand the full flow.
