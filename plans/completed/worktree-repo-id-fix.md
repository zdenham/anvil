# Plan: Ensure Worktrees and Repos Have Proper IDs

## Problem Statement

Worktrees are missing their required `id` field after creation/sync. Example from production:

```json
{
  "id": "0d5b7571-48eb-44bf-b9c1-7c05df8aa3c7",  // repo has ID (correct)
  "worktrees": [
    {
      "currentBranch": "main",
      "lastAccessedAt": 1769059085343,
      "name": "main",
      "path": "/Users/zac/Documents/juice/anvil/anvil"
      // Missing "id" field!
    }
  ]
}
```

## Root Cause

The **Rust backend** `WorktreeState` struct is missing the `id` field entirely:

**File:** `src-tauri/src/worktree_commands.rs:7-14`
```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeState {
    pub path: String,
    pub name: String,
    pub last_accessed_at: Option<u64>,
    pub current_branch: Option<String>,
    // Missing: pub id: String,
}
```

This causes:
1. `worktree_create` (line 58-63) - Creates worktrees without ID
2. `worktree_sync` (line 246-251) - Discovers worktrees from git without ID
3. When these worktrees are saved to `settings.json`, they lack the required `id` field

The TypeScript side has the correct type (with required `id: z.string().uuid()`), but the Rust backend doesn't know about it.

## What is NOT the Problem

- The frontend `src/entities/repositories/service.ts` correctly generates UUIDs when creating repos
- The core TypeScript types in `core/types/repositories.ts` correctly require `id`
- There is no migration script issue - this is a fresh .anvil problem

## Solution

### Step 1: Add `id` field to Rust struct

**File:** `src-tauri/src/worktree_commands.rs`

```rust
use uuid::Uuid;  // Add to imports

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeState {
    pub id: String,  // Add this field
    pub path: String,
    pub name: String,
    pub last_accessed_at: Option<u64>,
    pub current_branch: Option<String>,
}
```

### Step 2: Generate UUIDs in `worktree_create`

**File:** `src-tauri/src/worktree_commands.rs:57-63`

```rust
// Create worktree state
let worktree = WorktreeState {
    id: Uuid::new_v4().to_string(),  // Generate UUID
    path: worktree_path,
    name,
    last_accessed_at: Some(now_millis()),
    current_branch: None,
};
```

### Step 3: Generate UUIDs in `worktree_sync` for new worktrees

**File:** `src-tauri/src/worktree_commands.rs:246-251`

When discovering worktrees from git that aren't in settings:

```rust
existing_worktrees.push(WorktreeState {
    id: Uuid::new_v4().to_string(),  // Generate UUID for newly discovered worktrees
    path: git_wt.path.clone(),
    name: final_name,
    last_accessed_at: Some(now),
    current_branch: git_wt.branch.clone(),
});
```

### Step 4: Preserve existing IDs during sync

Ensure `worktree_sync` preserves the `id` field for worktrees already in settings (this should work automatically since we deserialize existing worktrees and only add new ones).

### Step 5: Add `uuid` crate to Cargo.toml

**File:** `src-tauri/Cargo.toml`

```toml
[dependencies]
uuid = { version = "1", features = ["v4"] }
```

### Step 6: Remove migration code from core

**File:** `core/services/repository/settings-service.ts`

Remove the `migrateWorktreeState` function entirely since:
1. All users start from fresh .anvil
2. The migration was for deprecated fields (`claim`, `version`, `lastTaskId`) that no longer exist
3. With the Rust fix, new worktrees will always have IDs

If we want to keep `preprocessSettings` for `defaultBranch` detection, just remove the worktree migration:

```typescript
function preprocessSettings(raw: unknown): unknown {
  if (raw && typeof raw === 'object') {
    const settings = raw as Record<string, unknown>;
    // Add defaultBranch if missing (requires git detection)
    if (!settings.defaultBranch && typeof settings.sourcePath === 'string') {
      settings.defaultBranch = detectDefaultBranch(settings.sourcePath) ?? 'main';
    }
    // Remove: worktree migration no longer needed
  }
  return raw;
}
```

### Step 7: Fix tests that create worktrees without IDs

**File:** `core/services/worktree/worktree-service.test.ts`

The test file creates worktrees without `id` fields like:
```typescript
settings.worktrees = [
  { path: '/wt1', name: 'wt1', lastAccessedAt: 1000 },  // Missing id
];
```

Add a helper and update all test worktrees:
```typescript
function createTestWorktree(overrides: Partial<WorktreeState> = {}): WorktreeState {
  return {
    id: crypto.randomUUID(),
    path: '/default/path',
    name: 'default',
    lastAccessedAt: Date.now(),
    currentBranch: null,
    ...overrides,
  };
}
```

## Files to Modify

1. `src-tauri/Cargo.toml` - Add uuid crate
2. `src-tauri/src/worktree_commands.rs` - Add `id` field to struct and generate UUIDs
3. `core/services/repository/settings-service.ts` - Remove worktree migration code
4. `core/services/worktree/worktree-service.test.ts` - Fix test worktrees to include IDs

## Repository ID

The repository `id` field is already working correctly - the frontend service generates a UUID when creating repos. No changes needed there.

## Verification

After implementation:
1. Run `cargo build` to verify Rust compiles
2. Run `pnpm test` to ensure all tests pass
3. Delete `~/.anvil` and start fresh
4. Import a repository via onboarding
5. Verify settings.json has `id` field on all worktrees
6. Create a new worktree via UI and verify it has an ID
7. Sync worktrees and verify IDs are preserved/generated
