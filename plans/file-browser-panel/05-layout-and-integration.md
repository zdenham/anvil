# 05 — Layout Integration + Tree Menu Entry + Wiring

**Depends on:** [04-file-browser-component.md](./04-file-browser-component.md)

See [decisions.md](./decisions.md) for rationale on resizable right panel, toggle/dismiss behavior, tree menu integration, worktree switching, and active state highlighting.

## Phases

- [ ] Extract file-browser layout logic into a dedicated hook + add right-panel slot
- [ ] Add "Files" entry point to each worktree section in the tree menu
- [ ] Wire up file clicks to open in content pane via navigateToFile
- [ ] Add Escape-key dismiss handler

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Right-panel slot in MainWindowLayout

`main-window-layout.tsx` is already ~547 lines (well above the 250-line guideline). Adding state, handlers, an Escape listener, and render changes inline would push it further. Extract the file-browser panel concerns into a dedicated hook.

### 1a. New hook: `src/hooks/use-file-browser-panel.ts`

Encapsulates all file-browser panel state and handlers. Keeps `MainWindowLayout` from growing.

```typescript
import { useState, useCallback, useEffect } from "react";

export interface FileBrowserContext {
  rootPath: string;
  repoId: string;
  worktreeId: string;
}

interface UseFileBrowserPanelReturn {
  fileBrowserContext: FileBrowserContext | null;
  /** Toggle file browser for a worktree. Closes if already open for same worktree. */
  handleOpenFileBrowser: (repoId: string, worktreeId: string, worktreePath: string) => void;
  /** Close the file browser panel. */
  closeFileBrowser: () => void;
  /** Active worktree ID (for tree menu highlight), or null. */
  fileBrowserWorktreeId: string | null;
}

export function useFileBrowserPanel(): UseFileBrowserPanelReturn {
  const [fileBrowserContext, setFileBrowserContext] = useState<FileBrowserContext | null>(null);

  const handleOpenFileBrowser = useCallback(
    (repoId: string, worktreeId: string, worktreePath: string) => {
      setFileBrowserContext((prev) => {
        // Toggle: if already open for this worktree, close it
        if (prev?.worktreeId === worktreeId) return null;
        return { rootPath: worktreePath, repoId, worktreeId };
      });
    },
    []
  );

  const closeFileBrowser = useCallback(() => {
    setFileBrowserContext(null);
  }, []);

  // Escape key dismisses the panel (per decisions: "Escape key toggles it off")
  useEffect(() => {
    if (!fileBrowserContext) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFileBrowserContext(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [fileBrowserContext]);

  return {
    fileBrowserContext,
    handleOpenFileBrowser,
    closeFileBrowser,
    fileBrowserWorktreeId: fileBrowserContext?.worktreeId ?? null,
  };
}
```

**Key points:**
- `handleOpenFileBrowser` uses the functional updater form of `setState` so the dependency array is empty (no stale closure on `fileBrowserContext`). This fixes the original plan which had `[fileBrowserContext]` as a dependency.
- The Escape key listener is scoped: only registered when the panel is open, cleaned up when closed.
- **Worktree switch behavior:** Clicking "Files" on a different worktree while the panel is already open causes `FileBrowserPanel` to unmount (tearing down its watcher) and remount with new context, starting at root. React handles this via the key prop (see render section below).

### 1b. Render changes in MainWindowLayout

**File: `src/components/main-window/main-window-layout.tsx`**

Import the hook and `FileBrowserPanel`:

```typescript
import { useFileBrowserPanel } from "@/hooks/use-file-browser-panel";
import { FileBrowserPanel } from "@/components/file-browser/file-browser-panel";
```

Inside `MainWindowLayout()`, call the hook (place after the existing `useQuickActionHotkeys()` call):

```typescript
const {
  fileBrowserContext,
  handleOpenFileBrowser,
  closeFileBrowser,
  fileBrowserWorktreeId,
} = useFileBrowserPanel();
```

Update the render. The current layout is (simplified):

```tsx
<div className={`flex h-full bg-surface-900 ${isFullscreen ? "pt-3" : ""}`}>
  <ResizablePanel position="left" ...>
    {/* TreePanelHeader + TreeMenu + StatusLegend */}
  </ResizablePanel>
  <ContentPaneContainer />
  <BuildModeIndicator />
  <CommandPalette ... />
</div>
```

