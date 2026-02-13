# 04 — FileBrowserPanel Component

**Depends on:** [01-file-view-type.md](./01-file-view-type.md), [02-rust-file-watcher.md](./02-rust-file-watcher.md), [03-file-icons.md](./03-file-icons.md)

See [decisions.md](./decisions.md) for rationale on single-directory navigation, breadcrumb truncation, file display rules, error handling, and keyboard support.

## Phases

- [ ] Create directory listing utilities and entry list sub-component
- [ ] Create FileBrowserPanel shell with directory reading and navigation
- [ ] Add file watcher integration and manual refresh
- [ ] Add breadcrumb header with truncation

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## File Split Strategy

A single file would exceed the 250-line limit. Split into focused modules:

| File | Responsibility | Est. Lines |
|------|---------------|------------|
| `src/components/file-browser/dir-utils.ts` | Pure sorting + breadcrumb truncation functions | ~50 |
| `src/components/file-browser/file-browser-header.tsx` | Header: breadcrumb path + refresh + close buttons | ~80 |
| `src/components/file-browser/file-entry-list.tsx` | Scrollable entry list rendering with icons | ~70 |
| `src/components/file-browser/file-browser-error.tsx` | Error state (stale/missing directory) | ~50 |
| `src/components/file-browser/file-browser-panel.tsx` | Shell: state, directory loading, watcher, keyboard | ~120 |

All files in `src/components/file-browser/`. Sub-plan 03 already creates `file-icons.ts` in the same directory.

---

## Phase 1: Directory listing utilities and entry list sub-component

### 1a. Pure utility functions

**New file: `src/components/file-browser/dir-utils.ts`**

Pure functions with no React or Tauri dependencies. Easily testable.

```typescript
import type { DirEntry } from "@/lib/filesystem-client";

/**
 * Sort directory entries: directories first (alphabetical), then files (alphabetical).
 * Case-insensitive comparison via localeCompare.
 */
export function sortDirEntries(entries: DirEntry[]): DirEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Breadcrumb segment with label and absolute path for navigation.
 */
export interface BreadcrumbSegment {
  label: string;
  path: string;
}

/**
 * Build breadcrumb segments from currentPath relative to rootPath.
 * The first segment is always the root directory name.
 * Returns all segments; truncation is handled at render time.
 */
export function buildBreadcrumbSegments(
  currentPath: string,
  rootPath: string
): BreadcrumbSegment[] {
  const rootName = rootPath.split("/").pop() ?? rootPath;
  const segments: BreadcrumbSegment[] = [{ label: rootName, path: rootPath }];

  if (currentPath === rootPath) return segments;

  // Strip rootPath prefix to get relative portion
  const relative = currentPath.slice(rootPath.length).replace(/^\//, "");
  const parts = relative.split("/").filter(Boolean);

  let accumulated = rootPath;
  for (const part of parts) {
    accumulated = `${accumulated}/${part}`;
    segments.push({ label: part, path: accumulated });
  }

  return segments;
}

/**
 * Truncate breadcrumb segments from the middle when there are too many.
 * Keeps the root segment and last `tailCount` segments, with "..." in between.
 *
 * @param segments - Full breadcrumb segments
 * @param maxVisible - Maximum number of visible segments (including "...")
 * @returns Segments to render, with a { label: "...", path: "" } placeholder if truncated
 */
export function truncateBreadcrumbs(
  segments: BreadcrumbSegment[],
  maxVisible: number = 4
): BreadcrumbSegment[] {
  if (segments.length <= maxVisible) return segments;

  const tailCount = Math.min(2, maxVisible - 2); // Keep last 1-2 segments
  const head = segments.slice(0, 1); // Root segment
  const tail = segments.slice(-tailCount);

  return [...head, { label: "\u2026", path: "" }, ...tail];
}
```

### 1b. Entry list sub-component

**New file: `src/components/file-browser/file-entry-list.tsx`**

Renders the scrollable list of directory entries. Directories show a `ChevronRight` chevron (matching the left sidebar pattern from `tree-menu/thread-item.tsx`), files show an icon from sub-plan 03.

