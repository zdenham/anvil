# 03 — Tab System

**Wave 2 (parallel with 02-split-layout-renderer)** — Depends on 01-foundation-store.

## Goal

Build the PaneGroup, TabBar, and TabItem components that render tabs within a pane group. Includes tab labels (mirroring sidebar), status indicators, tab switching, tab close (left-neighbor activation), and the "+" button.

## Context

**Builds on**: Pane layout store/service from 01-foundation-store.

**Existing patterns**:
- `TabButton` (`src/components/workspace/tab-button.tsx`) — Existing tab styling component, can reference for visual consistency
- `useTreeData()` (`src/hooks/use-tree-data.ts`) — Computes sidebar display labels. Tab labels must match these exactly.
- `ContentPane` (`src/components/content-pane/content-pane.tsx`) — Existing view renderer that dispatches by view type. Reused as-is inside PaneGroup.
- `ContentPaneHeader` (`src/components/content-pane/content-pane-header.tsx`) — Kept as sub-header below tab bar.

**Threading note**: All visible thread tabs (the active tab in every rendered PaneGroup) should stay actively updated, not just the focused one. This is handled in 06-edge-cases-polish but the component structure should support it.

## Files to Create

```
src/components/split-layout/
├── pane-group.tsx        — Full PaneGroup: tab bar + sub-header + content
├── tab-bar.tsx           — Horizontal scrolling tab strip
├── tab-item.tsx          — Individual tab (clickable, closeable, status dot)
└── use-tab-label.ts      — Hook to derive tab label from view (mirrors sidebar)
```

## Component Design

### PaneGroup (`pane-group.tsx`)

The leaf-level component rendered by `SplitNodeRenderer` for each group.

```
┌────────────────────────────────────────┐
│ TabBar                                 │
│ [● main ×] [fix-bug.md ×] [+ ]        │
├────────────────────────────────────────┤
│ ContentPaneHeader (sub-header)         │
│ (view-specific controls)               │
├────────────────────────────────────────┤
│                                        │
│ ContentPane (existing, renders view)   │
│                                        │
└────────────────────────────────────────┘
```

**Props**: `groupId: string`

**Behavior**:
- Reads group from `usePaneLayoutStore(s => s.groups[groupId])`
- Active group detection: `usePaneLayoutStore(s => s.activeGroupId === groupId)`
- Active group gets accent border (e.g. `border-accent-500/50`)
- Click anywhere in the group → `paneLayoutService.setActiveGroup(groupId)`
- Renders `TabBar` with the group's tabs
- Renders `ContentPaneHeader` for the active tab's view
- Renders `ContentPane` for the active tab's view
- Wraps content in `InputStoreProvider` with `active` only when this is the active group

### TabBar (`tab-bar.tsx`)

Horizontal tab strip above content.

**Props**: `groupId: string`, `tabs: TabItem[]`, `activeTabId: string`

**Behavior**:
- Renders each tab as a `TabItem`
- Horizontal overflow: `overflow-x-auto` with hidden scrollbar (CSS)
- "+" button at the end → `paneLayoutService.openTab({ type: "empty" }, groupId)`
- Tab order matches `tabs` array order

**Styling**:
- Background: `bg-surface-800`
- Height: compact (~32px)
- Bottom border to separate from content

### TabItem (`tab-item.tsx`)

Individual tab in the bar.

**Props**: `tab: TabItem`, `groupId: string`, `isActive: boolean`

**Behavior**:
- Click → `paneLayoutService.setActiveTab(groupId, tab.id)`
- Close button (×) → `paneLayoutService.closeTab(groupId, tab.id)` (stop propagation to prevent tab activation)
- Middle-click → same as close
- Status dot (left of label):
  - Pulsing dot: thread is streaming
  - Solid dot: thread is running (not streaming)
  - No dot: idle or non-thread view
- Status dot reads from the same `ThreadMetadata.status` that the sidebar uses

**Styling**:
- Active tab: `bg-surface-900` (matches content background), `text-surface-100`
- Inactive tab: `bg-surface-800`, `text-surface-400`, hover: `text-surface-200`
- Close button: visible on hover or when tab is active
- Max width: ~180px with text truncation (`truncate`)

### useTabLabel (`use-tab-label.ts`)

Hook that derives the display label from a `ContentPaneView`, using the same data sources as the sidebar.

```typescript
function useTabLabel(view: ContentPaneView): string {
  // For each view type, pull from the same store the sidebar uses:
  // - thread: thread.name ?? "New Thread"
  // - plan: getPlanTitle(plan.relativePath) — for readme.md → parent dir name
  // - terminal: lastCommand ?? dirName ?? "Terminal"
  // - file: basename(filePath)
  // - pull-request: "PR #N: title" or "PR #N"
  // - settings/logs/archive: static label
  // - changes: "Changes"
  // - empty: "New Tab"
}
```

Uses individual store selectors (not `useTreeData()` wholesale — just the same underlying stores and logic).

## Tab Status Indicators

For thread tabs, derive status from the thread store:

```typescript
function useTabStatus(view: ContentPaneView): "streaming" | "running" | "idle" {
  if (view.type !== "thread") return "idle";
  const status = useThreadStore(s => s.threads[view.threadId]?.status);
  // Map ThreadMetadata.status to tab indicator
}
```

- Streaming: small pulsing dot (CSS animation, `animate-pulse`)
- Running: small solid dot
- Idle: no dot (hidden)

## Phases

- [x] Create `useTabLabel` hook deriving labels from the same stores as sidebar
- [x] Create `TabItem` component with click, close, middle-click, and status dot
- [x] Create `TabBar` component with horizontal scrolling, "+" button, and tab rendering
- [x] Create `PaneGroup` component composing TabBar + ContentPaneHeader + ContentPane
- [x] Write tests for tab label derivation and tab interaction (close neighbor logic is in store, tested in 01)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
