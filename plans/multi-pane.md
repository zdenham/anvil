# Multi-Pane Layout

Implement VS Code-style multi-pane support where users can view multiple content panes side-by-side with recursive splitting and drag-to-rearrange.

## Phases

- [ ] Phase 1: Layout tree model + store
- [ ] Phase 2: Recursive layout renderer with react-resizable-panels
- [ ] Phase 3: Pane focus management + keyboard routing
- [ ] Phase 4: Navigation routing updates (per-pane targeting)
- [ ] Phase 5: Per-pane thread lifecycle (activeThreadId refactor)
- [ ] Phase 6: Drag-to-rearrange pane headers
- [ ] Phase 7: Persistence + hydration of layout tree

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Context

The app currently has a single active content pane rendered by `ContentPaneContainer`. The store (`content-panes/store.ts`) already supports `Record<string, ContentPaneData>` keyed by UUID, but only one pane renders at a time via `activePaneId`. The `InputStoreProvider` in `input-store.tsx` already demonstrates the per-instance Zustand-via-context pattern we'll extend to other per-pane state.

**In scope:** Multi-pane with recursive splits, resize, drag rearrangement, focus management.
**Out of scope:** Multi-tab (tabs within a pane). Architecture should not preclude it.

---

## State Audit Summary

### Must become per-pane

| State | Current location | Why |
|---|---|---|
| Input content + focus | `input-store.tsx` (provider pattern) | Already per-pane via context — just needs `active` wired to focus |
| `activeThreadId` | `threads/store.ts` | Global singleton assumes one thread active. Must track per-pane |
| `activeThreadLoading` | `threads/store.ts` | Coupled to `activeThreadId` |
| Tool expand/collapse | `tool-expand-store.ts` | Keyed by `threadId` only — two panes on same thread share state. Acceptable for now |
| Quick actions | `quick-actions-store.ts` | `selectedIndex`, `showFollowUpInput` etc. are per-input context |
| Find-bar open state | `content-pane.tsx` local state | Already component-local, but Cmd+F handler is `window`-level |
| Thread tab (conversation/changes) | `content-pane.tsx` local state | Already component-local per pane instance |
| Optimistic messages | `thread-content.tsx` local state | Already component-local per pane instance |
| Scroll position / scroller ref | `message-list.tsx` | Already component-local per instance |

### Stays global (no changes needed)

| State | Location | Why |
|---|---|---|
| Layout panel widths (sidebar, file browser) | `layout/store.ts` | Global chrome, not per-pane |
| Tree menu (expanded, pinned, hidden) | `tree-menu/store.ts` | One tree for the app |
| Streaming content | `streaming-store.ts` | Keyed by `threadId` — multiple panes on same thread see same stream (correct) |
| Modals | `modal-store.ts` | App-level |
| Heartbeats | `heartbeat-store.ts` | Per-thread metadata, not per-pane |
| Repo/worktree lookup | `repo-worktree-lookup-store.ts` | Cache |
| Navigation banner | `navigation-banner-store.ts` | App-level notification |

### Needs design decision

| State | Issue | Recommendation |
|---|---|---|
| `tree-menu/selectedItemId` | Currently synced to active pane. With multi-pane, tree selection is ambiguous | Keep as "last navigated item" for highlight. Don't couple to focus |
| `quick-actions-store` | Global but only meaningful in focused pane | Convert to component-local state or per-pane context |

---

## Architecture

### Layout Tree Model

Use a **binary tree** to represent the recursive split layout, matching VS Code's approach:

```typescript
// src/stores/layout-tree/types.ts

type Orientation = "horizontal" | "vertical";

interface SplitNode {
  type: "split";
  id: string;              // stable UUID for persistence
  orientation: Orientation;
  ratio: number;           // 0..1, first child gets ratio
  children: [LayoutNode, LayoutNode];
}

interface LeafNode {
  type: "leaf";
  paneId: string;          // references ContentPaneData.id
}

type LayoutNode = SplitNode | LeafNode;
```

A single pane (default) is just a `LeafNode`. Splitting creates a `SplitNode` with two `LeafNode` children.

### Layout Tree Store

New store at `src/stores/layout-tree/store.ts`:

```typescript
interface LayoutTreeState {
  root: LayoutNode;
  focusedPaneId: string | null;  // which pane has keyboard focus
  _hydrated: boolean;
}

interface LayoutTreeActions {
  hydrate(state: LayoutTreePersistedState): void;
  _applySplitPane(paneId: string, orientation: Orientation, newPaneId: string): Rollback;
  _applyClosePane(paneId: string): Rollback;
  _applySetFocusedPane(paneId: string): Rollback;
  _applyMovePane(fromPaneId: string, targetPaneId: string, edge: DropEdge): Rollback;
  _applySetRatio(splitId: string, ratio: number): Rollback;
}
```

