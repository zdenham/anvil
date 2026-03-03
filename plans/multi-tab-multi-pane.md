# Multi-Tab & Multi-Pane Support

## Goal

Implement VS Code-style multi-tab and multi-pane support: tabs within pane groups, Cmd+Click to open in new tab, draggable split layouts (up to 4 wide, 3 high), recursively stackable.

---

## Current Architecture (State Map)

### Layout Structure

```
┌──────────────────────────────────────────────────────────┐
│ MainWindowLayout (main-window-layout.tsx)                 │
├─────────────┬──────────────────────────┬─────────────────┤
│ ResizablePanel│ ContentPaneContainer    │ ResizablePanel  │
│ (left)       │ (center, flex-1)         │ (right)         │
│              │                          │                 │
│ TreeMenu     │ ContentPane (single)     │ FileBrowser OR  │
│ + Header     │  - ContentPaneHeader     │ SearchPanel     │
│ + Legend     │  - View content          │ (optional)      │
└─────────────┴──────────────────────────┴─────────────────┘
```

### Content Pane State (`~/.mort/ui/content-panes.json`)

```typescript
// Store: src/stores/content-panes/store.ts
interface ContentPanesState {
  panes: Record<string, ContentPaneData>;  // Keyed by UUID
  activePaneId: string | null;
  _hydrated: boolean;
}

// Currently: single pane with id "main"
// The Record<UUID, Pane> structure is already multi-pane ready
```

### Content Pane View Types (`src/components/content-pane/types.ts`)

```typescript
type ContentPaneView =
  | { type: "empty" }
  | { type: "thread"; threadId: string; autoFocus?: boolean }
  | { type: "plan"; planId: string }
  | { type: "settings" }
  | { type: "logs" }
  | { type: "archive" }
  | { type: "terminal"; terminalId: string }
  | { type: "file"; filePath: string; repoId?; worktreeId?; lineNumber? }
  | { type: "pull-request"; prId: string }
  | { type: "changes"; repoId: string; worktreeId: string; ... }
```

### Navigation Flow

```
User clicks sidebar item
  → TreeMenu.onItemSelect(itemId, type)
  → MainWindowLayout handler
  → navigationService.navigateToThread/Plan/Terminal/etc()
    → treeMenuService.setSelectedItem(itemId)     // highlight sidebar
    → contentPanesService.setActivePaneView(view)  // update center content
  → ContentPaneContainer re-renders with new view
```

### Key Files

| File | Role |
|------|------|
| `src/stores/content-panes/store.ts` | Zustand store for pane state |
| `src/stores/content-panes/service.ts` | Disk-as-truth CRUD operations |
| `src/stores/content-panes/types.ts` | Zod schemas + ContentPaneData |
| `src/stores/navigation-service.ts` | Coordinates tree selection + pane view |
| `src/stores/tree-menu/store.ts` | Sidebar selection/expansion state |
| `src/stores/layout/store.ts` | Panel width persistence |
| `src/components/content-pane/content-pane-container.tsx` | Renders active pane (single) |
| `src/components/content-pane/content-pane.tsx` | View renderer (dispatches by type) |
| `src/components/content-pane/content-pane-header.tsx` | Per-view headers |
| `src/components/main-window/main-window-layout.tsx` | Root layout + store init |
| `src/components/ui/resizable-panel.tsx` | Draggable resize (left/right only) |
| `src/hooks/use-tree-data.ts` | Computes display labels for all sidebar items |

### Existing Infrastructure We Can Build On

- **dnd-kit** (`@dnd-kit/core@^6.3.1`, `@dnd-kit/sortable@^10.0.0`) — already in package.json, used for quick-action reordering. Proven for sortable lists and cross-container drag. Custom collision detection needed for directional drop zones (see DnD Strategy below).
- **UUID-based pane system** — `Record<string, ContentPaneData>` already supports multiple panes
- **Disk-as-truth** + Zod validation for persistence
- **ResizablePanel** component for drag-to-resize
- **TabButton** component (`src/components/workspace/tab-button.tsx`) for tab styling
- **React 18** + Tailwind CSS 3 foundation

