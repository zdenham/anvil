# 01 - Breaking Changes

**Priority:** HIGH
**Dependencies:** None
**Estimated Files:** 3-4

## Overview

Remove CLI task commands and legacy Tauri commands that could cause runtime errors.

## Tasks

### 1. Remove CLI Task Commands

**File:** `agents/src/cli/anvil.ts`

Remove the entire task CLI section:
- [ ] Delete placeholder types (lines 8-21)
  ```typescript
  // TODO: Task functionality has been removed from the codebase.
  type TaskStatus = "draft" | "backlog" | "todo" | "in-progress" | "in-review" | "done" | "cancelled";
  interface TaskMetadata { ... }
  ```
- [ ] Delete `validateStatus()` function
- [ ] Delete `formatTaskLine()` and `formatTaskDetails()` functions
- [ ] Delete task help text and `showTasksHelp()` function
- [ ] Delete `tasksList`, `tasksCreate`, `tasksRename`, `tasksUpdate`, `tasksGet` functions
- [ ] Remove command routing for `tasks` subcommand

### 2. Remove Legacy openTask Function

**File:** `src/lib/hotkey-service.ts` (lines 94-101)

```typescript
export const openTask = async (
  threadId: string,
  taskId: string,  // <-- This parameter is legacy
  prompt?: string,
  repoName?: string
): Promise<void> => {
  await invoke("open_task", { threadId, taskId, prompt, repoName });
};
```

- [ ] Search for usages of `openTask` function
- [ ] Delete the function if unused
- [ ] If used, refactor callers to not use taskId

### 3. Remove Rust Backend Command

**File:** `src-tauri/src/anvil_commands.rs` (or similar)

- [ ] Find the `open_task` Tauri command
- [ ] Remove it from Rust backend
- [ ] Update any command registrations in `lib.rs`

## Verification

```bash
# Ensure no runtime errors
pnpm build

# Run tests
pnpm test

# Search for remaining openTask references
rg "openTask|open_task" --type ts --type rust
```

## Success Criteria

- [ ] CLI `anvil tasks` command removed or returns helpful error
- [ ] No `openTask` function in hotkey-service.ts
- [ ] No `open_task` command in Rust backend
- [ ] All tests pass
- [ ] Build succeeds