Add the file browser panel **after** `ContentPaneContainer` and **before** `BuildModeIndicator`:

```tsx
<ContentPaneContainer />

{fileBrowserContext && (
  <ResizablePanel
    position="right"
    minWidth={180}
    maxWidth={Math.floor(window.innerWidth * 0.5)}
    defaultWidth={250}
    persistKey="file-browser-panel-width"
    closeThreshold={120}
    onClose={closeFileBrowser}
    className="bg-surface-950 border-l border-surface-700"
  >
    <FileBrowserPanel
      key={fileBrowserContext.worktreeId}
      rootPath={fileBrowserContext.rootPath}
      repoId={fileBrowserContext.repoId}
      worktreeId={fileBrowserContext.worktreeId}
      onClose={closeFileBrowser}
    />
  </ResizablePanel>
)}

<BuildModeIndicator />
```

**Implementation notes on `ResizablePanel` usage:**

- `ResizablePanel` (in `src/components/ui/resizable-panel.tsx`) supports `position: "left" | "right"`, `minWidth`, `maxWidth?`, `defaultWidth: number | "1/3"`, `persistKey`, `closeThreshold?`, `onClose?`, `className?`, and `children`. All props used above are valid against the current API.
- `maxWidth` is evaluated at render time and won't dynamically update on window resize. This matches the existing left panel behavior (no dynamic max). Acceptable for v1.
- Width persistence uses `ResizablePanel`'s built-in mechanism: it reads/writes `~/.mort/ui/layout.json` via `appData` using the `persistKey`. This is the same file used by `layoutService`, which is hydrated at startup in `MainWindowLayout`. No additional persistence wiring needed.
- **`key={fileBrowserContext.worktreeId}`** on `FileBrowserPanel` ensures React unmounts/remounts when switching worktrees, giving each worktree a fresh component instance (tears down watchers, resets to root).

Pass the file browser state to `TreeMenu`:

```tsx
<TreeMenu
  // ... all existing props unchanged
  onOpenFiles={handleOpenFileBrowser}
  fileBrowserWorktreeId={fileBrowserWorktreeId}
/>
```

---

## Phase 2: "Files" entry point in tree menu

### 2a. TreeMenu props threading

**File: `src/components/tree-menu/tree-menu.tsx`** (currently 249 lines)

Add two new optional props to `TreeMenuProps`:

```typescript
interface TreeMenuProps {
  // ... all existing props unchanged
  /** Called when user opens the file browser for a worktree */
  onOpenFiles?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  /** Worktree ID that currently has the file browser open, or null */
  fileBrowserWorktreeId?: string | null;
}
```

Destructure them in the function signature and pass through to each `RepoWorktreeSection`:

```tsx
<RepoWorktreeSection
  key={section.id}
  section={section}
  // ... all existing props unchanged
  onOpenFiles={onOpenFiles}
  isFileBrowserOpen={fileBrowserWorktreeId === section.worktreeId}
/>
```

**Keyboard navigation note:** The decisions state that "Files" should be a keyboard-navigable tree item where arrow keys land on it, but selection alone does NOT open the file browser. The current `focusableItems` list in `tree-menu.tsx` (lines 54-71) builds a flat array of `section` and `item` type entries for keyboard navigation. Integrating "Files" into this system would require adding a new focusable item type (e.g., `type: "files-entry"`) to the array, with special handling in the `handleKeyDown` switch for Enter/Space to call `onOpenFiles`. However, this is a non-trivial change that adds complexity to the already-at-limit tree-menu.tsx.

**Pragmatic approach for v1:** Implement "Files" as a click-only tree item (matching the current `<button>` approach in Phase 2b). This is consistent with how other non-item elements in the tree (section headers, plus buttons) work today. Add a `// TODO: Integrate into focusableItems for full keyboard nav` comment. Full keyboard nav can be added in a follow-up if needed.

### 2b. "Files" button in worktree section

**File: `src/components/tree-menu/repo-worktree-section.tsx`** (currently 634 lines -- already far above the 250-line guideline)

This file is already oversize. Do NOT add the "Files" item inline. Instead, create a small dedicated component.

