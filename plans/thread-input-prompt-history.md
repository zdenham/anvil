# Thread Input Prompt History Cycling

## Overview

Add up/down arrow key navigation for cycling through previous prompts in the main thread/plan input (`ThreadInput` component), matching the Spotlight's behavior. This feature activates when the input is focused and conditions are met.

**Note:** This feature is for the main thread input, not the quick actions panel. The quick actions panel is transitioning to left/right arrow navigation for action selection, which frees up the up/down arrows for this prompt history cycling feature in the thread input.

## Background

The quick actions UI is transitioning from vertical (up/down) to horizontal (left/right) arrow navigation for action selection. Once that change is implemented, up/down arrows in the thread input will no longer need to navigate to the quick actions panel, freeing them for prompt history cycling.

## Reference Implementation: Spotlight

The Spotlight already implements this feature in:
- **Hook**: `src/components/spotlight/use-spotlight-history.ts`
- **Keyboard handler**: `src/components/spotlight/spotlight.tsx` (lines 1131-1170)
- **Cursor detection**: `src/lib/cursor-boundary.ts`

### Key Spotlight Behavior

**ArrowUp triggers history navigation when:**
```typescript
// spotlight.tsx line 1153
if (!query.trim() || isInHistoryMode) {
  const handled = await handleHistoryNavigation("up");
  // ...
}
```

**ArrowDown continues history navigation when:**
```typescript
// spotlight.tsx line 1133
if (isInHistoryMode) {
  const handled = await handleHistoryNavigation("down");
  // ...
}
```

**Cursor position is moved to end after history selection:**
```typescript
// spotlight.tsx line 631-634
requestAnimationFrame(() => {
  inputRef.current?.setCursorPosition(newQuery.length);
});
```

## Current ThreadInput Behavior

**File**: `src/components/reusable/thread-input.tsx`

Current up/down arrow handling (lines 55-102):
- Checks `triggerState?.isActive` to avoid interfering with @ mentions
- Uses `CursorBoundary.isOnTopRow()` and `CursorBoundary.isOnBottomRow()` for multi-line input handling
- Propagates to quick actions panel when input is empty OR cursor is on edge row

## Implementation Plan

### Phase 1: Create Reusable History Hook

**Create**: `src/hooks/use-prompt-history.ts`

Extract and generalize the history logic from `use-spotlight-history.ts`:

```typescript
import { useState, useCallback, useRef } from "react";
import {
  promptHistoryService,
  PromptHistoryEntry,
} from "@/lib/prompt-history-service";

interface UsePromptHistoryOptions {
  onQueryChange: (query: string) => void;
}

interface UsePromptHistoryResult {
  historyIndex: number | null;
  handleHistoryNavigation: (direction: "up" | "down") => Promise<boolean>;
  resetHistory: () => void;
  isInHistoryMode: boolean;
}

export function usePromptHistory(
  options: UsePromptHistoryOptions
): UsePromptHistoryResult {
  const { onQueryChange } = options;

  // null = not browsing history, 0+ = browsing (0 = most recent)
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  // Cache history entries to avoid repeated async calls during navigation
  const historyCache = useRef<PromptHistoryEntry[]>([]);
  const historyCacheValid = useRef(false);

  const loadHistory = useCallback(async () => {
    if (!historyCacheValid.current) {
      historyCache.current = await promptHistoryService.getAll();
      historyCacheValid.current = true;
    }
    return historyCache.current;
  }, []);

  const handleHistoryNavigation = useCallback(
    async (direction: "up" | "down"): Promise<boolean> => {
      const entries = await loadHistory();

      if (entries.length === 0) {
        return false;
      }

      if (direction === "up") {
        if (historyIndex === null) {
          // Start browsing history - set first entry as query
          setHistoryIndex(0);
          onQueryChange(entries[0].prompt);
          return true;
        }

        // Already in history mode - cycle to next older entry
        const nextIndex = historyIndex + 1;
        if (nextIndex < entries.length) {
          setHistoryIndex(nextIndex);
          onQueryChange(entries[nextIndex].prompt);
          return true;
        }
        // At oldest entry, don't cycle further
        return true;
      }

      if (direction === "down") {
        if (historyIndex === null) {
          return false;
        }

        // Cycle to newer entry
        const nextIndex = historyIndex - 1;
        if (nextIndex >= 0) {
          setHistoryIndex(nextIndex);
          onQueryChange(entries[nextIndex].prompt);
          return true;
        } else {
          // Down from newest entry - exit history mode and clear
          setHistoryIndex(null);
          onQueryChange("");
          return true;
        }
      }

      return false;
    },
    [historyIndex, loadHistory, onQueryChange]
  );

  const resetHistory = useCallback(() => {
    setHistoryIndex(null);
    historyCacheValid.current = false;
  }, []);

  return {
    historyIndex,
    handleHistoryNavigation,
    resetHistory,
    isInHistoryMode: historyIndex !== null,
  };
}
```

### Phase 2: Update ThreadInput Component

**Modify**: `src/components/reusable/thread-input.tsx`

#### 2.1 Add history hook

```typescript
import { usePromptHistory } from "@/hooks/use-prompt-history";

// Inside ThreadInput component:
const { handleHistoryNavigation, resetHistory, isInHistoryMode } = usePromptHistory({
  onQueryChange: (query: string) => {
    setValue(query);
    // Move cursor to end after history selection
    requestAnimationFrame(() => {
      const textarea = inputRef.current?.getTextarea?.();
      if (textarea) {
        CursorBoundary.moveToEnd(textarea);
      }
    });
  },
});
```

#### 2.2 Expose textarea ref from TriggerSearchInput

