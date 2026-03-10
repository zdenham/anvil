# Robust Worktree & PR Detection from Agent Bash Commands

## Problem

When an agent runs `git worktree add` or `gh pr create` via Bash, the sidebar doesn't reliably detect and display the results. Two root causes:

### Worktree Detection Bugs

1. `WORKTREE_SYNCED` **listener never calls** `worktree_sync` — The listener at `src/entities/worktrees/listeners.ts:24` only calls `useRepoWorktreeLookupStore.getState().hydrate()`, which re-reads settings.json from disk. But nobody updated settings.json! The `worktree_sync` Tauri command (which runs `git worktree list --porcelain` and merges results into settings.json) is never invoked. So the new worktree is invisible.

2. `is_external: true` **for all discovered worktrees** — `worktree_commands.rs:370` sets `is_external: !is_source` for every newly-discovered worktree. Since agent-created worktrees aren't the source path, they always appear as "external" even though they were created intentionally by an agent within Mort.

3. **Event payload only has** `repoId`**, not** `repoName` — `worktreeService.sync()` requires `repoName`, but `WORKTREE_SYNCED` only carries `repoId`. The listener can't call sync without resolving this.

### PR Detection Gaps

4. **No PostToolUse detection for** `gh pr create` — Unlike `git worktree add`, there's no PostToolUse hook that detects `gh pr create` via Bash. PRs only appear via webhook events (requires gateway channel setup) or manual creation. Without webhooks configured, agent-created PRs are invisible in the sidebar.

5. **Output parsing needed** — `gh pr create` outputs the PR URL to stdout (e.g., `https://github.com/owner/repo/pull/42`). The PostToolUse hook has access to `tool_response` which contains this output. Parsing the URL would give us repo slug and PR number.

## Root Cause Analysis

The worktree flow was designed with the right idea (PostToolUse detection → event → sidebar update) but the listener is broken — it skips the critical `worktree_sync` step that actually discovers new worktrees from git.

The PR flow simply has no equivalent detection mechanism at all.

## Phases

- [x] Fix worktree sync listener to call `worktree_sync` before `hydrate()`

- [x] Fix `is_external` logic for agent-triggered sync

- [x] Add PostToolUse detection for `gh pr create` via Bash

- [x] Add frontend listener for `PR_DETECTED` event

- [x] Add tests for both fixes

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Design

### Phase 1: Fix worktree sync listener

**Problem**: `WORKTREE_SYNCED` listener calls `hydrate()` but skips `worktree_sync`.

**Fix** in `src/entities/worktrees/listeners.ts`:

```typescript
import { worktreeService } from "./service";
import { useRepoWorktreeLookupStore } from "@/stores/repo-worktree-lookup-store";

eventBus.on(EventName.WORKTREE_SYNCED, async ({ repoId }) => {
  // Resolve repoId → repoName from the lookup store
  const repoName = useRepoWorktreeLookupStore.getState().getRepoName(repoId);
  if (repoName === "Unknown") {
    logger.warn(`[WorktreeListener] Cannot sync: unknown repo ${repoId}`);
    return;
  }

  // Actually discover new worktrees from git and update settings.json
  await worktreeService.sync(repoName);

  // Then re-hydrate the store from the updated settings.json
  await useRepoWorktreeLookupStore.getState().hydrate();
});
```

**Key insight**: `getRepoName()` returns "Unknown" for missing repos, so we guard against that.

### Phase 2: Fix `is_external` for agent-triggered sync

**Problem**: `worktree_commands.rs:370` marks all discovered worktrees as `is_external: !is_source`.

**Approach**: The `WORKTREE_SYNCED` event is emitted by Mort's agent system, so worktrees discovered during that sync were created intentionally. We have two options:

**Option A: Add a parameter to** `worktree_sync` — Add an `is_agent_triggered: bool` parameter. When true, newly discovered worktrees get `is_external: false`. This is the cleanest approach because the Tauri command knows the intent.

**Option B: Post-hoc fix in the listener** — After `worktree_sync`, find the new worktree entries and update their `is_external` flag. More fragile.

**Recommended: Option A.**

In `worktree_commands.rs`, change `worktree_sync` signature:

```rust
pub async fn worktree_sync(
    repo_name: String,
    mark_new_as_external: Option<bool>,  // None = true (backward compat)
) -> Result<Vec<WorktreeState>, String> {
    // ...existing code...
    let external = mark_new_as_external.unwrap_or(true);

    existing_worktrees.push(WorktreeState {
        // ...
        is_external: if is_source { false } else { external },
    });
}
```

Update `dispatch_worktree.rs` and `worktreeService.sync()` to pass the parameter.

Then in the `WORKTREE_SYNCED` listener, call `worktreeService.sync(repoName, false)`.

### Phase 3: Add PostToolUse detection for `gh pr create`