**New file: `src/components/tree-menu/files-item.tsx`**

```tsx
import { FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";

interface FilesItemProps {
  repoId: string;
  worktreeId: string;
  worktreePath: string;
  isActive: boolean;
  onOpenFiles: (repoId: string, worktreeId: string, worktreePath: string) => void;
}

/**
 * "Files" entry pinned at the top of a worktree section.
 * Opens the file browser panel. Highlights in accent color when active.
 *
 * Per decisions: click or Enter opens file browser; selection alone does not.
 */
export function FilesItem({ repoId, worktreeId, worktreePath, isActive, onOpenFiles }: FilesItemProps) {
  const handleClick = () => {
    onOpenFiles(repoId, worktreeId, worktreePath);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpenFiles(repoId, worktreeId, worktreePath);
    }
  };

  return (
    <button
      type="button"
      role="treeitem"
      tabIndex={-1}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex items-center gap-2 w-full pl-5 pr-2 py-1 text-xs",
        "hover:bg-surface-800 rounded cursor-pointer select-none",
        isActive
          ? "text-accent-400"
          : "text-surface-400 hover:text-surface-200"
      )}
    >
      <FolderOpen size={13} className="flex-shrink-0" />
      <span>Files</span>
    </button>
  );
}
```

**Key points:**
- Uses `lucide-react` `FolderOpen` icon (same library used throughout the tree menu).
- Icon `size={13}` matches the convention used by other tree-menu item icons (e.g., `MessageSquarePlus size={11}` in menus, status icons at similar sizes).
- `role="treeitem"` and `tabIndex={-1}` follow the ARIA tree pattern used by section headers.
- `cn()` utility from `@/lib/utils` is the standard classname merge used throughout.

### 2c. Render "Files" in RepoWorktreeSection

**File: `src/components/tree-menu/repo-worktree-section.tsx`**

Add new props to `RepoWorktreeSectionProps`:

```typescript
interface RepoWorktreeSectionProps {
  // ... all existing props unchanged
  /** Called when user opens the file browser for this worktree */
  onOpenFiles?: (repoId: string, worktreeId: string, worktreePath: string) => void;
  /** Whether the file browser is currently open for this worktree */
  isFileBrowserOpen?: boolean;
}
```

Destructure `onOpenFiles` and `isFileBrowserOpen` in the component function parameters.

Import `FilesItem`:

```typescript
import { FilesItem } from "./files-item";
```

In the expanded items section (the `<div role="group" aria-label="Items">` block, around line 591), insert the `FilesItem` **before** the `section.items.map(...)` call. This pins it at the top per decisions:

```tsx
<div
  role="group"
  aria-label="Items"
  className={`tree-children ${section.isExpanded ? 'expanded' : 'collapsed'}`}
>
  {/* "Files" pinned at top of expanded section - before threads/plans/terminals */}
  {onOpenFiles && (
    <FilesItem
      repoId={section.repoId}
      worktreeId={section.worktreeId}
      worktreePath={section.worktreePath}
      isActive={isFileBrowserOpen ?? false}
      onOpenFiles={onOpenFiles}
    />
  )}

  {section.items.map((item, index) => {
    // ... existing item rendering unchanged
  })}
</div>
```

---

## Phase 3: Wire up file clicks

This connects `FileBrowserPanel` file clicks to `navigateToFile` from [01-file-view-type.md](./01-file-view-type.md).

**File: `src/components/file-browser/file-browser-panel.tsx`** (created in sub-plan 04)

The `FileBrowserPanel` component from sub-plan 04 defines an `onFileClick` handler that is called when a file entry is clicked. Wire it to `navigationService.navigateToFile`:

```typescript
import { navigationService } from "@/stores/navigation-service";
```

In the component, add the handler and pass it to the file list rendering:

```typescript
const handleFileClick = useCallback(
  (entry: DirEntry) => {
    navigationService.navigateToFile(entry.path, { repoId, worktreeId });
  },
  [repoId, worktreeId]
);
```

