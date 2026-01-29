# Plan: Change Worktree Navigation from Arrow Keys to Tab/Shift+Tab

## Goal

Change the keyboard navigation for switching worktrees in the spotlight from left/right arrow keys to Tab/Shift+Tab, while keeping arrow keys for the empty state overlay.

---

## Background

### Current Behavior

In `src/components/spotlight/spotlight.tsx`, the worktree navigation currently uses:

1. **Empty state (query is empty):**
   - ArrowLeft/ArrowRight opens the worktree overlay and cycles through worktrees
   - Enter confirms the selection

2. **With query (on a thread result):**
   - ArrowRight cycles forward through worktrees (when cursor is at end)
   - ArrowLeft cycles backward through worktrees (when not on first worktree)

3. **UI hints:**
   - `results-tray.tsx:89`: Shows "← → to change" hint
   - `WorktreeOverlay` component: Displays left/right arrow SVG icons

### Desired Behavior

- **Empty state:** Keep ArrowLeft/ArrowRight for opening overlay and cycling (matches the visual arrows in the overlay)
- **With query (typing):** Use Tab (forward) and Shift+Tab (backward) to cycle worktrees
- **UI hints:** Update "← → to change" to "Tab to change"

---

## Implementation

### Step 1: Add Tab/Shift+Tab Handlers for Worktree Cycling (with query)

Add new case handlers for "Tab" key to handle worktree cycling when there's a query entered.

**Location:** `src/components/spotlight/spotlight.tsx` (inside the `switch (e.key)` block, around line 1104)

**Add new Tab handler:**

```typescript
case "Tab": {
  // Only cycle worktrees when we have a query and multiple worktrees
  const currentResult = displayResults[selectedIndex];
  if (currentResult?.type === "thread" && repoWorktrees.length > 1) {
    e.preventDefault();
    if (e.shiftKey) {
      // Shift+Tab = cycle backward
      setState((prev) => ({
        ...prev,
        selectedWorktreeIndex:
          prev.selectedWorktreeIndex > 0
            ? prev.selectedWorktreeIndex - 1
            : prev.repoWorktrees.length - 1,
      }));
    } else {
      // Tab = cycle forward
      setState((prev) => ({
        ...prev,
        selectedWorktreeIndex:
          (prev.selectedWorktreeIndex + 1) % prev.repoWorktrees.length,
      }));
    }
  }
  // If not on a thread result or only one worktree, let Tab behave normally (or do nothing)
  break;
}
```

### Step 2: Remove Worktree Cycling from ArrowRight/ArrowLeft (with query)

Modify the existing ArrowRight and ArrowLeft handlers to **only** handle the empty state, removing the worktree cycling logic for when there's a query.

**ArrowRight handler changes (lines 1148-1184):**

Keep only the empty query logic, remove the "with query" worktree cycling:

```typescript
case "ArrowRight": {
  const isQueryEmpty = query.trim() === "";

  // Show overlay and cycle worktrees when query is empty
  if (isQueryEmpty && repoWorktrees.length >= 1) {
    e.preventDefault();
    setState((s) => {
      // First press just opens the overlay, subsequent presses cycle
      const shouldCycle = s.worktreeOverlayVisible && s.repoWorktrees.length > 1;
      return {
        ...s,
        worktreeOverlayVisible: true,
        selectedWorktreeIndex: shouldCycle
          ? (s.selectedWorktreeIndex + 1) % s.repoWorktrees.length
          : s.selectedWorktreeIndex,
      };
    });
  }
  // When query is not empty, let default cursor behavior happen
  break;
}
```

**ArrowLeft handler changes (lines 1186-1223):**

Keep only the empty query logic:

```typescript
case "ArrowLeft": {
  const isQueryEmptyLeft = query.trim() === "";

  // Show overlay and cycle worktrees when query is empty
  if (isQueryEmptyLeft && repoWorktrees.length >= 1) {
    e.preventDefault();
    setState((s) => {
      // First press just opens the overlay, subsequent presses cycle
      const shouldCycle = s.worktreeOverlayVisible && s.repoWorktrees.length > 1;
      return {
        ...s,
        worktreeOverlayVisible: true,
        selectedWorktreeIndex: shouldCycle
          ? (s.selectedWorktreeIndex > 0
              ? s.selectedWorktreeIndex - 1
              : s.repoWorktrees.length - 1)
          : s.selectedWorktreeIndex,
      };
    });
  }
  // When query is not empty, let default cursor behavior happen
  break;
}
```

### Step 3: Update UI Hint Text

Change the hint from arrow keys to Tab.

**Location:** `src/components/spotlight/results-tray.tsx:89`

**Current:**
```typescript
const hint = repoWorktrees.length > 1 ? " · ← → to change" : "";
```

**Updated:**
```typescript
const hint = repoWorktrees.length > 1 ? " · Tab to change" : "";
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/spotlight/spotlight.tsx` | Add Tab handler, simplify ArrowLeft/ArrowRight to empty state only |
| `src/components/spotlight/results-tray.tsx` | Update hint text from "← → to change" to "Tab to change" |

---

## Summary of Behavior After Changes

| State | Key | Action |
|-------|-----|--------|
| Empty query | ArrowRight | Open overlay, cycle worktrees forward |
| Empty query | ArrowLeft | Open overlay, cycle worktrees backward |
| Empty query | Enter | Confirm worktree selection, dismiss overlay |
| With query | Tab | Cycle worktrees forward |
| With query | Shift+Tab | Cycle worktrees backward |
| With query | ArrowRight | Move cursor right (default behavior) |
| With query | ArrowLeft | Move cursor left (default behavior) |

---

## Testing Checklist

1. [ ] **Empty state navigation (unchanged):**
   - Open spotlight with empty input
   - Press ArrowRight - overlay should appear, cycle forward
   - Press ArrowLeft - should cycle backward
   - Press Enter - should confirm selection

2. [ ] **Tab navigation with query:**
   - Type a query to see "Create thread" result
   - Press Tab - should cycle worktree forward
   - Press Shift+Tab - should cycle worktree backward
   - Verify worktree indicator updates

3. [ ] **Arrow keys with query (cursor movement):**
   - Type a query
   - Press ArrowLeft/ArrowRight - cursor should move normally
   - Should NOT cycle worktrees

4. [ ] **UI hint:**
   - With multiple worktrees, hint should show "Tab to change"
   - With single worktree, no hint should appear

5. [ ] **Edge cases:**
   - Single worktree: Tab should do nothing (or default browser behavior)
   - No worktrees: Tab should do nothing

---

## Notes

- The WorktreeOverlay component still shows arrow icons, which is appropriate since it's shown in the empty state where arrows are still used
- Tab is a natural choice for cycling through options and doesn't conflict with text input
- Shift+Tab for reverse cycling follows standard keyboard conventions
