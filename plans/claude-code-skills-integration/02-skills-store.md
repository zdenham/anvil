# 02: Skills Store

## Overview

Create the Zustand store for managing skill state in the frontend. Follows the same entity pattern as quick-actions.

## Phases

- [ ] Create Zustand store with selectors
- [ ] Add hydration support
- [ ] Export from entity index

---

## Dependencies

- **01-types-foundation** - Needs `SkillMetadata`, `SkillSource` types

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/entities/skills/store.ts` | **CREATE** |
| `src/entities/skills/index.ts` | **CREATE** |
| `src/entities/index.ts` | **MODIFY** - Add skills export |

---

## Implementation

### 1. Skills Store

Create `src/entities/skills/store.ts`:

```typescript
import { create } from 'zustand';
import type { SkillMetadata, SkillSource } from './types';

interface SkillsState {
  skills: Record<string, SkillMetadata>;  // Keyed by ID
  _hydrated: boolean;
  _lastDiscoveryPath: string | null;      // Track which repo we discovered for

  // Selectors
  getSkill: (id: string) => SkillMetadata | undefined;
  getBySlug: (slug: string) => SkillMetadata | undefined;
  getAll: () => SkillMetadata[];
  getForSource: (source: SkillSource) => SkillMetadata[];
  search: (query: string) => SkillMetadata[];

  // Mutations
  hydrate: (skills: Record<string, SkillMetadata>, repoPath: string) => void;
  _setHydrated: (hydrated: boolean) => void;
}

// Priority order for sorting
const SOURCE_PRIORITY: Record<SkillSource, number> = {
  project: 0,
  project_command: 1,
  mort: 2,
  personal: 3,
  personal_command: 4,
};

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: {},
  _hydrated: false,
  _lastDiscoveryPath: null,

  getSkill: (id) => get().skills[id],

  getBySlug: (slug) => {
    const normalized = slug.toLowerCase();
    return Object.values(get().skills).find(s => s.slug === normalized);
  },

  getAll: () => {
    return Object.values(get().skills)
      .filter(s => s.userInvocable)
      .sort((a, b) =>
        SOURCE_PRIORITY[a.source] - SOURCE_PRIORITY[b.source] ||
        a.name.localeCompare(b.name)
      );
  },

  getForSource: (source) => {
    return Object.values(get().skills)
      .filter(s => s.source === source && s.userInvocable);
  },

  search: (query) => {
    const q = query.toLowerCase();
    return get().getAll().filter(s =>
      s.name.toLowerCase().includes(q) ||
      s.slug.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q)
    );
  },

  hydrate: (skills, repoPath) => set({
    skills,
    _hydrated: true,
    _lastDiscoveryPath: repoPath
  }),

  _setHydrated: (hydrated) => set({ _hydrated: hydrated }),
}));
```

### 2. Entity Index

Create `src/entities/skills/index.ts`:

```typescript
export * from './types';
export { useSkillsStore } from './store';
```

### 3. Update Entities Index

Add to `src/entities/index.ts`:

```typescript
export * from './skills';
```

---

## Acceptance Criteria

- [ ] `useSkillsStore` hook exists and compiles
- [ ] `getBySlug` normalizes to lowercase
- [ ] `getAll` returns skills sorted by source priority, then name
- [ ] `search` filters on name, slug, and description
- [ ] `hydrate` sets skills and tracks discovery path
- [ ] Store exported from `src/entities/skills`