```tsx
import { ChevronRight } from "lucide-react";
import type { DirEntry } from "@/lib/filesystem-client";
import { getFileIcon } from "./file-icons";

interface FileEntryListProps {
  entries: DirEntry[];
  onNavigate: (entry: DirEntry) => void;
}

export function FileEntryList({ entries, onNavigate }: FileEntryListProps) {
  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-surface-500 text-xs">
        Empty directory
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1 py-1">
      {entries.map((entry) => (
        <button
          key={entry.path}
          type="button"
          onClick={() => onNavigate(entry)}
          className="flex items-center gap-2 w-full px-3 py-1 text-xs text-surface-200 hover:bg-surface-800 cursor-pointer select-none truncate"
        >
          {entry.isDirectory ? (
            <ChevronRight size={12} className="flex-shrink-0 text-surface-400" />
          ) : (
            <img
              src={getFileIcon(entry.name)}
              alt=""
              className="w-4 h-4 flex-shrink-0"
            />
          )}
          <span className="truncate">{entry.name}</span>
        </button>
      ))}
    </div>
  );
}
```

**Notes:**
- `key={entry.path}` — entry paths are unique within a directory and serve as stable keys for a single directory listing. These are not persisted entity keys, so paths are acceptable here.
- Empty directory state per decisions ("handle with sensible defaults").
- Directories use `ChevronRight` from lucide-react at `size={12}` with `text-surface-400` — consistent with the left sidebar tree menu chevron pattern (see `tree-menu/thread-item.tsx`, `tree-menu/plan-item.tsx`).
- Files use `getFileIcon` from sub-plan 03. Icon source type (SVG `<img>` vs inline SVG component) depends on how sub-plan 03 exports icons. If it returns a React component instead of a URL, switch to `<Icon className="w-4 h-4" />`.

---

## Phase 2: FileBrowserPanel shell with directory reading and navigation

**New file: `src/components/file-browser/file-browser-panel.tsx`**

The orchestrator component. Manages state, loads directory contents, handles navigation and keyboard.

### Props

```typescript
export interface FileBrowserPanelProps {
  /** Root directory to browse (worktree path) */
  rootPath: string;
  /** Worktree context for file navigation */
  repoId: string;
  worktreeId: string;
  /** Called when panel should close */
  onClose: () => void;
}
```

### Implementation

```tsx
import { useEffect, useState, useCallback, useRef } from "react";
import { FilesystemClient, type DirEntry } from "@/lib/filesystem-client";
import { navigationService } from "@/stores/navigation-service";
import { logger } from "@/lib/logger-client";
import { sortDirEntries } from "./dir-utils";
import { FileBrowserHeader } from "./file-browser-header";
import { FileEntryList } from "./file-entry-list";
import { FileBrowserError } from "./file-browser-error";

const fsClient = new FilesystemClient();

export function FileBrowserPanel({
  rootPath,
  repoId,
  worktreeId,
  onClose,
}: FileBrowserPanelProps) {
  const [currentPath, setCurrentPath] = useState(rootPath);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);

  // Load directory contents when path or refreshKey changes
  useEffect(() => {
    let cancelled = false;
    setError(null);

    fsClient
      .listDir(currentPath)
      .then((raw) => {
        if (cancelled) return;
        setEntries(sortDirEntries(raw));
      })
      .catch((err) => {
        if (cancelled) return;
        logger.error("[FileBrowserPanel] Failed to list directory:", err);
        setError(String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [currentPath, refreshKey]);

  // Keyboard: Escape closes panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const el = panelRef.current;
    el?.addEventListener("keydown", handleKeyDown);
    return () => el?.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleNavigate = useCallback(
    (entry: DirEntry) => {
      if (entry.isDirectory) {
        setCurrentPath(entry.path);
        return;
      }
      navigationService.navigateToFile(entry.path, { repoId, worktreeId });
    },
    [repoId, worktreeId]
  );

  const handleBreadcrumbNavigate = useCallback(
    (path: string) => {
      if (!path) return; // Truncation placeholder "..." has empty path
      setCurrentPath(path);
    },
    []
  );

  const handleRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  // Error state — matches StalePlanView pattern from stale-plan-view.tsx
  if (error) {
    return (
      <FileBrowserError
        error={error}
        currentPath={currentPath}
        onClose={onClose}
      />
    );
  }

  return (
    <div ref={panelRef} className="flex flex-col h-full" tabIndex={-1}>
      <FileBrowserHeader
        currentPath={currentPath}
        rootPath={rootPath}
        onNavigate={handleBreadcrumbNavigate}
        onRefresh={handleRefresh}
        onClose={onClose}
      />
      <FileEntryList entries={entries} onNavigate={handleNavigate} />
    </div>
  );
}
```