---

## Target Architecture

### Core Concepts

**PaneGroup** — A container holding one or more tabs, keyed by UUID. Has a tab bar and renders the active tab's content. Analogous to a VS Code "editor group." Max 5 tabs per group — when opening a 6th, close the least-recently-used tab.

**Tab** — A single content view within a pane group. Each tab holds a `ContentPaneView`. Tabs can be reordered within a group or dragged between groups.

**SplitLayout** — A recursive tree structure that splits space either horizontally or vertically. Leaf nodes are PaneGroups. Internal nodes define splits with adjustable ratios. Max depth: 4 wide, 3 high.

```
SplitNode (recursive tree)
├── type: "leaf"     → PaneGroup (tabs + active tab content)
└── type: "split"    → { direction: "horizontal" | "vertical", children: SplitNode[], sizes: number[] }
```

### Visual Structure

```
┌──────────────────────────────────────────────────────────┐
│ MainWindowLayout                                         │
├─────────────┬────────────────────────────────────────────┤
│ TreeMenu    │ SplitLayoutContainer                       │
│ (unchanged) │ ┌──────────────────┬─────────────────────┐ │
│             │ │ PaneGroup A      │ PaneGroup B         │ │
│             │ │ [Tab1|Tab2|Tab3] │ [Tab4|Tab5]         │ │
│             │ │ ───────────────  │ ────────────        │ │
│             │ │ ContentPaneHeader│ ContentPaneHeader    │ │
│             │ │ ───────────────  │ ────────────        │ │
│             │ │ <ContentPane>    │ <ContentPane>       │ │
│             │ │                  │                     │ │
│             │ └──────────────────┴─────────────────────┘ │
└─────────────┴────────────────────────────────────────────┘
```

### New State Shape

```typescript
// ═══════════════════════════════════════════════════════════
// Split Layout Tree (recursive)
// ═══════════════════════════════════════════════════════════

type SplitNode =
  | { type: "leaf"; groupId: string }
  | { type: "split"; direction: "horizontal" | "vertical"; children: SplitNode[]; sizes: number[] };

// ═══════════════════════════════════════════════════════════
// Pane Group (a group of tabs)
// ═══════════════════════════════════════════════════════════

interface PaneGroup {
  id: string;                    // UUID
  tabs: TabItem[];               // Ordered list of tabs (max 5)
  activeTabId: string;           // Currently visible tab
  // No tabHistory — on close, activate the tab to the left
}

interface TabItem {
  id: string;                    // UUID
  view: ContentPaneView;         // What content this tab shows
}

// ═══════════════════════════════════════════════════════════
// Top-Level Layout State
// ═══════════════════════════════════════════════════════════

interface PaneLayoutState {
  root: SplitNode;               // The split tree
  groups: Record<string, PaneGroup>; // All pane groups, keyed by UUID
  activeGroupId: string;         // Which group has focus
  _hydrated: boolean;
}
```

### Default State

When no persisted state exists (or on first boot), the default state is a single group with an empty tab:

```typescript
const DEFAULT_GROUP_ID = crypto.randomUUID();
const DEFAULT_TAB_ID = crypto.randomUUID();

const DEFAULT_STATE: PaneLayoutState = {
  root: { type: "leaf", groupId: DEFAULT_GROUP_ID },
  groups: {
    [DEFAULT_GROUP_ID]: {
      id: DEFAULT_GROUP_ID,
      tabs: [{ id: DEFAULT_TAB_ID, view: { type: "empty" } }],
      activeTabId: DEFAULT_TAB_ID,
    },
  },
  activeGroupId: DEFAULT_GROUP_ID,
  _hydrated: false,
};
```

No migration from the old `content-panes.json` format — we start fresh with default state.

### Persistence (`~/.mort/ui/pane-layout.json`)

