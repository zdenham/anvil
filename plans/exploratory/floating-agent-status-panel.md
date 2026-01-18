# Floating Agent Status Panel

## Problem Statement

Users currently have no persistent, at-a-glance visibility into their running agents. To check agent status, they must:

- Open the Task panel or SimpleTask panel
- Navigate to a specific thread
- Look at individual thread status

This is especially problematic when:

- Multiple agents are running across different tasks
- An agent has completed work the user hasn't reviewed yet
- The user is working in another application and wants ambient awareness
- Quick navigation to the most urgent agent is needed

## Goals

Create a small, always-visible floating NSPanel that:

1. Shows count of currently running agents (green, pulsing)
2. Shows count of unread threads (blue, matching task panel dots)
3. Displays the hotkey to jump to the top priority agent
4. Is draggable to any screen position
5. Persists across app focus changes (non-activating)

## Architecture Overview

### Component Overview

```
┌────────────────────────────────────────┐
│  Floating Agent Status Panel (NSPanel) │
├────────────────────────────────────────┤
│                                        │
│   🟢 3 running     🔵 1 unread         │
│                                        │
│           ⇧↑ → Focus agent             │
│                                        │
└────────────────────────────────────────┘
```

**Panel Characteristics:**

- Size: ~280×60 pixels (compact)
- Position: Draggable, persisted to localStorage
- Level: Floating (above regular windows, below Spotlight)
- Style: Non-activating, borderless, transparent background with blur
- Behavior: Always visible when app is running

### Data Flow

```
Thread Store (Zustand)
        ↓
   Selectors
   ├── getRunningThreads()
   └── getUnreadThreads()
        ↓
   Event Bridge
        ↓
   Agent Status Panel (React)
        ↓
   Rendered UI
```

### Priority Determination

Tasks (and their threads) are prioritized by `sortOrder` (ascending):

- Lower `sortOrder` = higher priority (appears first)
- This matches the task navigation priority system

"Unread" is determined by the `isRead` property on `ThreadMetadata`:

- `isRead: false` - Thread has activity the user hasn't viewed yet
- This matches the existing blue dot indicator in the task panel

The hotkey navigates to the highest priority (lowest sortOrder) task that has an unread thread.

### Existing Infrastructure

**NSPanel system** (`src-tauri/src/panels.rs`):

- Mature panel management with 6 existing panels
- Supports non-activating, floating, draggable panels
- Collection behaviors for multi-space support

**Thread Store** (`src/entities/threads/store.ts`):

- Already tracks thread metadata with status
- Existing selector `getRunningThreads()`
- Easy to add attention-based selectors

**Event Bridge** (`src/lib/event-bridge.ts`):

- Asymmetric bridging pattern for read-only panels
- `setupIncomingBridge()` for receiving events

**Global Shortcuts** (`tauri-plugin-global-shortcut`):

- Already used for Spotlight toggle
- Can register new shortcuts for agent focus

### Color Scheme Alignment

This panel uses the same color scheme as the task panel dots (see `src/utils/task-colors.ts`):

| State       | Color            | Animation        | Tailwind Class              |
| ----------- | ---------------- | ---------------- | --------------------------- |
| Running     | Green            | Pulsing          | `text-green-400 animate-pulse` |
| Unread      | Blue             | None             | `text-blue-500`             |
| Inactive    | Muted gray       | None             | `text-zinc-600`             |

This consistency ensures users immediately recognize the meaning of the indicators without learning new visual language.

## Proposed Implementation

### Phase 1: Thread Store Selectors

**No new types needed.** We leverage the existing `isRead` boolean on `ThreadMetadata` which already powers the blue dot in the task panel.

#### 1.1 Add Unread Selectors

**File: `src/entities/threads/store.ts`**

Add selectors for unread and running queries:

```typescript
// Get all unread threads, sorted by task priority
getUnreadThreads: (): Array<{ thread: ThreadMetadata; sortOrder: number }> => {
  const threads = Object.values(get().threads);
  const tasks = useTaskStore.getState().tasks;

  return threads
    .filter((t) => !t.isRead)
    .map((thread) => {
      const task = tasks[thread.taskId];
      const sortOrder = task?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      return { thread, sortOrder };
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
},

// Get the single highest priority unread thread
getTopPriorityUnreadThread: (): ThreadMetadata | null => {
  const unread = get().getUnreadThreads();
  return unread[0]?.thread ?? null;
},

// Get count of running threads
getRunningCount: (): number => {
  return Object.values(get().threads).filter((t) => t.status === "running").length;
},

// Get count of unread threads
getUnreadCount: (): number => {
  return Object.values(get().threads).filter((t) => !t.isRead).length;
},
```