Service at `src/stores/layout-tree/service.ts` handles disk I/O to `~/.mort/ui/layout-tree.json`.

### Library Choice: `react-resizable-panels`

**Why:** Most actively maintained (~2.76M weekly downloads), zero deps, supports recursive nesting of `PanelGroup` inside `Panel`, headless/unstyled, built-in layout persistence, TypeScript-first, created by bvaughn (React DevTools author).

**Install:** `pnpm add react-resizable-panels`

### Rendering

Replace `ContentPaneContainer` with a recursive renderer:

```typescript
// src/components/content-pane/layout-renderer.tsx

function LayoutRenderer({ node }: { node: LayoutNode }) {
  if (node.type === "leaf") {
    return <PaneSlot paneId={node.paneId} />;
  }

  return (
    <PanelGroup direction={node.orientation}>
      <Panel defaultSize={node.ratio * 100}>
        <LayoutRenderer node={node.children[0]} />
      </Panel>
      <PanelResizeHandle />
      <Panel>
        <LayoutRenderer node={node.children[1]} />
      </Panel>
    </PanelGroup>
  );
}
```

`PaneSlot` wraps the existing `ContentPane` component with focus tracking and the `InputStoreProvider`.

### Focus Management

- `focusedPaneId` in the layout-tree store tracks which pane has keyboard focus
- Click anywhere in a pane sets it as focused (via `onPointerDown` on the pane container)
- `activePaneId` in content-panes store remains for "last interacted pane" semantics (navigation target)
- Focused pane gets a subtle visual indicator (border accent)

### Per-Pane Thread Context

The key refactor: replace global `activeThreadId` with per-pane tracking.

**Option chosen: "Visible threads" set.** Instead of a single `activeThreadId`, the thread store tracks which threads are visible in any pane:

```typescript
// In thread store:
interface ThreadStoreState {
  visibleThreadIds: Set<string>;  // replaces activeThreadId
  // ... rest unchanged
}
```

Thread listeners (`AGENT_STATE`, `AGENT_COMPLETED`) load state for any thread in `visibleThreadIds`, not just one. Each `ThreadContent` component registers/unregisters its threadId on mount/unmount via a service method.

This approach:
- Supports N panes showing N different threads simultaneously
- Doesn't break the optimization (only load thread state for visible threads)
- Works for mark-as-read (any visible thread is "read")
- Doesn't require a per-pane Zustand provider for thread state

### Navigation Routing

Update `navigationService` methods to accept optional `paneId`:

```typescript
async navigateToThread(threadId: string, options?: {
  paneId?: string;    // target pane (default: focused pane)
  autoFocus?: boolean;
}): Promise<void>
```

**Default behavior:** Navigate in the focused pane. If no `paneId` specified, use `focusedPaneId` from layout-tree store, falling back to `activePaneId`.

Tree menu clicks continue to navigate in the focused pane. Future: context menu "Open in new pane" or modifier-click to split.

### Keyboard Routing

- **Global shortcuts** (Cmd+P, Cmd+N): Stay global, no change
- **Pane-local shortcuts** (Cmd+F): Check `focusedPaneId` before executing. Refactor from `window.addEventListener` to a focus-aware handler
- **Input shortcuts** (Enter, arrow keys, Shift+Tab): Already scoped via DOM focus — no change needed

### Drag-to-Rearrange

Use `dnd-kit` for dragging pane headers. On drag start, identify source pane. On hover over target pane, show drop zone indicators (top/bottom/left/right/center). On drop, transform the layout tree:

1. Remove source leaf from tree (may collapse parent split)
2. Create new split at target position based on drop edge
3. Insert source leaf as new child

This is a tree transformation in the Zustand store — the recursive renderer re-renders automatically.

### Persistence

New file `~/.mort/ui/layout-tree.json`:

```json
{
  "root": {
    "type": "split",
    "id": "abc-123",
    "orientation": "horizontal",
    "ratio": 0.5,
    "children": [
      { "type": "leaf", "paneId": "pane-1" },
      { "type": "leaf", "paneId": "pane-2" }
    ]
  },
  "focusedPaneId": "pane-1"
}
```

Validated with Zod on hydration. Falls back to single-pane layout if invalid. The existing `content-panes.json` continues to store pane-to-view mappings — the layout tree only tracks spatial arrangement.

---

## Phase Details

### Phase 1: Layout tree model + store

**Files to create:**
- `src/stores/layout-tree/types.ts` — `LayoutNode`, `SplitNode`, `LeafNode`, Zod schemas
- `src/stores/layout-tree/store.ts` — Zustand store with `root`, `focusedPaneId`, tree mutation actions
- `src/stores/layout-tree/service.ts` — Disk I/O, tree manipulation helpers (splitAt, removeLeaf, findLeaf, etc.)
- `src/stores/layout-tree/tree-utils.ts` — Pure functions for tree operations (split, close, move, find)

