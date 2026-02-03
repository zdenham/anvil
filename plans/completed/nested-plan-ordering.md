# Nested Plan Ordering Fix

## Issue

**Problem:** When nested plans are displayed, sub-plans should appear immediately below their parent directory. Instead, threads and other plans appear between the parent and its children.

**Expected:**
```
📁 auth (folder plan)
  └── login.md
  └── oauth.md
🧵 thread-1
🧵 thread-2
```

**Actual (buggy):**
```
📁 auth (folder plan)
🧵 thread-1  ← appears between parent and children!
🧵 thread-2
  └── login.md
  └── oauth.md
```

**Root Cause:** In `use-tree-data.ts:33-112`, the `buildSectionItems()` function:

1. **Lines 42-56:** Adds ALL threads first (depth 0)
2. **Lines 104-110:** Then adds plans recursively (with proper parent-child nesting)

The problem is the final sort at **lines 219-233**:
```typescript
items.sort((a, b) => {
  if (a.depth !== b.depth) {
    return 0;  // ← BUG: Returns 0 for different depths, preserving insertion order
  }
  if (a.depth === 0) {
    return b.createdAt - a.createdAt;
  }
  return 0;
});
```

This sort only reorders items at the same depth level. Since threads are inserted first (at depth 0), they end up positioned before the plans (also at depth 0), but the children (depth > 0) were inserted after the plans, causing them to appear after the threads rather than immediately after their parents.

## Solution

Change the data structure approach - instead of building a flat list and sorting, build the nested structure correctly from the start by sorting top-level items (threads + root plans) by createdAt BEFORE building the tree, then don't sort after building.

## Implementation

**File:** `src/hooks/use-tree-data.ts`

Refactor `buildSectionItems`:

```typescript
function buildSectionItems(
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  sectionId: string,
  expandedSections: Record<string, boolean>,
  runningThreadIds: Set<string>
): TreeItemNode[] {
  const items: TreeItemNode[] = [];

  // Group plans by parent
  const childrenMap = new Map<string | undefined, PlanMetadata[]>();
  for (const plan of plans) {
    const siblings = childrenMap.get(plan.parentId) || [];
    siblings.push(plan);
    childrenMap.set(plan.parentId, siblings);
  }

  // Build thread nodes
  const threadNodes: TreeItemNode[] = threads.map((thread) => ({
    type: "thread" as const,
    id: thread.id,
    title: thread.name ?? "New Thread",
    status: getThreadStatusVariant(thread),
    updatedAt: thread.updatedAt,
    createdAt: thread.createdAt,
    sectionId,
    depth: 0,
    isFolder: false,
    isExpanded: false,
  }));

  // Recursively add plans with depth
  function addPlanAndChildren(plan: PlanMetadata, depth: number) {
    const children = childrenMap.get(plan.id) || [];
    const isFolder = children.length > 0;
    const isExpanded = expandedSections[`plan:${plan.id}`] ?? true;

    const relations = relationService.getByPlan(plan.id);
    const relatedThreadIds = relations.map((r) => r.threadId);
    const hasRunningThread = relatedThreadIds.some((id) => runningThreadIds.has(id));

    items.push({
      type: "plan",
      id: plan.id,
      title: getPlanTitle(plan),
      status: getPlanStatusVariant(plan.isRead, hasRunningThread, plan.stale),
      updatedAt: plan.updatedAt,
      createdAt: plan.createdAt,
      sectionId,
      depth,
      isFolder,
      isExpanded,
      parentId: plan.parentId,
    });

    if (isFolder && isExpanded) {
      const sorted = [...children].sort((a, b) =>
        a.relativePath.localeCompare(b.relativePath)
      );
      for (const child of sorted) {
        addPlanAndChildren(child, depth + 1);
      }
    }
  }

  // Get root plans and sort by createdAt descending
  const rootPlans = childrenMap.get(undefined) || [];

  // Create temporary root plan nodes to get their createdAt for sorting
  interface TopLevelItem {
    type: "thread" | "root-plan";
    createdAt: number;
    node?: TreeItemNode;  // For threads
    plan?: PlanMetadata;  // For plans
  }

  const topLevel: TopLevelItem[] = [
    ...threadNodes.map(node => ({ type: "thread" as const, createdAt: node.createdAt, node })),
    ...rootPlans.map(plan => ({ type: "root-plan" as const, createdAt: plan.createdAt, plan })),
  ];

  // Sort top-level by createdAt descending
  topLevel.sort((a, b) => b.createdAt - a.createdAt);

  // Now add items in sorted order - plans will recursively add their children
  for (const item of topLevel) {
    if (item.type === "thread" && item.node) {
      items.push(item.node);
    } else if (item.type === "root-plan" && item.plan) {
      addPlanAndChildren(item.plan, 0);
    }
  }

  return items;
}
```

Then remove the sort at lines 219-233 in `buildTreeFromEntities`.

## Affected Files

- `src/hooks/use-tree-data.ts` - Refactor `buildSectionItems` and remove post-build sort

## Automated Tests

Unit tests have been added to verify this bug and validate the fix:

**File:** `src/hooks/__tests__/use-tree-data.test.ts`

Run tests with:
```bash
pnpm test src/hooks/__tests__/use-tree-data.test.ts
```

### Test Cases

1. **"should keep child plans immediately after parent when parent is NEWER than threads"**
   - Parent plan created at T+3000 (newest)
   - Threads created at T+1000 and T+2000 (older)
   - Verifies children appear at indices `parentIndex + 1` and `parentIndex + 2`
   - Currently FAILS (confirms bug exists)

2. **"should keep children with parent when parent is in MIDDLE of createdAt order"**
   - Thread-2 at T+3000 (newest), parent at T+2000 (middle), thread-1 at T+1000 (oldest)
   - Verifies child appears immediately after parent at `parentIndex + 1`
   - Currently FAILS (confirms bug exists)

### Expected Results

- **Before fix:** Tests FAIL - children are separated from parent by threads
- **After fix:** Tests PASS - children immediately follow their parent

## Manual Testing

- [ ] Create nested plans: `auth/readme.md`, `auth/login.md`, `auth/oauth.md`
- [ ] Verify sub-plans appear immediately below parent directory
- [ ] Add threads to the same worktree
- [ ] Verify threads and root plans are interleaved by createdAt, but children stay with parents
- [ ] Collapse parent folder - verify children disappear
- [ ] Expand parent folder - verify children reappear in correct position

## Complexity

Medium
