# Subplan 0: Core Types & Store Structure

**Priority**: BLOCKING - Must complete before any other subplan
**Estimated Files**: 2
**Dependencies**: None

## Overview

Update the foundational types and store structure to key repositories by UUID instead of name.

## Files to Modify

### 1. `core/types/repositories.ts`

Add `id` field to `RepositoryMetadataSchema`:

```typescript
export const RepositoryMetadataSchema = z.object({
  id: z.string().uuid(),  // ADD THIS
  name: z.string(),
  // ... rest unchanged
});
```

### 2. `src/entities/repositories/store.ts`

Update store interface and implementation:

**Interface changes:**
```typescript
interface RepositoryState {
  repositories: Record<string, Repository>;  // Key is now UUID (not name)
  _hydrated: boolean;
}

interface RepositoryActions {
  hydrate: (repositories: Record<string, Repository>) => void;

  // Updated selectors
  getRepository: (id: string) => Repository | undefined;
  getRepositoryById: (id: string) => Repository | undefined;  // Alias
  getRepositoryByName: (name: string) => Repository | undefined;  // New helper
  getRepositoryIds: () => string[];  // New - returns UUIDs
  getRepositoryNames: () => string[];  // Keep for backwards compat

  // Update apply methods to use ID
  _applyCreate: (repo: Repository) => Rollback;
  _applyUpdate: (id: string, repo: Repository) => Rollback;
  _applyDelete: (id: string) => Rollback;
}
```

**Implementation notes:**
- `getRepository(id)` → `get().repositories[id]`
- `getRepositoryByName(name)` → iterate `Object.values()` to find by `repo.name`
- `getRepositoryIds()` → `Object.keys(get().repositories)`
- `getRepositoryNames()` → `Object.values(get().repositories).map(r => r.name)`

## Verification

After completing this subplan:
- [ ] TypeScript compiles (will have errors in consumers - expected)
- [ ] Store can be hydrated with UUID-keyed data
- [ ] `getRepositoryByName()` helper works correctly
- [ ] `getRepositoryIds()` returns array of UUIDs

## Blocks

This subplan blocks:
- Subplan 1A: Service Layer
- Subplan 1B: Hooks & Utils
- Subplan 1C: Listeners & Events
