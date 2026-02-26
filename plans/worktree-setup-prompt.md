# Worktree Setup Prompt

Configurable per-repo prompt that automatically runs an agent to set up a new worktree when one is created (e.g., copy `.env`, install deps, run migrations).

## Phases

- [x] Add `worktreeSetupPrompt` field to repository settings schema and types
- [x] Add `--skip-naming` flag to prevent worktree/branch renaming from setup threads
- [x] Add UI to configure the setup prompt in repository settings
- [x] Auto-create and run a setup thread after worktree creation (with `--skip-naming`)
- [x] Add tests

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `worktreeSetupPrompt` to Repository Settings

**File**: `core/types/repositories.ts`

Add an optional `worktreeSetupPrompt` field to `RepositorySettingsSchema`:

```typescript
/** Optional prompt sent to an agent to set up new worktrees (install deps, copy env vars, etc.) */
worktreeSetupPrompt: z.string().nullable().default(null),
```

This field is nullable so repos without a setup prompt simply skip the auto-setup step. Using `.default(null)` means existing `settings.json` files migrate seamlessly — Zod fills in `null` when the field is missing.

No changes needed to `RepositoryMetadata` (that's the legacy schema) or `UpdateRepositoryInput` (settings are updated via the Rust backend / `appData` layer).

## Phase 2: Add `--skip-naming` Flag to Prevent Worktree/Branch Renaming

**Problem**: The setup thread will be the first thread in the new worktree. `SimpleRunnerStrategy.setup()` triggers `initiateWorktreeNaming()` on the first thread (checks `isWorktreeRenamed` → false, `isMainWorktree` → false), which would:
1. Generate a worktree name from the setup prompt (e.g., "copy-env-npm-install") — a nonsensical name
2. Set `isRenamed: true`, preventing the *real* first user thread from naming the worktree
3. Create and checkout a git branch with that bad name

**Solution**: Thread a `--skip-naming` flag from frontend → agent CLI → runner so setup threads don't trigger naming.

### Changes

**`agents/src/runners/types.ts`** — Add to `RunnerConfig`:
```typescript
/** Skip worktree and thread naming (used by setup threads that shouldn't influence names) */
skipNaming?: boolean;
```

**`agents/src/runners/simple-runner-strategy.ts`** — `parseArgs()`:
```typescript
case "--skip-naming":
  config.skipNaming = true;
  break;  // Boolean flag, no value to consume
```

**`agents/src/runners/simple-runner-strategy.ts`** — `setup()` (around line 422-438):
Add a guard before the naming calls:
```typescript
if (config.skipNaming) {
  emitLog("INFO", `[naming] Skipping thread and worktree naming — setup thread`);
} else {
  this.initiateThreadNaming(threadId, prompt, threadPath);

  const alreadyRenamed = isWorktreeRenamed(mortDir, repoId, worktreeId);
  const mainWorktree = isMainWorktree(mortDir, repoId, worktreeId);
  // ... existing naming logic
}
```

**`src/lib/agent-service.ts`** — `SpawnSimpleAgentOptions`:
```typescript
/** Skip worktree/thread naming (for setup threads) */
skipNaming?: boolean;
```

**`src/lib/agent-service.ts`** — `spawnSimpleAgent()` command args:
```typescript
...(parsed.skipNaming ? ["--skip-naming"] : []),
```

**`src/lib/thread-creation-service.ts`** — `CreateThreadOptions`:
```typescript
/** Skip worktree/thread naming (for setup threads) */
skipNaming?: boolean;
```

Pass through to `spawnSimpleAgent`:
```typescript
spawnSimpleAgent({
  ...existing,
  skipNaming: options.skipNaming,
});
```

## Phase 3: UI for Configuring the Setup Prompt

**File**: `src/components/main-window/settings/repository-settings.tsx`

Add an expandable section per repo that lets the user write/edit the setup prompt:

- Add an "Edit Setup Prompt" button or collapsible section below the existing repo card
- Use a `<textarea>` for multi-line prompt editing
- Show placeholder text: `"e.g., Copy .env from the main worktree, run npm install, run db:migrate..."`
- Save on blur or explicit "Save" button — writes to `settings.json` via the existing repo settings update flow

The save flow:
1. Load current `settings.json` for the repo slug via `appData.loadSettings(slug)`
2. Merge the new `worktreeSetupPrompt` value
3. Write back via `appData.writeJson(settingsPath, updatedSettings)`

Alternatively, if there's already a Tauri command for updating settings, use that. Check `src/entities/repositories/service.ts` for existing update patterns.

## Phase 4: Auto-create Setup Thread After Worktree Creation

**File**: `src/components/main-window/main-window-layout.tsx` — `handleNewWorktree`

After the worktree is successfully created and synced (line ~401), check if the repo has a `worktreeSetupPrompt`. If so, spawn a setup agent with `skipNaming: true` so it doesn't hijack the worktree/branch name:

```typescript
// After worktree creation succeeds:
const settings = await loadSettings(slugify(repoName));
if (settings.worktreeSetupPrompt) {
  // Find the newly created worktree from the synced list
  const newWorktree = settings.worktrees.find(w => w.name === worktreeName);
  if (newWorktree) {
    await createThread({
      prompt: settings.worktreeSetupPrompt,
      repoId: settings.id,
      worktreeId: newWorktree.id,
      worktreePath: newWorktree.path,
      permissionMode: "implement", // setup needs write access
      skipNaming: true, // Don't rename worktree/branch based on setup prompt
    });
  }
}
```

**Why `skipNaming: true` is critical**: Without this flag, the setup thread — being the first thread in the worktree — would trigger `initiateWorktreeNaming()`. This would generate a worktree name from the setup prompt text (e.g., "copy-env-run-npm"), set `isRenamed: true` to prevent future renaming, and create/checkout a git branch with that bad name. The user's actual first task thread should be the one that names the worktree.

This reuses the existing `createThread` from `thread-creation-service.ts` which handles optimistic UI + agent spawning. The setup thread appears in the sidebar like any other thread and the user can watch it work.

**System prompt context**: The agent already receives `--cwd` set to the worktree path, so the setup prompt can reference relative paths. The prompt should be written by the user to be self-contained (e.g., "Copy .env from /path/to/main/.env to this directory, then run `npm install`").

## Phase 5: Tests

- Unit test: Verify `RepositorySettingsSchema` parses correctly with and without the new field (null default migration)
- Unit test: Verify `--skip-naming` is parsed correctly by `SimpleRunnerStrategy.parseArgs()` and that `skipNaming` defaults to `undefined` when not provided
- Integration consideration: The thread creation flow is already tested; the new code just conditionally calls `createThread` based on a settings field

## Notes

- The setup thread runs with `permissionMode: "implement"` so the agent can execute shell commands, write files, etc.
- The setup thread passes `skipNaming: true` to prevent worktree renaming and branch creation from the setup prompt — the user's first real thread will name the worktree instead
- The user can cancel the setup thread if needed — it's a normal thread in the UI
- Small agent runner change needed: the `--skip-naming` flag threads through `agent-service.ts` → CLI args → `SimpleRunnerStrategy`
- The prompt text is stored in `~/.mort/repositories/{slug}/settings.json` alongside other repo settings
