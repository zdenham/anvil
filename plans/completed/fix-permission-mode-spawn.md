# Fix: Permission Mode Reverts to "plan" on Agent Spawn

## Problem

When a user changes the permission mode to "approve" (via Shift+Tab) and then spawns an agent, the UI reverts back to "plan". The selected permission mode is not being passed through to the spawned agent process.

## Root Cause

There are **two bugs** that combine to cause this:

### Bug 1: Runner overwrites metadata with hardcoded "plan" (CRITICAL)

In `agents/src/runners/simple-runner-strategy.ts:388`, when a new thread is spawned, the runner writes its own `metadata.json` with `permissionMode: "plan"` hardcoded:

```typescript
const threadMetadata: SimpleThreadMetadata = {
  // ...
  permissionMode: "plan",  // ← HARDCODED, ignores whatever frontend wrote
  // ...
};
writeFileSync(threadMetadataPath, JSON.stringify(threadMetadata, null, 2));
```

This overwrites whatever the frontend had previously saved to disk, including the user's selected "approve" mode.

### Bug 2: Permission mode not passed as CLI argument

In `src/lib/agent-service.ts:670-679`, the `spawnSimpleAgent` function builds command args but never includes `--permission-mode`:

```typescript
const commandArgs = [
  runnerPath,
  "--repo-id", parsed.repoId,
  "--worktree-id", parsed.worktreeId,
  "--thread-id", parsed.threadId,
  "--cwd", parsed.sourcePath,
  "--prompt", parsed.prompt,
  "--anvil-dir", anvilDir,
  // ← NO --permission-mode
];
```

And `SpawnSimpleAgentOptions` (line 497) doesn't include `permissionMode` at all.

### The race / overwrite sequence

1. User selects "approve" → frontend calls `threadService.update()` → writes `permissionMode: "approve"` to `~/.anvil/threads/{id}/metadata.json`
2. User sends message → `spawnSimpleAgent()` is called (without permission mode)
3. Agent process starts → `setup()` in `simple-runner-strategy.ts` runs
4. For new threads, `setup()` writes a fresh `metadata.json` with `permissionMode: "plan"` — **overwriting** the frontend's file
5. Then `setup()` immediately reads back from that same file → gets "plan"
6. Agent runs in "plan" mode
7. Frontend's file watcher or hub messages update the UI → shows "plan"

For the **resumed thread path** (not first message), Bug 1 doesn't apply because metadata isn't rewritten. But the runner still reads from disk at lines 436-445, and the frontend's async write may not have completed yet (race condition).

## Fix

### Step 1: Add `permissionMode` to spawn options and CLI args

**`src/lib/agent-service.ts`**:
- Add `permissionMode` to `SpawnSimpleAgentOptions` and `SpawnOptionsSchema`
- Pass `--permission-mode` in `commandArgs`

**All call sites** that invoke `spawnSimpleAgent()`:
- `src/components/content-pane/thread-content.tsx:360` — pass `permissionMode` from `activeMetadata.permissionMode`
- `src/components/content-pane/plan-content.tsx:168` — pass permission mode
- `src/components/control-panel/plan-view.tsx:237` — pass permission mode
- `src/lib/thread-creation-service.ts:146` — pass permission mode (may need to accept it as a parameter)

### Step 2: Parse `--permission-mode` in the runner

**`agents/src/runners/simple-runner-strategy.ts`**:
- Add `case "--permission-mode"` to `parseArgs()` switch (line 204)
- Add `permissionMode` to `RunnerConfig` interface in `agents/src/runners/types.ts`

### Step 3: Use CLI arg instead of hardcoded value in metadata write

**`agents/src/runners/simple-runner-strategy.ts`**:
- In `setup()` (line 388), use `config.permissionMode ?? "plan"` instead of hardcoded `"plan"`
- Remove the separate read-back from disk (lines 436-445) — use the CLI arg as source of truth

### Step 4: Pass through to OrchestrationContext

The runner already passes `permissionModeId` in the context (line 454). Just wire it from the config instead of re-reading from disk:

```typescript
return {
  workingDir: cwd,
  threadId,
  threadPath,
  repoId,
  worktreeId,
  permissionModeId: config.permissionMode ?? "plan",
};
```

## Files to Change

| File | Change |
|------|--------|
| `agents/src/runners/types.ts` | Add `permissionMode?: PermissionModeId` to `RunnerConfig` |
| `agents/src/runners/simple-runner-strategy.ts` | Parse `--permission-mode` CLI arg; use it in metadata write and context return |
| `src/lib/agent-service.ts` | Add `permissionMode` to options schema; pass `--permission-mode` in command args |
| `src/components/content-pane/thread-content.tsx` | Pass `permissionMode` to `spawnSimpleAgent()` |
| `src/components/content-pane/plan-content.tsx` | Pass `permissionMode` to `spawnSimpleAgent()` |
| `src/components/control-panel/plan-view.tsx` | Pass `permissionMode` to `spawnSimpleAgent()` |
| `src/lib/thread-creation-service.ts` | Accept and pass `permissionMode` to `spawnSimpleAgent()` |

## Phases

- [x] Add `permissionMode` to `RunnerConfig`, `SpawnSimpleAgentOptions`, CLI parsing, and command args
- [x] Use CLI-provided permission mode in metadata write and context return (remove read-back-from-disk pattern)
- [x] Update all `spawnSimpleAgent()` call sites to pass permission mode from thread metadata
- [x] Verify the resume path also respects the current permission mode

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
