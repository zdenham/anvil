# Fix: Onboarding Repository Loading Failure

## Problem

After onboarding creates a new repository, users cannot send messages. The thread shows: `"Cannot submit: no working directory"`.

## Root Cause

A **Rust/TypeScript serialization mismatch** causes the Zod schema to reject the settings.json that the Rust backend writes.

### The chain of failure

1. **`createFromFolder()`** (`src/entities/repositories/service.ts:325-331`) writes a worktree to settings.json **without** a `createdAt` field (it's `undefined`, so absent from JSON):
   ```json
   { "id": "...", "path": "...", "name": "main", "lastAccessedAt": 1234, "currentBranch": null }
   ```

2. **`useMRUWorktree`** (`src/hooks/use-mru-worktree.ts:74`) calls `worktreeService.sync()` on mount, which invokes the Rust `worktree_sync` command.

3. **Rust `WorktreeState`** (`src-tauri/src/worktree_commands.rs:8-19`) has:
   ```rust
   pub created_at: Option<u64>,   // Missing field → None
   pub is_renamed: bool,           // Missing field → false (via #[serde(default)])
   ```
   When Rust reads the settings.json, the absent `createdAt` becomes `None`. When it re-serializes and saves, `None` becomes **`"createdAt": null`** in JSON. (Same for `is_renamed` → `false`.)

4. **TypeScript `WorktreeStateSchema`** (`core/types/repositories.ts:37`) has:
   ```typescript
   createdAt: z.number().optional()  // Accepts undefined, REJECTS null
   ```
   Zod's `.optional()` allows `undefined` but NOT `null`. So the settings.json with `"createdAt": null` **fails validation**.

5. **`loadSettings()`** (`src/lib/app-data-store.ts:337-342`) sees the Zod failure and falls through to `migrateFromMetadata()`.

6. **`migrateFromMetadata()`** (`src/lib/app-data-store.ts:371-383`) looks for a `metadata.json` file that doesn't exist (only `settings.json` was created), so it throws: `"Repository repo-cool not found"`.

7. **`useWorkingDirectory`** (`src/hooks/use-working-directory.ts:48-50`) catches the error and skips the repo. No match is found → returns empty string.

8. **`ThreadContent`** (`src/components/content-pane/thread-content.tsx:314-316`) sees empty working directory → blocks message submission with `"Cannot submit: no working directory"`.

### Evidence from actual settings.json on disk

```json
{
  "worktrees": [{
    "createdAt": null,        // ← Written by Rust as null (was absent)
    "isRenamed": false,       // ← Written by Rust as false (was absent)
    "id": "542185a2-...",
    "path": "/Users/zac/Downloads/repo-cool",
    "name": "main",
    "lastAccessedAt": 1771313632856,
    "currentBranch": "main"
  }],
  "lastUpdated": 1771313980243   // ← Different from createdAt, proving Rust modified it
}
```

### Secondary issue: `loadSettings` fallback is fragile

When `RepositorySettingsSchema.safeParse()` fails, `loadSettings` falls through to `migrateFromMetadata()` which assumes a legacy `metadata.json` exists. For repos created via the new `createFromFolder` path, no `metadata.json` is ever written, so migration always throws.

## Fixes

### Fix 1: Zod schema — accept `null` for optional worktree fields (primary fix)
**File:** `core/types/repositories.ts:37`

Change:
```typescript
createdAt: z.number().optional(),
```
To:
```typescript
createdAt: z.number().nullable().optional(),
```

This makes the schema accept `undefined`, `null`, and `number` — matching what Rust serializes.

Do the same for any other `WorktreeState` fields that Rust serializes as `null` from `Option<T>`: `lastAccessedAt` and `currentBranch` already handle this correctly (`.nullable().optional()`), but `createdAt` does not.

### Fix 2: `loadSettings` — repair-in-place instead of falling through to migration
**File:** `src/lib/app-data-store.ts:340-346`

When `safeParse` fails but `raw` exists (meaning settings.json IS there but has invalid fields), try to repair it before falling through to `migrateFromMetadata`. Use a lenient parse (strip nulls → re-save) so the file is fixed for future reads:

```typescript
if (raw) {
  const result = RepositorySettingsSchema.safeParse(raw);
  if (result.success) {
    return result.data;
  }
  // Try repair: strip null values from optional fields and re-parse
  logger.warn(`[loadSettings] Invalid settings.json for ${repoName}, attempting repair`);
  const repaired = repairSettingsJson(raw);
  const retryResult = RepositorySettingsSchema.safeParse(repaired);
  if (retryResult.success) {
    await saveSettings(repoName, retryResult.data);
    return retryResult.data;
  }
}
```

### Fix 3: `createFromFolder` — write `createdAt` on the initial worktree
**File:** `src/entities/repositories/service.ts:325-331`

Add `createdAt: now` to the initial worktree object so it's never absent:

```typescript
worktrees: [{
  id: crypto.randomUUID(),
  path: sourcePath,
  name: 'main',
  createdAt: now,          // ← Add this
  lastAccessedAt: now,
  currentBranch: null,
}],
```

This prevents the issue at the source — Rust will read a number and write a number back.

## Phases

- [x] Fix Zod schema to accept null for worktree `createdAt` and `lastAccessedAt`
- [x] Fix `createFromFolder` and `create` to write `createdAt` on initial worktree
- [x] Fix `loadSettings` to attempt repair before falling through to migration
- [x] Verify fix by checking the full chain works end-to-end

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to modify

| File | Change |
|------|--------|
| `core/types/repositories.ts:37` | `createdAt: z.number().nullable().optional()` |
| `src/entities/repositories/service.ts:325-331` | Add `createdAt: now` to initial worktree |
| `src/lib/app-data-store.ts:332-347` | Add repair logic before migration fallback |