**Key details:**
- `FilesystemClient` is instantiated at module level (same pattern as `src/lib/paths.ts`, `src/lib/agent-service.ts`).
- `DirEntry` type imported from `@/lib/filesystem-client` — already exists, no new type declaration needed.
- `navigationService.navigateToFile` comes from sub-plan 01, imported from `@/stores/navigation-service`.
- No loading spinner per decisions — `listDir` returns in <10ms.
- Panel stays open after file click per decisions.
- `tabIndex={-1}` on the panel div enables keyboard event capture.
- Early return for error state per coding guidelines.

---

## Phase 3: File watcher integration and manual refresh

Modify `src/components/file-browser/file-browser-panel.tsx` to add file watcher integration using the client from sub-plan 02.

### Watcher effect

Add this effect to `FileBrowserPanel`, after the directory-loading effect:

```typescript
import { fileWatcherClient } from "@/lib/file-watcher-client";

// Watch the currently viewed directory for changes
useEffect(() => {
  const watchId = `file-browser-${worktreeId}-${currentPath}`;
  let unlisten: (() => void) | null = null;
  let tornDown = false;

  fileWatcherClient
    .startWatch(watchId, currentPath, false)
    .then(() => {
      if (tornDown) {
        // Cleanup ran before watch started — stop immediately
        fileWatcherClient.stopWatch(watchId);
        return;
      }
      return fileWatcherClient.onEvent(watchId, () => {
        setRefreshKey((k) => k + 1);
      });
    })
    .then((unlistenFn) => {
      if (unlistenFn) unlisten = unlistenFn;
    })
    .catch((err) => {
      // Watcher failure is non-fatal — manual refresh still works
      logger.warn("[FileBrowserPanel] File watcher failed:", err);
    });

  return () => {
    tornDown = true;
    unlisten?.();
    fileWatcherClient.stopWatch(watchId);
  };
}, [currentPath, worktreeId]);
```

**Key behaviors per decisions:**
- Only watches the currently viewed directory (non-recursive: `false` third argument).
- Re-establishes watch when navigating to a different directory (effect re-runs on `currentPath` change).
- `stopWatch` called on directory change and unmount — no leaked watchers.
- Watchers fully torn down when the panel closes (unmount triggers cleanup).
- `tornDown` flag prevents race condition where cleanup runs before the async `startWatch` resolves.
- Watcher failure is non-fatal — logged as warning, manual refresh button still works.
- `watchId` is derived inside the effect, not a dependency — avoids the stale-closure/re-render issue of putting a computed string in the dependency array.
- No visual feedback on refresh per decisions — entries update silently via `refreshKey` increment.

### Manual refresh button

Already wired: `handleRefresh` is passed to `FileBrowserHeader` which renders the refresh icon button (see Phase 4). Clicking it increments `refreshKey` to trigger directory re-read independently of the watcher.

---

## Phase 4: Breadcrumb header with truncation

### 4a. Header sub-component

**New file: `src/components/file-browser/file-browser-header.tsx`**

```tsx
import { RefreshCw, X } from "lucide-react";
import { buildBreadcrumbSegments, truncateBreadcrumbs } from "./dir-utils";

interface FileBrowserHeaderProps {
  currentPath: string;
  rootPath: string;
  onNavigate: (path: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function FileBrowserHeader({
  currentPath,
  rootPath,
  onNavigate,
  onRefresh,
  onClose,
}: FileBrowserHeaderProps) {
  const allSegments = buildBreadcrumbSegments(currentPath, rootPath);
  const segments = truncateBreadcrumbs(allSegments);

  return (
    <div className="flex items-center gap-1 px-3 py-2 border-b border-surface-700 min-h-[36px]">
      {/* Breadcrumb path */}
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden text-xs">
        {segments.map((seg, i) => {
          const isLast = i === segments.length - 1;
          const isPlaceholder = seg.path === "";

          return (
            <span key={seg.path || `ellipsis-${i}`} className="flex items-center gap-1 min-w-0">
              {i > 0 && (
                <span className="text-surface-600 flex-shrink-0">/</span>
              )}
              {isPlaceholder ? (
                <span className="text-surface-500">{seg.label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => onNavigate(seg.path)}
                  className={
                    isLast
                      ? "text-surface-200 truncate"
                      : "text-surface-400 hover:text-surface-200 truncate"
                  }
                  disabled={isLast}
                >
                  {seg.label}
                </button>
              )}
            </span>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={onRefresh}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Refresh directory"
          title="Refresh directory"
        >
          <RefreshCw size={12} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close file browser"
          title="Close file browser"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
```