```json
{
  "root": {
    "type": "split",
    "direction": "horizontal",
    "children": [
      { "type": "leaf", "groupId": "a1b2c3d4-..." },
      { "type": "leaf", "groupId": "e5f6g7h8-..." }
    ],
    "sizes": [50, 50]
  },
  "groups": {
    "a1b2c3d4-...": {
      "id": "a1b2c3d4-...",
      "tabs": [
        { "id": "t1-...", "view": { "type": "thread", "threadId": "abc" } },
        { "id": "t2-...", "view": { "type": "plan", "planId": "xyz" } }
      ],
      "activeTabId": "t1-..."
    },
    "e5f6g7h8-...": {
      "id": "e5f6g7h8-...",
      "tabs": [
        { "id": "t3-...", "view": { "type": "file", "filePath": "/src/main.ts" } }
      ],
      "activeTabId": "t3-..."
    }
  },
  "activeGroupId": "a1b2c3d4-..."
}
```

Don't persist ephemeral view properties (`autoFocus`, etc.).

---

## Navigation Service Changes

The `navigationService` currently calls `contentPanesService.setActivePaneView(view)`. After the refactor:

- **Regular click**: Find existing tab with this view across all groups → focus it. If not found, replace active tab's view.
- **Cmd+Click**: Open a new tab in the active group (always, even if duplicate exists).
- **Drag to split**: Create a new group in a new split.

```typescript
// navigationService changes:
async navigateToThread(threadId, options?) {
  await treeMenuService.setSelectedItem(threadId);
  const view = { type: "thread", threadId, autoFocus: options?.autoFocus };

  if (options?.newTab) {
    await paneLayoutService.openTab(view);
  } else {
    // Default: find existing tab with this thread across ALL groups, focus it.
    // If not found, replace the active tab's view.
    await paneLayoutService.findOrOpenTab(view);
  }
}
```

---

## Detailed Component Design

### 1. SplitLayoutContainer

Replaces `ContentPaneContainer` as the center content area.

```
src/components/split-layout/
├── split-layout-container.tsx    // Root: reads layout tree, renders recursively
├── split-node-renderer.tsx       // Recursive: renders leaf or nested split
├── split-resize-handle.tsx       // Drag handle between split children
├── pane-group.tsx                // Tab bar + sub-header + active tab content
├── tab-bar.tsx                   // Horizontal tab strip with DnD
├── tab-item.tsx                  // Individual tab (draggable, closeable)
├── drop-zone-overlay.tsx         // Visual overlay for drop targets during drag
└── types.ts                      // SplitNode, PaneGroup, TabItem types
```

### 2. PaneGroup Component

```
┌────────────────────────────────────────┐
│ TabBar                                 │
│ [● main ×] [fix-bug.md ×] [+ ]        │
├────────────────────────────────────────┤
│ ContentPaneHeader (sub-header)         │
│ (view-specific controls, e.g. toggle)  │
├────────────────────────────────────────┤
│                                        │
│ ContentPane (existing component)       │
│ (renders the active tab's view)        │
│                                        │
└────────────────────────────────────────┘
```

- Tab bar at top with horizontal scrolling for overflow
- Each tab shows: status indicator (streaming dot) + label + close button
- Active group has a visual indicator (e.g. accent border)
- Clicking a tab makes it active; clicking its close button removes it
- "+" button at the end to open empty tab
- `ContentPaneHeader` kept as a sub-header below tabs for view-specific controls (thread conversation/changes toggle, etc.)
- Max 5 tabs per group; opening a 6th closes the LRU tab

### 3. Tab Labels (Derived from Sidebar)

Tab labels mirror exactly what the sidebar shows, using the same data sources as `useTreeData()`:

