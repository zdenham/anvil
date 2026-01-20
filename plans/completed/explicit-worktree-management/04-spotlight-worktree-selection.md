# Sub-Plan 4: Spotlight Worktree Selection

## Prerequisites
- **Sub-Plan 2 (Tauri Commands and Frontend Service)** must be complete

## Parallel Execution
Can run **in parallel with Sub-Plan 3** (Worktrees Tab) after Sub-Plan 2 completes.

## Overview
Add worktree selection to the spotlight when creating tasks. Users can cycle through available worktrees using the right arrow key.

---

## Part A: Update Types

### File: `src/components/spotlight/types.ts`

Extend `TaskResult` to include selected worktree:

```typescript
export interface TaskResult {
  query: string;
  selectedWorktree?: {
    path: string;
    name: string;
  };
}
```

Or wherever the task creation result is typed, add the worktree selection.

---

## Part B: Spotlight State

### File: `src/components/spotlight/spotlight.tsx`

1. Add state for worktree cycling:

```typescript
const [selectedWorktreeIndex, setSelectedWorktreeIndex] = useState<number>(0);
const [availableWorktrees, setAvailableWorktrees] = useState<WorktreeState[]>([]);
```

2. Load available worktrees when spotlight opens or when a repository is selected:

```typescript
useEffect(() => {
  const loadWorktrees = async () => {
    // Get the currently selected repository (match existing pattern)
    const repo = getSelectedRepository(); // or however this is accessed
    if (repo) {
      try {
        const worktrees = await worktreeService.list(repo.name);
        setAvailableWorktrees(worktrees);
        setSelectedWorktreeIndex(0); // Reset to first (most recent)
      } catch (err) {
        console.error("Failed to load worktrees:", err);
        setAvailableWorktrees([]);
      }
    }
  };
  loadWorktrees();
}, [/* dependency for when spotlight opens or repo changes */]);
```

3. Reset worktree selection when spotlight closes or query changes significantly.

---

## Part C: Keyboard Navigation

### File: `src/components/spotlight/spotlight.tsx`

Add right arrow handler for worktree cycling in the existing key handler:

```typescript
case "ArrowRight":
  // Only cycle worktrees when on a task result and worktrees exist
  if (isOnTaskResult() && availableWorktrees.length > 0) {
    e.preventDefault();
    setSelectedWorktreeIndex((prev) =>
      (prev + 1) % availableWorktrees.length
    );
  }
  break;

case "ArrowLeft":
  // Cycle backwards through worktrees
  if (isOnTaskResult() && availableWorktrees.length > 0) {
    e.preventDefault();
    setSelectedWorktreeIndex((prev) =>
      (prev - 1 + availableWorktrees.length) % availableWorktrees.length
    );
  }
  break;
```

---

## Part D: Display Selected Worktree

### File: `src/components/spotlight/results-tray.tsx` (or equivalent)

Update the task result display to show selected worktree:

```typescript
function getTaskResultDisplay(result: TaskResult, availableWorktrees: WorktreeState[], selectedIndex: number) {
  const selectedWorktree = availableWorktrees[selectedIndex];

  return {
    icon: <MortLogo size={7} />,
    title: "Create task",
    subtitle: selectedWorktree
      ? `Worktree: ${selectedWorktree.name} (← → to change)`
      : availableWorktrees.length === 0
        ? "No worktrees - create one in Worktrees tab"
        : "Select worktree",
  };
}
```

Consider showing visual indicator:
- Current worktree name prominently displayed
- Small dots or pagination indicator showing position in list
- Hint text showing arrow key navigation

---

## Part E: Pass Worktree to Task Creation

When the user confirms task creation (Enter/Cmd+Enter), include the selected worktree:

```typescript
const handleConfirmTask = async () => {
  const selectedWorktree = availableWorktrees[selectedWorktreeIndex];

  if (!selectedWorktree) {
    // Show error - no worktree selected
    setError("Please create a worktree first in the Worktrees tab");
    return;
  }

  await createTask({
    prompt: query,
    repository: selectedRepo,
    worktreePath: selectedWorktree.path,
  });
};
```

---

## Edge Cases to Handle

1. **No worktrees available**
   - Show message directing user to Worktrees tab
   - Disable task creation until worktree exists

2. **Single worktree**
   - Auto-select it
   - Still show which worktree will be used
   - Arrow keys do nothing (or show "only worktree" indicator)

3. **Worktrees loaded async**
   - Show loading state briefly if needed
   - Default to first worktree once loaded

4. **Repository changes**
   - Reload worktrees for new repo
   - Reset selection index to 0

---

## Verification Steps

1. Update `types.ts` with worktree selection
2. Add worktree state and loading to spotlight
3. Add arrow key handlers
4. Update results display to show selected worktree
5. Wire up task creation to include worktreePath
6. TypeScript compile: `pnpm tsc --noEmit`
7. Manual testing:
   - Open spotlight
   - Type a task prompt
   - Verify worktree name shown
   - Press right arrow - worktree cycles
   - Press left arrow - cycles backwards
   - Create task - verify worktreePath is passed

## Success Criteria
- Spotlight shows current worktree name for task results
- Right/left arrow keys cycle through worktrees
- Visual feedback shows which worktree is selected
- Task creation includes `worktreePath` from selection
- Graceful handling when no worktrees exist
