# Tree State - Building & Persistence

## Overview

Implement the tree data structure changes and expand state management for nested plans.

**Dependencies**: None
**Parallel with**: 01-data-layer, 04-agent-prompts

---

## Implementation

### 1. Tree Data Structure Changes

**`src/stores/tree-menu/types.ts`**

Extend TreeItemNode to support nesting:

```typescript
export interface TreeItemNode {
  type: "thread" | "plan";
  id: string;
  title: string;
  status: StatusDotVariant;
  updatedAt: number;
  createdAt: number;
  sectionId: string;
  // NEW: For nested plans
  depth: number;           // Indentation level (0 = root)
  isFolder: boolean;       // Has children
  isExpanded: boolean;     // If folder, is it expanded?
  parentId?: string;       // Parent plan ID
}
```

### 2. Reuse Existing expandedSections Store

**Key Insight**: We already have `expandedSections: Record<string, boolean>` in the tree-menu store that handles worktree section expansion. Rather than creating a separate `expandedFoldersByWorktree` state, we extend the existing pattern.

**ID Convention** for `expandedSections` keys:
- Worktree sections: `"repoId:worktreeId"` (existing)
- Plan folders: `"plan:planId"` (new)

This reuses the existing:
- Store state (`expandedSections`)
- Service methods (`toggleSection`, `expandSection`, `collapseSection`)
- Persistence layer (disk-based, not localStorage)
- Optimistic update pattern

**No store changes needed!** The existing `expandedSections` already supports arbitrary string keys.

### 3. Tree Building Enhancement

**`src/hooks/use-tree-data.ts`**

Update `buildTreeFromEntities` to handle nested plans:

```typescript
/**
 * Build tree items for a section, handling nested plans.
 * Returns a flat list with depth info for rendering.
 */
function buildSectionItems(
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  sectionId: string,
  expandedSections: Record<string, boolean>,
  runningThreadIds: Set<string>
): TreeItemNode[] {
  const items: TreeItemNode[] = [];

  // Add threads (always depth 0, never folders)
  for (const thread of threads) {
    items.push({
      type: "thread",
      id: thread.id,
      title: thread.name ?? "New Thread",
      status: getThreadStatusVariant(thread),
      updatedAt: thread.updatedAt,
      createdAt: thread.createdAt,
      sectionId,
      depth: 0,
      isFolder: false,
      isExpanded: false,
    });
  }

  // Group plans by parent
  const childrenMap = new Map<string | undefined, PlanMetadata[]>();
  for (const plan of plans) {
    const siblings = childrenMap.get(plan.parentId) || [];
    siblings.push(plan);
    childrenMap.set(plan.parentId, siblings);
  }

  // Recursively add plans with depth
  function addPlanAndChildren(plan: PlanMetadata, depth: number) {
    const children = childrenMap.get(plan.id) || [];
    const isFolder = children.length > 0;
    // Use "plan:planId" key convention for folder expand state
    const isExpanded = expandedSections[`plan:${plan.id}`] ?? true; // Default expanded

    items.push({
      type: "plan",
      id: plan.id,
      title: getPlanTitle(plan),
      status: getPlanStatus(plan, runningThreadIds),
      updatedAt: plan.updatedAt,
      createdAt: plan.createdAt,
      sectionId,
      depth,
      isFolder,
      isExpanded,
      parentId: plan.parentId,
    });

    // Only add children if expanded
    if (isFolder && isExpanded) {
      const sorted = [...children].sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath)
      );
      for (const child of sorted) {
        addPlanAndChildren(child, depth + 1);
      }
    }
  }

  // Add root plans (no parentId)
  const rootPlans = childrenMap.get(undefined) || [];
  const sortedRoots = [...rootPlans].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  );
  for (const plan of sortedRoots) {
    addPlanAndChildren(plan, 0);
  }

  return items;
}

/**
 * Get display title for a plan.
 * For readme.md files, use the parent directory name.
 */
function getPlanTitle(plan: PlanMetadata): string {
  const parts = plan.relativePath.split('/');
  const filename = parts[parts.length - 1];

  // For readme.md, use directory name as title
  if (filename.toLowerCase() === 'readme.md' && parts.length > 2) {
    return parts[parts.length - 2];
  }

  // Otherwise use filename without extension
  return filename.replace(/\.md$/, '');
}
```

### 4. Toggle Folder Action

Use the existing service for toggling folder expansion:

```typescript
// In component click handler:
import { treeMenuService } from "@/stores/tree-menu/service";

const handleFolderClick = (planId: string) => {
  // Uses existing service - just with "plan:" prefixed key
  treeMenuService.toggleSection(`plan:${planId}`);
};
```

No new service methods needed - the existing `toggleSection`, `expandSection`, `collapseSection` all work with any string key.

---

## Checklist

- [ ] Add `depth`, `isFolder`, `isExpanded`, `parentId` to TreeItemNode type
- [ ] Update `buildTreeFromEntities()` to use `buildSectionItems()` helper
- [ ] Implement `getPlanTitle()` for readme.md directory naming
- [ ] Use `"plan:planId"` key convention for expand state in `expandedSections`
- [ ] Ensure tree rebuilds when expand state changes (already reactive via `expandedSections`)
- [ ] Add folder toggle click handler using existing `treeMenuService.toggleSection()`
