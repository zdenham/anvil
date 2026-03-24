# Smart Worktree Renaming Audit

## Overview

This document audits the "smart worktree renaming based on thread name" feature, which automatically generates meaningful names for worktrees based on the user's initial prompt when a new thread is created.

## Architecture Summary

The system uses an event-driven architecture:

```
Agent (Node.js) → Event Emission
    ↓
WORKTREE_NAME_GENERATED event emitted to stdout
    ↓
Tauri Frontend (JavaScript)
    ↓
Event Bridge (setupIncomingBridge)
    ↓
mitt Event Bus (eventBus.emit)
    ↓
setupWorktreeListeners() - Event Handler
    ↓
worktreeService.rename() - Tauri IPC Call
    ↓
Rust Backend - worktree_rename Command
    ↓
Settings File Updated
```

## Complete Wiring Breakdown

### 1. Agent-Side Event Emission

**File:** `agents/src/runners/simple-runner-strategy.ts`

When a new thread is created (not resumed), the `setup()` method calls:
- Line 287: `this.initiateThreadNaming(threadId, prompt, threadPath)` - for thread naming
- Line 292: `this.initiateWorktreeNaming(worktreeId, repoId, prompt)` - for worktree naming

The `initiateWorktreeNaming()` method (lines 420-441):
- Checks for `ANTHROPIC_API_KEY` environment variable
- Calls `generateWorktreeName(prompt, apiKey)` to generate a name (max 10 chars)
- On success, calls `events.worktreeNameGenerated(worktreeId, repoId, name)` to emit event
- Non-blocking (fire-and-forget with Promise.catch)

### 2. Worktree Name Generation Service

**File:** `agents/src/services/worktree-naming-service.ts`

Logic:
- For prompts ≤ 10 characters: Sanitizes and uses directly (cost optimization)
- For prompts > 10 characters: Uses Claude Haiku to generate concise name
- Sanitization rules: lowercase, alphanumeric + hyphens only, max 10 chars, no leading/trailing hyphens
- API calls made via `@ai-sdk/anthropic`

### 3. Event Emission to Frontend

**File:** `agents/src/lib/events.ts`

Method: `events.worktreeNameGenerated(worktreeId, repoId, name)` (lines 57-58)

```typescript
worktreeNameGenerated: (worktreeId: string, repoId: string, name: string) =>
  emitEvent(EventName.WORKTREE_NAME_GENERATED, { worktreeId, repoId, name }),
```

### 4. Event Type Definition

**File:** `core/types/events.ts`

Lines 68 & 138-142: Event name and payload definition:
```typescript
WORKTREE_NAME_GENERATED: "worktree:name:generated",

[EventName.WORKTREE_NAME_GENERATED]: {
  worktreeId: string;
  repoId: string;
  name: string;
};
```

### 5. Event Bridge Configuration

**File:** `src/lib/event-bridge.ts`

Line 36: Event is in `BROADCAST_EVENTS` array - will be cross-window broadcast.

Behavior:
- Agent outputs event to stdout
- Tauri captures and bridges to all windows
- Event sent as `app:worktree:name:generated` with `_source` field for echo prevention
- Incoming bridge (lines 375-442) registers listeners for all BROADCAST_EVENTS
- Events forwarded from Tauri to local mitt eventBus

### 6. Frontend Event Listener Setup

**File:** `src/entities/worktrees/listeners.ts`

Lines 9-24: The listener is registered via `setupWorktreeListeners()`:

```typescript
export function setupWorktreeListeners(): void {
  eventBus.on(
    EventName.WORKTREE_NAME_GENERATED,
    async ({ worktreeId, repoId, name }) => {
      try {
        await worktreeService.rename(repoId, worktreeId, name);
        logger.info(`[WorktreeListener] Renamed worktree "${worktreeId}" to "${name}"`);
      } catch (error) {
        logger.error(`[WorktreeListener] Failed to rename worktree...`);
      }
    }
  );
}
```

### 7. Listener Initialization

**File:** `src/entities/index.ts`

Lines 105-115: Central initialization function includes `setupWorktreeListeners()`.

Initialization called in all 4 windows:
1. **Main Window** (`src/App.tsx`, lines 72-73)
2. **Control Panel** (`src/control-panel-main.tsx`, line 38)
3. **Spotlight** (`src/spotlight-main.tsx`, line 50)
4. **Inbox List** (`src/inbox-list-main.tsx`, line 35)

### 8. Tauri IPC Call

**File:** `src/entities/worktrees/service.ts`

