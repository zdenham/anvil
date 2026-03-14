# Fix: Worktree Folders Flattened on Sidebar Refresh

## Problem

When clicking the refresh button in the left sidebar header, worktrees that were organized inside folders get flattened — they become siblings of the folder instead of remaining as children.

## Root Cause

**The Rust** `WorktreeState` **struct is missing the** `visualSettings` **field, causing it to be silently dropped during worktree sync.**

The data loss chain:

1. **Refresh button** calls `worktreeService.sync(repo.name)` → Tauri command `worktree_sync`
2. `worktree_sync` loads `settings.json` as raw JSON (`serde_json::Value`) — `visualSettings` is present on disk
3. It deserializes worktrees into `Vec<WorktreeState>` (line 324) — **the Rust struct lacks** `visualSettings`, so serde silently drops it
4. It re-serializes back: `settings["worktrees"] = serde_json::to_value(&existing_worktrees)` (line 386) — writes worktrees **without** `visualSettings`
5. It saves the stripped settings back to disk (line 388) — **permanently destroying the hierarchy data**
6. Frontend re-hydrates from the now-stripped `settings.json` → worktrees have no `parentId` → tree builder places them at the repo root level

**Rust struct** (`src-tauri/src/worktree_commands.rs:8-21`):

```rust
pub struct WorktreeState {
    pub id: String,
    pub path: String,
    pub name: String,
    pub created_at: Option<u64>,
    pub last_accessed_at: Option<u64>,
    pub current_branch: Option<String>,
    pub is_renamed: bool,
    pub is_external: bool,
    // ← visualSettings is MISSING
}
```

**TypeScript schema** (`core/types/repositories.ts:30-49`):

```typescript
export const WorktreeStateSchema = z.object({
  id: z.string().uuid(),
  path: z.string(),
  name: z.string(),
  // ...
  visualSettings: VisualSettingsSchema.optional(), // ← PRESENT here
  isExternal: z.boolean().optional(),
});
```

## Fix

### Phase 1: Add `visualSettings` to Rust `WorktreeState` struct

**File**: `src-tauri/src/worktree_commands.rs`

Add a `visual_settings` field to the Rust struct so serde preserves it through the deserialize→serialize round-trip:

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VisualSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeState {
    pub id: String,
    pub path: String,
    pub name: String,
    pub created_at: Option<u64>,
    pub last_accessed_at: Option<u64>,
    pub current_branch: Option<String>,
    #[serde(default)]
    pub is_renamed: bool,
    #[serde(default)]
    pub is_external: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visual_settings: Option<VisualSettings>,  // ← ADD THIS
}
```

Also ensure the `worktree_create` function initializes it as `None`:

```rust
let worktree = WorktreeState {
    // ... existing fields ...
    visual_settings: None,
};
```

### Phase 2: Verify no other Rust commands strip unknown fields

Check that `worktree_touch`, `worktree_rename`, and `worktree_delete` also preserve `visualSettings` through their read-modify-write cycles. They use the same `Vec<WorktreeState>` deserialization pattern, so adding the field to the struct in Phase 1 fixes all of them at once.

## Phases

- [x] Add `VisualSettings` struct and `visual_settings` field to Rust `WorktreeState`

- [x] Update `worktree_create` to initialize `visual_settings: None`

- [x] Verify `worktree_touch`, `worktree_rename`, `worktree_delete` are also fixed (they use the same struct)

- [x] Build and test that refresh no longer strips `visualSettings` from `settings.json`

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Impact

- **Severity**: High — this is a data-destructive bug that permanently loses user-configured folder hierarchy on every refresh
- **Scope**: Affects every user who organizes worktrees into folders
- **Risk of fix**: Low — adding a field with `Option` + `skip_serializing_if` is backwards-compatible with existing settings files