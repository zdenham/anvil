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

### 2. Folder Expand State Store

**`src/stores/tree-menu/store.ts`**

Add per-worktree folder expand state:

```typescript
interface TreeMenuState {
  // ... existing state
  expandedFoldersByWorktree: Record<string, Set<string>>; // worktreeId -> Set of expanded plan IDs
}

interface TreeMenuActions {
  // ... existing actions
  toggleFolder: (worktreeId: string, planId: string) => void;
  expandFolder: (worktreeId: string, planId: string) => void;
  collapseFolder: (worktreeId: string, planId: string) => void;
  getExpandedFolders: (worktreeId: string) => Set<string>;
  isExpanded: (worktreeId: string, planId: string) => boolean;
}

// Implementation
export const useTreeMenuStore = create<TreeMenuState & TreeMenuActions>()(
  persist(
    (set, get) => ({
      expandedFoldersByWorktree: {},

      toggleFolder: (worktreeId, planId) => {
        set((state) => {
          const expanded = new Set(state.expandedFoldersByWorktree[worktreeId] || []);
          if (expanded.has(planId)) {
            expanded.delete(planId);
          } else {
            expanded.add(planId);
          }
          return {
            expandedFoldersByWorktree: {
              ...state.expandedFoldersByWorktree,
              [worktreeId]: expanded,
            },
          };
        });
      },

      expandFolder: (worktreeId, planId) => {
        set((state) => {
          const expanded = new Set(state.expandedFoldersByWorktree[worktreeId] || []);
          expanded.add(planId);
          return {
            expandedFoldersByWorktree: {
              ...state.expandedFoldersByWorktree,
              [worktreeId]: expanded,
            },
          };
        });
      },

      collapseFolder: (worktreeId, planId) => {
        set((state) => {
          const expanded = new Set(state.expandedFoldersByWorktree[worktreeId] || []);
          expanded.delete(planId);
          return {
            expandedFoldersByWorktree: {
              ...state.expandedFoldersByWorktree,
              [worktreeId]: expanded,
            },
          };
        });
      },

      getExpandedFolders: (worktreeId) => {
        return get().expandedFoldersByWorktree[worktreeId] || new Set();
      },

      isExpanded: (worktreeId, planId) => {
        return get().getExpandedFolders(worktreeId).has(planId);
      },
    }),
    {
      name: 'tree-menu-storage',
      partialize: (state) => ({
        expandedFoldersByWorktree: state.expandedFoldersByWorktree,
      }),
      // Custom serializer for Set objects
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const parsed = JSON.parse(str);
          // Convert arrays back to Sets
          if (parsed.state?.expandedFoldersByWorktree) {
            for (const key of Object.keys(parsed.state.expandedFoldersByWorktree)) {
              parsed.state.expandedFoldersByWorktree[key] = new Set(
                parsed.state.expandedFoldersByWorktree[key]
              );
            }
          }
          return parsed;
        },
        setItem: (name, value) => {
          // Convert Sets to arrays for JSON serialization
          const toStore = { ...value };
          if (toStore.state?.expandedFoldersByWorktree) {
            const converted: Record<string, string[]> = {};
            for (const [key, val] of Object.entries(toStore.state.expandedFoldersByWorktree)) {
              converted[key] = Array.from(val as Set<string>);
            }
            toStore.state.expandedFoldersByWorktree = converted;
          }
          localStorage.setItem(name, JSON.stringify(toStore));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    }
  )
);
```

### 3. Tree Building Enhancement

**`src/hooks/use-tree-data.ts`**

Update to build hierarchical tree structure:

```typescript
interface TreeBuildContext {
  plans: PlanMetadata[];
  childrenMap: Map<string, PlanMetadata[]>;
  expandedFolders: Set<string>;
  worktreeId: string;
}

/**
 * Build a flat list of TreeItemNodes with proper depth for rendering.
 * Only includes children of expanded folders.
 */
function buildPlanTree(
  plans: PlanMetadata[],
  worktreeId: string,
  expandedFolders: Set<string>
): TreeItemNode[] {
  // Group children by parent
  const childrenMap = new Map<string, PlanMetadata[]>();
  const rootPlans: PlanMetadata[] = [];

  for (const plan of plans) {
    if (plan.parentId) {
      const siblings = childrenMap.get(plan.parentId) || [];
      siblings.push(plan);
      childrenMap.set(plan.parentId, siblings);
    } else {
      rootPlans.push(plan);
    }
  }

  const context: TreeBuildContext = {
    plans,
    childrenMap,
    expandedFolders,
    worktreeId,
  };

  // Build flat list with depth info
  const result: TreeItemNode[] = [];

  function addNodeAndChildren(plan: PlanMetadata, depth: number) {
    const children = childrenMap.get(plan.id) || [];
    const isFolder = children.length > 0;
    const isExpanded = expandedFolders.has(plan.id);

    result.push({
      type: 'plan',
      id: plan.id,
      title: getPlanTitle(plan),
      status: getPlanStatus(plan),
      updatedAt: plan.updatedAt,
      createdAt: plan.createdAt,
      sectionId: worktreeId,
      depth,
      isFolder,
      isExpanded,
      parentId: plan.parentId,
    });

    // Only add children if this folder is expanded
    if (isFolder && isExpanded) {
      // Sort children by title or creation date
      const sortedChildren = [...children].sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath)
      );

      for (const child of sortedChildren) {
        addNodeAndChildren(child, depth + 1);
      }
    }
  }

  // Sort root plans
  const sortedRoots = [...rootPlans].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  );

  for (const plan of sortedRoots) {
    addNodeAndChildren(plan, 0);
  }

  return result;
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

### 4. Hook Integration

**`src/hooks/use-tree-data.ts`**

Update the hook to use the new tree building:

```typescript
export function useTreeData(worktreeId: string) {
  const plans = usePlanStore((state) => state.getByWorktree(worktreeId));
  const expandedFolders = useTreeMenuStore((state) =>
    state.getExpandedFolders(worktreeId)
  );

  const treeItems = useMemo(
    () => buildPlanTree(plans, worktreeId, expandedFolders),
    [plans, worktreeId, expandedFolders]
  );

  return treeItems;
}
```

---

## Checklist

- [ ] Add `depth`, `isFolder`, `isExpanded`, `parentId` to TreeItemNode type
- [ ] Add `expandedFoldersByWorktree` state to tree-menu store
- [ ] Implement `toggleFolder`, `expandFolder`, `collapseFolder` actions
- [ ] Implement `getExpandedFolders`, `isExpanded` selectors
- [ ] Add persistence with Set serialization for expand state
- [ ] Update `buildPlanTree()` to create hierarchical flat list
- [ ] Implement `getPlanTitle()` for readme.md directory naming
- [ ] Update `useTreeData` hook to use new tree building
- [ ] Ensure tree rebuilds when expand state changes
