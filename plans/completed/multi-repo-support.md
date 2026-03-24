# Multi-Repository Support Plan

## Overview

This plan outlines the implementation of seamless multi-repository support in Anvil. The codebase already has a solid foundation for multiple repositories (UUID-based identification, per-repo settings, multi-repo store), but the UI and workflows currently assume a single repository context.

**Key Design Principle**: Repository/worktree selection uses a **flat MRU (Most Recently Used) list**. The existing left/right arrow keys cycle through repo+worktree combinations sorted by recency. No "default repository" concept - just MRU ordering.

## Current State Analysis

### What Already Works
- **Data structures**: `Record<string, Repository>` store, per-repo settings.json, UUID-based identification
- **Worktree tracking**: Per-repository worktree arrays with UUIDs
- **Thread context**: Agents already receive `repoId` and `worktreeId` when spawned
- **Hydration**: `repoService.hydrate()` loads all repositories from `~/.anvil/repositories/`
- **Backend**: Rust worktree commands accept repo name parameter
- **Arrow key navigation**: Left/right arrows already cycle through worktrees

### What's Missing
1. **Settings "Add Repository" button is non-functional** - just logs to console
2. **Worktree list is single-repo** - only loads worktrees from one repository
3. **No cross-repo MRU tracking** - `lastAccessedAt` exists per-worktree but not aggregated across repos

---

## Phase 1: Fix "Add Repository" Button

**Goal**: Make the settings page button functional

### Task 1.1: Wire up file picker dialog

**File**: `src/components/main-window/settings/repository-settings.tsx`

**Changes needed**:
```typescript
// Current (non-functional):
const handleAddRepository = async () => {
  console.log("Add repository");
};

// Should become:
import { open } from "@tauri-apps/plugin-dialog";

const handleAddRepository = async () => {
  try {
    const selectedPath = await open({
      directory: true,
      multiple: false,
      title: "Select Repository Folder",
    });

    if (selectedPath && typeof selectedPath === "string") {
      await repoService.createFromFolder(selectedPath);
      // Refresh repository list
      await repoService.hydrate();
    }
  } catch (error) {
    console.error("Failed to add repository:", error);
    // TODO: Show user-facing error
  }
};
```

**Reference implementation**: `src/components/spotlight/spotlight.tsx` lines 282-306 has working file picker

### Task 1.2: Add validation for duplicate repositories

**File**: `src/entities/repositories/service.ts`

**Changes needed**:
- Check if repository path is already registered before creating
- Check if repository name (slug) would conflict
- Return meaningful error messages

### Task 1.3: Add success/error feedback in settings UI

**File**: `src/components/main-window/settings/repository-settings.tsx`

**Changes needed**:
- Show loading state during add operation
- Display success toast/notification
- Display error message if add fails

---

## Phase 2: Unified Repo+Worktree MRU Navigation

**Goal**: Replace single-repo worktree list with a flat MRU list of repo+worktree combinations. The existing left/right arrow keys cycle through this unified list.

### Task 2.1: Define RepoWorktree combination type

**File**: `core/types/repositories.ts`

**Add new type**:
```typescript
export interface RepoWorktree {
  repoName: string;
  repoId: string;
  worktree: WorktreeState;
}
```

### Task 2.2: Replace worktree state with unified MRU list

**File**: `src/components/spotlight/spotlight.tsx`

**Current state**:
```typescript
interface SpotlightState {
  availableWorktrees: WorktreeState[];
  selectedWorktreeIndex: number;
}
```

**New state**:
```typescript
interface SpotlightState {
  // Flat list of all repo+worktree combos, sorted by MRU
  repoWorktrees: RepoWorktree[];
  selectedWorktreeIndex: number;  // Index into repoWorktrees
}
```

### Task 2.3: Load worktrees from ALL repositories

**File**: `src/components/spotlight/spotlight.tsx`

