# 03: Tree Menu Nesting

Modify tree menu to nest sub-agent threads under their parent.

## Phases

- [x] Update `use-tree-data.ts` to build nested thread hierarchy
- [x] Update expansion state to support `thread:{id}` keys
- [x] Update `thread-item.tsx` to support being a folder
- [x] Add sub-agent visual indicators (badge, etc.)

---

## Tree Data Changes

```typescript
// src/hooks/use-tree-data.ts

function buildSectionItems(
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  // ... existing params
): TreeItemNode[] {
  // Separate root threads from sub-agent threads
  const rootThreads = threads.filter(t => !t.parentThreadId);
  const childThreadsMap = new Map<string, ThreadMetadata[]>();

  for (const thread of threads) {
    if (thread.parentThreadId) {
      const siblings = childThreadsMap.get(thread.parentThreadId) || [];
      siblings.push(thread);
      childThreadsMap.set(thread.parentThreadId, siblings);
    }
  }

  // Build tree recursively
  function addThreadAndChildren(thread: ThreadMetadata, depth: number) {
    const children = childThreadsMap.get(thread.id) || [];
    const isFolder = children.length > 0;
    const isExpanded = expandedSections[`thread:${thread.id}`] ?? true;

    items.push({
      type: "thread",
      id: thread.id,
      title: thread.name ?? "New Thread",
      status: getThreadStatusVariant(thread, runningThreadIds),
      depth,
      isFolder,
      isExpanded,
      parentId: thread.parentThreadId,
      // Sub-agent indicator
      isSubAgent: !!thread.parentThreadId,
      agentType: thread.agentType,
    });

    if (isFolder && isExpanded) {
      for (const child of children.sort((a, b) => a.createdAt - b.createdAt)) {
        addThreadAndChildren(child, depth + 1);
      }
    }
  }

  // Add root threads (which recursively add their children)
  for (const thread of rootThreads) {
    addThreadAndChildren(thread, 0);
  }

  // ... rest of plan building
}
```

## TreeItemNode Extension

```typescript
// src/stores/tree-menu/types.ts
interface TreeItemNode {
  type: "thread" | "plan";  // No new type - sub-agents are threads
  // ... existing fields

  // Sub-agent indicator (for threads only)
  isSubAgent?: boolean;
  agentType?: string;
}
```

## Thread Item Changes

```typescript
// Update thread-item.tsx to handle being a folder
function ThreadItem({ item, ... }) {
  const hasChildren = item.isFolder;

  return (
    <div style={{ paddingLeft: `${INDENT_BASE + item.depth * INDENT_STEP}px` }}>
      {hasChildren && <ChevronIcon expanded={item.isExpanded} />}
      <StatusDot variant={item.status} />
      {item.isSubAgent && <AgentTypeBadge type={item.agentType} />}
      <span className="truncate">{item.title}</span>
    </div>
  );
}
```

## Key Behaviors

- Sub-agents ONLY appear nested under parent (not in date sections independently)
- Single click navigates to sub-agent thread view
- Threads become folders when they have sub-agent children
- Same indentation pattern as nested plans

## Files to Modify

- `src/hooks/use-tree-data.ts` - Nested thread building
- `src/stores/tree-menu/types.ts` - Add isSubAgent, agentType fields
- `src/components/tree-menu/thread-item.tsx` - Folder support, badges
