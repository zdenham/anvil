# Quick Action Intermediate Screen

## Problem

Currently, after performing a quick action (archive, markUnread), the app immediately navigates to the next unread thread. This is too presumptuous - users may want to:
- Take a moment before moving on
- Choose what to do next (not always the next unread item)
- See confirmation of their action before proceeding

## Current Behavior

1. User performs quick action (archive/markUnread)
2. Action executes (e.g., `threadService.archive()`)
3. `navigateToNextItemOrFallback()` immediately finds and navigates to the next unread item
4. If no unread items, shows "all caught up" banner and closes/shows empty state

**Files involved:**
- `src/components/control-panel/control-panel-window.tsx:531-559` - Quick action handler
- `src/hooks/use-navigate-to-next-item.ts` - Navigation logic after action
- `src/hooks/use-unified-inbox-navigation.ts` - Finds next unread item

## Proposed Behavior

1. User performs quick action (archive/markUnread)
2. Action executes
3. App navigates to **new intermediate screen** instead of next item
4. Intermediate screen shows:
   - Confirmation of completed action
   - Option to "Continue to next unread" (press Enter)
   - Other actionable options (TBD)
5. User presses Enter or selects option to proceed

## Design

### Intermediate Screen Content

```
┌─────────────────────────────────────────────────┐
│                                                 │
│           ✓ Thread archived                     │
│                                                 │
│   ┌─────────────────────────────────────────┐   │
│   │  ↵  Continue to next unread             │   │  ← Primary action (Enter)
│   └─────────────────────────────────────────┘   │
│                                                 │
│   ┌─────────────────────────────────────────┐   │
│   │  ⌘N  Start a new thread                 │   │  ← Secondary option
│   └─────────────────────────────────────────┘   │
│                                                 │
│   ┌─────────────────────────────────────────┐   │
│   │  Esc  Close panel                       │   │
│   └─────────────────────────────────────────┘   │
│                                                 │
│   "3 unread items remaining"                    │  ← Status indicator
│                                                 │
└─────────────────────────────────────────────────┘
```

### Alternative when all caught up:

```
┌─────────────────────────────────────────────────┐
│                                                 │
│           ✓ Thread archived                     │
│                                                 │
│           All caught up!                        │
│                                                 │
│   ┌─────────────────────────────────────────┐   │
│   │  ⌘N  Start a new thread                 │   │
│   └─────────────────────────────────────────┘   │
│                                                 │
│   ┌─────────────────────────────────────────┐   │
│   │  Esc  Close panel                       │   │
│   └─────────────────────────────────────────┘   │
│                                                 │
└─────────────────────────────────────────────────┘
```

## Implementation Plan

### Step 1: Create New Content Pane View Type

Add a new view type to represent the intermediate screen.

**File: `src/components/content-pane/types.ts`**

Add to the `ContentPaneView` union type:
```typescript
| {
    type: "quick-action-complete";
    completedAction: "archive" | "markUnread";
    previousItemType: "thread" | "plan";
    previousItemId: string;
  }
```

### Step 2: Create Intermediate Screen Component

**File: `src/components/content-pane/quick-action-complete-view.tsx`** (new)

Component should:
- Display confirmation message based on `completedAction`
- Show unread count from unified inbox
- Render action options with keyboard shortcuts
- Handle keyboard navigation (Enter, Cmd+N, Esc)
- Use existing `useUnifiedInboxNavigation` to get next item and counts

```typescript
interface QuickActionCompleteViewProps {
  completedAction: "archive" | "markUnread";
  previousItemType: "thread" | "plan";
  previousItemId: string;
}

export function QuickActionCompleteView({
  completedAction,
  previousItemType,
  previousItemId,
}: QuickActionCompleteViewProps) {
  const { getNextUnreadItem } = useUnifiedInboxNavigation();
  const { navigateToThread, navigateToPlan } = useContextAwareNavigation();

  // Get next item info
  const nextItem = getNextUnreadItem({ type: previousItemType, id: previousItemId });
  const hasNextItem = nextItem !== null;

  // Get unread count for display
  const unreadCount = useUnreadCount(); // New hook or derive from stores

  // Keyboard handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && hasNextItem) {
        // Navigate to next unread
        if (nextItem.type === "thread") {
          navigateToThread(nextItem.id);
        } else {
          navigateToPlan(nextItem.id);
        }
      } else if (e.key === "n" && e.metaKey) {
        // Create new thread
        // ... existing new thread logic
      } else if (e.key === "Escape") {
        // Close panel
        // ... close panel logic
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasNextItem, nextItem, navigateToThread, navigateToPlan]);

  return (
    // Render UI as shown in design
  );
}
```

### Step 3: Update Content Pane to Render New View

