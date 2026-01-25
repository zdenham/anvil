# Implementation Plan: Main Worktree as Initial MRU

## Problem Statement

When a repository is first imported, the system discovers all existing git worktrees. Currently, all discovered worktrees receive the same `lastAccessedAt` timestamp (the current time), which means the MRU (Most Recently Used) ordering is arbitrary - whichever worktree happens to be processed last ends up at the top of the list.

The user expects the **main worktree** (the original repository directory, i.e., `sourcePath`) to be considered the most recently used by default, so it appears first in the worktree list.

## Current Behavior

### During Repository Import (`createFromFolder`)
- **File**: `src/entities/repositories/service.ts` (lines 319-325)
- Only the main worktree is registered initially with `lastAccessedAt: now`
- This is correct behavior

### During Worktree Sync (`worktree_sync`)
- **File**: `src-tauri/src/worktree_commands.rs` (lines 229-257)
- All newly discovered worktrees get `last_accessed_at: Some(now)` with the same timestamp
- The main worktree is correctly identified (path === sourcePath) and named "main"
- **Problem**: If the main worktree doesn't exist in settings yet (e.g., first sync), it gets the same timestamp as all other discovered worktrees

### MRU Sorting
- **File**: `src-tauri/src/worktree_commands.rs` (lines 274-279)
- Sorts by `last_accessed_at` descending (most recent first)
- When timestamps are equal, order is undefined (depends on Vec iteration order)

## Solution

Modify the `worktree_sync` function in `src-tauri/src/worktree_commands.rs` to set `last_accessed_at: None` for newly discovered worktrees instead of the current timestamp.

### Rationale

The `lastAccessedAt` field represents when the user last accessed a worktree **through our tool**. Worktrees discovered during sync haven't been accessed yet - they just happen to exist on disk.

The main worktree already receives a proper timestamp during `createFromFolder` (the import action counts as an access), so it will naturally sort first. Any other worktrees discovered during sync get `None`, which sorts to the bottom (the MRU sort treats `None`/`0` as oldest).

## Implementation Steps

### Step 1: Modify `worktree_sync` in Rust

**File**: `src-tauri/src/worktree_commands.rs`

Change line 253 from:
```rust
last_accessed_at: Some(now),
```

To:
```rust
last_accessed_at: None,
```

The `now` variable on line 230 can also be removed since it's no longer used in the discovery loop (it's still used on line 271 for `lastUpdated`).

## Alternative Approaches Considered

### Alternative 1: Offset Timestamps (Main Gets `now`, Others Get `now - 1`)
Give main worktree current timestamp, others get 1ms earlier.

**Rejected because**: Semantically incorrect. `lastAccessedAt` should represent actual access through the tool, not discovery time. Also more complex than necessary.

### Alternative 2: Sort After Discovery
Sort the worktrees list to put "main" first regardless of timestamp.

**Rejected because**: This would override explicit user MRU preferences. If a user has been working in a non-main worktree, it should stay at the top.

### Alternative 3: Use a Separate "Priority" Field
Add a `priority` field to `WorktreeState` that's used as a tiebreaker.

**Rejected because**: Over-engineering for this use case.

## Testing

1. **Fresh Import Test**: Import a repository that has existing git worktrees. Verify the main worktree appears first in the list.

2. **MRU Override Test**: After import, "touch" a non-main worktree (e.g., by creating a thread in it). Verify that worktree now appears first.

3. **Re-sync Test**: Call sync again on a repository. Verify existing worktrees maintain their timestamps and order.

## Files to Modify

| File | Change |
|------|--------|
| `src-tauri/src/worktree_commands.rs` | Modify timestamp assignment in `worktree_sync` loop |

## Estimated Scope

- **Lines of code changed**: 1
- **Risk**: Low - isolated change to timestamp assignment
- **Breaking changes**: None - only affects initial discovery ordering