```typescript
function useTabLabel(view: ContentPaneView): string {
  // Pull from the same stores that useTreeData() uses
  switch (view.type) {
    case "empty": return "New Tab";
    case "thread": {
      // Same as sidebar: thread.name ?? "New Thread"
      const thread = useThreadStore(s => s.threads[view.threadId]);
      return thread?.name ?? "New Thread";
    }
    case "plan": {
      // Same as sidebar: getPlanTitle(plan.relativePath)
      // For readme.md → parent directory name, otherwise filename
      const plan = usePlanStore(s => s.plans[view.planId]);
      return plan ? getPlanTitle(plan.relativePath) : "Plan";
    }
    case "terminal": {
      // Same as sidebar: terminal.lastCommand ?? dirName ?? "terminal"
      const terminal = useTerminalSessionStore(s => s.sessions[view.terminalId]);
      return terminal?.lastCommand ?? terminal?.worktreePath.split("/").pop() ?? "Terminal";
    }
    case "file": return basename(view.filePath);
    case "pull-request": {
      // Same as sidebar: "PR #N: title" or "PR #N"
      const pr = usePullRequestStore(s => s.pullRequests[view.prId]);
      const details = pr?.details;
      return details ? `PR #${pr.prNumber}: ${details.title}` : `PR #${pr?.prNumber ?? "?"}`;
    }
    case "settings": return "Settings";
    case "logs": return "Logs";
    case "archive": return "Archive";
    case "changes": return "Changes";
  }
}
```

### 4. Tab Status Indicators

Tabs show a status dot matching the sidebar indicators:

- **Streaming (pulsing dot)**: Thread is actively receiving agent output
- **Running (solid dot)**: Agent is working but not streaming text yet
- **Idle**: No indicator

These use the same `ThreadMetadata.status` / streaming state that the sidebar already tracks. All visible thread tabs stay actively updated — not just the focused one.

### 5. Split Resize Handles

Extend the existing `ResizablePanel` pattern for internal splits:

- Horizontal splits: vertical drag handles between children
- Vertical splits: horizontal drag handles between children
- Sizes stored as percentages in the `sizes` array
- Min size per child: ~15% (prevents invisible groups)
- Double-click handle to reset to equal sizes

### 6. Drop Zone Overlay

When dragging a tab, show drop zones on hover over pane groups:

```
┌──────────────────────┐
│        TOP           │  → split vertical, new group above
├──────────────────────┤
│    │         │       │
│LEFT│ CENTER  │ RIGHT │  → LEFT/RIGHT: split horizontal
│    │         │       │  → CENTER: add tab to this group
├──────────────────────┤
│       BOTTOM         │  → split vertical, new group below
└──────────────────────┘
```

### DnD Strategy

**Library**: Keep `@dnd-kit` for tab reordering within groups and cross-container tab moves. It's already installed (v6.3.1 core, v10.0.0 sortable), proven in the codebase for quick-action sorting, and handles use cases 1 & 2 well.

**Architecture**: A single `DndContext` wrapping the entire `SplitLayoutContainer` so all tab bars and pane groups share the same drag context.

**Edge drop zones (drag-to-split)**: Implement as a custom overlay with mouse position detection rather than relying on dnd-kit's collision algorithms. When a tab drag is active, each `PaneGroup` shows directional drop zone overlays. Mouse proximity to pane edges (~30px threshold) determines the drop zone direction. This separation keeps tab reordering (dnd-kit) and split creation (custom) cleanly decoupled.

**Why not switch to Pragmatic DnD or others**: dnd-kit is already working, the migration cost isn't justified, and the hybrid approach (dnd-kit for sortable + custom for edge zones) gives us the best of both worlds without fighting the library's collision detection.

---

## State Management Design

### New Store: `src/stores/pane-layout/store.ts`

```typescript
interface PaneLayoutState {
  root: SplitNode;
  groups: Record<string, PaneGroup>;
  activeGroupId: string;
  _hydrated: boolean;
}

interface PaneLayoutActions {
  hydrate(state: PaneLayoutPersistedState): void;

  // Tab operations
  _applyOpenTab(groupId: string, tab: TabItem, makeActive?: boolean): Rollback;
  _applyCloseTab(groupId: string, tabId: string): Rollback;
  _applySetActiveTab(groupId: string, tabId: string): Rollback;
  _applySetTabView(groupId: string, tabId: string, view: ContentPaneView): Rollback;
  _applyMoveTab(fromGroupId: string, tabId: string, toGroupId: string, index: number): Rollback;
  _applyReorderTabs(groupId: string, tabIds: string[]): Rollback;

