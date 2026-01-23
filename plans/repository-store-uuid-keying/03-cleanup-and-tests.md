# Subplan 3: Cleanup & Tests

**Priority**: Tier 3 - After Tier 2 completes
**Estimated Files**: 2-3
**Dependencies**: All previous subplans

## Overview

Remove transitional code, update test helpers, and add verification tests.

## Files to Modify

### 1. `src/test/helpers/stores.ts`

Update test helper to create UUID-keyed mock repositories:

```typescript
// Before:
export function createMockRepoStore() {
  return {
    repositories: {
      'my-project': { name: 'my-project', ... },
    },
  };
}

// After:
export function createMockRepoStore() {
  return {
    repositories: {
      'uuid-1234': { id: 'uuid-1234', name: 'my-project', ... },
    },
  };
}
```

### 2. `src/lib/repo-store-client.ts`

Review and update if this file contains any name-based interfaces or methods.

### 3. Remove Transitional Code

After full migration is verified:
- Remove any `// TODO: migrate to UUID` comments
- Remove any dual-support code that handles both name and UUID
- Clean up any deprecated method aliases

## New Tests to Add

### Unit Tests

```typescript
describe('Repository Store - UUID Keying', () => {
  it('should key repositories by UUID', () => {
    const repo = { id: 'uuid-123', name: 'test-repo', ... };
    store.hydrate({ 'uuid-123': repo });
    expect(store.getRepository('uuid-123')).toEqual(repo);
  });

  it('should find repository by name', () => {
    const repo = { id: 'uuid-123', name: 'test-repo', ... };
    store.hydrate({ 'uuid-123': repo });
    expect(store.getRepositoryByName('test-repo')).toEqual(repo);
  });

  it('should return all repository IDs', () => {
    store.hydrate({
      'uuid-1': { id: 'uuid-1', name: 'repo-a', ... },
      'uuid-2': { id: 'uuid-2', name: 'repo-b', ... },
    });
    expect(store.getRepositoryIds()).toEqual(['uuid-1', 'uuid-2']);
  });
});
```

### Integration Tests

```typescript
describe('Repository Rename - UUID Stability', () => {
  it('should maintain UUID after rename', async () => {
    const originalId = repo.id;
    await repoService.rename(repo.id, 'new-name');

    const renamed = store.getRepository(originalId);
    expect(renamed.id).toBe(originalId);
    expect(renamed.name).toBe('new-name');
  });
});

describe('Plan Resolution After Migration', () => {
  it('should resolve plan paths using repo UUID', async () => {
    const plan = { repoId: 'uuid-123', ... };
    const repo = store.getRepository(plan.repoId);
    expect(repo).toBeDefined();
    // Verify path resolution works
  });
});
```

## Verification Checklist

Final verification before considering migration complete:

- [ ] All TypeScript compiles without errors
- [ ] All existing tests pass
- [ ] New UUID-keying tests pass
- [ ] Manual testing: Create new repository
- [ ] Manual testing: Rename repository (verify UUID unchanged)
- [ ] Manual testing: Delete repository
- [ ] Manual testing: Plans resolve correctly to repository paths
- [ ] Manual testing: No stale data after repository operations
- [ ] No workaround functions remain (`findRepoByIdFromSettings`, etc.)

## Rollback Plan

If issues are discovered post-deployment:
1. The disk format is unchanged (still slug-based folders)
2. Revert store changes to name-keyed
3. Restore workaround functions
4. No data migration needed for rollback
