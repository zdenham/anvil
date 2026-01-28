# Main Window UI Re-Architecture Plan

## Overview

This plan outlines a phased approach to refactoring the main window UI with the following goals:

1. Deprecate Mission Control view (unified inbox)
2. Deprecate Workflows page
3. Replace full-text sidebar menu items with icon-only header controls
4. Implement a collapsible tree menu with flat `repo/worktree` sections containing `plan|thread` items
5. Display thread/plan content in the main content pane (not NSPanel)
6. Support multiple content panes in the future
7. Make the left panel resizable

---

## Current Architecture Summary

### What Exists Today

```
┌─────────────────────────────────────────────────────────┐
│ Main Window                                             │
├──────────────┬──────────────────────────────────────────┤
│ Sidebar      │ Content Area (tab-based)                 │
│ (256px)      │                                          │
│              │ ┌──────────────────────────────────────┐ │
│ - Mission    │ │ Tab: inbox | worktrees | logs |      │ │
│   Control    │ │      settings                        │ │
│ - Worktrees  │ │                                      │ │
│ - Settings   │ │ Currently shows:                     │ │
│ - Logs       │ │ - UnifiedInbox (threads + plans)     │ │
│              │ │ - WorktreesPage                      │ │
│ [Legend]     │ │ - LogsPage                           │ │
│              │ │ - SettingsPage                       │ │
└──────────────┴──────────────────────────────────────────┘
```

**Thread/Plan Selection Flow:**
1. Click item in UnifiedInbox
2. `showControlPanelWithView()` called
3. NSPanel (singleton) or standalone window opens
4. Content rendered in separate window

### Key Files to Modify

| File | Changes Needed |
|------|----------------|
| `main-window-layout.tsx` | New layout structure, content pane system |
| `sidebar.tsx` | Complete rewrite → tree menu |
| `unified-inbox.tsx` | Deprecate → remove |
| `worktrees-page.tsx` | Deprecate → integrate into tree |
| `control-panel-window.tsx` | Extract views for embedding |

---

## Target Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│ ┌──────────────┬───────────────────────────────────────────────────┐ │
│ │ Tree Panel   │ Content Pane (uuid-identified)                    │ │
│ │ (resizable)  │                                                   │ │
│ │              │ ┌───────────────────────────────────────────────┐ │ │
│ │ [⚙] [📋] [+] │ │ Thread or Plan View                          │ │ │
│ │ ─────────────│ │                                               │ │ │
│ │ repo-a/main  │ │ (Same components as current control panel    │ │ │
│ │   · plan1    │ │  but embedded in main window)                │ │ │
│ │   · thread1  │ │                                               │ │ │
│ │   · thread2  │ │                                               │ │ │
│ │ ─────────────│ │                                               │ │ │
│ │ repo-a/feat  │ │                                               │ │ │
│ │   · thread3  │ │                                               │ │ │
│ │ ─────────────│ └───────────────────────────────────────────────┘ │ │
│ │ repo-b/main  │                                                   │ │
│ │              │ [Content pane can be split in future]            │ │
│ │ [Legend]     │                                                   │ │
│ └──────────────┴───────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Key Architecture Decisions:**
- Header bar lives **inside** the left tree panel, not spanning the full window
- Each content pane has a **UUID** for identification and state management
- Tree hierarchy: `repo/worktree` is a **single combined level** (not nested)
- Horizontal dividers separate each repo/worktree section
- All state managed via **Zustand with `~/.mort/` disk persistence** (following established patterns in `docs/data-models.md`)
- **No feature flags** - this is a full migration
- **Architect for multi-pane from day one** - UUID-based pane system ready for future splits/tabs
- **All threads/plans have worktree association** - this is an enforced invariant
- **Thread names from AI** - use `thread-naming-service.ts`, show loading state until ready
- **NSPanel + Content Pane coexist** - Enter opens in main window, Shift+Enter opens NSPanel, shared component logic

---

## Phase 1: Foundation & Component Extraction

**Goal:** Extract reusable components and establish new layout primitives without breaking existing functionality.

### 1.1 Extract Thread/Plan Views as Embeddable Components

Currently, `ThreadView` and `PlanView` are tightly coupled to the control panel window context. We need to make them embeddable anywhere.