**Location**: `agents/src/runners/shared.ts` PostToolUse hook, right after the `git worktree add` detection block (\~line 1080).

```typescript
// Detect PR creation via Bash — trigger PR sync
if (input.tool_name === "Bash") {
  const toolInput = input.tool_input as { command?: string };
  const command = toolInput.command ?? "";

  if (/gh\s+pr\s+create\b/.test(command)) {
    // Parse the PR URL from the tool response
    const response = typeof input.tool_response === "string"
      ? input.tool_response
      : JSON.stringify(input.tool_response);

    // gh pr create outputs the URL on success: https://github.com/owner/repo/pull/123
    const prUrlMatch = response.match(
      /https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/
    );

    if (prUrlMatch && context.repoId && context.worktreeId) {
      const repoSlug = prUrlMatch[1];
      const prNumber = parseInt(prUrlMatch[2], 10);

      emitEvent(EventName.PR_DETECTED, {
        repoId: context.repoId,
        worktreeId: context.worktreeId,
        repoSlug,
        prNumber,
      }, "PostToolUse:gh-pr-create");

      logger.info(`[PostToolUse] Detected gh pr create: #${prNumber} on ${repoSlug}`);
    }
  }
}
```

**New event** in `core/types/events.ts`:

```typescript
PR_DETECTED = "pr:detected",

[EventName.PR_DETECTED]: {
  repoId: string;
  worktreeId: string;
  repoSlug: string;
  prNumber: number;
};
```

Add to `BRIDGED_EVENTS` in `src/lib/event-bridge.ts`.

### Phase 4: Frontend listener for `PR_DETECTED`

**Location**: `src/entities/pull-requests/listeners.ts` (extend `setupInternalPrListeners`)

```typescript
eventBus.on(EventName.PR_DETECTED, async ({ repoId, worktreeId, repoSlug, prNumber }) => {
  // Idempotent: skip if already exists
  const existing = pullRequestService.getByRepoAndNumber(repoId, prNumber);
  if (existing) return;

  // Look up current branch from the worktree
  const currentBranch = useRepoWorktreeLookupStore
    .getState()
    .getCurrentBranch(repoId, worktreeId);

  // Fetch baseBranch from GH CLI if possible, otherwise default to repo's default branch
  const baseBranch = useRepoWorktreeLookupStore
    .getState()
    .getDefaultBranch(repoId);

  await pullRequestService.create({
    prNumber,
    repoId,
    worktreeId,
    repoSlug,
    headBranch: currentBranch ?? "",
    baseBranch,
  });

  logger.info(`[PrListener] Created PR entity from agent detection: #${prNumber}`);
});
```

### Phase 5: Tests

**Worktree sync fix**: Unit test that verifies `worktree_sync` is called (not just `hydrate`) when `WORKTREE_SYNCED` fires. Mock `worktreeService.sync` and verify it's invoked with the correct repo name.

**PR detection**: Unit test in `agents/src/runners/__tests__/` that verifies the PostToolUse regex matches various `gh pr create` command patterns and correctly parses PR URLs from tool responses. Also test edge cases: failed commands (no URL in output), compound commands, etc.

**Key test patterns for PR URL parsing**:

- `gh pr create --title "foo" --body "bar"` → output: `https://github.com/owner/repo/pull/42`
- `gh pr create 2>&1` → output might include error text before URL
- Command fails → no URL in output → no event emitted

**Key test patterns for worktree regex**:

- `git worktree add ../path branch`
- `git worktree add -b branch ../path`
- `git worktree add ../path branch 2>&1 || git worktree add -b branch ../path 2>&1` (user's exact command)

## Files to Modify

| File | Change |
| --- | --- |
| `src/entities/worktrees/listeners.ts` | Call `worktreeService.sync()` before `hydrate()` |
| `src/entities/worktrees/service.ts` | Add `markNewAsExternal` parameter to `sync()` |
| `src-tauri/src/worktree_commands.rs` | Add `mark_new_as_external` param to `worktree_sync` |
| `src-tauri/src/ws_server/dispatch_worktree.rs` | Pass new param in dispatch |
| `agents/src/runners/shared.ts` | Add PostToolUse detection for `gh pr create` |
| `core/types/events.ts` | Add `PR_DETECTED` event |
| `src/lib/event-bridge.ts` | Add `PR_DETECTED` to `BROADCAST_EVENTS` |
| `src/entities/pull-requests/listeners.ts` | Add `PR_DETECTED` listener |

## Risk Assessment

- **Worktree sync fix** is low risk — adding the missing `worktree_sync` call is what the original plan intended
- **is_external parameter** is backward compatible — `None` defaults to current behavior
- **PR detection** is new functionality, isolated to PostToolUse and a new event — no risk to existing PR flows
- All detection uses PostToolUse (after execution), so no blocking or permission concerns