# Subplan 1B: Hooks & Utils

**Priority**: Tier 1 - Can run in parallel with 1A and 1C
**Estimated Files**: 4
**Dependencies**: Subplan 0 (Core Types & Store)

## Overview

Update hooks and utility functions that currently use workaround patterns to iterate through repositories by name.

## Files to Modify

### 1. `src/entities/plans/utils.ts`

**Remove `findRepoByIdFromSettings()` function entirely** (lines ~27-44)

This workaround exists because the store was name-keyed. With UUID-keyed store, replace usages with:

```typescript
// Before (workaround):
const result = await findRepoByIdFromSettings(repoId);

// After (direct lookup):
const repo = useRepoStore.getState().getRepository(repoId);
const slug = slugify(repo.name);
const settings = await loadSettings(slug);
```

### 2. `src/hooks/use-repo-names.ts`

**Simplify the entire hook:**

```typescript
// Before: Async loads settings for every repo just to get IDs
// After: Single-pass derivation from store

export function useRepoNames(): Record<string, string> {
  const repositories = useRepoStore((state) => state.repositories);

  return useMemo(() => {
    return Object.fromEntries(
      Object.entries(repositories).map(([id, repo]) => [id, repo.name])
    );
  }, [repositories]);
}
```

### 3. `src/hooks/use-working-directory.ts`

Update to use ID-based lookup:

```typescript
// Before:
const repoNames = useRepoStore.getState().getRepositoryNames();
for (const name of repoNames) {
  // iterate to find matching repoId
}

// After:
const repo = useRepoStore.getState().getRepository(repoId);
// Direct access, no iteration needed
```

### 4. `src/entities/relations/detection.ts`

Update `findRepoSettingsById()` or similar functions:

```typescript
// Before: Iterates getRepositoryNames() to find repo by ID
// After: Direct lookup by ID

const repo = useRepoStore.getState().getRepository(repoId);
if (repo) {
  const slug = slugify(repo.name);
  const settings = await loadSettings(slug);
}
```

## Verification

After completing this subplan:
- [ ] `findRepoByIdFromSettings()` is deleted
- [ ] `useRepoNames()` hook is simplified (no async loading)
- [ ] `use-working-directory.ts` uses direct ID lookup
- [ ] `detection.ts` uses direct ID lookup
- [ ] No more iteration patterns to find repo by ID

## Parallel With

- Subplan 1A: Service Layer
- Subplan 1C: Listeners & Events