**Notes:**
- Uses `lucide-react` icons (`RefreshCw`, `X`) — consistent with the rest of the codebase (e.g., `content-pane-header.tsx` uses `X` from lucide-react).
- Button styling matches existing header buttons (see `ContentPaneHeader` pattern: `p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors`).
- Last breadcrumb segment is non-clickable (current directory).
- The `"..."` truncation placeholder has `path: ""` and is rendered as plain text, not a button.
- Root segment always clickable to navigate back to worktree root.

### 4b. Error state sub-component

**New file: `src/components/file-browser/file-browser-error.tsx`**

Follows the `StalePlanView` pattern from `src/components/control-panel/stale-plan-view.tsx`: warning icon, descriptive heading, path info, and a dismiss button.

```tsx
import { AlertTriangle, X } from "lucide-react";

interface FileBrowserErrorProps {
  error: string;
  currentPath: string;
  onClose: () => void;
}

export function FileBrowserError({
  error,
  currentPath,
  onClose,
}: FileBrowserErrorProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Minimal header with close button */}
      <div className="flex items-center justify-end px-3 py-2 border-b border-surface-700">
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close file browser"
        >
          <X size={12} />
        </button>
      </div>

      {/* Error content — matches StalePlanView layout */}
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 rounded-full bg-amber-500/10">
              <AlertTriangle className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h2 className="text-lg font-medium text-surface-100">
                Directory not found
              </h2>
              <p className="text-sm text-surface-400">
                This directory may have been moved or deleted
              </p>
            </div>
          </div>

          <div className="mb-6 p-3 bg-surface-800 rounded-lg border border-surface-700">
            <div className="text-xs text-surface-400 mb-1">Path:</div>
            <code className="text-sm text-surface-200 font-mono break-all">
              {currentPath}
            </code>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-full px-4 py-2.5 text-surface-400 hover:text-surface-200 hover:bg-surface-800 rounded-lg transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## UI Structure (final)

```
┌──────────────────────────┐
│ wt/ > src/ > components/ 🔄 ✕ │  <- FileBrowserHeader: clickable breadcrumbs + refresh + close
│──────────────────────────│
│ › content-pane/                │  <- FileEntryList: chevrons for dirs, file icons for files
│ › tree-menu/                   │
│ › ui/                          │
│   App.tsx                      │
│   main.tsx                     │
└──────────────────────────┘
```

Or, on error:

```
┌──────────────────────────┐
│                        ✕ │
│                          │
│   ⚠ Directory not found │  <- FileBrowserError: matches StalePlanView pattern
│   Path: /some/deleted/..│
│                          │
│        [Close]           │
└──────────────────────────┘
```

---

## Files

| File | Action |
|------|--------|
| `src/components/file-browser/dir-utils.ts` | **New** — pure sorting + breadcrumb functions |
| `src/components/file-browser/file-entry-list.tsx` | **New** — entry list rendering sub-component |
| `src/components/file-browser/file-browser-panel.tsx` | **New** — shell component with state, loading, watcher |
| `src/components/file-browser/file-browser-header.tsx` | **New** — header with breadcrumbs + action buttons |
| `src/components/file-browser/file-browser-error.tsx` | **New** — error state sub-component |

## Verification

After implementation, verify:

1. **TypeScript compiles** — `npx tsc --noEmit` passes.
2. **Unit tests for dir-utils** — `sortDirEntries`, `buildBreadcrumbSegments`, and `truncateBreadcrumbs` should have tests covering edge cases (root path, deeply nested paths, empty segments, single segment).
3. **Manual test** — Open the file browser panel (requires sub-plan 05 integration), navigate into directories, verify breadcrumb truncation, verify error state by deleting a worktree directory while the panel is open.
4. **Watcher test** — Create/delete files in the viewed directory and confirm entries update automatically within ~200ms (debounce window).
5. **Line counts** — Verify no file exceeds 250 lines.