**Tasks:**
- [ ] Create `src/components/content-pane/` directory
- [ ] Create `ContentPane` wrapper component that can host any view
- [ ] Extract `ThreadView` logic into `src/components/content-pane/thread-content.tsx`
  - Remove control-panel-specific header logic
  - Accept `threadId` as prop, manage own data fetching
  - Keep conversation/changes tab system internal
- [ ] Extract `PlanView` logic into `src/components/content-pane/plan-content.tsx`
  - Accept `planId` as prop
  - Keep markdown rendering and action buttons
- [ ] Create `ContentPaneHeader` component (shared header for embedded views)
  - Status dot + title
  - Tab switching (for threads)
  - Optional "pop out to window" button
  - Close button (clears content pane)

**New Types:**
```typescript
// src/components/content-pane/types.ts
export type ContentPaneView =
  | { type: "empty" }
  | { type: "thread"; threadId: string }
  | { type: "plan"; planId: string }
  | { type: "settings" }
  | { type: "logs" }
  | { type: "terminal"; terminalId: string };  // See plans/terminal-ui-integration.md

export interface ContentPane {
  id: string; // UUID for this pane instance
  view: ContentPaneView;
}

export interface ContentPaneProps {
  paneId: string;
  view: ContentPaneView;
  onClose: () => void;
  onPopOut?: () => void;
}
```

### 1.2 Create Resizable Panel Primitive

**Tasks:**
- [ ] Create `src/components/ui/resizable-panel.tsx`
  - Horizontal resize handle with drag support
  - Min/max width constraints
  - Persist width to localStorage or Zustand
  - Collapse button integration
- [ ] Add CSS variables for panel sizing
- [ ] Test resize behavior with various content

**Implementation Notes:**
- Use CSS `resize` or custom drag handler
- Consider using a library like `react-resizable-panels` for robustness
- Store width in `useLayoutStore` or similar

### 1.3 Create Tree Component Primitives

**Tasks:**
- [ ] Create `src/components/tree/` directory
- [ ] Create base `TreeNode` component
  - Expand/collapse chevron
  - Indentation based on depth
  - Selection highlight
  - Icon slot + label slot
- [ ] Create `TreeView` container
  - Keyboard navigation (arrow keys)
  - Single selection management
  - Accessibility (ARIA tree role)

---

## Phase 2: Tree Menu Data Structure

**Goal:** Establish the data model for the hierarchical tree view.

### 2.1 Define Tree Data Types

```typescript
// src/components/tree-menu/types.ts

// Repo/worktree is a single combined level (flat list with dividers)
export interface RepoWorktreeSection {
  type: "repo-worktree";
  id: string; // unique identifier (e.g., "repo-path:worktree-path")
  repoName: string;
  worktreeName: string; // branch name or "main"
  repoPath: string;
  worktreePath: string;
  items: TreeItemNode[];
  isExpanded: boolean;
}

export interface TreeItemNode {
  type: "thread" | "plan";
  id: string; // threadId or planId
  title: string;
  status: StatusDotVariant;
  updatedAt: Date;
  sectionId: string; // parent repo-worktree section
}

export type TreeNode = RepoWorktreeSection | TreeItemNode;
```

**Visual Structure:**
- Each `RepoWorktreeSection` displays as `"repoName/worktreeName"` (e.g., "mortician/main")
- Horizontal line dividers separate sections
- Items within a section are indented one level
- Sections can be collapsed to hide their items

### 2.2 Create Tree Data Store (Zustand + Disk Persistence)

**Tasks:**
- [ ] Create `src/stores/tree-menu-store.ts`:
  ```typescript
  import { persist } from 'zustand/middleware';

  interface TreeMenuState {
    // Expansion state for each repo-worktree section
    expandedSections: Record<string, boolean>; // keyed by section id
    selectedItemId: string | null; // thread or plan id

    // Actions
    toggleSection: (sectionId: string) => void;
    setSelectedItem: (itemId: string | null) => void;
    expandSection: (sectionId: string) => void;
    collapseSection: (sectionId: string) => void;
  }

  export const useTreeMenuStore = create<TreeMenuState>()(
    persist(
      (set, get) => ({
        // ... implementation
      }),
      {
        name: 'tree-menu-storage',
        // Persists expansion state to disk
      }
    )
  );
  ```
  - Derive tree structure from existing `useThreadStore` and `usePlanStore`
  - Manage expansion state per section (persisted)
  - Track selected node (persisted)
  - Sort items by `updatedAt` within each section