**Replace `loadWorktrees` function**:
```typescript
const loadWorktrees = useCallback(async () => {
  const repos = controller.getRepositories();
  const allRepoWorktrees: RepoWorktree[] = [];

  // Gather worktrees from all repos
  for (const repo of repos) {
    try {
      const worktrees = await worktreeService.sync(repo.name);
      for (const wt of worktrees) {
        allRepoWorktrees.push({
          repoName: repo.name,
          repoId: repo.id,
          worktree: wt,
        });
      }
    } catch (err) {
      logger.error(`Failed to load worktrees for ${repo.name}:`, err);
    }
  }

  // Sort by MRU (most recently used first) across ALL repos
  allRepoWorktrees.sort((a, b) =>
    (b.worktree.lastAccessedAt ?? 0) - (a.worktree.lastAccessedAt ?? 0)
  );

  setState(prev => ({
    ...prev,
    repoWorktrees: allRepoWorktrees,
    selectedWorktreeIndex: 0,  // Most recent is first
  }));
}, []);
```

### Task 2.4: Arrow key navigation works unchanged

**File**: `src/components/spotlight/spotlight.tsx`

The existing arrow key handlers (lines 830-868) already cycle `selectedWorktreeIndex`. No changes needed to the keyboard handling logic itself - it just now cycles through the unified `repoWorktrees` array instead of single-repo worktrees.

```typescript
// Existing code works as-is:
case "ArrowRight": {
  setState((prev) => ({
    ...prev,
    selectedWorktreeIndex: (prev.selectedWorktreeIndex + 1) % prev.repoWorktrees.length,
  }));
}
case "ArrowLeft": {
  setState((prev) => ({
    ...prev,
    selectedWorktreeIndex: prev.selectedWorktreeIndex === 0
      ? prev.repoWorktrees.length - 1
      : prev.selectedWorktreeIndex - 1,
  }));
}
```

### Task 2.5: Update worktree display to show repo context

**File**: `src/components/spotlight/spotlight.tsx` (worktree indicator area)

**Current display**: Just worktree name (e.g., `main`, `feature-x`)

**New display**: Show repo name when multiple repos exist
- Single repo: `main` (no change)
- Multiple repos: `myrepo/main` or `myrepo: main` or badge style

**Visual indicator**: When cycling crosses repo boundary, make it visually clear (e.g., different color, separator, or repo name highlight)

### Task 2.6: Update thread creation to use selected RepoWorktree

**File**: `src/components/spotlight/spotlight.tsx`

**Current code** (simplified):
```typescript
const selectedRepo = defaultRepo ?? repos[0];
const selectedWorktree = availableWorktrees[selectedWorktreeIndex];
```

**New code**:
```typescript
const selected = repoWorktrees[selectedWorktreeIndex];
if (!selected) throw new Error("No worktree selected");

// Get full repo object from store
const selectedRepo = repos.find(r => r.id === selected.repoId);
const selectedWorktree = selected.worktree;

controller.createSimpleThread(query, selectedRepo, selectedWorktree.path);
```

### Task 2.7: Update `lastAccessedAt` on worktree use

**File**: `src/entities/worktrees/service.ts` or equivalent

**Requirement**: When a thread is created in a worktree, update that worktree's `lastAccessedAt` timestamp. This keeps the MRU list accurate.

```typescript
// After thread creation succeeds:
await worktreeService.touch(repoName, worktreeId);  // Updates lastAccessedAt to now
```

---

## Phase 3: Repository Management Improvements

**Goal**: Enhance repository management capabilities in settings

### Task 3.1: Add repository removal functionality

**File**: `src/components/main-window/settings/repository-settings.tsx`

**Requirements**:
- Add remove button per repository
- Confirmation dialog (with option to keep files on disk)
- Update store and persist changes

### Task 3.2: Add repository rename functionality

**File**: `src/components/main-window/settings/repository-settings.tsx`

**Requirements**:
- Inline edit for repository display name
- Handle slug changes (migration of settings folder)

### Task 3.3: Repository status indicators

**File**: `src/components/main-window/settings/repository-settings.tsx`

