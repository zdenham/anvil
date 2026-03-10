# Auto-Archive Setup Threads on Success

## Problem

When a repo has a `worktreeSetupPrompt`, every new worktree creates a full thread visible in the sidebar. Users must manually archive these threads each time. The setup thread is transient by nature — it runs `npm install`, copies `.env`, etc. — and shouldn't stick around cluttering the workspace.

## Goal

After a setup thread's agent completes successfully, auto-archive the thread so it disappears from the sidebar without user intervention. If the agent errors, leave the thread visible so the user can inspect what went wrong.

## Design

### How the agent determines success

The agent already emits a final status during `strategy.cleanup()` in `simple-runner-strategy.ts:532-537`:
- `"completed"` on success (from `runner.ts:403`)
- `"error"` on failure (from `runner.ts:446`)
- `"cancelled"` on abort (from `runner.ts:425`)

The frontend receives this via `thread:status-changed` event. This is the signal.

### Approach: Mort REPL SDK `archive()` method

Extend `MortReplSdk` with a `mort.archive(threadId)` method that emits a `thread:archived` event. The setup thread's prompt can end with a mort-repl call:

```
mort-repl "await mort.archive(mort.context.threadId)"
```

**Why this approach:**
- Aligns with the direction of making the SDK more robust for UI control
- The agent self-determines success — it only reaches the archive call if all prior setup steps succeeded (the agent naturally stops on error)
- Keeps the pattern consistent: the SDK is the bridge between agent logic and UI actions
- No special-case infrastructure needed — just a new SDK method

### Alternative considered: frontend listener auto-archive

Listen for `thread:status-changed` where `status === "completed"` and the thread has a setup flag. Simpler, but the agent doesn't truly self-determine success — a completed status just means the agent loop ended, not that `npm install` actually worked. The agent is in a better position to judge.

## Phases

- [ ] Add `archive()` method to `MortReplSdk` that emits `thread:archived` event
- [ ] Wire up the archive event in the repl hook context (ensure `emitEvent` is available)
- [ ] Update the frontend `thread:archived` listener to handle agent-emitted archives (verify it works when the event comes from the agent process rather than a UI action)
- [ ] Update the default `worktreeSetupPrompt` documentation/example to include the `mort-repl` archive call at the end
- [ ] Add tests: unit test for `MortReplSdk.archive()`, integration test confirming the event flows through

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Details

### Phase 1: `MortReplSdk.archive()`

In `agents/src/lib/mort-repl/mort-sdk.ts`, add:

```ts
async archive(threadId?: string): Promise<void> {
  const id = threadId ?? this._context.threadId;
  this._emitEvent(EventName.THREAD_ARCHIVED, { threadId: id });
  this.log(`Archived thread ${id}`);
}
```

The SDK needs access to `emitEvent`. The constructor already receives a `ChildSpawner` which has the context — but `emitEvent` is passed separately through `ReplHookDeps`. Thread it through:

1. Add `emitEvent` to `MortReplSdk` constructor params (alongside spawner and context)
2. Store as private field, call from `archive()`

### Phase 2: Wire `emitEvent` into SDK

In `agents/src/hooks/repl-hook.ts`, the `createReplHook` function already receives `deps.emitEvent`. Pass it to the `MortReplSdk` constructor:

```ts
const sdk = new MortReplSdk(spawner, deps.context, deps.emitEvent);
```

### Phase 3: Frontend listener compatibility

`src/entities/threads/listeners.ts:201` already handles `THREAD_ARCHIVED`:

```ts
eventBus.on(EventName.THREAD_ARCHIVED, ({ threadId }) => { ... });
```

The event bridge (`src/lib/event-bridge.ts`) routes agent-emitted events to the frontend `eventBus`. Verify that `thread:archived` from the agent process is handled the same as a UI-initiated archive. The key difference: UI archives move files on disk (to `archive/threads/`), but agent-emitted archives would skip that. Two options:

**Option A (recommended):** Have the frontend listener trigger the full `threadService.archive()` when it receives the event from the agent. This ensures disk state stays consistent.

**Option B:** Have the SDK do the disk move itself (since the agent process has filesystem access). But this duplicates logic and the agent shouldn't need to know about `~/.mort` archive directory structure.

### Phase 4: Setup prompt example

Update the default example in `src/components/main-window/settings/repository-settings.tsx` and any docs to show:

```
Copy .env.example to .env, run npm install, then archive this thread:
mort-repl "await mort.archive()"
```

### Phase 5: Tests

- **Unit**: `MortReplSdk.archive()` calls `emitEvent` with correct event name and payload
- **Integration**: Full flow — repl hook intercepts `mort-repl "await mort.archive()"`, SDK emits event, formatted result returned