- [ ] Create selector hooks:
  - `useTreeData()` - full tree structure (derived from thread/plan stores)
  - `useSelectedTreeNode()` - currently selected
  - `useExpandedSections()` - expansion state

### 2.3 Map Existing Data to Tree Structure

**Tasks:**
- [ ] Write transformer function: `buildTreeFromEntities(threads, plans, worktrees)`
- [ ] Handle orphaned threads/plans (no worktree association)
  - Group under "Unassociated" or repo root
- [ ] Subscribe to entity changes for live updates

---

## Phase 3: Tree Menu Implementation

**Goal:** Build the actual tree menu component that replaces the sidebar navigation.

### 3.1 Repo/Worktree Section (Combined Level)

**Tasks:**
- [ ] Create `RepoWorktreeSection` component
  - Displays as `"repoName/worktreeName"` (e.g., "mortician/main")
  - Git branch icon or folder icon
  - Expand/collapse to show/hide items
  - Horizontal divider line above each section (except first)
  - Badge showing active item count (optional)
  - Visual styling distinct from item level (bolder, slightly larger text)

**Styling Notes:**
```css
.repo-worktree-section {
  padding: 8px 12px;
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.repo-worktree-section:not(:first-child)::before {
  content: "";
  display: block;
  height: 1px;
  background: var(--border-color);
  margin: 8px 0;
}

.repo-worktree-section .chevron {
  transition: transform 0.15s ease;
}

.repo-worktree-section.collapsed .chevron {
  transform: rotate(-90deg);
}
```

### 3.3 Item Level (Thread/Plan Rows)

**Tasks:**
- [ ] Create `ThreadTreeItem` component
  - Status dot (running/unread/read/stale)
  - Thread title (from thread.name or first user message)
  - Styled like VSCode file entries
  - Click → set as active content pane view
- [ ] Create `PlanTreeItem` component
  - Status dot
  - Plan filename
  - Same styling as thread items

**Styling Notes:**
```css
/* Tree item styling similar to VSCode */
.tree-item {
  padding: 2px 8px 2px calc(depth * 16px + 8px);
  font-size: 13px;
  line-height: 22px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

.tree-item:hover {
  background: var(--hover-bg);
}

.tree-item.selected {
  background: var(--selection-bg);
}

.tree-item .status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
```

### 3.4 Tree Menu Container

**Tasks:**
- [ ] Create `TreeMenu` component
  - Render full tree hierarchy
  - Handle selection changes → update content pane
  - Keyboard navigation
  - Context menu (right-click) for archive, etc.

---

## Phase 4: New Layout Assembly

**Goal:** Assemble the new main window layout with tree menu and embedded content pane.

### 4.1 Header Bar (Inside Tree Panel)

**Tasks:**
- [ ] Create `TreePanelHeader` component (lives inside tree panel, not spanning full window)
  - Icon buttons: Settings, Logs, Terminal, New (dropdown)
  - Minimal height (40px or so)
  - Visually part of the left panel
- [ ] Settings icon → shows settings in content pane
- [ ] Logs icon → shows logs in content pane
- [ ] Terminal icon → creates new terminal session and opens in content pane (see `plans/terminal-ui-integration.md`)

### 4.2 Main Layout Integration

**Tasks:**
- [ ] Update `main-window-layout.tsx`:
  ```tsx
  <div className="main-layout">
    <ResizablePanel minWidth={200} maxWidth={400} defaultWidth={280}>
      <TreePanelHeader /> {/* Header inside tree panel */}
      <TreeMenu />
      <StatusLegend />
    </ResizablePanel>
    <ContentPaneContainer /> {/* Manages panes by UUID */}
  </div>
  ```
- [ ] Remove tab system (inbox/worktrees/logs/settings tabs)
- [ ] Settings and Logs become content pane views

### 4.3 Content Pane State Management (Zustand + Disk Persistence)

