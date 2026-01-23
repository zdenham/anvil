# Navigation: Frontend as Single Source of Truth

## Overview

Refactor the inbox navigation system so the **frontend owns all index state**. Rust becomes a pure event forwarder that detects keypresses and modifier releases, but does not track which item is selected.

**Problem**: Currently both Rust and React track `selectedIndex` independently, leading to synchronization bugs where the Rust index lags behind what the user sees highlighted.

**Solution**: Remove index tracking from Rust entirely. Frontend handles:
- Index state and bounds checking
- Wrapping at list boundaries
- Opening the correct item on Alt release

Rust handles:
- Detecting Alt+Down/Up keypresses
- Detecting Alt release
- Emitting simple events (no index payload needed)

---

## Changes to Rust

### File: `src-tauri/src/navigation_mode.rs`

#### 1. Remove `current_index` field

```rust
// REMOVE these lines (89-90):
/// Currently selected index during navigation
current_index: Mutex<usize>,

// REMOVE from new() (line 107):
current_index: Mutex::new(0),
```

#### 2. Simplify `NavigationEvent` enum

```rust
// CHANGE NavOpen from:
NavOpen {
    #[serde(rename = "selectedIndex")]
    selected_index: usize,
},

// TO:
NavRelease,
```

#### 3. Remove index tracking in `enter_navigation_mode`

```rust
// In NavigationState::Idle branch (line 138):
// REMOVE: *self.current_index.lock().unwrap() = 0;

// In NavigationState::Navigating branch (lines 162-177):
// REMOVE all index manipulation, just emit events:
NavigationState::Navigating => {
    match direction {
        NavigationDirection::Down => {
            tracing::debug!("NavigationMode: nav-down");
            self.emit(NavigationEvent::NavDown);
        }
        NavigationDirection::Up => {
            tracing::debug!("NavigationMode: nav-up");
            self.emit(NavigationEvent::NavUp);
        }
    }
}
```

#### 4. Simplify `on_modifier_released`

```rust
// CHANGE (lines 183-208):
pub fn on_modifier_released(&self) {
    let mut state = self.state.lock().unwrap();

    if *state == NavigationState::Navigating {
        let target = *self.current_target.lock().unwrap();
        tracing::info!(
            target = ?target,
            "NavigationMode: Navigating -> Idle (modifier released)"
        );
        *state = NavigationState::Idle;

        // Emit nav-release (no index needed - frontend knows what's selected)
        tracing::info!("[NavigationMode] on_modifier_released: Emitting nav-release event");
        self.emit(NavigationEvent::NavRelease);
    }
}
```

---

## Changes to Frontend

### File: `src/entities/events.ts`

#### Update event types

```typescript
// CHANGE NavigationOpenEvent:
export interface NavigationOpenEvent {
  type: "nav-open";
  selectedIndex: number;  // REMOVE this field
}

// TO:
export interface NavigationReleaseEvent {
  type: "nav-release";
  // No payload - frontend owns the index
}

// UPDATE NavigationModeEvent union type accordingly
```

### File: `src/components/inbox-list/InboxListWindow.tsx`

#### 1. Update event handler for nav-release

```typescript
// CHANGE (lines 82-84):
case "nav-open":
  handleItemOpen(event.selectedIndex);
  break;

// TO:
case "nav-release":
  handleItemOpen();  // No argument - use local state
  break;
```

#### 2. Simplify handleItemOpen

```typescript
// CHANGE (lines 100-123):
const handleItemOpen = useCallback((indexFromEvent?: number) => {
  const currentIndex = indexFromEvent ?? selectedIndexRef.current;
  // ...
}, [items]);

// TO:
const handleItemOpen = useCallback(() => {
  const currentIndex = selectedIndexRef.current;
  const item = items[currentIndex];

  if (!item) {
    logger.warn("[InboxListWindow] No item at index:", currentIndex);
    return;
  }

  logger.log("[InboxListWindow] Opening item at index:", currentIndex, item.type);

  // Hide this panel first
  invoke("hide_inbox_list_panel").catch((err) => {
    logger.error("[InboxListWindow] Failed to hide panel:", err);
  });

  // Open the selected item in control panel
  if (item.type === "thread") {
    switchToThread(item.data.id);
  } else if (item.type === "plan") {
    switchToPlan(item.data.id);
  }
}, [items]);
```

#### 3. Fix dependency array in useEffect (line 97)

This was part of the original bug. With frontend as source of truth, ensure the effect properly depends on what it uses:

```typescript
// CHANGE:
}, [items.length, setSelectedIndex]);

// TO:
}, [items.length, setSelectedIndex, handleItemOpen]);
```

Or better yet, use an `itemsRef` pattern to avoid closure staleness entirely:

```typescript
// Add at component level:
const itemsRef = useRef(items);
useEffect(() => {
  itemsRef.current = items;
}, [items]);

// Then in handleItemOpen:
const handleItemOpen = useCallback(() => {
  const currentIndex = selectedIndexRef.current;
  const item = itemsRef.current[currentIndex];
  // ...
}, []);  // No dependencies needed - uses refs
```

---

## Testing Checklist

After implementation, verify:

1. **Basic navigation works**
   - Alt+Down opens panel, highlights first item
   - Repeated Down moves highlight down
   - Repeated Up moves highlight up
   - Releasing Alt opens the highlighted item

2. **Bounds work correctly**
   - At bottom of list, Down wraps to top
   - At top of list, Up wraps to bottom

3. **Index never lags**
   - Rapid Alt+Down+Down+Down+release opens correct item
   - Item that opens matches item that was highlighted

4. **Items changing during navigation**
   - If a new thread comes in while navigating, navigation still works
   - No crash or wrong item opened

5. **Cancel works**
   - Escape cancels navigation
   - Panel blur cancels navigation

---

## Files Summary

| File | Action |
|------|--------|
| `src-tauri/src/navigation_mode.rs` | Remove `current_index`, change `NavOpen` to `NavRelease` |
| `src/entities/events.ts` | Update event type definitions |
| `src/components/inbox-list/InboxListWindow.tsx` | Remove index from event handling, use local state |

---

## Why This Fixes the Bug

The "one behind" bug happens because:
1. Rust increments its index synchronously on keypress
2. React increments its index asynchronously (state batching)
3. On Alt release, Rust sends its index, which may differ from what React shows

By removing Rust's index tracking:
- There's only ONE index (React's)
- What's highlighted IS what opens
- No synchronization needed
- No stale closures affecting which item opens

The frontend already does the visual rendering from its own state. Now it also owns the "which item to open" decision, making the system consistent by construction.