**Show**:
- Number of worktrees
- Active threads count
- Path validity (exists/missing)

---

## Phase 4: Backend Enhancements

**Goal**: Ensure Rust backend fully supports multi-repo operations

### Task 4.1: Validate repository paths on startup

**File**: `src-tauri/src/worktree_commands.rs` or new `repo_commands.rs`

**New command**:
```rust
#[tauri::command]
pub async fn validate_repository(repo_name: String) -> Result<RepoValidation, String> {
    // Check sourcePath exists
    // Check git repo valid
    // Return status and any issues
}
```

### Task 4.2: Add repository removal command

**File**: `src-tauri/src/repo_commands.rs` (new file)

**New command**:
```rust
#[tauri::command]
pub async fn remove_repository(repo_name: String, delete_files: bool) -> Result<(), String> {
    // Remove settings.json
    // Optionally remove worktree folders
    // Clean up any dangling references
}
```

### Task 4.3: Add cross-repo worktree list command (optional optimization)

**File**: `src-tauri/src/worktree_commands.rs`

**New command** (if frontend aggregation becomes slow):
```rust
#[tauri::command]
pub async fn list_all_worktrees() -> Result<Vec<RepoWorktree>, String> {
    // Iterate all repos
    // Aggregate worktrees
    // Return with repo context, sorted by lastAccessedAt
}
```

Note: Frontend can do this aggregation initially. Only add this command if performance requires it.

---

## Phase 5: Polish & Edge Cases

### Task 5.1: Handle repository path changes

**Scenario**: User moves repository folder on disk

**Solution**:
- Detect on startup/focus
- Prompt user to relocate
- Update sourcePath in settings

### Task 5.2: Handle duplicate worktree names across repos

**Scenario**: Both repos have a worktree named "main"

**Solution**:
- When multiple repos exist, always show `repoName/worktreeName` format
- Single repo: just show worktree name (no redundant prefix)

### Task 5.3: Inbox/thread filtering by repository

**File**: `src/components/inbox/*.tsx`

**Add capability to**:
- Filter inbox by repository
- Show repo badge on inbox items
- Group threads by repo (optional view)

---

## Implementation Order (Recommended)

1. **Phase 1** (Fix Add Repository) - Quick win, unblocks users
2. **Phase 2** (Unified MRU Navigation) - Core multi-repo UX with arrow keys
3. **Phase 3** (Repository Management) - Settings improvements
4. **Phase 4** (Backend) - Robustness & validation
5. **Phase 5** (Polish) - Edge cases & inbox integration

---

## Files to Modify Summary

| File | Phase | Changes |
|------|-------|---------|
| `src/components/main-window/settings/repository-settings.tsx` | 1, 3 | Fix add button, add remove/rename |
| `src/entities/repositories/service.ts` | 1 | Validation, duplicate checks |
| `src/components/spotlight/spotlight.tsx` | 2 | Load all repos, unified MRU list, update display |
| `src/entities/worktrees/service.ts` | 2 | Add `touch()` method to update lastAccessedAt |
| `core/types/repositories.ts` | 2 | Add `RepoWorktree` type |
| `src-tauri/src/worktree_commands.rs` | 4 | Validation command |
| `src-tauri/src/repo_commands.rs` | 4 | New file: removal command |
| `src-tauri/src/lib.rs` | 4 | Register new commands |
| `src/components/inbox/*.tsx` | 5 | Repo filtering, badges |

---

## Success Criteria

- [ ] User can add new repositories from settings page
- [ ] Left/right arrow keys cycle through repo+worktree combos sorted by MRU
- [ ] Most recently used worktree (across all repos) is selected by default
- [ ] Repository name visible in worktree indicator when multiple repos exist
- [ ] Threads correctly track which repo/worktree they belong to
- [ ] Using a worktree updates its `lastAccessedAt` (maintains MRU accuracy)
- [ ] User can remove repositories from settings
- [ ] Invalid/moved repositories are detected and handled gracefully
