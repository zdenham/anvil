# Inbox Navigation Highlight Mismatch Bug

## Summary

The visually highlighted inbox item does not match the item that gets opened when the user releases Alt. The user sees item N highlighted but item M opens.

## Root Cause

The bug is caused by a **stale closure** in the `handleItemOpen` callback combined with **ignoring the `selectedIndex` provided by Rust** in the `nav-open` event.

### Technical Analysis

#### Two Independent Index Tracking Systems

1. **Rust backend** (`navigation_mode.rs:89-90`): Maintains `current_index: Mutex<usize>`
2. **React frontend** (`InboxListWindow.tsx:38-39`): Maintains `selectedIndex` state and `selectedIndexRef`

#### The Problem Flow

1. User navigates with Alt+Down/Up
2. Rust tracks its own index and emits `nav-down`/`nav-up` events
3. React updates its local `selectedIndex` state based on these events
4. When Alt is released, Rust emits `nav-open { selectedIndex: X }` with **Rust's tracked index**
5. React **ignores** the provided `selectedIndex` and uses its own `selectedIndexRef.current`

#### Why They Diverge

The `handleItemOpen` callback (`InboxListWindow.tsx:100-122`) has a **stale closure problem**:

```typescript
const handleItemOpen = useCallback(() => {
  const currentIndex = selectedIndexRef.current;  // Uses React's ref
  const item = items[currentIndex];               // items might be stale!
  // ...
}, [items]);  // Only recreated when items change
```

The callback captures `items` at creation time. If the `items` array changes during navigation (e.g., new thread comes in, plan updates), the callback still references the old array.

Additionally, the `useEffect` that handles navigation events has an incomplete dependency array:

```typescript
useEffect(() => {
  // ...event handling...
}, [items.length, setSelectedIndex]);  // Missing handleItemOpen!
```

When `items.length` doesn't change but `items` content does (e.g., items get reordered due to `updatedAt` changes), the event handler still uses the old `handleItemOpen` which references stale `items`.

#### Race Condition Scenario

```
Time  │ Rust Index  │ React Index  │ Visual  │ Event
──────┼─────────────┼──────────────┼─────────┼──────────────────
T1    │ 0           │ 0            │ Item 0  │ nav-start
T2    │ 0→1         │ 0→1          │ Item 1  │ nav-down (emitted)
T3    │ 1           │ 0 (stale!)   │ Item 1  │ React batched update pending
T4    │ 1           │ 1            │ Item 1  │ React state catches up
T5    │ 1→2         │ 1            │ Item 1  │ nav-down (emitted)
T6    │ 2           │ 1 (stale!)   │ Item 1  │ React hasn't processed yet
T7    │ 2           │ -            │ Item 1  │ Alt released, nav-open{2}
T8    │ -           │ uses ref=1   │ -       │ Opens WRONG item (1 not 2)
```

The visual highlight shows the correct item because it's rendered from `selectedIndex` state, but `selectedIndexRef.current` may be behind due to React's asynchronous state updates.

## The Fix

### Option A: Use Rust's Provided Index (Recommended)

Modify `handleItemOpen` to accept the index from the event instead of using the ref:

```typescript
// In the event handler:
case "nav-open":
  handleItemOpen(event.selectedIndex);  // Pass Rust's index
  break;

// Update the callback:
const handleItemOpen = useCallback((indexFromEvent?: number) => {
  const currentIndex = indexFromEvent ?? selectedIndexRef.current;
  const item = items[currentIndex];
  // ...
}, [items]);
```

This ensures Rust (the source of truth for navigation) determines which item opens.

### Option B: Remove Dual Index Tracking

Have Rust be the single source of truth:
1. Remove `selectedIndexRef` from React
2. Store the current index in Rust only
3. Have `nav-down`/`nav-up` events include the new index
4. React just renders based on the index from events

This is more work but eliminates the synchronization problem entirely.

## Recommended Fix Implementation

Apply Option A as it's minimal and directly addresses the bug:

**File: `src/components/inbox-list/InboxListWindow.tsx`**

```diff
- case "nav-open":
-   handleItemOpen();
-   break;
+ case "nav-open":
+   handleItemOpen(event.selectedIndex);
+   break;

- const handleItemOpen = useCallback(() => {
-   const currentIndex = selectedIndexRef.current;
+ const handleItemOpen = useCallback((indexFromEvent?: number) => {
+   const currentIndex = indexFromEvent ?? selectedIndexRef.current;
    const item = items[currentIndex];
    // ... rest unchanged
  }, [items]);
```

The `NavigationOpenEvent` type already includes `selectedIndex: number` (see `events.ts:98-101`), so the data is available - it's just not being used.

## Files Involved

- `src/components/inbox-list/InboxListWindow.tsx` - React component with the bug
- `src-tauri/src/navigation_mode.rs` - Rust navigation state (working correctly)
- `src/entities/events.ts` - Event type definitions (already includes selectedIndex)