The `TriggerSearchInput` component may need to expose the underlying textarea element for cursor positioning. Check if `inputRef.current` provides access to the textarea, or add a method to the `TriggerSearchInputRef` interface:

```typescript
// In trigger-search-input.tsx types
export interface TriggerSearchInputRef {
  focus: () => void;
  blur: () => void;
  getTextarea: () => HTMLTextAreaElement | null;
  // ... existing methods
}
```

#### 2.3 Update handleKeyDown

Replace the existing up/down arrow handling with history-aware logic:

```typescript
const handleKeyDown = useCallback(
  async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter submits (unchanged)
    if (e.key === "Enter" && !e.shiftKey && !triggerState?.isActive && value.trim()) {
      e.preventDefault();
      e.stopPropagation();
      handleSubmit();
      return;
    }

    // Handle arrow keys
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !triggerState?.isActive) {
      const textarea = e.target as HTMLTextAreaElement;
      const isEmpty = value.trim() === "";

      // === HISTORY NAVIGATION LOGIC (follows spotlight pattern) ===

      if (e.key === "ArrowUp") {
        // Condition: empty input OR already in history mode OR on first line
        const onTopRow = CursorBoundary.isOnTopRow(textarea);

        if (isEmpty || isInHistoryMode || onTopRow) {
          const handled = await handleHistoryNavigation("up");
          if (handled) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
      }

      if (e.key === "ArrowDown") {
        // Only cycle down if already in history mode
        if (isInHistoryMode) {
          const handled = await handleHistoryNavigation("down");
          if (handled) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }

        // If not in history mode, let default behavior handle cursor movement
        // (no longer navigating to quick actions panel - that uses left/right arrows now)
      }

      // Input has content and cursor is in the middle - let textarea handle naturally
      e.stopPropagation();
      return;
    }

    // Note: Other keys handled by TriggerSearchInput when trigger is active
  },
  [handleSubmit, triggerState?.isActive, value, isInHistoryMode, handleHistoryNavigation]
);
```

#### 2.4 Reset history on typing

Add history reset when user types:

```typescript
// In the onChange handler or as an effect
const handleChange = useCallback((newValue: string) => {
  setValue(newValue);
  // Reset history mode when user types
  resetHistory();
}, [resetHistory]);

// Update TriggerSearchInput onChange
<TriggerSearchInput
  value={value}
  onChange={handleChange}  // Use new handler
  // ...
/>
```

### Phase 3: Remove Up/Down Quick Actions Navigation

Once quick actions uses left/right arrows for selection navigation (per `plans/quick-actions-sdk/09-ui-components.md`), remove the `onNavigateToQuickActions` callback that was triggered by up/down arrows:

- **Before**: ArrowUp from input → navigate to quick actions panel
- **After**: ArrowUp from input → cycle prompt history (no panel focus transfer)

The quick actions panel will be navigated using left/right arrows exclusively.

### Phase 4: Acceptance Criteria

- [ ] ArrowUp with empty input starts history cycling (most recent first)
- [ ] ArrowUp in history mode goes to older prompts
- [ ] ArrowDown in history mode goes to newer prompts
- [ ] ArrowDown from newest entry exits history mode and clears input
- [ ] Typing any character resets history mode
- [ ] Cursor moves to end of text after selecting from history
- [ ] History navigation respects cursor position checks (top row only for ArrowUp when input has content)
- [ ] History works independently of @ mention trigger state
- [ ] History shares the same `prompt-history-service` as Spotlight

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/hooks/use-prompt-history.ts` | Create | Reusable history navigation hook |
| `src/components/reusable/thread-input.tsx` | Modify | Add history cycling logic |
| `src/components/reusable/trigger-search-input.tsx` | Modify (if needed) | Expose textarea ref for cursor control |

## Cursor Position Checks Reference

From `src/lib/cursor-boundary.ts`:

| Method | Use Case |
|--------|----------|
| `CursorBoundary.isOnTopRow(textarea)` | ArrowUp should trigger history only when cursor is on top visual row |
| `CursorBoundary.isOnBottomRow(textarea)` | ArrowDown behavior at bottom of multi-line input |
| `CursorBoundary.moveToEnd(textarea)` | Position cursor after selecting history item |
| `CursorBoundary.isEmpty(textarea)` | Quick check for empty input |

## History State Flow

```
Initial State: historyIndex = null (not in history mode)

[Empty input] + ArrowUp
  → historyIndex = 0, shows most recent prompt

[In history mode] + ArrowUp
  → historyIndex++, shows older prompt (stops at oldest)

[In history mode] + ArrowDown
  → historyIndex--, shows newer prompt

[historyIndex = 0] + ArrowDown
  → historyIndex = null, clears input, exits history mode

[Any typing]
  → resetHistory(), historyIndex = null
```

## Dependencies

- `src/lib/prompt-history-service.ts` - Already exists, used by Spotlight
- `src/lib/cursor-boundary.ts` - Already exists, provides cursor position utilities

## Testing Considerations

1. **Empty input**: ArrowUp should start history, ArrowDown should do nothing
2. **Multi-line input**: ArrowUp should only trigger history on top row
3. **With @ trigger active**: Arrow keys should not trigger history (handled by trigger dropdown)
4. **History wrapping**: Verify oldest/newest entry boundaries work correctly
5. **Quick typing**: Reset behavior should be reliable during fast input

## Optional: Refactor Spotlight to Use Shared Hook

After implementing `use-prompt-history.ts`, consider refactoring `use-spotlight-history.ts` to use the shared hook, adding only Spotlight-specific logic (like `onHistoryResults` for showing history in results panel).
