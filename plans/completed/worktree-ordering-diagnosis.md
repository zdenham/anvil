# Worktree Ordering Diagnosis

## Current Behavior

Worktrees in the sidebar are currently ordered by **most recent activity** - specifically, by the `latestUpdate` timestamp of any thread or plan within that worktree section.

### How Ordering Works

The sorting logic is in `src/hooks/use-tree-data.ts`:

**1. Items within a worktree** are sorted by `createdAt` descending (newest first):
```typescript
// Line 131
data.items.sort((a, b) => b.createdAt - a.createdAt);
```

**2. Worktree sections** are sorted by `latestUpdate` descending (most recent first):
```typescript
// Lines 147-151
sections.sort((a, b) => {
  const aLatest = sectionMap.get(a.id)?.latestUpdate ?? 0;
  const bLatest = sectionMap.get(b.id)?.latestUpdate ?? 0;
  return bLatest - aLatest;
});
```

**3. `latestUpdate` is computed** as the maximum `updatedAt` of all threads/plans in that section:
```typescript
// Lines 93-95 (for threads)
if (thread.updatedAt > section.latestUpdate) {
  section.latestUpdate = thread.updatedAt;
}

// Lines 122-124 (for plans)
if (plan.updatedAt > section.latestUpdate) {
  section.latestUpdate = plan.updatedAt;
}
```

## Why Creating a New Thread Causes Reordering

When a new thread is created:

1. The thread is created with `createdAt: now` and `updatedAt: now`
2. This sets `latestUpdate` for its worktree section to `now`
3. The sorting algorithm places this worktree at the top (highest `latestUpdate`)
4. Any worktree that previously had older items will move down

**Example scenario:**
- Worktree A has threads from yesterday (`latestUpdate: yesterday`)
- Worktree B has threads from last week (`latestUpdate: last week`)
- Order: A, B

After creating a new thread in Worktree B:
- Worktree B now has `latestUpdate: now`
- Order changes to: B, A

## Proposed Fix Options

### Option 1: Sort by Worktree Name (Alphabetical)

Replace the `latestUpdate` sort with alphabetical sorting by worktree name:

```typescript
// In use-tree-data.ts, replace lines 146-151:
sections.sort((a, b) => {
  // Primary: sort by repo name
  const repoCompare = a.repoName.localeCompare(b.repoName);
  if (repoCompare !== 0) return repoCompare;
  // Secondary: sort by worktree name
  return a.worktreeName.localeCompare(b.worktreeName);
});
```

**Pros:** Stable, predictable ordering
**Cons:** Loses "most active at top" feature

### Option 2: Sort by Worktree Creation Date

Track when each worktree was first seen/registered and sort by that:

```typescript
// Would require adding createdAt to worktree metadata
sections.sort((a, b) => {
  const aCreated = getWorktreeCreatedAt(a.repoId, a.worktreeId) ?? 0;
  const bCreated = getWorktreeCreatedAt(b.repoId, b.worktreeId) ?? 0;
  return aCreated - bCreated; // Oldest first
});
```

**Pros:** Stable ordering, respects order of worktree creation
**Cons:** Requires schema change to track worktree creation time

### Option 3: User-Defined Ordering (Drag and Drop)

Store explicit ordering in the tree-menu store and allow users to reorder via drag-and-drop:

```typescript
// In tree-menu store
interface TreeMenuState {
  // ... existing fields
  sectionOrder: string[]; // Array of sectionIds in user-defined order
}

// Sort using explicit order
sections.sort((a, b) => {
  const aIndex = sectionOrder.indexOf(a.id);
  const bIndex = sectionOrder.indexOf(b.id);
  // New sections go to end
  if (aIndex === -1 && bIndex === -1) return 0;
  if (aIndex === -1) return 1;
  if (bIndex === -1) return -1;
  return aIndex - bIndex;
});
```

**Pros:** Maximum user control
**Cons:** More complex implementation, requires UI work

### Option 4: Keep Current + Pin Feature

Keep the "most recent activity" sorting but allow users to pin worktrees to top:

```typescript
interface TreeMenuState {
  pinnedSections: Set<string>;
}

sections.sort((a, b) => {
  const aPinned = pinnedSections.has(a.id);
  const bPinned = pinnedSections.has(b.id);

  // Pinned sections first
  if (aPinned && !bPinned) return -1;
  if (!aPinned && bPinned) return 1;

  // Within same pin status, sort by latest update
  const aLatest = sectionMap.get(a.id)?.latestUpdate ?? 0;
  const bLatest = sectionMap.get(b.id)?.latestUpdate ?? 0;
  return bLatest - aLatest;
});
```

**Pros:** Preserves current behavior, adds user control
**Cons:** UI needed for pin/unpin

## Recommendation

**Option 1 (Alphabetical)** is the simplest fix if stable ordering is the primary goal.

**Option 3 or 4** provides the best UX if users want control over their workspace organization.

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/use-tree-data.ts` | Update sorting logic (lines 146-151) |
| `src/stores/tree-menu/types.ts` | Add `sectionOrder` or `pinnedSections` if using Option 3/4 |
| `src/stores/tree-menu/store.ts` | Add actions for reordering/pinning if using Option 3/4 |
| `src/components/tree-menu/repo-worktree-section.tsx` | Add pin UI if using Option 4 |
