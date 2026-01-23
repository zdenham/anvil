# Subplan 1A: Service Layer

**Priority**: Tier 1 - Can run in parallel with 1B and 1C
**Estimated Files**: 1
**Dependencies**: Subplan 0 (Core Types & Store)

## Overview

Update the repository service to use UUID-based operations internally and in its public API.

## Files to Modify

### `src/entities/repositories/service.ts`

#### Method Signature Changes

| Method | Current | New |
|--------|---------|-----|
| `get` | `get(name: string)` | `get(id: string)` |
| `getByName` | N/A | `getByName(name: string)` (new) |
| `update` | `update(name, updates)` | `update(id, updates)` |
| `delete` | `delete(name)` | `delete(id)` |
| `refresh` | `refresh(name)` | `refresh(id)` |
| `getLatestVersion` | `getLatestVersion(name)` | `getLatestVersion(id)` |
| `getVersion` | `getVersion(name, ver)` | `getVersion(id, ver)` |
| `remove` | Already uses `repoId` param | Fix internal implementation |
| `rename` | Already uses `repoId` param | Fix internal implementation |

#### Update `hydrate()` Function

```typescript
// Current (line ~144):
repositories[metadata.name] = { ...metadata, versions };

// Change to:
repositories[settings.id] = { ...metadata, id: settings.id, versions };
```

#### Add Helper Method

```typescript
getByName(name: string): Repository | undefined {
  return useRepoStore.getState().getRepositoryByName(name);
}
```

#### Internal Changes

Update all internal references from name-based to ID-based lookups:
- `useRepoStore.getState().getRepository(name)` → `getRepository(id)`
- `slugify(name)` usage needs review - may need to derive slug from repo object

## Verification

After completing this subplan:
- [ ] All service methods accept UUID where applicable
- [ ] `hydrate()` correctly keys repositories by UUID
- [ ] `getByName()` helper exists for transitional use
- [ ] TypeScript compiles (may still have consumer errors)

## Parallel With

- Subplan 1B: Hooks & Utils
- Subplan 1C: Listeners & Events