**File: `src/components/content-pane/content-pane.tsx`**

Add case for new view type:
```typescript
case "quick-action-complete":
  return (
    <QuickActionCompleteView
      completedAction={view.completedAction}
      previousItemType={view.previousItemType}
      previousItemId={view.previousItemId}
    />
  );
```

### Step 4: Update Quick Action Handler

**File: `src/components/control-panel/control-panel-window.tsx`**

Modify `handleQuickAction` to navigate to intermediate screen instead of next item:

```typescript
const handleQuickAction = useCallback(async (action: ActionType) => {
  const currentItem = { type: "thread" as const, id: threadId };

  if (action === "archive") {
    await threadService.archive(threadId, instanceId);
    // NEW: Navigate to intermediate screen instead of next item
    await contentPanesService.setActivePaneView({
      type: "quick-action-complete",
      completedAction: "archive",
      previousItemType: "thread",
      previousItemId: threadId,
    });
  } else if (action === "markUnread") {
    await useThreadStore.getState().markThreadAsUnread(threadId);
    await contentPanesService.setActivePaneView({
      type: "quick-action-complete",
      completedAction: "markUnread",
      previousItemType: "thread",
      previousItemId: threadId,
    });
  }
  // ... rest of handler
}, [...]);
```

### Step 5: Update Plan View Quick Action Handler

**File: `src/components/control-panel/plan-view.tsx`**

Apply same changes to plan quick action handler (lines 191-215).

### Step 6: Create Unread Count Hook (Optional)

**File: `src/hooks/use-unread-count.ts`** (new)

```typescript
export function useUnreadCount() {
  const threads = useThreadStore((s) => Object.values(s.threads));
  const plans = usePlanStore((s) => Object.values(s.plans));

  return useMemo(() => {
    const unreadThreads = threads.filter(t => !t.isRead && t.status !== "running").length;
    const unreadPlans = plans.filter(p => !p.isRead && !p.stale).length;
    return unreadThreads + unreadPlans;
  }, [threads, plans]);
}
```

### Step 7: Control Panel Support

The control panel window needs to handle the new view type for its routing.

**File: `src/components/control-panel/control-panel-window.tsx`**

Ensure the control panel can display the intermediate screen:
- If control panel routes through Rust, may need to update `show_control_panel_with_view` command
- Or render the intermediate screen directly in the control panel component

### Step 8: Handle "All Caught Up" State

In `QuickActionCompleteView`, when `nextItem === null`:
- Hide "Continue to next unread" option
- Show "All caught up!" message
- Only show "Start new thread" and "Close panel" options

## Files to Create

1. `src/components/content-pane/quick-action-complete-view.tsx` - New intermediate screen component
2. `src/hooks/use-unread-count.ts` - Hook for unread item count (optional, could inline)

## Files to Modify

1. `src/components/content-pane/types.ts` - Add new view type
2. `src/components/content-pane/content-pane.tsx` - Render new view
3. `src/components/control-panel/control-panel-window.tsx` - Update quick action handler
4. `src/components/control-panel/plan-view.tsx` - Update plan quick action handler
5. Possibly `src-tauri/src/commands/panels.rs` - If control panel routing needs updates

## Considerations

### Keyboard Shortcut Conflicts

The intermediate screen uses:
- **Enter** - Continue to next unread
- **Cmd+N** - Start new thread (existing global shortcut)
- **Esc** - Close panel

These should not conflict with existing shortcuts since we're on a new view.

### Control Panel vs Main Window

The intermediate screen should work in both contexts:
- **Control panel**: Shows the screen, Enter navigates within control panel
- **Main window**: Shows in content pane, Enter navigates within main window

The `useContextAwareNavigation` hook already handles this distinction.

### State Persistence

The intermediate screen view should probably NOT be persisted to `content-panes.json`. If the user quits while on this screen, reopening should show empty state or last actual thread, not the intermediate screen.

Consider filtering out `quick-action-complete` views before persistence, or treating it as an ephemeral state.

### Animation/Transition

For a polished feel, consider:
- Fade-in animation for the intermediate screen
- Quick transition when pressing Enter to continue
- Visual feedback on keyboard press

## Testing

1. Archive a thread → Should show intermediate screen with "Thread archived"
2. Press Enter → Should navigate to next unread thread
3. Archive when all caught up → Should show "All caught up" variant
4. Press Cmd+N from intermediate screen → Should create new thread
5. Press Esc → Should close panel (control panel) or show empty state (main window)
6. Mark thread as unread → Should show "Marked as unread" intermediate screen
7. Same flow should work for plans

## Future Enhancements

The intermediate screen architecture allows for easy addition of more options:
- "Undo" action
- "View archived threads"
- "Snooze" functionality
- Quick stats about completed work
