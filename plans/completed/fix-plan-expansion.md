# Fix: Plans with Sub-Plans Not Expandable

## Diagnosis

**Toggle default mismatch** in `treeMenuService.toggleSection()` makes plan/thread folder expansion require 3 clicks instead of 2.

### The Bug

`treeMenuService.toggleSection()` (`src/stores/tree-menu/service.ts:57`) reads the current expansion state with:
```ts
const current = useTreeMenuStore.getState().expandedSections[sectionId] ?? true;
```

The `?? true` default was written for repo/worktree sections (which default to expanded). But plan folders and thread folders use different keys (`plan:{id}`, `thread:{id}`) and default to **collapsed** in the rendering layer:

- `use-tree-data.ts:154`: `expandedSections[\`plan:${plan.id}\`] ?? false`
- `use-tree-data.ts:120`: `expandedSections[\`thread:${thread.id}\`] ?? false`

**Result:** When a user clicks to expand a plan folder for the first time:
1. Click 1: Selects the plan (chevron appears)
2. Click 2: `toggleSection` reads `undefined ?? true` = `true` → sets `false` → **no visible change** (was already visually collapsed)
3. Click 3: reads `false` → sets `true` → **finally expands**

The same mismatch also affects `expandSection()` (`service.ts:84`) where it early-returns if `current === true`, but `current` for a never-toggled plan folder would be `undefined ?? true` = `true`, so `expandSection` would ALSO no-op on first call.

### Scope

- Same bug affects thread folders (sub-agent threads) using `thread:` prefix
- `Changes` folder items using `changes:` prefix are NOT affected (they use the section-level toggle which defaults to collapsed in the rendering: `expandedSections[changesItemId] ?? false`)

## Phases

- [x] Fix toggle/expand/collapse defaults to be context-aware based on key prefix
- [x] Verify plan folder and thread folder expansion works on first click

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Fix toggle/expand/collapse defaults

**File:** `src/stores/tree-menu/service.ts`

Add a helper to determine the correct default based on key convention:

```ts
/**
 * Get default expansion state for a section/folder key.
 * Repo/worktree sections default expanded (true).
 * Plan folders, thread folders, and changes folders default collapsed (false).
 */
function getDefaultExpanded(sectionId: string): boolean {
  if (sectionId.startsWith("plan:") || sectionId.startsWith("thread:") || sectionId.startsWith("changes:")) {
    return false;
  }
  return true; // repo:worktree sections default expanded
}
```

Then update three methods to use it:

**`toggleSection`** (line 57):
```ts
// Before:
const current = useTreeMenuStore.getState().expandedSections[sectionId] ?? true;
// After:
const current = useTreeMenuStore.getState().expandedSections[sectionId] ?? getDefaultExpanded(sectionId);
```

**`expandSection`** (line 84):
```ts
// Before:
const current = useTreeMenuStore.getState().expandedSections[sectionId];
if (current === true) return;
// After:
const current = useTreeMenuStore.getState().expandedSections[sectionId] ?? getDefaultExpanded(sectionId);
if (current === true) return;
```

**`collapseSection`** (line 109):
```ts
// Before:
const current = useTreeMenuStore.getState().expandedSections[sectionId];
if (current === false) return;
// After:
const current = useTreeMenuStore.getState().expandedSections[sectionId] ?? getDefaultExpanded(sectionId);
if (current === false) return;
```

## Phase 2: Verify

- Confirm plan folder expansion works on first toggle click (2 total clicks: select, then expand)
- Confirm thread folder (sub-agent) expansion works the same way
- Confirm repo/worktree sections still default expanded and collapse on first click
- Confirm `Changes` folder still defaults collapsed