**Files to modify:**
- `src/stores/content-panes/service.ts` — `createPane` should also insert into layout tree; `closePane` should remove from tree

### Phase 2: Recursive layout renderer

**Install:** `react-resizable-panels`

**Files to create:**
- `src/components/content-pane/layout-renderer.tsx` — Recursive `LayoutRenderer` component
- `src/components/content-pane/pane-slot.tsx` — Wraps `ContentPane` with focus tracking, header with split/close buttons

**Files to modify:**
- `src/components/content-pane/content-pane-container.tsx` — Replace single-pane render with `<LayoutRenderer root={layoutTree} />`
- `src/components/content-pane/content-pane-header.tsx` — Add split button (horizontal/vertical)
- `src/components/main-window/main-window-layout.tsx` — Hydrate layout-tree store on startup

### Phase 3: Pane focus management + keyboard routing

**Files to modify:**
- `src/stores/layout-tree/store.ts` — Add `_applySetFocusedPane`
- `src/components/content-pane/pane-slot.tsx` — `onPointerDown` sets focused pane
- `src/components/content-pane/content-pane.tsx` — Refactor Cmd+F to check focused state
- `src/components/content-pane/thread-content.tsx` — Refactor Cmd+F to check focused state
- `src/stores/input-store.tsx` — Wire `active` prop to `focusedPaneId` instead of always-true
- `src/index.css` — Focused pane visual indicator

### Phase 4: Navigation routing updates

**Files to modify:**
- `src/stores/navigation-service.ts` — Add optional `paneId` param, default to focused pane
- `src/stores/content-panes/service.ts` — Ensure `setPaneView` works independently of `activePaneId`
- `src/components/main-window/main-window-layout.tsx` — Update tree click handler, Spotlight handler, menu handler to use focused pane

### Phase 5: Per-pane thread lifecycle

**Files to modify:**
- `src/entities/threads/store.ts` — Replace `activeThreadId: string | null` with `visibleThreadIds: Set<string>`
- `src/entities/threads/service.ts` — Add `registerVisibleThread(threadId)` / `unregisterVisibleThread(threadId)`
- `src/entities/threads/listeners.ts` — Change `AGENT_STATE` / `AGENT_COMPLETED` to check `visibleThreadIds.has(threadId)` instead of `activeThreadId === threadId`
- `src/components/content-pane/thread-content.tsx` — On mount call `registerVisibleThread`, on unmount call `unregisterVisibleThread`
- `src/hooks/use-mark-thread-as-read.ts` — Check `visibleThreadIds` instead of `activeThreadId`

### Phase 6: Drag-to-rearrange pane headers

**Install:** `@dnd-kit/core @dnd-kit/utilities` (or evaluate if simpler HTML5 drag API suffices)

**Files to create:**
- `src/components/content-pane/pane-drop-zone.tsx` — Drop zone overlay with edge detection (top/bottom/left/right)

**Files to modify:**
- `src/components/content-pane/content-pane-header.tsx` — Make draggable via drag handle
- `src/components/content-pane/pane-slot.tsx` — Add drop zone detection
- `src/stores/layout-tree/service.ts` — `movePane(fromId, targetId, edge)` tree transformation

### Phase 7: Persistence + hydration

**Files to modify:**
- `src/stores/layout-tree/service.ts` — Save to `~/.mort/ui/layout-tree.json` with debounce
- `src/stores/layout-tree/types.ts` — Zod schema for persisted layout tree
- `src/components/main-window/main-window-layout.tsx` — Hydrate layout tree on startup, reconcile with content-panes store (handle stale paneIds)

---

## Multi-Tab Future Considerations

The architecture explicitly supports future tabbing by keeping `ContentPaneData` (what a pane shows) separate from `LayoutNode` (where panes are arranged). To add tabs later:

- Each `LeafNode` would reference a **pane group** instead of a single pane
- A pane group contains ordered panes (tabs) with one active tab
- The `ContentPane` header becomes a tab bar
- No changes needed to the split tree model itself

This is why we keep the existing `content-panes/store.ts` pane registry — it becomes the tab model later.

---

## Risk Factors

1. **Performance with many panes:** Each pane renders a full thread view with react-virtuoso. Test with 4+ panes to ensure smooth scrolling/streaming.
2. **Same thread in multiple panes:** Streaming store is keyed by threadId (shared correctly), but optimistic messages are component-local (independent per pane). This is the correct behavior but verify no race conditions.
3. **activeThreadId migration:** This is the riskiest change. Many parts of the codebase reference `activeThreadId`. The `visibleThreadIds` migration must be thorough.
4. **Drag-and-drop complexity:** Phase 6 is the most complex UI work. Consider shipping phases 1-5 first and adding drag later.