  // Group operations
  _applySetActiveGroup(groupId: string): Rollback;
  _applyCreateGroup(group: PaneGroup): Rollback;
  _applyRemoveGroup(groupId: string): Rollback;

  // Split operations
  _applySplitGroup(groupId: string, direction: "horizontal" | "vertical", newGroup: PaneGroup): Rollback;
  _applyUpdateSplitSizes(path: number[], sizes: number[]): Rollback;
  _applyCollapseSplit(path: number[]): Rollback;
}
```

### New Service: `src/stores/pane-layout/service.ts`

```typescript
const paneLayoutService = {
  // Lifecycle
  hydrate(): Promise<void>;
  persistState(): Promise<void>;

  // Tab management (enforces max 5 tabs per group — closes leftmost if at cap)
  openTab(view: ContentPaneView, groupId?: string): Promise<string>;
  closeTab(groupId: string, tabId: string): Promise<void>;
  setActiveTab(groupId: string, tabId: string): Promise<void>;
  setActiveTabView(view: ContentPaneView): Promise<void>;
  moveTab(fromGroupId: string, tabId: string, toGroupId: string, index: number): Promise<void>;

  // Group management
  setActiveGroup(groupId: string): Promise<void>;
  splitGroup(groupId: string, direction: "horizontal" | "vertical", view?: ContentPaneView): Promise<string>;

  // Split management
  updateSplitSizes(path: number[], sizes: number[]): Promise<void>;

  // Dedup: find existing tab with same view across ALL groups, focus it. Otherwise replace active tab.
  findOrOpenTab(view: ContentPaneView, options?: { groupId?: string; newTab?: boolean }): Promise<void>;

  // Convenience
  getActiveGroup(): PaneGroup | null;
  getActiveTab(): TabItem | null;
};
```

### Tab Close Behavior

When closing a tab, activate the tab to the left — or to the right if the leftmost tab was closed:

```typescript
// On close:
// 1. Remove tabId from group.tabs
// 2. If the closed tab was active:
//    a. If index > 0, activate tab at index - 1 (left neighbor)
//    b. If index === 0, activate new tab at index 0 (right neighbor)
// 3. If no tabs remain, remove the group and collapse the split
```

---

## Interaction Design

### Opening Tabs

| Action | Behavior |
|--------|----------|
| Click sidebar item | Find existing tab across all groups → focus it. If not found, replace active tab's view |
| Cmd+Click sidebar item | Open in new tab in active group (even if duplicate) |
| Middle-click sidebar item | Open in new tab in active group |
| Cmd+W | Close active tab |

### Splitting Panes

| Action | Behavior |
|--------|----------|
| Drag tab to edge drop zone | Split in that direction |
| Drag tab to center of group | Move tab to that group |

### Closing / Collapsing

| Action | Behavior |
|--------|----------|
| Close tab | Activate left neighbor (or right if leftmost closed) |
| Close last tab in group | Remove the group, collapse the split |
| Close last group | Reset to single empty group (never empty screen) |
| Drag resize to 0 | Collapse that group (same as closing all tabs) |

### Focus

| Action | Behavior |
|--------|----------|
| Click in a pane group | That group becomes the active group |
| Active group shows accent border | Visual indicator of which group has focus |

---

## Edge Cases & Gotchas

### 1. Tab Deduplication

**Problem**: User clicks a sidebar item that's already open in another group.

**Solution**: `findOrOpenTab` searches all groups for a tab with a matching view. If found, focus that group and tab. If not found, replace the active tab's view. Cmd+Click bypasses dedup and always opens a new tab.

### 2. Thread State — All Visible Threads Stay Active

**Problem**: `useThreadStore.activeThreadId` is a single value. With multiple thread tabs, which one is "active"?

**Solution**: All thread tabs that are currently *visible* (i.e., the active tab in any rendered pane group) should actively receive updates. The `threadStates` record already supports multiple threads being loaded simultaneously. Instead of a single `activeThreadId`, we track the set of visible thread IDs derived from the layout state:

```typescript
// Computed from layout state:
function getVisibleThreadIds(state: PaneLayoutState): string[] {
  return Object.values(state.groups)
    .map(g => g.tabs.find(t => t.id === g.activeTabId))
    .filter(t => t?.view.type === "thread")
    .map(t => t.view.threadId);
}
```

The existing `activeThreadId` continues to track which thread has *keyboard focus* (i.e., the active tab in the active group). But streaming, status updates, and state syncing apply to all visible threads.

### 3. Input Store Provider Scoping

**Problem**: `InputStoreProvider` is currently per-pane. With multiple panes visible simultaneously, each needs its own input store.

**Solution**: Each `PaneGroup` wraps its content in an `InputStoreProvider`. The `active` prop is only `true` for the active group's active tab. This is already the pattern — just needs to be applied at the group level.

### 4. Streaming Indicators in Tabs

**Problem**: A thread might be streaming while the user is looking at another tab.

**Solution**: Streaming continues via the agent process regardless of which tab is visible. Tab items show a status indicator (pulsing dot for streaming, solid dot for running) matching the sidebar's thread status. When the user switches to that tab, the stream content is already there.

### 5. Content Search (Find Bar)

**Problem**: Cmd+F opens find bar — which pane does it search?

**Solution**: Find bar is scoped to the active group's active tab (same as VS Code). The `ContentPane` component already manages find bar state locally, so this works naturally.

### 6. Max Tabs Per Group

**Problem**: Too many tabs clutters the tab bar and is hard to navigate.

**Solution**: Cap at 5 tabs per group. When opening the 6th, close the leftmost tab. This keeps things manageable.

### 7. Right Panel Interaction

**Problem**: The right panel (file browser, search) currently exists at the same level as the center content. Does it participate in the split layout?

**Solution**: No. Keep the right panel as a separate resizable panel outside the split layout, same as VS Code's sidebar panels. The split layout only governs the center content area.

### 8. Tree Selection Sync

**Problem**: With multiple groups showing different items, which one does the sidebar track?

**Solution**: Sidebar always reflects the active group's active tab. When the active group or active tab changes, update sidebar selection accordingly. This is a one-way sync: sidebar selection follows the active tab.

### 9. Pop-Out / Standalone Windows

**Problem**: Current pop-out opens a new window. How does this interact with tabs?

**Solution**: Pop-out behavior stays the same — it opens the view in a standalone Tauri window. The tab remains in the group (or can be closed if desired). The standalone window is independent of the tab layout.

### 10. Archive Events

**Problem**: `THREAD_ARCHIVED` / `PLAN_ARCHIVED` events clear panes showing archived content. With multiple tabs, need to clear all matching tabs.

**Solution**: The listener iterates all groups and all tabs, closing any tab whose view references the archived entity. If that leaves a group empty, collapse the group.

### 11. Max Split Constraints

**Problem**: Preventing infinite nesting. Limit: 4 wide, 3 high.

**Solution**: Before creating a split, walk the tree to count depth in each direction:
- Count consecutive `horizontal` splits for width (max 4 children)
- Count consecutive `vertical` splits for height (max 3 children)
- If at limit, refuse the split and show a toast notification

### 12. Resize Handle Minimum Sizes

**Problem**: Users could resize a group to be impossibly small.

**Solution**: Enforce minimum pixel width/height per group (e.g., 200px wide, 150px tall). When a resize would violate this, clamp. When a group is dragged below a collapse threshold (e.g., 50px), treat it as a close/collapse action.

---

## State That Needs Re-Architecting

### Must Change

1. **`content-panes/` store + service** → Replace with `pane-layout/` store + service. The current single-pane-with-UUID system becomes groups-with-tabs.

2. **`navigation-service.ts`** → Update all `navigateTo*` methods to use `paneLayoutService` instead of `contentPanesService`. Add `newTab` option support. Default behavior is find-and-focus existing tab (dedup).

3. **`ContentPaneContainer`** → Replace with `SplitLayoutContainer` that renders the recursive split tree.

4. **`main-window-layout.tsx`** → Replace `ContentPaneContainer` usage with `SplitLayoutContainer`. Update store initialization to use `paneLayoutService.hydrate()`.

5. **`content-panes/listeners.ts`** → Move to `pane-layout/listeners.ts`. Update to iterate all groups/tabs for archive events.

### Must Extend

6. **`ContentPane` component** → No structural change, but receives a `groupId` prop so it knows which group it belongs to (for InputStoreProvider scoping).

7. **`ContentPaneHeader`** → Kept as a sub-header below the tab bar for view-specific controls (thread conversation/changes toggle, etc.).

### Can Stay As-Is

8. **`tree-menu/` store + service** → No changes. Still tracks `selectedItemId`.
9. **`layout/` store** → Still tracks panel widths for left/right panels. Split sizes are in the new layout store.
10. **All entity stores** (threads, plans, etc.) → No changes.
11. **Individual content components** (ThreadContent, PlanContent, etc.) → No changes.
12. **ResizablePanel** → Still used for left/right panels. Split resize handles are a new component.

---

## New Files to Create

```
src/stores/pane-layout/
├── store.ts                  // Zustand store for PaneLayoutState
├── service.ts                // Disk-as-truth service (hydrate, persist, CRUD)
├── types.ts                  // Zod schemas + runtime types
├── listeners.ts              // Event listeners (archive, etc.)
└── constraints.ts            // Max split depth validation

