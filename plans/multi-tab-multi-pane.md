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

### Existing Infrastructure We Can Build On

- **dnd-kit** (`@dnd-kit/core`, `@dnd-kit/sortable`) - already in package.json, used for quick-action reordering
- **UUID-based pane system** - `Record<string, ContentPaneData>` already supports multiple panes
- **Disk-as-truth** + Zod validation for persistence
- **ResizablePanel** component for drag-to-resize
- **TabButton** component (`src/components/workspace/tab-button.tsx`) for tab styling
- **React 18** + Tailwind CSS 3 foundation

---

## Target Architecture

### Core Concepts

**PaneGroup** — A container holding one or more tabs. Has a tab bar and renders the active tab's content. Analogous to a VS Code "editor group."

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
  tabs: TabItem[];               // Ordered list of tabs
  activeTabId: string;           // Currently visible tab
}

interface TabItem {
  id: string;                    // UUID
  view: ContentPaneView;         // What content this tab shows
  label?: string;                // Override display label (derived from view if not set)
}

// ═══════════════════════════════════════════════════════════
// Top-Level Layout State
// ═══════════════════════════════════════════════════════════

interface PaneLayoutState {
  root: SplitNode;               // The split tree
  groups: Record<string, PaneGroup>; // All pane groups
  activeGroupId: string;         // Which group has focus
  _hydrated: boolean;
}
```

### Persistence (`~/.mort/ui/pane-layout.json`)

```json
{
  "root": {
    "type": "split",
    "direction": "horizontal",
    "children": [
      { "type": "leaf", "groupId": "group-1" },
      { "type": "leaf", "groupId": "group-2" }
    ],
    "sizes": [50, 50]
  },
  "groups": {
    "group-1": {
      "id": "group-1",
      "tabs": [
        { "id": "tab-1", "view": { "type": "thread", "threadId": "abc" } },
        { "id": "tab-2", "view": { "type": "plan", "planId": "xyz" } }
      ],
      "activeTabId": "tab-1"
    },
    "group-2": {
      "id": "group-2",
      "tabs": [
        { "id": "tab-3", "view": { "type": "file", "filePath": "/src/main.ts" } }
      ],
      "activeTabId": "tab-3"
    }
  },
  "activeGroupId": "group-1"
}
```

---

## Migration Strategy

### Backwards Compatibility

The current `content-panes.json` uses `{ panes: Record<string, {id, view}>, activePaneId }`. We need to migrate this to the new layout format on first load:

```typescript
// In hydrate():
// 1. Try loading pane-layout.json (new format)
// 2. If not found, load content-panes.json (old format)
// 3. Convert: single pane → single group with one tab → leaf layout
// 4. Write pane-layout.json, delete content-panes.json
```

The migration is a one-shot transform:
- Old `panes["main"].view` → New `groups["default"].tabs[0].view`
- Old `activePaneId` → New `activeGroupId`

### Navigation Service Changes

The `navigationService` currently calls `contentPanesService.setActivePaneView(view)`. After the refactor:

- **Regular click**: Replace the active tab's view in the active group (same behavior as today)
- **Cmd+Click**: Open a new tab in the active group
- **Drag to split**: Create a new group in a new split

```typescript
// navigationService changes:
async navigateToThread(threadId, options?) {
  await treeMenuService.setSelectedItem(threadId);
  if (options?.newTab) {
    await paneLayoutService.openTabInActiveGroup({ type: "thread", threadId });
  } else {
    await paneLayoutService.setActiveTabView({ type: "thread", threadId });
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
├── pane-group.tsx                // Tab bar + active tab content
├── tab-bar.tsx                   // Horizontal tab strip with DnD
├── tab-item.tsx                  // Individual tab (draggable, closeable)
├── drop-zone-overlay.tsx         // Visual overlay for drop targets during drag
└── types.ts                      // SplitNode, PaneGroup, TabItem types
```

### 2. PaneGroup Component

```
┌────────────────────────────────────────┐
│ TabBar                                 │
│ [Thread: main ×] [plan.md ×] [+ ]     │
├────────────────────────────────────────┤
│                                        │
│ ContentPane (existing component)       │
│ (renders the active tab's view)        │
│                                        │
└────────────────────────────────────────┘
```

- Tab bar at top with horizontal scrolling for overflow
- Each tab shows: icon (by view type) + label + close button
- Active group has a visual indicator (e.g. accent border)
- Clicking a tab makes it active; clicking its close button removes it
- "+" button at the end to open empty tab
- Double-click tab to rename (optional, low priority)

### 3. Tab Labels (Derived from View)

```typescript
function getTabLabel(view: ContentPaneView): string {
  switch (view.type) {
    case "empty": return "New Tab";
    case "thread": return threadName ?? "Thread";  // lookup from threadStore
    case "plan": return planName ?? "Plan";
    case "settings": return "Settings";
    case "logs": return "Logs";
    case "archive": return "Archive";
    case "terminal": return "Terminal";
    case "file": return basename(view.filePath);
    case "pull-request": return `PR #${prNumber}`;
    case "changes": return "Changes";
  }
}
```

### 4. Split Resize Handles

Extend the existing `ResizablePanel` pattern for internal splits:

- Horizontal splits: vertical drag handles between children
- Vertical splits: horizontal drag handles between children
- Sizes stored as percentages in the `sizes` array
- Min size per child: ~15% (prevents invisible groups)
- Double-click handle to reset to equal sizes

### 5. Drop Zone Overlay

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

Use dnd-kit's `DndContext` + custom collision detection for these zones.

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

Key methods:

```typescript
const paneLayoutService = {
  // Lifecycle
  hydrate(): Promise<void>;
  persistState(): Promise<void>;

  // Tab management
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

  // Dedup: find existing tab with same view, or open new
  findOrOpenTab(view: ContentPaneView, options?: { groupId?: string; newTab?: boolean }): Promise<void>;

  // Convenience
  getActiveGroup(): PaneGroup | null;
  getActiveTab(): TabItem | null;
};
```

### Navigation Service Updates

```typescript
// src/stores/navigation-service.ts
// Change from contentPanesService → paneLayoutService

async navigateToThread(threadId, options?) {
  await treeMenuService.setSelectedItem(threadId);
  const view = { type: "thread", threadId, autoFocus: options?.autoFocus };

  if (options?.newTab) {
    await paneLayoutService.openTab(view);
  } else {
    // Default: find existing tab with this thread, or replace active tab
    await paneLayoutService.findOrOpenTab(view);
  }
}
```

---

## Interaction Design

### Opening Tabs

| Action | Behavior |
|--------|----------|
| Click sidebar item | Replace active tab's view (current behavior preserved) |
| Cmd+Click sidebar item | Open in new tab in active group |
| Middle-click sidebar item | Open in new tab in active group |
| Cmd+T | New empty tab in active group |
| Cmd+W | Close active tab |
| Cmd+Shift+T | Reopen last closed tab |

### Switching Tabs

| Action | Behavior |
|--------|----------|
| Click tab | Activate that tab |
| Cmd+1-9 | Switch to tab N in active group |
| Cmd+Option+Left/Right | Switch to prev/next tab |
| Cmd+Shift+[ / ] | Switch to prev/next tab (VS Code style) |

### Splitting Panes

| Action | Behavior |
|--------|----------|
| Cmd+\ | Split active group right (horizontal) |
| Cmd+Shift+\ | Split active group down (vertical) |
| Drag tab to edge drop zone | Split in that direction |
| Drag tab to center of group | Move tab to that group |

### Closing / Collapsing

| Action | Behavior |
|--------|----------|
| Close last tab in group | Remove the group, collapse the split |
| Close last group | Reset to single empty group (never empty screen) |
| Drag resize to 0 | Collapse that group (same as closing all tabs) |

### Focus

| Action | Behavior |
|--------|----------|
| Click in a pane group | That group becomes the active group |
| Cmd+Option+Up/Down/Left/Right | Move focus between adjacent groups |
| Active group shows accent border | Visual indicator of which group has focus |

---

## Edge Cases & Gotchas

### 1. Duplicate Views

**Problem**: User opens the same thread in two tabs. Which one does the sidebar highlight?

**Solution**: Sidebar highlights the tab in the *active group*. If the active tab in the active group matches, highlight it. If not, don't change sidebar selection. The `findOrOpenTab` method should check all groups for an existing tab before creating a new one and activate the existing one instead.

### 2. Thread State Coupling

**Problem**: `useThreadStore.activeThreadId` is a single value. With multiple thread tabs, which one is "active"?

**Solution**: `activeThreadId` tracks which thread's *state is loaded* (conversation content, streaming). When switching tabs/groups to a different thread tab, update `activeThreadId`. When switching to a non-thread tab, leave it as-is (the thread content stays cached).

The `threadStates` record already supports multiple threads being loaded simultaneously, so no structural change is needed — just update the "active" pointer on tab/group focus change.

### 3. Input Store Provider Scoping

**Problem**: `InputStoreProvider` is currently per-pane. With multiple panes visible simultaneously, each needs its own input store.

**Solution**: Each `PaneGroup` wraps its content in an `InputStoreProvider`. The `active` prop is only `true` for the active group's active tab. This is already the pattern — just needs to be applied at the group level.

### 4. Streaming in Background Tabs

**Problem**: A thread might be streaming while the user is looking at another tab.

**Solution**: Streaming continues via the agent process regardless of which tab is visible. The `StreamingStore` already stores streams keyed by thread ID. When the user switches back to that tab, the stream content is still there. Add a visual indicator (pulsing dot) on the tab to show it's actively streaming.

### 5. Content Search (Find Bar)

**Problem**: Cmd+F opens find bar — which pane does it search?

**Solution**: Find bar is scoped to the active group's active tab (same as VS Code). The `ContentPane` component already manages find bar state locally, so this works naturally.

### 6. Layout Persistence Size

**Problem**: With many tabs, the persisted JSON could grow.

**Solution**: Cap at a reasonable number of tabs per group (e.g., 20). When opening the 21st, close the least-recently-used tab. Also, don't persist `autoFocus` or other ephemeral view properties.

### 7. Keyboard Shortcut Conflicts

**Problem**: Cmd+1-9 currently mapped to quick actions. Tab switching also wants Cmd+1-9.

**Solution**: Use Cmd+Option+1-9 for tab switching, keep Cmd+1-9 for quick actions. Or: Cmd+1-9 for tabs (VS Code default), Cmd+Shift+1-9 for quick actions. **Decision needed from user.**

### 8. Right Panel Interaction

**Problem**: The right panel (file browser, search) currently exists at the same level as the center content. Does it participate in the split layout?

**Solution**: No. Keep the right panel as a separate resizable panel outside the split layout, same as VS Code's sidebar panels. The split layout only governs the center content area.

### 9. Tree Selection Ambiguity

**Problem**: With multiple groups showing different items, which one does the sidebar track?

**Solution**: Sidebar always reflects the active group's active tab. When the active group or active tab changes, update sidebar selection accordingly. This is a one-way sync: sidebar selection follows the active tab.

### 10. Pop-Out / Standalone Windows

**Problem**: Current pop-out opens a new window. How does this interact with tabs?

**Solution**: Pop-out behavior stays the same — it opens the view in a standalone Tauri window. The tab remains in the group (or can be closed if desired). The standalone window is independent of the tab layout.

### 11. Archive Events

**Problem**: `THREAD_ARCHIVED` / `PLAN_ARCHIVED` events clear panes showing archived content. With multiple tabs, need to clear all matching tabs.

**Solution**: The listener iterates all groups and all tabs, closing any tab whose view references the archived entity. If that leaves a group empty, collapse the group.

### 12. Max Split Constraints

**Problem**: Preventing infinite nesting. Limit: 4 wide, 3 high.

**Solution**: Before creating a split, walk the tree to count depth in each direction:
- Count consecutive `horizontal` splits for width (max 4 children)
- Count consecutive `vertical` splits for height (max 3 children)
- If at limit, refuse the split and show a toast notification

### 13. Resize Handle Minimum Sizes

**Problem**: Users could resize a group to be impossibly small.

**Solution**: Enforce minimum pixel width/height per group (e.g., 200px wide, 150px tall). When a resize would violate this, clamp. When a group is dragged below a collapse threshold (e.g., 50px), treat it as a close/collapse action.

---

## State That Needs Re-Architecting

### Must Change

1. **`content-panes/` store + service** → Replace with `pane-layout/` store + service. The current single-pane-with-UUID system becomes groups-with-tabs.

2. **`navigation-service.ts`** → Update all `navigateTo*` methods to use `paneLayoutService` instead of `contentPanesService`. Add `newTab` option support.

3. **`ContentPaneContainer`** → Replace with `SplitLayoutContainer` that renders the recursive split tree.

4. **`main-window-layout.tsx`** → Replace `ContentPaneContainer` usage with `SplitLayoutContainer`. Update store initialization to use `paneLayoutService.hydrate()`.

5. **`content-panes/listeners.ts`** → Move to `pane-layout/listeners.ts`. Update to iterate all groups/tabs for archive events.

### Must Extend

6. **`ContentPane` component** → No structural change, but receives a `groupId` prop so it knows which group it belongs to (for InputStoreProvider scoping).

7. **`ContentPaneHeader`** → May be absorbed into the tab bar (the header info moves into the tab label). Or kept as a secondary header below the tab bar for view-specific controls.

8. **Keyboard handlers** in `main-window-layout.tsx` → Add tab/group navigation shortcuts.

### Can Stay As-Is

9. **`tree-menu/` store + service** → No changes. Still tracks `selectedItemId`.
10. **`layout/` store** → Still tracks panel widths for left/right panels. Split sizes are in the new layout store.
11. **All entity stores** (threads, plans, etc.) → No changes.
12. **Individual content components** (ThreadContent, PlanContent, etc.) → No changes.
13. **ResizablePanel** → Still used for left/right panels. Split resize handles are a new component.

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

- [ ] Create pane-layout store, service, types with Zod schemas and migration from content-panes format
- [ ] Build SplitLayoutContainer and SplitNodeRenderer for recursive layout rendering (single group first, no splits)
- [ ] Build PaneGroup, TabBar, and TabItem components with tab switching, closing, and opening
- [ ] Wire navigation service to pane-layout service; add Cmd+Click for new tab support
- [ ] Implement split operations: split group, resize handles, collapse on empty
- [ ] Add drag-and-drop for tab reordering within groups and moving between groups
- [ ] Add drop zone overlay for drag-to-split (drop on edge creates new split)
- [ ] Add keyboard shortcuts for tab and group navigation
- [ ] Add split depth constraints (4 wide, 3 high) and edge case handling (archive events, streaming indicators)
- [ ] Update persistence, test migration from old format, and verify disk-as-truth round-trips

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Open Questions

1. **Cmd+1-9 conflict**: Should tab switching use Cmd+1-9 (VS Code default, conflicts with quick actions) or Cmd+Option+1-9?
2. **Tab deduplication**: When navigating to a thread that's already open in another group, should we focus that tab or open a duplicate? (VS Code focuses existing by default, but allows duplicates via Cmd+Click)
3. **Header vs Tab Bar**: Should the current `ContentPaneHeader` be merged into the tab bar, or kept as a sub-header below tabs for view-specific controls (like the thread conversation/changes toggle)?
4. **Tab close behavior**: When closing a tab, should the previously-active tab become active (MRU order) or the adjacent tab?
