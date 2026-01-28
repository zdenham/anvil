# Command Palette (Command+P) Implementation Plan

## Overview

Implement a VS Code-style Command+P command palette that allows users to search and navigate through all unarchived threads and plans. The palette will display a preview of the selected item at the bottom (using the same content as the tree menu tooltip previews). This feature will deprecate the existing control panel navigation hotkeys (Alt+Up/Down).

## Key Design Decision: Local Modal, Not Global Window

**The command palette is a modal overlay within the main window webview**, NOT a separate Tauri window or global hotkey system. This means:

- Command+P is handled by a React keyboard listener in the main window
- The palette renders as a fixed-position overlay with backdrop
- No Rust/Tauri changes needed for hotkey registration (purely frontend)
- Works only when the main window is focused (standard modal behavior)
- Simpler implementation, no cross-window complexity

## Current State

### Existing Components to Leverage
- **Thread/Plan preview hooks** - `use-thread-preview.ts` and `use-plan-preview.ts`
- **Entity stores** - Thread and Plan stores with all metadata in memory
- **Content pane navigation** - `useContentPanesStore` for setting active view
- **Existing modal patterns** - Reference existing overlay components for styling

### Components to Deprecate
- Control panel navigation hotkeys (Alt+Up/Down)
- Settings UI in `navigation-hotkey-settings.tsx`
- Related functions in `hotkey-service.ts`:
  - `saveControlPanelNavigationDownHotkey()`
  - `getSavedControlPanelNavigationDownHotkey()`
  - `saveControlPanelNavigationUpHotkey()`
  - `getSavedControlPanelNavigationUpHotkey()`

## Architecture

### Command Palette Flow
```
User presses Command+P (in main window)
    ↓
React keyboard listener catches event
    ↓
Command palette modal opens (fixed overlay in main window webview)
    ↓
User types search query
    ↓
Filter threads/plans by name or preview content
    ↓
Up/Down arrows navigate results
    ↓
Selected item shows preview at bottom
    ↓
Enter updates content pane to selected item
    ↓
Escape closes palette
```

### Data Flow
```
useThreadStore.getAllThreads() ─┐
                                ├─→ Filter by query ─→ Display results
usePlanStore.getAll() ─────────┘                            ↓
                                                    Selected index
                                                            ↓
                                              getPreviewContent() helper
                                                            ↓
                                                    Preview panel
```

## Implementation Steps

### Phase 1: Extract Preview Content Helper

**File:** `src/lib/preview-content.ts` (new)

Extract the preview logic from the hooks into a reusable helper that can be called synchronously with data already available:

```typescript
import type { ThreadMetadata } from "@core/types/threads";
import type { PlanMetadata } from "@core/types/plans";

const MAX_THREAD_PREVIEW_LENGTH = 500;
const MAX_PLAN_PREVIEW_LENGTH = 200;

/**
 * Gets preview content for a thread from its metadata.
 * Returns the last turn's prompt, truncated if necessary.
 */
export function getThreadPreviewContent(thread: ThreadMetadata): string | null {
  if (!thread?.turns?.length) return null;

  const lastTurn = thread.turns[thread.turns.length - 1];
  const prompt = lastTurn?.prompt;

  if (!prompt) return null;

  if (prompt.length > MAX_THREAD_PREVIEW_LENGTH) {
    return prompt.slice(0, MAX_THREAD_PREVIEW_LENGTH) + "...";
  }

  return prompt;
}

/**
 * Gets preview content for a plan.
 * Since plan content is loaded async, this returns the content truncated.
 */
export function getPlanPreviewContent(content: string | null): string | null {
  if (!content) return null;

  if (content.length > MAX_PLAN_PREVIEW_LENGTH) {
    return content.slice(0, MAX_PLAN_PREVIEW_LENGTH) + "...";
  }

  return content;
}

export interface PreviewableItem {
  type: "thread" | "plan";
  id: string;
  name: string;
  preview: string | null;
  updatedAt: number;
  repoId: string;
  worktreeId: string;
}
```

### Phase 2: Update Existing Preview Hooks

**Files:**
- `src/hooks/use-thread-preview.ts`
- `src/hooks/use-plan-preview.ts`

Refactor to use the new shared helper:

```typescript
// use-thread-preview.ts
import { useThreadStore } from "@/entities/threads/store";
import { getThreadPreviewContent } from "@/lib/preview-content";

export function useThreadPreview(threadId: string): string | null {
  const thread = useThreadStore((s) => s.getThread(threadId));
  if (!thread) return null;
  return getThreadPreviewContent(thread);
}
```

```typescript
// use-plan-preview.ts
import { usePlanContent } from "./use-plan-content";
import { getPlanPreviewContent } from "@/lib/preview-content";

export function usePlanPreview(planId: string | null): PlanPreviewResult {
  const { content, isLoading } = usePlanContent(planId);
  return {
    preview: getPlanPreviewContent(content),
    isLoading,
  };
}
```

### Phase 3: Create Command Palette Component