**Note:** These selectors reuse the existing utility functions from `src/utils/task-colors.ts` conceptually - the same `isRead` logic that drives the blue dot indicator.

### Phase 2: Rust Panel Setup

#### 2.1 Define AgentStatus Panel

**File: `src-tauri/src/panels.rs`**

Add new panel definition alongside existing panels:

```rust
panel!(AgentStatusPanel {
    config: {
        can_become_key_window: false,  // Never steal focus
        is_floating_panel: true
    }
})

// In setup_panels function, add:
PanelBuilder::<_, AgentStatusPanel>::new(app, "agent-status")
    .url(WebviewUrl::App("agent-status.html".into()))
    .level(PanelLevel::Floating)  // Below ScreenSaver, above normal
    .collection_behavior(CollectionBehavior::new()
        .can_join_all_spaces()        // Visible on all spaces
        .stationary()                 // Stays in place during space switches
        .full_screen_auxiliary())
    .style_mask(StyleMask::empty()
        .borderless()
        .nonactivating_panel())
    .hides_on_deactivate(false)       // Always visible
    .transparent(true)
    .no_activate(true)
    .build()?;
```

#### 2.2 Add Tauri Commands for Position Persistence

**File: `src-tauri/src/lib.rs`**

Add commands for position save/load:

```rust
#[tauri::command]
async fn set_agent_status_position(
    app: tauri::AppHandle,
    x: f64,
    y: f64,
) -> Result<(), String> {
    if let Some(panel) = app.get_webview_panel("agent-status") {
        panel.set_frame_origin(CGPoint::new(x, y));
    }
    Ok(())
}

#[tauri::command]
async fn get_agent_status_position(
    app: tauri::AppHandle,
) -> Result<(f64, f64), String> {
    if let Some(panel) = app.get_webview_panel("agent-status") {
        let frame = panel.frame();
        Ok((frame.origin.x, frame.origin.y))
    } else {
        Err("Panel not found".to_string())
    }
}
```

#### 2.3 Add Show/Hide/Toggle Commands

**File: `src-tauri/src/lib.rs`**

```rust
#[tauri::command]
async fn toggle_agent_status_panel(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(panel) = app.get_webview_panel("agent-status") {
        if panel.is_visible() {
            panel.order_out(None);
        } else {
            panel.show();
        }
    }
    Ok(())
}

#[tauri::command]
async fn show_agent_status_panel(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(panel) = app.get_webview_panel("agent-status") {
        panel.show();
    }
    Ok(())
}
```

### Phase 3: Vite Entry Point

#### 3.1 Add HTML Entry

**File: `agent-status.html`** (new file in root)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Agent Status</title>
  </head>
  <body class="bg-transparent">
    <div id="root"></div>
    <script type="module" src="/src/agent-status.tsx"></script>
  </body>
</html>
```

#### 3.2 Update Vite Config

**File: `vite.config.ts`**

Add to rollupOptions.input:

```typescript
input: {
  // ... existing entries
  "agent-status": resolve(__dirname, "agent-status.html"),
}
```

### Phase 4: React UI Component

#### 4.1 Create Entry Point

**File: `src/agent-status.tsx`** (new)

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { AgentStatusPanel } from "./components/agent-status/agent-status-panel";
import "./globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AgentStatusPanel />
  </React.StrictMode>
);
```

#### 4.2 Create Panel Component

**File: `src/components/agent-status/agent-status-panel.tsx`** (new)

