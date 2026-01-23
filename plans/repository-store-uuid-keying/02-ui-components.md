# Subplan 2: UI Components

**Priority**: Tier 2 - After all Tier 1 subplans complete
**Estimated Files**: 4-5
**Dependencies**: Subplans 1A, 1B, 1C

## Overview

Update UI components that iterate over or look up repositories to use the new UUID-keyed store.

## Files to Modify (Can Be Parallelized)

### Stream D: Settings UI

#### `src/components/main-window/settings/repository-settings.tsx`

```typescript
// Before:
const repositoriesMap = useRepoStore((s) => s.repositories);
Object.entries(repositoriesMap).map(([name, repo]) => ...)

// After:
const repositoriesMap = useRepoStore((s) => s.repositories);
Object.entries(repositoriesMap).map(([id, repo]) => {
  // id is now UUID, display repo.name for UI
})
```

Changes:
- Variable naming: `name` → `id` in destructuring
- Display: Use `repo.name` for user-visible text
- Actions: Pass `id` to service methods like `repoService.delete(id)`

---

### Stream E: Spotlight & Onboarding

#### `src/components/spotlight/spotlight.tsx`

Update repository list iteration:
```typescript
// Iterate using Object.values() or Object.entries() with UUID keys
const repos = Object.values(repositories);
// Use repo.id for actions, repo.name for display
```

#### `src/components/onboarding/OnboardingFlow.tsx`

Update any repository lookups or selections to use UUID.

---

### Stream F: Worktrees

#### `src/components/main-window/worktrees-page.tsx`

Update iteration from name to ID:
```typescript
// Before: keyed by name
// After: keyed by UUID, display name from repo object
```

---

## Common Patterns

### Iteration Pattern
```typescript
// Before:
Object.keys(repositories).map(name => ...)

// After:
Object.entries(repositories).map(([id, repo]) => (
  <Item key={id} name={repo.name} onAction={() => handleAction(id)} />
))
```

### Lookup Pattern
```typescript
// Before:
const repo = repositories[selectedName];

// After:
const repo = repositories[selectedId];
// Or if you only have name:
const repo = useRepoStore.getState().getRepositoryByName(selectedName);
```

### Service Call Pattern
```typescript
// Before:
await repoService.delete(name);

// After:
await repoService.delete(id);
```

## Verification

After completing this subplan:
- [ ] All UI components render correctly with UUID-keyed store
- [ ] Repository names display correctly (not UUIDs)
- [ ] All CRUD operations work (create, rename, delete)
- [ ] No console errors related to missing keys or undefined repos

## Parallel Execution

Within this subplan, Streams D, E, and F can be worked on simultaneously by different developers or in separate branches.