**File:** `src/components/command-palette/command-palette.tsx` (new)

```typescript
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useThreadStore } from "@/entities/threads/store";
import { usePlanStore } from "@/entities/plans/store";
import { usePlanContent } from "@/hooks/use-plan-content";
import { getThreadPreviewContent, getPlanPreviewContent, type PreviewableItem } from "@/lib/preview-content";
import { useContentPanesStore } from "@/stores/content-panes/store";
import { cn } from "@/lib/utils";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get all unarchived threads and plans
  const threads = useThreadStore((s) => s.getAllThreads());
  const plans = usePlanStore((s) => s.getAll());

  // Build searchable items list
  const items: PreviewableItem[] = useMemo(() => {
    const threadItems: PreviewableItem[] = threads
      .filter((t) => t.status !== "archived")
      .map((t) => ({
        type: "thread" as const,
        id: t.id,
        name: t.name ?? "Unnamed Thread",
        preview: getThreadPreviewContent(t),
        updatedAt: t.updatedAt,
        repoId: t.repoId,
        worktreeId: t.worktreeId,
      }));

    const planItems: PreviewableItem[] = plans
      .filter((p) => !p.stale)
      .map((p) => ({
        type: "plan" as const,
        id: p.id,
        name: p.relativePath.replace(/\.md$/, ""),
        preview: null, // Loaded on selection
        updatedAt: p.updatedAt,
        repoId: p.repoId,
        worktreeId: p.worktreeId,
      }));

    // Sort by most recently updated
    return [...threadItems, ...planItems].sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }, [threads, plans]);

  // Filter by query
  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;

    const lowerQuery = query.toLowerCase();
    return items.filter((item) => {
      const nameMatch = item.name.toLowerCase().includes(lowerQuery);
      const previewMatch = item.preview?.toLowerCase().includes(lowerQuery);
      return nameMatch || previewMatch;
    });
  }, [items, query]);

  // Selected item for preview
  const selectedItem = filteredItems[selectedIndex] ?? null;

  // Load plan content for preview when a plan is selected
  const { content: planContent, isLoading: planLoading } = usePlanContent(
    selectedItem?.type === "plan" ? selectedItem.id : null
  );

  // Get preview for selected item
  const selectedPreview = useMemo(() => {
    if (!selectedItem) return null;
    if (selectedItem.type === "thread") {
      return selectedItem.preview;
    }
    return getPlanPreviewContent(planContent);
  }, [selectedItem, planContent]);

  // Reset state when opened
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Keep selectedIndex in bounds
  useEffect(() => {
    if (selectedIndex >= filteredItems.length) {
      setSelectedIndex(Math.max(0, filteredItems.length - 1));
    }
  }, [filteredItems.length, selectedIndex]);

  // Navigate to selected item (updates content pane within main window)
  const setActiveView = useContentPanesStore((s) => s.setActiveView);

  const navigateToItem = useCallback((item: PreviewableItem) => {
    if (item.type === "thread") {
      setActiveView({ type: "thread", threadId: item.id });
    } else {
      setActiveView({ type: "plan", planId: item.id });
    }
    onClose();
  }, [onClose, setActiveView]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, filteredItems.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (selectedItem) {
            navigateToItem(selectedItem);
          }
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, filteredItems.length, selectedItem, navigateToItem, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Palette */}
      <div className="relative w-full max-w-2xl bg-surface-800 rounded-xl shadow-2xl border border-surface-700 overflow-hidden">
        {/* Search input */}
        <div className="p-3 border-b border-surface-700">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search threads and plans..."
            className="w-full bg-transparent text-surface-200 placeholder-surface-500 outline-none text-sm"
            autoFocus
          />
        </div>

        {/* Results list */}
        <div className="max-h-[300px] overflow-y-auto">
          {filteredItems.length === 0 ? (
            <div className="p-4 text-center text-surface-500 text-sm">
              No results found
            </div>
          ) : (
            filteredItems.map((item, index) => (
              <CommandPaletteItem
                key={`${item.type}-${item.id}`}
                item={item}
                isSelected={index === selectedIndex}
                onClick={() => navigateToItem(item)}
                onHover={() => setSelectedIndex(index)}
              />
            ))
          )}
        </div>

        {/* Preview panel */}
        {selectedItem && (
          <div className="border-t border-surface-700 p-3 bg-surface-850">
            <div className="text-xs text-surface-500 mb-1">
              {selectedItem.type === "thread" ? "Thread Preview" : "Plan Preview"}
            </div>
            <div className="text-sm text-surface-300 whitespace-pre-wrap line-clamp-4">
              {selectedItem.type === "plan" && planLoading ? (
                <span className="text-surface-500">Loading...</span>
              ) : (
                selectedPreview ?? <span className="text-surface-500">No preview available</span>
              )}
            </div>
          </div>
        )}

        {/* Footer hints */}
        <div className="border-t border-surface-700 px-3 py-2 flex items-center gap-4 text-xs text-surface-500">
          <span><kbd className="px-1 bg-surface-700 rounded">↑↓</kbd> Navigate</span>
          <span><kbd className="px-1 bg-surface-700 rounded">↵</kbd> Open</span>
          <span><kbd className="px-1 bg-surface-700 rounded">esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}

interface CommandPaletteItemProps {
  item: PreviewableItem;
  isSelected: boolean;
  onClick: () => void;
  onHover: () => void;
}

function CommandPaletteItem({ item, isSelected, onClick, onHover }: CommandPaletteItemProps) {
  return (
    <div
      className={cn(
        "px-3 py-2 cursor-pointer flex items-center gap-3",
        isSelected ? "bg-surface-700" : "hover:bg-surface-750"
      )}
      onClick={onClick}
      onMouseEnter={onHover}
    >
      {/* Type indicator */}
      <div className={cn(
        "w-2 h-2 rounded-full",
        item.type === "thread" ? "bg-accent-500" : "bg-blue-500"
      )} />

      {/* Name */}
      <div className="flex-1 min-w-0">
        <div className="text-sm text-surface-200 truncate">
          {item.name}
        </div>
        {item.preview && (
          <div className="text-xs text-surface-500 truncate">
            {item.preview}
          </div>
        )}
      </div>

      {/* Type label */}
      <div className="text-xs text-surface-500">
        {item.type === "thread" ? "Thread" : "Plan"}
      </div>
    </div>
  );
}
```