**Tasks:**
- [ ] Create `src/stores/content-panes-store.ts`:
  ```typescript
  import { persist } from 'zustand/middleware';

  interface ContentPane {
    id: string; // UUID
    view: ContentPaneView;
  }

  interface ContentPanesState {
    panes: Record<string, ContentPane>; // keyed by UUID
    activePaneId: string | null;

    // Actions
    createPane: (view?: ContentPaneView) => string; // returns new UUID
    closePane: (paneId: string) => void;
    setPaneView: (paneId: string, view: ContentPaneView) => void;
    setActivePane: (paneId: string) => void;
  }

  export const useContentPanesStore = create<ContentPanesState>()(
    persist(
      (set, get) => ({
        // ... implementation
      }),
      {
        name: 'content-panes-storage',
        // Persists to disk via electron-store or similar
      }
    )
  );
  ```
- [ ] Wire tree selection to content pane state
- [ ] Handle empty state (no selection)
- [ ] Restore pane state on app restart

---

## Phase 5: Deprecation & Cleanup

**Goal:** Remove deprecated components and migrate remaining functionality.

### 5.1 Remove Mission Control

**Tasks:**
- [ ] Delete `src/components/inbox/unified-inbox.tsx`
- [ ] Delete `src/components/inbox/inbox-item.tsx`
- [ ] Delete `src/components/inbox/inbox-header.tsx`
- [ ] Remove "inbox" tab from TabId type
- [ ] Update any references

### 5.2 Remove Workflows Page

**Tasks:**
- [ ] Delete `src/components/main-window/worktrees-page.tsx` (the full page)
- [ ] Keep worktree data fetching logic (needed for tree)
- [ ] Remove "worktrees" tab from TabId type

### 5.3 Clean Up Sidebar

**Tasks:**
- [ ] Delete old `sidebar.tsx` or rename/repurpose
- [ ] Remove menu item components if no longer needed

### 5.4 Update Navigation Events

**Tasks:**
- [ ] Update "navigate" event handler (from macOS menu)
- [ ] Map old navigation targets to new content pane views

---

## Phase 6: NSPanel Integration

**Goal:** Support both NSPanel (quick access) and main window content panes with shared rendering logic.

### Decision: Hybrid Approach with Shared Components

**Behavior:**
- **Enter on Spotlight** → Opens thread in main window content pane AND focuses main window
- **Shift+Enter on Spotlight** → Opens thread in NSPanel (floating, quick access)
- **Tree selection** → Opens in main window content pane
- **Pop-out button** → Opens in standalone window

**Architecture:**
- Extract `ThreadContent` and `PlanContent` as truly reusable components
- Both NSPanel and ContentPane import and render these same components
- No duplicated rendering logic between windows

### Tasks:
- [ ] Update spotlight handler to detect Shift modifier
- [ ] Implement Enter → main window + focus behavior
- [ ] Implement Shift+Enter → NSPanel behavior
- [ ] Ensure `ThreadContent` and `PlanContent` work in both contexts (no window-specific assumptions)
- [ ] Add keyboard shortcut documentation

---

## Phase 7: Multi-Pane Architecture (Build Foundation Now)

**Goal:** Architect the UUID-based pane system from day one to support future multi-pane/multi-tab features.

**Decision:** Build the foundation now, defer the UI for splitting until later.

### 7.1 Content Pane System (Implement Now)

**Tasks:**
- [ ] Design `ContentPaneContainer` that manages panes by UUID from the start
- [ ] Each pane has its own `ContentPaneView` state stored by UUID
- [ ] Store pane state in `~/.mort/ui/content-panes.json`
- [ ] Support single-pane initially, but data model ready for multiple
- [ ] Consider using React context for pane-scoped state

**Data Model:**
```typescript
interface ContentPanesPersistedState {
  panes: Record<string, ContentPane>;  // keyed by UUID
  activePaneId: string | null;
  // Future: splitLayout?: SplitConfiguration;
}
```

### 7.2 Split View Primitives (Defer Implementation)

**Note:** The actual split UI is deferred until after core refactor is stable, but the UUID-based architecture supports it.

**Future Tasks:**
- [ ] Create horizontal/vertical splitter components
- [ ] Define split configurations (50/50, 70/30, etc.)
- [ ] Add UI for splitting (drag to split, menu option)
- [ ] Add tab support within panes