Lines 30-32: Frontend service invokes Tauri command:
```typescript
async rename(repoName: string, oldName: string, newName: string): Promise<void> {
  return invoke("worktree_rename", { repoName, oldName, newName });
}
```

### 9. Tauri Backend Command

**File:** `src-tauri/src/worktree_commands.rs`

Lines 131-170: Rust implementation of `worktree_rename`:
- Validates new name format (alphanumeric, dashes, underscores)
- Loads settings from `~/.anvil/repositories/{slugified-repo-name}/settings.json`
- Checks new name doesn't already exist
- Finds worktree by old name in worktrees array
- Updates the name field
- Persists to disk

## Wiring Status

| Step | Component | Location | Status |
|------|-----------|----------|--------|
| 1 | Agent detects new thread | `simple-runner-strategy.ts:292` | ✅ |
| 2 | Generate worktree name | `worktree-naming-service.ts` | ✅ |
| 3 | Emit event | `agents/src/lib/events.ts:57-58` | ✅ |
| 4 | Event type defined | `core/types/events.ts:68, 138-142` | ✅ |
| 5 | In broadcast list | `src/lib/event-bridge.ts:36` | ✅ |
| 6 | Bridge incoming | `src/lib/event-bridge.ts:375-442` | ✅ |
| 7 | Listener registered | `src/entities/worktrees/listeners.ts:11` | ✅ |
| 8 | Listener initialized | `src/entities/index.ts:113` | ✅ |
| 9 | Frontend service calls Tauri | `src/entities/worktrees/service.ts:30-32` | ✅ |
| 10 | Rust backend executes | `src-tauri/src/worktree_commands.rs:132-169` | ✅ |

## Issues Found

### 🔴 Issue 1: Missing Deduplication Logic (TODO Unresolved)

**File:** `agents/src/runners/simple-runner-strategy.ts:290`

```typescript
// TODO: Only trigger for first thread in worktree - need to track this
// For now, always trigger (frontend will handle deduplication/ignoring)
this.initiateWorktreeNaming(worktreeId, repoId, prompt);
```

**Problem:**
- Worktree naming is triggered for EVERY thread created in a worktree
- Comment indicates frontend should handle deduplication, but there's no evidence of this logic
- The worktree will be renamed multiple times if multiple threads are created

**Impact:**
- If user creates 3 threads in same worktree, the name will be regenerated 3 times
- Later threads' prompts may overwrite earlier naming (e.g., "auth-fix" → "bug-fix" → "docs")
- Unexpected behavior for users

**Recommendation:**
- Track which worktrees have been named in current session
- Only generate name for truly first thread in a worktree
- Or check if worktree already has a non-UUID name before renaming

### 🟡 Issue 2: Silent Failure - No User Feedback

**Problem:**
- Frontend logs error but doesn't notify user if rename fails
- Silent failure with no way for user to know something went wrong

**Current behavior:**
```typescript
} catch (error) {
  logger.error(`[WorktreeListener] Failed to rename worktree...`);
  // No user-facing notification
}
```

**Recommendation:**
- Consider showing a toast notification on failure
- Or at minimum, provide a way to manually trigger rename

### 🟡 Issue 3: Race Condition Potential

**Problem:**
- Worktree naming runs async (fire-and-forget)
- If user renames worktree manually before naming completes, could cause conflict
- Rust backend has name-uniqueness check, so would fail gracefully

**Impact:**
- Minor - fails gracefully but silently

### 🟢 Issue 4: Limited Test Coverage

**Status:**
- Thread naming has integration tests
- Worktree naming only has unit tests
- No integration test verifying complete event flow to Tauri backend

**Recommendation:**
- Add integration test for full E2E flow

## Security Considerations

### ✅ Properly Handled
- Worktree names validated for format (alphanumeric, dash, underscore only)
- Max 10 characters enforced in generation service
- Rust backend re-validates format before persisting
- No path traversal possible (names don't contain slashes)

### ⚠️ Notes
- `ANTHROPIC_API_KEY` must be in environment
- Graceful degradation if key missing (skips naming)
- No rate limiting on API calls

## Conclusion

**The worktree renaming feature is properly wired and functional.** All components are connected and properly typed. The event chain flows correctly from agent through to the Rust backend.

**However, there is one significant design issue:**
1. **Deduplication TODO is unresolved** - worktrees may be renamed multiple times unexpectedly

**Minor issues:**
2. Silent failure with no user feedback
3. Potential race condition (handled gracefully)
4. Limited integration test coverage

The feature works correctly for the primary use case (first thread creation in a new worktree), but may exhibit unexpected behavior if users create multiple threads in the same worktree.