```tsx
import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useThreadStore } from "@/entities/threads/store";
import { setupIncomingBridge } from "@/lib/event-bridge";
import { Circle } from "lucide-react";
import { cn } from "@/lib/utils";

const HOTKEY_DISPLAY = "⇧↑";

export function AgentStatusPanel() {
  const runningCount = useThreadStore((state) => state.getRunningCount());
  const unreadCount = useThreadStore((state) => state.getUnreadCount());
  const topPriority = useThreadStore((state) => state.getTopPriorityUnreadThread());

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Set up event bridge for updates from other windows
  useEffect(() => {
    const cleanup = setupIncomingBridge();
    return cleanup;
  }, []);

  // Refresh thread data on mount
  useEffect(() => {
    useThreadStore.getState().refreshAll();
  }, []);

  // Dragging handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.screenX, y: e.screenY });
  }, []);

  const handleMouseMove = useCallback(
    async (e: React.MouseEvent) => {
      if (!isDragging) return;

      const deltaX = e.screenX - dragStart.x;
      const deltaY = e.screenY - dragStart.y;

      // Get current position and update
      const [currentX, currentY] = await invoke<[number, number]>(
        "get_agent_status_position"
      );
      await invoke("set_agent_status_position", {
        x: currentX + deltaX,
        y: currentY - deltaY, // Cocoa coordinates are flipped
      });

      setDragStart({ x: e.screenX, y: e.screenY });
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    // Persist position to localStorage
    invoke<[number, number]>("get_agent_status_position").then(([x, y]) => {
      localStorage.setItem("agent-status-position", JSON.stringify({ x, y }));
    });
  }, []);

  const hasActivity = runningCount > 0 || unreadCount > 0;

  return (
    <div
      className={cn(
        "w-[280px] h-[60px] rounded-xl",
        "bg-background/80 backdrop-blur-xl",
        "border border-border/50",
        "shadow-lg",
        "flex items-center justify-between px-4",
        "cursor-move select-none",
        "transition-opacity duration-200",
        !hasActivity && "opacity-60"
      )}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Status counts */}
      <div className="flex items-center gap-4">
        {/* Running count - green pulsing dot (matches task panel) */}
        <div className="flex items-center gap-1.5">
          <Circle
            className={cn(
              "h-3 w-3 fill-current",
              runningCount > 0
                ? "text-green-400 animate-pulse"
                : "text-zinc-600"
            )}
          />
          <span className="text-sm font-medium text-zinc-200">
            {runningCount} running
          </span>
        </div>

        {/* Unread count - blue dot (matches task panel) */}
        <div className="flex items-center gap-1.5">
          <Circle
            className={cn(
              "h-3 w-3 fill-current",
              unreadCount > 0 ? "text-blue-500" : "text-zinc-600"
            )}
          />
          <span className="text-sm font-medium text-zinc-200">
            {unreadCount} unread
          </span>
        </div>
      </div>

      {/* Hotkey hint */}
      {topPriority && (
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <kbd className="px-1.5 py-0.5 bg-zinc-700 rounded text-[10px] font-mono">
            {HOTKEY_DISPLAY}
          </kbd>
          <span>Focus</span>
        </div>
      )}
    </div>
  );
}
```

**Color scheme matches task panel:**
- Running: `text-green-400 animate-pulse` (same as `bg-green-400` dot)
- Unread: `text-blue-500` (same as `bg-blue-500` dot)
- Inactive: `text-zinc-600` (muted when count is zero)

### Phase 5: Hotkey Integration

The panel displays the **Shift+Up** hotkey hint, which is the same hotkey used by the task navigation system (see `task-navigation-hotkeys.md`).

**No new hotkey registration required.** The existing `useSimpleTaskKeyboard` hook handles Shift+Up to navigate to the highest priority non-running task. This panel simply provides visual feedback about what agents are running and what threads are unread, helping users understand what Shift+Up will do.

The navigation behavior is:

1. User sees "3 running, 1 unread" in the floating panel
2. User presses Shift+Up (anywhere in the simple task window)
3. `useSimpleTaskKeyboard` navigates to highest priority non-running task
4. Panel counts update to reflect new state

### Phase 6: Auto-Show/Hide Logic

#### 6.1 Visibility Controller

**File: `src/components/agent-status/visibility-controller.ts`** (new)

```typescript
import { invoke } from "@tauri-apps/api/core";
import { useThreadStore } from "@/entities/threads/store";

// Subscribe to thread store and auto-show/hide panel
export function setupVisibilityController() {
  let lastHasActivity = false;

  return useThreadStore.subscribe((state) => {
    const hasActivity =
      state.getRunningCount() > 0 || state.getUnreadCount() > 0;

    if (hasActivity !== lastHasActivity) {
      if (hasActivity) {
        invoke("show_agent_status_panel");
      }
      // Don't auto-hide - let user dismiss manually if desired
      lastHasActivity = hasActivity;
    }
  });
}
```

### Phase 7: Position Restoration

#### 7.1 Restore Position on Mount

In `AgentStatusPanel` component, add position restoration:

```tsx
// Restore saved position on mount
useEffect(() => {
  const savedPosition = localStorage.getItem("agent-status-position");
  if (savedPosition) {
    const { x, y } = JSON.parse(savedPosition);
    invoke("set_agent_status_position", { x, y });
  }
}, []);
```

## Files to Create

| File                                                   | Purpose                    |
| ------------------------------------------------------ | -------------------------- |
| `agent-status.html`                                    | Vite entry point for panel |
| `src/agent-status.tsx`                                 | React entry point          |
| `src/components/agent-status/agent-status-panel.tsx`   | Main panel UI component    |
| `src/components/agent-status/visibility-controller.ts` | Auto-show logic            |

