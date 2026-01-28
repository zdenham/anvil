# Fix: Worktree Renaming Not Persisting to Disk

## Problem

When a new thread is created, the agent generates a worktree name via Haiku but the name never gets persisted to disk. The logs show:

```
[worktree_rename] Haiku returned: "tech-audit", sanitized to: "tech-audit"
[worktree_rename] generateWorktreeName resolved with name: "tech-audit"
[worktree_rename] Emitting worktree:name:generated event...
[WARN] [handleAgentEvent] Unhandled event: worktree:name:generated
```

## Root Causes

### 1. Frontend Event Handler Missing (FIXED)

The `handleAgentEvent` function in `src/lib/agent-service.ts` was missing a case for `EventName.WORKTREE_NAME_GENERATED`. This has been fixed - the event now gets forwarded to `eventBus`.

### 2. Agent Should Write to Disk Directly (NOT FIXED)

The current architecture relies on the frontend to handle the disk write via Tauri commands. However:

- **Thread naming works** because the agent writes directly to disk (`threads/{threadId}/metadata.json`) before emitting the event
- **Worktree naming fails** because the agent only emits an event, expecting the frontend to call `worktree_rename` Tauri command

This is fragile because:
- If the event gets lost (as was happening), the name is never persisted
- The agent has all the information needed to write directly
- It adds unnecessary round-trip through the event system

## Solution

Follow the same pattern as thread naming: **write to disk in the agent, then emit event for UI refresh**.

### Changes Required

#### 1. `agents/src/runners/simple-runner-strategy.ts`

Update `initiateWorktreeNaming` to write the worktree name to disk before emitting the event:

```typescript
private initiateWorktreeNaming(
  worktreeId: string,
  repoId: string,
  prompt: string,
  mortDir: string  // Add mortDir parameter
): void {
  // ... existing API key check ...

  generateWorktreeName(prompt, apiKey)
    .then((name) => {
      // Write to disk FIRST (same pattern as thread naming)
      try {
        this.updateWorktreeNameOnDisk(mortDir, repoId, worktreeId, name);
        emitLog("INFO", `[worktree_rename] Updated worktree name on disk: "${name}"`);
      } catch (err) {
        emitLog("ERROR", `[worktree_rename] Failed to write name to disk: ${err}`);
        // Continue to emit event anyway - frontend might be able to recover
      }

      // Then emit event for UI refresh
      events.worktreeNameGenerated(worktreeId, repoId, name);
    })
    .catch((error) => {
      emitLog("WARN", `[worktree_rename] Failed to generate name: ${error.message}`);
    });
}
```

#### 2. Add helper method to write worktree name

```typescript
/**
 * Update worktree name in repository settings on disk.
 * Scans repositories to find the one with matching repoId,
 * then updates the worktree's name and sets isRenamed=true.
 */
private updateWorktreeNameOnDisk(
  mortDir: string,
  repoId: string,
  worktreeId: string,
  newName: string
): void {
  const reposDir = join(mortDir, "repositories");

  // Find the repository settings file
  const repoDirs = readdirSync(reposDir).filter(name => {
    const stat = statSync(join(reposDir, name));
    return stat.isDirectory();
  });

  for (const repoDir of repoDirs) {
    const settingsPath = join(reposDir, repoDir, "settings.json");
    if (!existsSync(settingsPath)) continue;

    const content = readFileSync(settingsPath, "utf-8");
    const parsed = RepositorySettingsSchema.safeParse(JSON.parse(content));
    if (!parsed.success) continue;

    const settings = parsed.data;
    if (settings.id !== repoId) continue;

    // Found the right repo - update the worktree
    const worktreeIndex = settings.worktrees.findIndex(w => w.id === worktreeId);
    if (worktreeIndex === -1) {
      throw new Error(`Worktree ${worktreeId} not found in repo ${repoId}`);
    }

    settings.worktrees[worktreeIndex] = {
      ...settings.worktrees[worktreeIndex],
      name: newName,
      isRenamed: true,
    };
    settings.lastUpdated = Date.now();

    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return;
  }

  throw new Error(`Repository ${repoId} not found`);
}
```

#### 3. Update call site in `setup()`

Pass `mortDir` to `initiateWorktreeNaming`:

```typescript
// Current:
this.initiateWorktreeNaming(worktreeId, repoId, prompt);

// Updated:
this.initiateWorktreeNaming(worktreeId, repoId, prompt, mortDir);
```

#### 4. Keep frontend listener as backup

The listener in `src/entities/worktrees/listeners.ts` should remain as a safety net for:
- Cross-window synchronization (other windows need to know about the rename)
- Future scenarios where events come from other sources

The frontend handler should be idempotent - if the worktree is already renamed, it should be a no-op.

## Files to Modify

| File | Change |
|------|--------|
| `agents/src/runners/simple-runner-strategy.ts` | Add disk write before event emission |
| `src/lib/agent-service.ts` | Already fixed - event forwarding added |
| `src/entities/worktrees/listeners.ts` | Make rename idempotent (check if already renamed) |

## Testing

1. Create a new worktree
2. Start a thread in the worktree
3. Verify the worktree name is updated in `~/.mort/repositories/{repo}/settings.json`
4. Verify `isRenamed: true` is set
5. Verify UI reflects the new name
6. Subsequent threads in the same worktree should NOT trigger renaming (isRenamed check)
