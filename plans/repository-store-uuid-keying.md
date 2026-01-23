# Repository Store: Migrate from Name-Keyed to UUID-Keyed

## Problem Statement

The repository store currently keys repositories by their display **name** (a string) rather than by their **UUID**. This creates several problems:

1. **Inefficient lookups**: Plans and threads store `repoId` (UUID), but looking up a repo by ID requires iterating through all repositories
2. **Rename vulnerability**: If a repository is renamed, the store key changes, potentially breaking references
3. **Duplicate name risk**: Nothing prevents two repositories from having the same display name
4. **Inconsistency**: Thread and plan stores key by UUID, but repository store uses name

### Evidence of Current Architecture

**Store definition** (`src/entities/repositories/store.ts:5-6`):
```typescript
interface RepositoryState {
  repositories: Record<string, Repository>;  // Key is NAME, not UUID
}
```

**Selectors use name** (`store.ts:42-43`):
```typescript
getRepository: (name) => get().repositories[name],
getRepositoryNames: () => Object.keys(get().repositories),
```

**Hydration keys by name** (`service.ts:144`):
```typescript
repositories[metadata.name] = { ...metadata, versions };
```

**Workaround code exists** (`src/entities/plans/utils.ts:27-44`):
```typescript
// Note: We need to iterate through repos to find one matching the ID.
async function findRepoByIdFromSettings(repoId: string): Promise<...> {
  const repoNames = useRepoStore.getState().getRepositoryNames();
  for (const name of repoNames) {
    const slug = slugify(name);
    const settings = await loadSettings(slug);
    if (settings.id === repoId) {
      return { settings, slug };
    }
  }
}
```

**Another workaround hook** (`src/hooks/use-repo-names.ts`):
- Entire hook exists just to build `Record<repoId, displayName>` mapping
- Has to async load settings for every repo just to get their IDs

---

## Proposed Solution

Migrate the repository store to key by UUID instead of name. This requires:

1. Updating the store data structure
2. Adding `id` field to the in-memory `Repository` type
3. Updating all consumers to use ID-based lookups
4. Removing workaround code

---

## Implementation Plan

### Phase 1: Update Core Types

**File: `core/types/repositories.ts`**

Add `id` field to `RepositoryMetadataSchema` and `RepositorySchema`:
```typescript
export const RepositoryMetadataSchema = z.object({
  id: z.string().uuid(),  // ADD THIS
  name: z.string(),
  // ... rest unchanged
});
```

This ensures the UUID is available in the in-memory `Repository` object, not just in `RepositorySettings` on disk.

### Phase 2: Update Store Structure

**File: `src/entities/repositories/store.ts`**

Change the store to key by ID:

```typescript
interface RepositoryState {
  repositories: Record<string, Repository>;  // Key is now UUID
  _hydrated: boolean;
}

interface RepositoryActions {
  hydrate: (repositories: Record<string, Repository>) => void;

  // Update selectors
  getRepository: (id: string) => Repository | undefined;
  getRepositoryById: (id: string) => Repository | undefined;  // Alias
  getRepositoryByName: (name: string) => Repository | undefined;  // New helper
  getRepositoryIds: () => string[];  // Renamed from getRepositoryNames
  getRepositoryNames: () => string[];  // Keep for UI convenience

  // Update apply methods to use ID
  _applyCreate: (repo: Repository) => Rollback;
  _applyUpdate: (id: string, repo: Repository) => Rollback;
  _applyDelete: (id: string) => Rollback;
}
```

### Phase 3: Update Service Layer

**File: `src/entities/repositories/service.ts`**

Update all methods to work with IDs:

| Method | Current Signature | New Signature |
|--------|-------------------|---------------|
| `get` | `get(name: string)` | `get(id: string)` |
| `getByName` | N/A | `getByName(name: string)` (new helper) |
| `update` | `update(name, updates)` | `update(id, updates)` |
| `delete` | `delete(name)` | `delete(id)` |
| `remove` | `remove(repoId)` | unchanged (already uses ID param name but wrong internally) |
| `rename` | `rename(repoId, newName)` | unchanged (already uses ID param name but wrong internally) |
| `refresh` | `refresh(name)` | `refresh(id)` |
| `getLatestVersion` | `getLatestVersion(name)` | `getLatestVersion(id)` |
| `getVersion` | `getVersion(name, ver)` | `getVersion(id, ver)` |