## Files to Modify

| File                            | Changes                                      |
| ------------------------------- | -------------------------------------------- |
| `src-tauri/src/panels.rs`       | Add AgentStatusPanel definition              |
| `src-tauri/src/lib.rs`          | Add position commands, show/hide commands    |
| `src/entities/threads/store.ts` | Add unread/running selectors                 |
| `vite.config.ts`                | Add agent-status entry point                 |

## Decisions Made

### Panel Level: Floating (Not ScreenSaver)

**Decision:** Use `PanelLevel::Floating` instead of `PanelLevel::ScreenSaver`.

**Rationale:**

- Status panel should be visible but not intrusive
- Spotlight and error panels need to appear above it
- ScreenSaver level would put it above fullscreen apps, which may be annoying

### Non-Activating: Always

**Decision:** Panel never becomes key window.

**Rationale:**

- User should never lose focus from their work
- Panel is display-only with no text input
- Click-through for dragging is acceptable

### Auto-Show: On Activity

**Decision:** Automatically show when agents start running.

**Rationale:**

- Users want visibility when things are happening
- Manual show would defeat the purpose of ambient awareness
- Users can dismiss if desired

### Auto-Hide: Never

**Decision:** Don't automatically hide when activity stops.

**Rationale:**

- User may want to review completed agents
- Sudden disappearing UI is disorienting
- Manual dismiss is more predictable

### Position Persistence: localStorage

**Decision:** Save position to localStorage, not backend.

**Rationale:**

- Position is per-machine preference
- localStorage is simpler and faster
- No need to sync across devices

### Hotkey: Shift+Up

**Decision:** Use Shift+Up for focus, same as task navigation.

**Rationale:**

- Consistent with task navigation hotkeys (task-navigation-hotkeys.md)
- No new hotkey to learn - single system for task priority navigation
- Panel serves as visual indicator, not a new navigation system

## Edge Cases

### 1. No Running or Unread Threads

Panel shows `0 running` and `0 unread`, reducing opacity to indicate idle state. Hotkey hint is hidden when no unread threads exist.

### 2. Panel Dragged Off-Screen

Store position but don't persist obviously invalid positions. On restoration, validate position is within screen bounds.

### 3. Multiple Monitors

Panel uses Cocoa coordinate system. Position is absolute and will appear on whatever monitor contains that coordinate.

### 4. Thread Data Desync

Panel uses `setupIncomingBridge()` for updates. If desync occurs, panel will self-correct on next event.

### 5. App Restart

Position restored from localStorage. Thread state refreshed from disk on mount.

### 6. Hotkey Only Works in Simple Task Window

Shift+Up is handled by `useSimpleTaskKeyboard`, which is only active when a simple task window is open. The panel displays the hotkey hint regardless of context - users must have a simple task window focused to use the hotkey.

## Testing Plan

1. **Unit Tests**

   - `getUnreadThreads()` returns correct threads (those with `isRead: false`)
   - `getTopPriorityUnreadThread()` returns highest priority unread thread
   - Priority ordering by task `sortOrder` is correct
   - `getRunningCount()` correctly counts threads with `status: "running"`

2. **Integration Tests**

   - Panel shows/hides correctly
   - Position persists across restarts
   - Event bridge updates counts
   - Unread count matches blue dot indicators in task panel

3. **Manual Testing**
   - Drag panel to different positions
   - Verify running/unread counts update in real-time
   - Verify green pulsing dot appears when threads are running
   - Verify blue dot appears when threads are unread
   - Verify hotkey hint displays correctly
   - Test on multiple monitors
   - Test during fullscreen mode
   - Test after app restart

## Success Criteria

1. Panel displays accurate running thread count with green pulsing indicator
2. Panel displays accurate unread thread count with blue indicator
3. Panel is draggable and position persists
4. Panel appears above regular windows
5. Panel doesn't steal focus when interacted with
6. Panel displays correct hotkey hint (⇧↑)
7. Panel automatically shows when agents start
8. Panel styling matches task panel color scheme (green-400 running, blue-500 unread)

## Future Enhancements

1. **Click to expand** - Show list of all threads on click
2. **Individual thread status** - Hover to see which threads are running/unread
3. **Quick actions** - Cancel all, mark all as read from panel
4. **Notifications** - macOS notifications for new unread threads
5. **Global hotkey** - Register a global Shift+Up that works even outside simple task windows
6. **Auto-hide option** - Setting to auto-hide after idle period