src/components/split-layout/
├── split-layout-container.tsx // Root component (replaces ContentPaneContainer)
├── split-node-renderer.tsx    // Recursive renderer for SplitNode tree
├── split-resize-handle.tsx    // Drag handle between split children
├── pane-group.tsx             // PaneGroup component (tabs + content)
├── tab-bar.tsx                // Horizontal scrolling tab strip
├── tab-item.tsx               // Individual tab with DnD + close
├── drop-zone-overlay.tsx      // Visual drop targets during tab drag
├── use-split-constraints.ts   // Hook for validating split depth
└── types.ts                   // Component-level types
```

---

## Phases

- [ ] Create pane-layout store, service, types with Zod schemas and default state
- [ ] Build SplitLayoutContainer and SplitNodeRenderer for recursive layout rendering (single group first, no splits)
- [ ] Build PaneGroup, TabBar, and TabItem components with tab switching, closing (left-neighbor), status dots, and sidebar-matching labels
- [ ] Wire navigation service to pane-layout service; add Cmd+Click for new tab; implement find-and-focus dedup
- [ ] Implement split operations: split group, resize handles, collapse on empty
- [ ] Add drag-and-drop for tab reordering within groups and moving between groups (dnd-kit with single DndContext)
- [ ] Add drop zone overlay for drag-to-split (custom edge detection, ~30px threshold)
- [ ] Add split depth constraints (4 wide, 3 high) and edge case handling (archive events, streaming indicators, max 5 tabs)
- [ ] Wire up all visible thread tabs to stay actively updated (not just focused one)
- [ ] Verify persistence round-trips and default state bootstrapping

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Decisions Made

1. **Keyboard shortcuts**: Out of scope for now. No tab switching shortcuts, no split shortcuts.
2. **Tab deduplication**: Default click finds and focuses existing tab across all groups. Cmd+Click always opens new tab (even if duplicate).
3. **Header placement**: `ContentPaneHeader` kept as sub-header below tab bar for view-specific controls.
4. **Tab close behavior**: Activate left neighbor (or right if leftmost closed). MRU history is out of scope (separate workflow).
5. **Tab labels**: Mirror sidebar labels exactly (same data sources as `useTreeData()`).
6. **Max tabs**: 5 per group, LRU eviction.
7. **No migration**: Fresh default state, no backwards compatibility with `content-panes.json`.
8. **DnD library**: Keep dnd-kit for tab reorder/cross-container. Custom edge detection for drag-to-split zones.
9. **Visible threads**: All visible thread tabs (active tab in any rendered group) stay actively updated with streaming/status.
