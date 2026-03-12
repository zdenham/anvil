# Track A: Right Panel Container + Hook + Layout

**Parent:** [unified-right-panel-tabs.md](../unified-right-panel-tabs.md)
**Parallel:** Yes — no dependencies on Track B or C

## Goal

Replace the current modal right panel (file-browser XOR search) with a unified tabbed container. Refactor the hook to manage tab state instead of discriminated union state.

## Phases

- [x] Refactor `useRightPanel` hook to manage tabbed state
- [x] Create `RightPanelTabBar` component
- [x] Create `RightPanelContainer` component
- [x] Integrate `useActiveWorktreeContext` for Files tab automatic worktree resolution

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Refactor `useRightPanel` hook

**File:** `src/hooks/use-right-panel.ts`

Replace the current discriminated union state with tab-aware state:

```typescript
// Current state
type RightPanelState =
  | { type: "none" }
  | { type: "file-browser"; rootPath: string; repoId: string; worktreeId: string }
  | { type: "search" };

// New state
type RightPanelTab = "search" | "files" | "changelog";

interface RightPanelState {
  isOpen: boolean;
  activeTab: RightPanelTab;
  /** Explicit worktree override from tree menu "Files" button. Cleared when tab switches away. */
  filesWorktreeOverride: { repoId: string; worktreeId: string; rootPath: string } | null;
}
```

New hook API:

```typescript
interface UseRightPanelReturn {
  state: RightPanelState;
  /** Toggle panel open/close. Remembers last active tab. */
  toggle: () => void;
  /** Open panel to a specific tab */
  openTab: (tab: RightPanelTab) => void;
  /** Open Files tab with explicit worktree (from tree menu) */
  openFileBrowser: (repoId: string, worktreeId: string, worktreePath: string) => void;
  /** Open Search tab (Cmd+Shift+F) */
  openSearch: () => void;
  /** Close the panel */
  close: () => void;
  /** Active tab for external consumers */
  activeTab: RightPanelTab;
  /** Whether panel is open */
  isOpen: boolean;
}
```

Key behaviors:
- Default `activeTab` is `"files"` when first opened
- `openFileBrowser()` sets `filesWorktreeOverride` + switches to files tab + opens panel
- `openSearch()` switches to search tab + opens panel
- `toggle()` opens to last `activeTab` (default `"files"`)
- `close()` sets `isOpen: false` but preserves `activeTab`
- `filesWorktreeOverride` is cleared when switching away from files tab

## Phase 2: `RightPanelTabBar` (VS Code-style icon bar)

**New file:** `src/components/right-panel/right-panel-tab-bar.tsx`

Icon-only tab bar matching VS Code's secondary sidebar style — no text labels, just icons with tooltips.

```typescript
import { Search, FolderTree, GitCommitVertical } from "lucide-react";
import { Tooltip } from "@/components/ui/tooltip";

const TAB_CONFIG: { tab: RightPanelTab; icon: LucideIcon; tooltip: string }[] = [
  { tab: "search", icon: Search, tooltip: "Search" },
  { tab: "files", icon: FolderTree, tooltip: "Files" },
  { tab: "changelog", icon: GitCommitVertical, tooltip: "Changelog" },
];

interface RightPanelTabBarProps {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
}
```

**Icon styling** (consistent with titlebar + tree panel header patterns):
- Icon size: `14` (one step up from the 12px titlebar icons — these are primary navigation)
- Each icon is a `<button>` wrapped in `<Tooltip side="bottom">`
- Button classes: `flex items-center justify-center w-6 h-6 rounded transition-colors`
- Inactive: `text-surface-500 hover:text-surface-200 hover:bg-surface-800`
- Active: `text-accent-400 bg-surface-800`
- Container: `flex items-center gap-1 px-2 py-1.5 border-b border-surface-700`
  (same border pattern as `FileBrowserHeader` and `TreePanelHeader`)

## Phase 3: `RightPanelContainer`

**New file:** `src/components/right-panel/right-panel-container.tsx`

Tabbed container that renders:
1. `RightPanelTabBar` at the top
2. Active tab content below (conditional render, NOT hidden — lazy mount/unmount per tab)

```typescript
interface RightPanelContainerProps {
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  onClose: () => void;
  /** Files tab props */
  filesContext: ActiveWorktreeContext;
  filesWorktreeOverride: { repoId: string; worktreeId: string; rootPath: string } | null;
  /** Search tab props */
  onNavigateToFile: SearchPanelProps["onNavigateToFile"];
  onNavigateToThread: SearchPanelProps["onNavigateToThread"];
}
```

Tab content rendering:
- **Search:** Renders existing `<SearchPanel>` with `onClose` + navigation callbacks
- **Files:** Renders existing `<FileBrowserPanel>` with worktree context from either `filesWorktreeOverride` or `filesContext` (from `useActiveWorktreeContext`)
- **Changelog:** Renders `<ChangelogPanel>` (from Track B) with same worktree context derivation

For the Files tab, the worktree resolution order is:
1. `filesWorktreeOverride` if set (explicit tree menu click)
2. `useActiveWorktreeContext()` result (active tab's worktree → MRU fallback)
3. If neither has context, show an empty state ("No worktree selected")

## Phase 4: Integrate `useActiveWorktreeContext`

Wire the Files tab to auto-resolve worktree from the active content pane tab. This is handled by passing `useActiveWorktreeContext()` result as `filesContext` prop to `RightPanelContainer` from the layout.

The existing `useActiveWorktreeContext` hook already handles:
- Thread → thread.repoId/worktreeId
- Plan → plan.repoId/worktreeId
- File → view.repoId/worktreeId
- Changes → view.repoId/worktreeId
- Terminal → session.worktreeId + lookup repoId
- Fallback → MRU worktree

No changes needed to the hook itself — just consume it in the layout and pass through.

## Files Changed

| File | Change |
| --- | --- |
| `src/hooks/use-right-panel.ts` | Rewrite: tab-aware state management |
| `src/components/right-panel/right-panel-tab-bar.tsx` | **New**: tab bar component |
| `src/components/right-panel/right-panel-container.tsx` | **New**: tabbed container |

## Interface Contract (for Track D)

Track D (integration) will consume this track's output:

```typescript
// From useRightPanel():
rightPanel.isOpen        // boolean — drives ResizablePanel visibility
rightPanel.activeTab     // RightPanelTab — passed to container
rightPanel.toggle()      // titlebar button
rightPanel.openSearch()  // Cmd+Shift+F
rightPanel.openFileBrowser(repoId, worktreeId, path)  // tree menu
rightPanel.openTab(tab)  // direct tab switch
rightPanel.close()       // panel close

// RightPanelContainer expects:
<RightPanelContainer
  activeTab={rightPanel.activeTab}
  onTabChange={rightPanel.openTab}
  onClose={rightPanel.close}
  filesContext={activeWorktreeContext}
  filesWorktreeOverride={rightPanel.state.filesWorktreeOverride}
  onNavigateToFile={...}
  onNavigateToThread={...}
/>
```