---

## Migration Strategy

### Full Migration (No Feature Flags)

This is a complete migration - no feature flags or incremental rollout. The old UI will be fully replaced.

**Execution Order:**

1. **Phase 1:** Foundation & Component Extraction
   - Extract components, create primitives
   - Build in parallel with existing UI

2. **Phase 2-3:** Tree Menu Data & Components
   - Build tree data store with persistence
   - Create tree components
   - Test with real data

3. **Phase 4:** Layout Assembly
   - Replace main-window-layout.tsx entirely
   - Wire up all state management

4. **Phase 5:** Cleanup
   - Delete deprecated components
   - Remove dead code

5. **Future:** Phase 6-7 (NSPanel decisions, multi-pane)

---

## Technical Considerations

### State Management (Zustand + `~/.mort/` Disk Persistence)

**IMPORTANT:** Follow established persistence patterns from `docs/data-models.md` and `src/lib/persistence.ts`. Do NOT use `electron-store` or browser localStorage.

All UI state is managed via Zustand stores with disk persistence via the `~/.mort/` directory:

| State | Store | Persistence Location |
|-------|-------|---------------------|
| Tree expansion | `tree-menu-store` | `~/.mort/ui/tree-menu.json` |
| Selected item | `tree-menu-store` | `~/.mort/ui/tree-menu.json` |
| Content panes (by UUID) | `content-panes-store` | `~/.mort/ui/content-panes.json` |
| Active pane ID | `content-panes-store` | `~/.mort/ui/content-panes.json` |
| Panel width | `layout-store` | `~/.mort/ui/layout.json` |

**Persistence Implementation (following established patterns):**
```typescript
import { persistence } from '@/lib/persistence';

// Example: tree-menu-store using established patterns
interface TreeMenuPersistedState {
  expandedSections: Record<string, boolean>;
  selectedItemId: string | null;
}

const UI_STATE_PATH = 'ui/tree-menu.json';

export const useTreeMenuStore = create<TreeMenuState>()((set, get) => ({
  expandedSections: {},
  selectedItemId: null,

  // Actions persist to disk following disk-as-truth pattern
  toggleSection: async (sectionId: string) => {
    const newState = !get().expandedSections[sectionId];
    set((state) => ({
      expandedSections: { ...state.expandedSections, [sectionId]: newState }
    }));
    await persistTreeMenuState(get());
  },

  // Hydrate from disk on startup
  hydrate: async () => {
    const data = await persistence.readJson<TreeMenuPersistedState>(UI_STATE_PATH);
    if (data) {
      set({ expandedSections: data.expandedSections, selectedItemId: data.selectedItemId });
    }
  },
}));

async function persistTreeMenuState(state: TreeMenuState) {
  const toSave: TreeMenuPersistedState = {
    expandedSections: state.expandedSections,
    selectedItemId: state.selectedItemId,
  };
  await persistence.writeJson(UI_STATE_PATH, toSave);
}
```

### Performance

- Tree virtualization if many items (react-window or similar)
- Memoize tree node components
- Debounce resize events

### Accessibility

- ARIA tree roles and attributes
- Keyboard navigation (arrows, Enter, Escape)
- Focus management between tree and content

### Testing

- Unit tests for tree data transformations
- Component tests for tree interactions
- Integration tests for selection → content pane flow

---

## Resolved Decisions

### 1. Thread Titles
**Decision:** Use AI-generated names via `thread-naming-service.ts`.

- Thread naming service generates names asynchronously after thread creation
- Service emits a `THREAD_UPDATED` event when name is ready
- **Loading State:** Display "New Thread" as placeholder until AI name arrives
- Reference: `agents/src/services/thread-naming-service.ts`

### 2. Worktree Association Invariant
**Decision:** All threads and plans MUST have a worktree association.

- This is an enforced invariant - no "unassociated" section needed
- If a thread/plan has no worktree, that's a bug to fix at creation time
- Simplifies tree structure significantly

### 3. State Persistence
**Decision:** Use `~/.mort/` directory conventions for ALL persistent state.

