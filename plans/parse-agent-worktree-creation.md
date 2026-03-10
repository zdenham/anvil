# Parse Agent Worktree Creation

## Problem

When an agent uses the `EnterWorktree` tool (Claude Code's built-in worktree tool), Mort doesn't know about it until a manual `worktree_sync` occurs. This causes the sidebar to show stale data, and users may create duplicate worktrees because the agent-created one isn't visible yet.

**Current state of PR detection (for reference):** PRs are NOT detected by parsing tool calls. PR creation is detected via GitHub webhooks (`pull_request.opened`) delivered through gateway channels. The `handlePullRequestEvent` in `pr-lifecycle-handler.ts` processes webhook payloads to auto-create PR entities. This is a fundamentally different mechanism from what we need here.

## How Agent Worktrees Work Today

1. **Mort-managed worktrees** (`worktree_create` Tauri command): Mort creates the worktree, writes to `settings.json`, and the sidebar hydrates from it. This path works.

2. **Agent-created worktrees** (`EnterWorktree` tool): Claude Code creates a git worktree under `.claude/worktrees/` in the repo. Mort has **zero visibility** into this — no event is emitted, no settings.json update, no sidebar refresh. The worktree only appears after a `worktree_sync` call (which scans `git worktree list`).

3. **Worktree naming flow**: The `SimpleRunnerStrategy` already handles worktree renaming after first message — it writes to `settings.json` on disk and emits `WORKTREE_NAME_GENERATED`. But this only works for worktrees Mort already knows about.

## Approach

Intercept the `EnterWorktree` tool call in the agent's **PostToolUse hook** (in `shared.ts`). When we detect that `EnterWorktree` was used successfully, parse the tool response to extract the worktree path, then trigger a `worktree_sync` + emit an event so the sidebar refreshes.

This mirrors the existing PostToolUse patterns for:

- File change tracking (`FILE_MODIFYING_TOOLS` detection)
- Plan detection (`isPlanPath` + `PLAN_DETECTED` event)
- Sub-agent thread completion (`Task`/`Agent` tool handling)

## Phases

- [ ] Research: Verify `EnterWorktree` tool response format from Claude Code SDK

- [ ] Add `WORKTREE_SYNCED` event to core event types

- [ ] Add PostToolUse hook logic in `shared.ts` to detect `EnterWorktree` completion

- [ ] Parse worktree path from tool response and call `worktree_sync` via events

- [ ] Add frontend listener for `WORKTREE_SYNCED` to re-hydrate sidebar

- [ ] Add tests for the PostToolUse hook worktree detection logic

- [ ] Integration test: verify sidebar updates after agent `EnterWorktree`

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Design

### 1. PostToolUse Hook (agents/src/runners/shared.ts)

In the existing PostToolUse hook, add a check after the file-modifying tools block:

```typescript
// Detect EnterWorktree tool — trigger worktree sync so sidebar updates
if (input.tool_name === "EnterWorktree") {
  const response = typeof input.tool_response === "string"
    ? input.tool_response
    : JSON.stringify(input.tool_response);

  // EnterWorktree response contains the worktree path
  // Parse it and emit event for frontend to sync
  try {
    const parsed = JSON.parse(response);
    const worktreePath = parsed?.path ?? parsed?.worktree_path;

    if (worktreePath && context.repoId) {
      emitEvent(EventName.WORKTREE_SYNCED, {
        repoId: context.repoId,
        worktreePath,
      }, "PostToolUse:enter-worktree");

      logger.info(`[PostToolUse] Detected EnterWorktree: ${worktreePath}`);
    }
  } catch {
    // Response may not be JSON — still emit a generic sync event
    if (context.repoId) {
      emitEvent(EventName.WORKTREE_SYNCED, {
        repoId: context.repoId,
      }, "PostToolUse:enter-worktree");
    }
  }
}
```

### 2. New Event (core/types/events.ts)

```typescript
WORKTREE_SYNCED: "worktree:synced",

// In EventPayloads:
[EventName.WORKTREE_SYNCED]: {
  repoId: string;
  worktreePath?: string;
};
```

Add to `BRIDGED_EVENTS` in `event-bridge.ts`.

### 3. Frontend Listener (src/entities/worktrees/listeners.ts)

```typescript
eventBus.on(EventName.WORKTREE_SYNCED, async ({ repoId }: EventPayloads[typeof EventName.WORKTREE_SYNCED]) => {
  // Find repo name from repoId, call worktreeService.sync(repoName)
  // Then re-hydrate the lookup store
  await useRepoWorktreeLookupStore.getState().hydrate();
});
```

### 4. Key Files to Modify

| File | Change |
| --- | --- |
| `core/types/events.ts` | Add `WORKTREE_SYNCED` event |
| `src/lib/event-bridge.ts` | Add to `BRIDGED_EVENTS` |
| `agents/src/runners/shared.ts` | PostToolUse hook: detect `EnterWorktree` |
| `src/entities/worktrees/listeners.ts` | Listen for `WORKTREE_SYNCED`, call sync + hydrate |

### 5. Open Questions

- **EnterWorktree response format**: Need to verify what the Claude Code SDK returns from `EnterWorktree`. The tool response may be a plain string, JSON with a `path` field, or something else. Phase 1 addresses this.
- **Race condition**: The agent's `EnterWorktree` creates a git worktree that Mort doesn't know about. Between creation and our `worktree_sync`, another agent could also try to create a worktree. The `worktree_sync` is idempotent so this is safe — it just discovers what's on disk.
- **Should we also update the thread's worktreeId?**: If an agent enters a new worktree mid-conversation, the thread metadata still points to the old worktreeId. This is a separate concern and out of scope for this plan.