**Key points:**
- `navigationService.navigateToFile()` is added in sub-plan 01. It clears tree selection and sets the content pane view to `{ type: "file", filePath, repoId?, worktreeId? }`.
- `DirEntry` is the type from sub-plan 02's Rust `list_dir` command. It has a `path: string` field (absolute path).
- The file browser panel **stays open** after clicking a file (per decisions). The file opens in the content pane via `navigateToFile`, but the panel is not closed.
- If the file viewer from `plans/file-viewer-pane.md` is not yet implemented, files show a placeholder in the content pane (from sub-plan 01's minimal `file` view routing).

---

## Phase 4: Add Escape-key dismiss handler

Already handled inside `useFileBrowserPanel` hook (Phase 1a). The Escape listener is:
- Only active when the panel is open (`fileBrowserContext !== null`).
- Cleaned up when the panel closes or the component unmounts.
- Calls `setFileBrowserContext(null)` which closes the panel.

No additional work needed in this phase -- it is baked into the hook. This phase exists as a checklist item to verify the behavior works during testing.

**Potential conflict:** If the `FileBrowserPanel` component (sub-plan 04) or `CommandPalette` also listen for Escape, ensure the listeners do not interfere. `CommandPalette` only listens when open. `FileBrowserPanel` internal Escape handling (if any, e.g., for breadcrumb editing) should call `e.stopPropagation()` to prevent the global listener from also firing.

---

## Files

| File | Action |
|------|--------|
| `src/hooks/use-file-browser-panel.ts` | **New** -- hook for panel state, toggle, Escape dismiss |
| `src/components/main-window/main-window-layout.tsx` | Modify -- import hook + `FileBrowserPanel`, add right-panel render slot, pass props to `TreeMenu` |
| `src/components/tree-menu/tree-menu.tsx` | Modify -- add `onOpenFiles` + `fileBrowserWorktreeId` props, thread through to `RepoWorktreeSection` |
| `src/components/tree-menu/files-item.tsx` | **New** -- small "Files" tree item component |
| `src/components/tree-menu/repo-worktree-section.tsx` | Modify -- add `onOpenFiles` + `isFileBrowserOpen` props, render `FilesItem` at top of expanded items |
| `src/components/file-browser/file-browser-panel.tsx` | Modify -- wire `handleFileClick` to `navigationService.navigateToFile` |

## Line count impact

| File | Current lines | Estimated change | Projected |
|------|---------------|------------------|-----------|
| `main-window-layout.tsx` | 547 | +15 (import, hook call, render slot, TreeMenu props) | ~562 |
| `tree-menu.tsx` | 249 | +8 (2 props, 2 destructure, 2 pass-through lines) | ~257 |
| `repo-worktree-section.tsx` | 634 | +10 (2 props, import, render `FilesItem`) | ~644 |
| `use-file-browser-panel.ts` | 0 | +55 (new file) | ~55 |
| `files-item.tsx` | 0 | +45 (new file) | ~45 |

**Note:** `main-window-layout.tsx` (547 lines) and `repo-worktree-section.tsx` (634 lines) are already well above the 250-line guideline. This plan adds minimal code to each by extracting new logic into `use-file-browser-panel.ts` and `files-item.tsx`. Further decomposition of those existing files is out of scope for this plan but should be prioritized.

`tree-menu.tsx` goes slightly over 250 lines. The addition is trivial (prop threading only), so this is acceptable.

## Verification

After implementation, verify:

1. **TypeScript compiles** -- `npx tsc --noEmit` passes.
2. **Toggle behavior** -- Click "Files" on a worktree: panel opens. Click again: panel closes.
3. **Worktree switch** -- With panel open for worktree A, click "Files" on worktree B: panel swaps instantly to B's root.
4. **Accent highlight** -- "Files" item in tree menu highlights in accent color when the panel is open for that worktree. Other worktrees' "Files" items remain unhighlighted.
5. **Escape dismiss** -- With panel open, press Escape: panel closes.
6. **Snap-to-close** -- Drag the panel's left edge past the close threshold: panel closes.
7. **Width persistence** -- Resize the panel, close it, reopen it: width is restored from `~/.mort/ui/layout.json` under the key `file-browser-panel-width`.
8. **File click** -- Click a file in the browser: content pane shows the file (or placeholder). Panel stays open.
9. **Panel stays open** -- After clicking a file, the panel remains visible and navigable.
10. **Pinned at top** -- "Files" appears above all threads/plans/terminals in each worktree section.
