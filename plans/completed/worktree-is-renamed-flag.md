# Plan: Add `isRenamed` Property to Worktrees

## Problem

Currently, the worktree renaming logic triggers on every new thread run. When a thread is created, `initiateWorktreeNaming()` is called which generates a task-based name and emits a `worktree:name:generated` event. This happens regardless of whether the worktree has already been renamed from its initial animal name.

The existing TODO in `simple-runner-strategy.ts` (line 290) acknowledges this:
```typescript
// TODO: Only trigger for first thread in worktree - need to track this
```

## Solution

Add an `isRenamed` boolean property to the `WorktreeState` schema to track whether a worktree has already been renamed from its initial animal name. Use this flag to skip the renaming process on subsequent thread runs.

## Implementation Steps

### 1. Extend WorktreeState Schema

**File:** `core/types/repositories.ts`

Add `isRenamed` to the schema with a default of `false`:

```typescript
export const WorktreeStateSchema = z.object({
  id: z.string().uuid(),
  path: z.string(),
  name: z.string(),
  lastAccessedAt: z.number().optional(),
  currentBranch: z.string().nullable().optional(),
  isRenamed: z.boolean().optional().default(false),
});
```

Using `.optional().default(false)` ensures backward compatibility with existing worktrees that don't have this property.

### 2. Update Rust Backend Worktree Struct

**File:** `src-tauri/src/repositories/worktree.rs` (or similar)

Add the `is_renamed` field to the Rust struct that corresponds to `WorktreeState`:

```rust
#[derive(Serialize, Deserialize, Clone)]
pub struct WorktreeState {
    pub id: String,
    pub path: String,
    pub name: String,
    pub last_accessed_at: Option<u64>,
    pub current_branch: Option<String>,
    #[serde(default)]
    pub is_renamed: bool,
}
```

### 3. Set `isRenamed = true` When Renaming

**File:** `src/entities/worktrees/listeners.ts`

Update the rename listener to set the flag after successful rename:

```typescript
eventBus.on(
  EventName.WORKTREE_NAME_GENERATED,
  async ({ worktreeId, repoId, name }) => {
    try {
      await worktreeService.rename(repoId, worktreeId, name);
      // Flag is set by the backend during rename
      logger.info(`[WorktreeListener] Renamed worktree "${worktreeId}" to "${name}"`);
    } catch (error) {
      logger.error(`[WorktreeListener] Failed to rename worktree...`);
    }
  }
);
```

The backend `worktree_rename` command should set `is_renamed = true` when it updates the worktree name.

### 4. Update Backend Rename Command

**File:** `src-tauri/src/worktree_commands.rs` (or similar)

When processing the rename command, set `is_renamed = true`:

```rust
// In the rename handler:
worktree.name = new_name;
worktree.is_renamed = true;
// Persist to settings.json
```

### 5. Add `isRenamed` Check Before Triggering Rename

**File:** `agents/src/runners/simple-runner-strategy.ts`

Update the thread creation logic to check the flag before initiating rename:

```typescript
// Get worktree state to check if already renamed
const worktree = await this.getWorktreeState(worktreeId, repoId);

if (!worktree?.isRenamed) {
  // Only trigger naming for worktrees that haven't been renamed yet
  this.initiateWorktreeNaming(worktreeId, repoId, prompt);
}
```

This requires adding a method to fetch worktree state, or passing the `isRenamed` flag through the existing data flow.

### 6. Pass `isRenamed` Through Event System

**Option A:** Fetch worktree state in the runner before deciding to rename

The runner would need access to the worktree service or settings to check the flag. This might require:
- Adding a new Tauri command `worktree_get` to fetch a single worktree's state
- Or including `isRenamed` in the data passed when starting a thread run

**Option B:** Include `isRenamed` in the thread start payload

When a thread run is initiated, include the worktree's `isRenamed` status so the runner can check it without additional lookups.

### 7. Handle Edge Cases

- **Manual renames:** If a user manually renames a worktree, should `isRenamed` be set to `true`? Probably yes - this prevents auto-rename from overwriting user's choice.
- **Existing worktrees:** Worktrees created before this change won't have `isRenamed` set. The schema default of `false` means they'll be renamed on their next thread run, which is acceptable behavior.

## Files to Modify

1. `core/types/repositories.ts` - Add `isRenamed` to schema
2. `src-tauri/src/repositories/` - Add `is_renamed` to Rust struct
3. `src-tauri/src/worktree_commands.rs` - Set flag on rename
4. `agents/src/runners/simple-runner-strategy.ts` - Check flag before renaming
5. Potentially add a new Tauri command to fetch worktree state, or modify existing data flow

## Testing

1. Create a new worktree - should have `isRenamed: false`
2. Run a thread - should rename worktree and set `isRenamed: true`
3. Run another thread in same worktree - should NOT trigger rename
4. Manually rename a worktree - should set `isRenamed: true`
5. Existing worktrees (migration) - should work with default `false` value

## Risks

- **Backend/Frontend type sync:** Ensure the Rust and TypeScript types stay in sync
- **Settings migration:** Existing `settings.json` files won't have this field - ensure defaults handle this gracefully