**File:** `src/components/command-palette/index.ts` (new)

```typescript
export { CommandPalette } from "./command-palette";
```

### Phase 4: Integrate into Main Window

**File:** `src/components/main-window/main-window-layout.tsx`

Add command palette state and keyboard listener:

```typescript
import { useState, useEffect } from "react";
import { CommandPalette } from "@/components/command-palette";

export function MainWindowLayout() {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Listen for Command+P
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <>
      {/* Existing layout */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />
    </>
  );
}
```

### Phase 5: Deprecate Control Panel Navigation Hotkeys

**File:** `src/components/main-window/settings/navigation-hotkey-settings.tsx`

Add deprecation notice and disable functionality:

```typescript
export function ControlPanelNavigationHotkeySettings() {
  return (
    <SettingsSection
      title="Control Panel Navigation Hotkeys (Deprecated)"
      description="These hotkeys are deprecated. Use Command+P to open the command palette for quick navigation."
    >
      <div className="p-3 bg-yellow-900/20 border border-yellow-700/30 rounded-lg text-sm text-yellow-400">
        <p>
          <strong>Deprecated:</strong> The Alt+Up/Down navigation hotkeys have been replaced
          by the Command Palette (Command+P on Mac, Ctrl+P on Windows/Linux).
        </p>
        <p className="mt-2">
          Press <kbd className="px-1.5 py-0.5 bg-surface-700 rounded">⌘P</kbd> to quickly
          search and navigate to any thread or plan.
        </p>
      </div>
    </SettingsSection>
  );
}
```

**File:** `src/lib/hotkey-service.ts`

Mark deprecated functions:

```typescript
/**
 * @deprecated Use Command+P command palette instead. Will be removed in future version.
 */
export const saveControlPanelNavigationDownHotkey = async (hotkey: string): Promise<void> => {
  // ... existing implementation
};

// ... same for other navigation hotkey functions
```


## File Changes Summary

| File | Change Type | Description |
|------|-------------|-------------|
| `src/lib/preview-content.ts` | Create | Shared preview content helpers |
| `src/hooks/use-thread-preview.ts` | Modify | Use shared helper |
| `src/hooks/use-plan-preview.ts` | Modify | Use shared helper |
| `src/components/command-palette/command-palette.tsx` | Create | Main command palette component |
| `src/components/command-palette/index.ts` | Create | Barrel export |
| `src/lib/hotkey-service.ts` | Modify | Deprecate navigation hotkey functions |
| `src/components/main-window/main-window-layout.tsx` | Modify | Integrate command palette with keyboard listener |
| `src/components/main-window/settings/navigation-hotkey-settings.tsx` | Modify | Add deprecation notice |

**No Rust/Tauri changes required** - the hotkey is handled entirely in the React frontend.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘P` / `Ctrl+P` | Open command palette |
| `↑` / `↓` | Navigate results |
| `Enter` | Open selected item |
| `Escape` | Close palette |

## Future Enhancements (Out of Scope)

- Fuzzy matching (currently substring match)
- Category filtering (e.g., `>` for commands, `@` for threads)
- Recent items section
- Pinned/favorite items
- Actions beyond navigation (archive, delete, etc.)

## Testing Considerations

1. **Unit tests** for `getThreadPreviewContent()` and `getPlanPreviewContent()`
2. **Component tests** for CommandPalette keyboard navigation
3. **Integration tests** for hotkey registration
4. **Edge cases:**
   - Empty results
   - Very long thread/plan names
   - Plans with no content
   - Threads with no turns
   - Special characters in search query
