# Fix REPL Child Thread Sidebar Nesting & Stuck "Running" Status

## Diagnosis

Both bugs originate in `agents/src/lib/mort-repl/child-spawner.ts` — the REPL-specific spawning path. The SDK sub-agent path (`agents/src/runners/shared.ts` PreToolUse:SubAgent) handles both correctly. The REPL path was implemented separately and is missing two things the SDK path does.

### Bug 1: Child thread shows as sibling instead of nested child

**Root cause**: `ChildSpawner.createThreadOnDisk()` (child-spawner.ts:89-103) does **not set** `visualSettings` on the child metadata.

The tree builder (`src/hooks/tree-node-builders.ts:115`) resolves parent placement via:

```ts
parentId: thread.visualSettings?.parentId ?? thread.worktreeId
```

Since `visualSettings` is `undefined`, it falls back to `thread.worktreeId` — placing the child at the same level as its parent (both directly under the worktree node).

**Compare** with the SDK sub-agent path (`shared.ts:799-801`):

```ts
visualSettings: {
  parentId: context.threadId,  // sub-agent → parent thread
},
```

### Bug 2: Spawned thread stays "running" forever

**Root cause**: After the child process exits, `ChildSpawner.waitForResult()` (child-spawner.ts:199-226) only reads the result text. It **does not emit** `AGENT_COMPLETED` **or** `THREAD_STATUS_CHANGED` events.

The child runner process does:

1. Update `metadata.json` to `status: "completed"` (via `simple-runner-strategy.ts:cleanup()` line 517)
2. Emit `thread:status:changed` event (line 533)

But this event is likely **lost in a race condition** — the child's socket can close before the event flushes, since the process exits immediately after cleanup.

**Compare** with the SDK sub-agent path (`shared.ts:1243-1254`) where the **parent** process emits both events after the sub-agent completes:

```ts
emitEvent(EventName.THREAD_STATUS_CHANGED, { threadId: childThreadId, status: "completed" });
emitEvent(EventName.AGENT_COMPLETED, { threadId: childThreadId, exitCode: 0 });
```

The `AGENT_COMPLETED` listener (`src/entities/threads/listeners.ts:143-171`) has a safety net that force-updates status if the thread is still "running" after the process exits — but it never fires for REPL children because the event is never emitted.

---

## Phases

- [x] Fix `visualSettings` in `ChildSpawner.createThreadOnDisk()`

- [x] Emit completion events in `ChildSpawner.waitForResult()`

- [x] Add tests for both fixes

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Fix `visualSettings`

**File**: `agents/src/lib/mort-repl/child-spawner.ts`

In `createThreadOnDisk()`, add `visualSettings` to the metadata object (after `permissionMode` on line 102):

```ts
const childMetadata = {
  // ... existing fields ...
  parentThreadId: this.context.threadId,
  parentToolUseId: this.parentToolUseId,
  agentType,
  permissionMode,
+ visualSettings: {
+   parentId: this.context.threadId,
+ },
};
```

This matches the SDK path in `shared.ts:799-801`.

## Phase 2: Emit completion events after child exits

**File**: `agents/src/lib/mort-repl/child-spawner.ts`

In `waitForResult()`, after the child exits and before returning the result text, emit completion events from the parent process:

```ts
private async waitForResult(...): Promise<string> {
  // ... existing exit wait ...

  if (child.pid) {
    this.activePids.delete(child.pid);
  }

  const durationMs = Date.now() - startTime;
  const resultText = this.readChildResult(childThreadPath, childThreadId);

+ // Determine final status from exit code
+ const status = exitCode === 130 ? "cancelled" : exitCode === 0 ? "completed" : "error";
+
+ // Emit events from parent process (child's events may be lost on socket close)
+ this.emitEvent(
+   EventName.THREAD_STATUS_CHANGED,
+   { threadId: childThreadId, status },
+   "mort-repl:child-complete",
+ );
+ this.emitEvent(
+   EventName.AGENT_COMPLETED,
+   { threadId: childThreadId, exitCode },
+   "mort-repl:child-complete",
+ );

  logger.info(
    `[mort-repl] Child ${childThreadId} exited with code ${exitCode} in ${durationMs}ms`,
  );

  return resultText;
}
```

This mirrors what `shared.ts:1243-1254` does for SDK sub-agents. The `handleAgentCompleted` listener will:

1. Refresh the thread from disk (which now has `status: "completed"` written by the child)
2. Force-update status if it's still "running" (safety net)
3. Mark thread as unread
4. Refresh the parent thread

## Phase 3: Tests

**File**: `agents/src/lib/mort-repl/__tests__/child-spawner.test.ts`

Add two test cases:

1. `visualSettings` **test**: Assert that `createThreadOnDisk` writes metadata with `visualSettings.parentId` set to the parent thread ID
2. **Completion events test**: Assert that after child process exits, `THREAD_STATUS_CHANGED` and `AGENT_COMPLETED` events are emitted with the correct thread ID and exit code