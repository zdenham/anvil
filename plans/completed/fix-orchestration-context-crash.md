# Fix: Agent Crash — `orchestrationContext is not defined`

Post-mortem for the agent startup crash and missing error banner text after the event-driven-state-sync implementation.

## Phases

- [x] Fix variable name typo in `shared.ts`
- [x] Pass `error` prop to `<ThreadView>` in `thread-content.tsx`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Diagnosis

### Bug 1: Agent crash — `orchestrationContext is not defined`

**File**: `agents/src/runners/shared.ts:538`

The `runAgentLoop()` function signature names the parameter `context` (line 411):

```ts
export async function runAgentLoop(
  config: RunnerConfig,
  context: OrchestrationContext,  // ← named "context"
  ...
)
```

But line 538 references `orchestrationContext` — a variable that doesn't exist in this scope:

```ts
createCommentResolutionHook({
  worktreeId: orchestrationContext.worktreeId,  // ❌ ReferenceError
  emitEvent,
}),
```

This throws a `ReferenceError` at agent startup when building the PreToolUse hooks array, before the agent loop even begins. The error propagates up to `runner.ts` and is logged as:

```
Agent failed: orchestrationContext is not defined
```

**Fix**: Change `orchestrationContext.worktreeId` → `context.worktreeId`.

### Bug 2: Red box with no text above thread input

**File**: `src/components/content-pane/thread-content.tsx:495-504`

`ThreadView` accepts an optional `error?: string` prop (defined at `thread-view.tsx:24`). When `status === "error"` and there are messages, it renders a red banner at the bottom:

```tsx
{status === "error" && messages.length > 0 && (
  <div className="absolute bottom-0 left-0 right-0 p-4 bg-red-950/90 border-t border-red-500/30">
    <p className="text-sm text-red-300">{error}</p>
  </div>
)}
```

But `thread-content.tsx` never passes the `error` prop:

```tsx
<ThreadView
  key={threadId}
  ref={messageListRef}
  threadId={threadId}
  messages={messages}
  isStreaming={isStreaming}
  status={viewStatus}
  toolStates={toolStates}
  workingDirectory={workingDirectory || undefined}
  // ❌ Missing: error={...}
/>
```

The error string is available on `activeState?.error` (ThreadState has `error?: string` at `core/types/events.ts:400`). Since the prop is undefined, the red banner renders with empty text — a visible red box with nothing in it.

**Fix**: Add `error={activeState?.error}` to the `<ThreadView>` props.

### Connection between the two bugs

Bug 1 causes the agent to crash immediately. The crash sets the thread status to `"error"` with an error message (`"orchestrationContext is not defined"`). Bug 2 means that error message is never shown to the user — they see a red box with no text instead of the actual error. Fixing both means the agent won't crash, and if future errors occur, the message will be visible.

---

## Changes

### `agents/src/runners/shared.ts` — line 538

```diff
- worktreeId: orchestrationContext.worktreeId,
+ worktreeId: context.worktreeId,
```

### `src/components/content-pane/thread-content.tsx` — line 495-504

```diff
  <ThreadView
    key={threadId}
    ref={messageListRef}
    threadId={threadId}
    messages={messages}
    isStreaming={isStreaming}
    status={viewStatus}
    toolStates={toolStates}
    workingDirectory={workingDirectory || undefined}
+   error={activeState?.error}
  />
```