Update `hydrate()` to key by ID:
```typescript
// Change from:
repositories[metadata.name] = { ...metadata, versions };

// To:
repositories[settings.id] = { ...metadata, id: settings.id, versions };
```

### Phase 4: Update Consumers

#### High Priority (logic changes required)

| File | Changes Required |
|------|------------------|
| `src/entities/plans/utils.ts` | Remove `findRepoByIdFromSettings()` - direct lookup now works |
| `src/hooks/use-repo-names.ts` | Simplify or remove - IDs are now keys, can derive name map easily |
| `src/hooks/use-working-directory.ts` | Update to use ID-based lookup |
| `src/entities/relations/detection.ts` | Update repo lookup to use ID directly |

#### Medium Priority (straightforward updates)

| File | Changes Required |
|------|------------------|
| `src/components/main-window/settings/repository-settings.tsx` | Iterate by ID, display name from repo object |
| `src/components/main-window/worktrees-page.tsx` | Update iteration from name to ID |
| `src/components/spotlight/spotlight.tsx` | Update repo list iteration |
| `src/components/onboarding/OnboardingFlow.tsx` | Update any repo lookups |

#### Low Priority (minimal changes)

| File | Changes Required |
|------|------------------|
| `src/entities/repositories/listeners.ts` | Update event handler lookups |
| `src/lib/repo-store-client.ts` | Update interface if still used |
| `src/test/helpers/stores.ts` | Update test helpers |

### Phase 5: Clean Up Workarounds

After migration, remove/simplify:

1. **`src/entities/plans/utils.ts`**: Delete `findRepoByIdFromSettings()` function entirely
2. **`src/hooks/use-repo-names.ts`**: Simplify to single-pass derivation:
   ```typescript
   const repoNames = useMemo(() => {
     const repos = useRepoStore.getState().repositories;
     return Object.fromEntries(
       Object.entries(repos).map(([id, repo]) => [id, repo.name])
     );
   }, [repositories]);
   ```

---

## Migration Considerations

### Filesystem Structure (No Change)

The filesystem structure under `~/.mort/repositories/` will continue to use **slugified names** for directories:
```
~/.mort/repositories/
  my-project/           <- slug stays name-based
    settings.json       <- contains the UUID
```

This is fine - the filesystem organization doesn't need to match the in-memory keying. The `settings.json` already contains the UUID.

### Backwards Compatibility

No migration of persisted data is needed because:
- `settings.json` already contains `id` field (UUID)
- We're just changing how the in-memory store is keyed
- Hydration will read the ID from settings and use it as the key

### Breaking Changes

API changes for any code that calls `repoService` methods with names:
- `repoService.get("my-project")` -> `repoService.get("uuid-here")` or `repoService.getByName("my-project")`
- Similar for `update`, `delete`, `refresh`

---

## Files Changed Summary

| Category | Files |
|----------|-------|
| Core Types | `core/types/repositories.ts` |
| Store | `src/entities/repositories/store.ts` |
| Service | `src/entities/repositories/service.ts` |
| Listeners | `src/entities/repositories/listeners.ts` |
| Remove Workarounds | `src/entities/plans/utils.ts`, `src/hooks/use-repo-names.ts` |
| UI Components | `repository-settings.tsx`, `worktrees-page.tsx`, `spotlight.tsx`, `OnboardingFlow.tsx` |
| Hooks | `use-working-directory.ts` |
| Other | `detection.ts`, `repo-store-client.ts`, `stores.ts` (test helper) |

**Total: ~14 files**

---

## Risks

1. **Missing consumers**: May discover additional code paths that use name-based lookups
2. **Event handlers**: Events currently pass `name` - may need to pass `id` instead or both
3. **Rust backend**: `src-tauri/src/repo_commands.rs` uses slug-based paths - verify it doesn't need changes

---

## Testing Plan

1. Add unit tests for new `getRepositoryByName` helper
2. Update existing repo service tests to use IDs
3. Integration test: Create repo, rename it, verify all lookups still work
4. Integration test: Verify plans can resolve paths after migration