This is a **hard requirement**. Follow established patterns:
- Disk as truth (events trigger disk re-reads)
- Entity store pattern (single store per entity type)
- Persistence layer (`src/lib/persistence.ts`) for all disk I/O
- Reference: `docs/data-models.md` for directory structure conventions

**DO NOT** use `electron-store` or browser localStorage for entity state. UI layout preferences (panel width, expansion state) should also follow `.mort` conventions where appropriate.

### 4. Search/Filter
**Decision:** Defer. Use existing spotlight for now.

- No tree filter in initial implementation
- Spotlight already provides global thread search
- Can revisit if users need scoped filtering within tree

### 5. Context Menu
**Decision:** Defer. No right-click context menu in initial implementation.

- Can add later based on user feedback
- Focus on core tree navigation first

### 6. Thread Loading State
**Decision:** Display "New Thread" as placeholder until AI name is ready.

- Simple text, no spinner or skeleton
- Replaced automatically when `THREAD_UPDATED` event fires with the AI-generated name

### 7. Tree Item Ordering
**Decision:** Keep current ordering (most recently updated first).

- Matches existing inbox behavior
- Plans and threads mixed together by update time

### 8. Empty Content Pane State
**Decision:** Show onboarding guide (same as current Mission Control empty state).

- Reuse existing onboarding guide component
- In the future, this will evolve into a more comprehensive guide/dashboard

### 9. Tree Panel Collapse Behavior
**Decision:** No collapse-to-rail behavior. Panel is either full width or hidden.

- No icon-only rail state
- Just a drag handle to resize, with snap-to-close under a threshold
- Keyboard shortcut can toggle visibility if needed later

### 10. Section Expansion UI
**Decision:** Use +/- icons (not chevrons) to toggle section collapse.

- Plus (+) icon when section is collapsed
- Minus (-) icon when section is expanded
- Click icon to toggle, not the entire section header

### 11. Section Expansion Persistence
**Decision:** Persist tree expansion state in `~/.mort/ui/tree-menu.json`.

- Remember collapsed/expanded state per repo/worktree section
- Restore on app restart

### 12. Active/Running Thread Indication
**Decision:** Keep existing legend/status dot system.

- Status dot color indicates state (running = green, etc.)
- Dots may need to be smaller to fit tree item rows
- No additional animations or row tinting

### 13. Drag-to-Resize Behavior
**Decision:** Simple drag with snap-to-close.

- No snap points during drag - smooth/continuous resize
- Snap to closed (hidden) when dragged below a minimum threshold (~100px?)
- Double-click behavior: not specified (can defer)
- Min width when visible: ~180-200px
- Max width: no hard max, but reasonable limit (~400px or 40% of window)

### 14. Header Icons
**Decision:** Keep existing icon behavior - already functional.

- Icons are already wired up in current implementation
- No changes needed for initial implementation

## Open Questions

(None remaining - all decisions resolved)

---

## File Structure (Proposed)

```
src/components/
├── content-pane/
│   ├── index.ts
│   ├── types.ts
│   ├── content-pane.tsx           # Single pane component
│   ├── content-pane-container.tsx # Manages multiple panes by UUID
│   ├── content-pane-header.tsx
│   ├── thread-content.tsx
│   ├── plan-content.tsx
│   ├── settings-content.tsx
│   ├── logs-content.tsx
│   └── terminal-content.tsx       # See plans/terminal-ui-integration.md
├── tree-menu/
│   ├── index.ts
│   ├── types.ts
│   ├── tree-menu.tsx
│   ├── tree-panel-header.tsx      # Header bar (inside tree panel)
│   ├── repo-worktree-section.tsx  # Combined repo/worktree level
│   ├── section-divider.tsx        # Horizontal line between sections
│   ├── thread-item.tsx
│   └── plan-item.tsx
├── ui/
│   └── resizable-panel.tsx
└── main-window/
    ├── main-window-layout.tsx (complete rewrite)
    └── ...

src/stores/
├── tree-menu-store.ts (new, persisted)
├── content-panes-store.ts (new, persisted)
├── terminal-store.ts (new, for terminal sessions - see plans/terminal-ui-integration.md)
└── ...
```

---

## Success Criteria

