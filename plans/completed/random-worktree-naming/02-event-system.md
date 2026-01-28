# Sub-Plan 02: Event System Extension

## Overview
Add the `WORKTREE_NAME_GENERATED` event to the event system, including type definitions and emitter helper.

## Dependencies
- None (can run in parallel with 01 and 03)

## Steps

### Step 1: Add Event Name and Payload Type

**File:** `core/types/events.ts`

Add to `EventName` object (around line 66, after `WORKTREE_RELEASED`):

```typescript
// Add new event name
WORKTREE_NAME_GENERATED: "worktree:name:generated",
```

Add to `EventPayloads` interface (around line 134, after `WORKTREE_RELEASED` payload):

```typescript
// Worktree naming
[EventName.WORKTREE_NAME_GENERATED]: {
  worktreeId: string;
  repoId: string;
  name: string;
};
```

Add to `EventNameSchema` (around line 277, after `WORKTREE_RELEASED`):

```typescript
EventName.WORKTREE_NAME_GENERATED,
```

### Step 2: Add Event Emitter Helper

**File:** `agents/src/lib/events.ts`

Add to the `events` object (after `worktreeReleased`):

```typescript
worktreeNameGenerated: (worktreeId: string, repoId: string, name: string) =>
  emitEvent(EventName.WORKTREE_NAME_GENERATED, { worktreeId, repoId, name }),
```

Update imports at top if `EventName` import doesn't include the new event (it should auto-include since it's `as const`).

## Verification
1. TypeScript compiles without errors
2. Event name is exported correctly
3. Payload type is properly typed
4. Emitter function works (type-checks with correct arguments)

## Output
- Modified `core/types/events.ts`
- Modified `agents/src/lib/events.ts`
