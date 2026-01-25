# Worktree Overlay Display Plan

## Overview

When the spotlight input is empty and the user presses the right arrow key, display a centered overlay showing the currently selected worktree. Successive arrow presses should cycle through worktrees. The overlay should disappear after 750ms of inactivity OR when the user starts typing.

## Current Behavior

- Arrow right/left cycling **only works** when a thread result is selected AND cursor is at text end
- The current worktree is shown in the ResultsTray subtitle: `repo-name/worktree-name · ← → to change`
- `selectedWorktreeIndex` tracks position in the flat MRU list `repoWorktrees`

## Proposed Changes

### 1. New State Variables

Add to `SpotlightState`:
```typescript
worktreeOverlayVisible: boolean;  // Whether overlay is currently shown
```

Add a ref for the timeout:
```typescript
const overlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

### 2. New Component: WorktreeOverlay

Create a new component (inline or extracted) that renders a centered overlay:

```tsx
function WorktreeOverlay({
  visible,
  repoWorktrees,
  selectedIndex
}: {
  visible: boolean;
  repoWorktrees: RepoWorktree[];
  selectedIndex: number;
}) {
  if (!visible || repoWorktrees.length === 0) return null;

  const selected = repoWorktrees[selectedIndex];
  const hasMultipleRepos = new Set(repoWorktrees.map(w => w.repoName)).size > 1;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-50">
      <div className="bg-surface-800/95 backdrop-blur-md rounded-lg px-6 py-4 shadow-xl border border-surface-600/50">
        <div className="flex items-center gap-3 text-lg">
          <GitBranch className="w-5 h-5 text-text-secondary" />
          <span className="text-text-primary font-medium">
            {hasMultipleRepos
              ? `${selected.repoName}/${selected.worktree.name}`
              : selected.worktree.name
            }
          </span>
        </div>
        {repoWorktrees.length > 1 && (
          <div className="text-xs text-text-tertiary text-center mt-2">
            {selectedIndex + 1} of {repoWorktrees.length}
          </div>
        )}
      </div>
    </div>
  );
}
```

### 3. Modify Arrow Key Handling

Update the keyboard event handler to handle the **empty query** case:

```typescript
// ArrowRight handling (around line 960-978)
if (e.key === "ArrowRight") {
  const isQueryEmpty = state.query.trim() === "";

  if (isQueryEmpty && state.repoWorktrees.length >= 1) {
    // Show overlay (and cycle worktrees if multiple exist)
    e.preventDefault();

    setState((s) => ({
      ...s,
      worktreeOverlayVisible: true,
      selectedWorktreeIndex: s.repoWorktrees.length > 1
        ? (s.selectedWorktreeIndex + 1) % s.repoWorktrees.length
        : s.selectedWorktreeIndex,  // Don't cycle if only one worktree
    }));

    // Reset the 750ms timeout
    resetOverlayTimeout();
    return;
  }

  // Existing behavior: cycle when thread result selected and cursor at end
  // ... existing code ...
}

// ArrowLeft handling (around line 979-996)
if (e.key === "ArrowLeft") {
  const isQueryEmpty = state.query.trim() === "";

  if (isQueryEmpty && state.repoWorktrees.length >= 1) {
    e.preventDefault();

    setState((s) => ({
      ...s,
      worktreeOverlayVisible: true,
      selectedWorktreeIndex: s.repoWorktrees.length > 1
        ? (s.selectedWorktreeIndex > 0
            ? s.selectedWorktreeIndex - 1
            : s.repoWorktrees.length - 1)  // Wrap around to end
        : s.selectedWorktreeIndex,  // Don't cycle if only one worktree
    }));

    // Reset the 750ms timeout
    resetOverlayTimeout();
    return;
  }

  // Existing behavior...
}
```

### 4. Timeout Management

Add helper function to manage the overlay timeout:

```typescript
const resetOverlayTimeout = useCallback(() => {
  // Clear existing timeout
  if (overlayTimeoutRef.current) {
    clearTimeout(overlayTimeoutRef.current);
  }

  // Set new 750ms timeout
  overlayTimeoutRef.current = setTimeout(() => {
    setState((s) => ({ ...s, worktreeOverlayVisible: false }));
  }, 750);
}, []);
```

### 5. Dismiss on Typing

Add logic to hide overlay when user types:

```typescript
// In the input's onChange handler or a useEffect watching query
useEffect(() => {
  if (state.query.length > 0 && state.worktreeOverlayVisible) {
    // Clear timeout and hide immediately
    if (overlayTimeoutRef.current) {
      clearTimeout(overlayTimeoutRef.current);
      overlayTimeoutRef.current = null;
    }
    setState((s) => ({ ...s, worktreeOverlayVisible: false }));
  }
}, [state.query]);
```

### 6. Cleanup

Clear timeout on unmount and when spotlight is hidden:

```typescript
// In existing cleanup effect
useEffect(() => {
  return () => {
    if (overlayTimeoutRef.current) {
      clearTimeout(overlayTimeoutRef.current);
    }
  };
}, []);

// In resetState function
const resetState = () => {
  if (overlayTimeoutRef.current) {
    clearTimeout(overlayTimeoutRef.current);
    overlayTimeoutRef.current = null;
  }
  setState({
    // ... existing reset values
    worktreeOverlayVisible: false,
  });
};
```

### 7. Render the Overlay

Add the overlay component to the JSX, positioned within the spotlight container:

```tsx
return (
  <div className="spotlight-container relative">
    {/* Existing spotlight content */}
    <TriggerSearchInput ... />
    <ResultsTray ... />

    {/* New overlay */}
    <WorktreeOverlay
      visible={state.worktreeOverlayVisible}
      repoWorktrees={state.repoWorktrees}
      selectedIndex={state.selectedWorktreeIndex}
    />
  </div>
);
```

## Implementation Order

1. Add `worktreeOverlayVisible` to state and `overlayTimeoutRef`
2. Create the `WorktreeOverlay` component
3. Update `resetState` to include new state and cleanup
4. Add the timeout management helper (`resetOverlayTimeout`)
5. Modify ArrowRight handler for empty query case
6. Modify ArrowLeft handler for empty query case
7. Add useEffect to dismiss overlay on typing
8. Add cleanup on unmount
9. Render the overlay in the JSX

## Edge Cases

- **Single worktree**: Show overlay with current worktree info, but don't cycle (no index change). Let the 750ms timeout hide it naturally.
- **No worktrees**: Guard against empty `repoWorktrees` array (don't show overlay)
- **Rapid cycling**: Each arrow press resets the 750ms timer
- **Paste text**: Should also dismiss overlay (handled by query change effect)
- **Focus loss**: Overlay should hide when spotlight loses focus (handled by existing panel-hidden logic)

## Testing

1. Open spotlight with empty input
2. Press right arrow - overlay should appear showing current worktree
3. Press right arrow again within 750ms - should cycle to next worktree, timer resets
4. Wait 750ms - overlay should disappear
5. Press right arrow again - overlay reappears
6. Start typing - overlay should immediately disappear
7. Test left arrow with same expectations (with wrap-around)