- [ ] Tree menu displays `repo/worktree` sections with horizontal dividers
- [ ] Each section expands to show threads/plans
- [ ] Clicking tree item opens content in main pane (no NSPanel)
- [ ] Content panes have UUIDs and state persists to disk
- [ ] Thread/plan views work identically to current control panel
- [ ] Left panel is resizable with drag handle
- [ ] Header bar lives inside tree panel with icon buttons
- [ ] Settings and Logs accessible from header icons
- [ ] Tree expansion state persists across app restarts
- [ ] Mission Control and Workflows pages removed
- [ ] No regressions in existing functionality
- [ ] Performance acceptable with 100+ items in tree

---

## Sub-Plans (To Be Created)

This master plan will be broken into focused sub-plans aligned with the phases above:

```
plans/refactor/
├── 01-foundation-extraction.md    # Phase 1: ContentPane components + ResizablePanel + Tree primitives
├── 02-tree-data-store.md          # Phase 2: Tree data types + Zustand store + entity mapping
├── 03-tree-menu-ui.md             # Phase 3: RepoWorktreeSection + TreeItems + TreeMenu container
├── 04-layout-assembly.md          # Phase 4: Header bar + main layout + content pane state
├── 05-deprecation-cleanup.md      # Phase 5: Remove Mission Control, Workflows, old sidebar
├── 06-regression-testing.md       # Gate: Verify thread/plan views work before cleanup
└── 07-nspanel-multipane.md        # Phase 6+7: NSPanel integration + multi-pane foundation (future)
```

### Sub-Plan Scope Boundaries

**01-foundation-extraction.md** (Phase 1)
- Extract `ThreadContentPane` and `PlanContentPane` from existing views
- Implement `ResizablePanel` with drag handle and persistence
- Create base tree primitives: `TreeItem`, `TreeSection`, `TreeExpander`
- Deliverable: Standalone components that can render in isolation

**02-tree-data-store.md** (Phase 2)
- Define `TreeNode` types and discriminated unions
- Implement `useTreeMenuStore` with Zustand (expansion state, selection)
- Create `useTreeData` hook for entity → tree node mapping
- Deliverable: Tree data layer with persistence, no UI

**03-tree-menu-ui.md** (Phase 3)
- Build `RepoWorktreeSection` with horizontal dividers
- Implement `ThreadTreeItem` and `PlanTreeItem` with icons/badges
- Assemble `TreeMenu` container with keyboard navigation
- Deliverable: Fully functional tree menu component

**04-layout-assembly.md** (Phase 4)
- Create `TreePanelHeader` with icon buttons (settings, logs, new thread)
- Build `MainWindowLayout` combining tree + content panes
- Wire up content pane selection and state management
- Create `useContentPanesStore` with Zustand persistence
- Deliverable: Complete new main window, parallel to old

**05-deprecation-cleanup.md** (Phase 5)
- Remove `MissionControl.tsx` and `Workflows.tsx`
- Remove old sidebar navigation components
- Clean up unused routes and store slices
- Update navigation event handlers for new architecture
- Deliverable: Codebase with only new architecture

**06-regression-testing.md** (Run after Phase 4, before Phase 5)
- Manual test checklist for thread view functionality
- Manual test checklist for plan view functionality
- Verify feature parity between old control panel and new content panes
- Test NSPanel still works independently
- Test spotlight → thread opening flow
- Deliverable: Sign-off that thread/plan views have no regressions

**07-nspanel-multipane.md** (Phase 6+7 - Future)
- NSPanel window management strategy
- Multi-pane content area foundation
- Drag-and-drop pane arrangement
- Deliverable: Design doc and initial scaffolding

### Out of Scope for This Refactor

The following items are mentioned in Technical Considerations but are **not covered** by the sub-plans above:

- **Terminal integration** - Covered by separate plan: `plans/terminal-ui-integration.md`
- **Settings/Logs content extraction** - Settings and Logs will continue using existing implementations; only the routing changes
- **ARIA accessibility / keyboard navigation** - Basic keyboard nav included, but full accessibility audit is deferred
- **Tree virtualization** - Only needed if performance issues arise with 100+ items; defer until measured
- **Unit/component/integration tests** - No automated test coverage in scope; regression testing is manual (see 06-regression-testing.md)
