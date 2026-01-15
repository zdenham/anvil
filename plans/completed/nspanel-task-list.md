# NSPanel Task List View

## Overview

Create a lightweight NSPanel that displays a simple list of all tasks, accessible via Spotlight by typing "tasks". When a task is clicked, it opens the existing SimpleTaskPanel with that task's conversation.

## Architecture

### Components to Create

1. **Rust Panel Management** (`src-tauri/src/panels.rs`)
   - `create_tasks_panel()` - Creates the NSPanel window
   - `show_tasks_panel()` / `hide_tasks_panel()` - Visibility controls
   - Panel configuration: ~400x500, non-activating, floats above fullscreen

2. **Frontend Entry Point** (`src/tasks-panel/`)
   - `main.tsx` - React entry point
   - `tasks-panel.tsx` - Main component with task list

3. **HTML Entry** (`tasks-panel.html`)
   - Standard Vite HTML entry for the panel

4. **Spotlight Integration** (`src/components/spotlight/`)
   - Add "tasks" action type to search results
   - Handle selection to show the tasks panel

---

## Event Bridge Setup (Critical)

The codebase uses an asymmetric event bridge architecture to prevent echo loops:

### Bridge Types

| Bridge | Purpose | Used By |
|--------|---------|---------|
| `setupOutgoingBridge()` | Broadcasts local mitt events to all windows via Tauri | **Spotlight only** (spawns agents) |
| `setupIncomingBridge()` | Listens for Tauri broadcasts, emits to local mitt | Task panels (receive-only) |

### Why This Panel is Incoming-Only

The tasks-panel is a **read-only list view**. It:
- Displays tasks from the store
- Opens SimpleTaskPanel when a task is clicked
- Does NOT spawn agents or emit state-changing events

Therefore, it must **only use `setupIncomingBridge()`**. Using both bridges would create echo loops where:
1. Spotlight emits `TASK_UPDATED`
2. Tasks-panel receives via incoming bridge
3. If outgoing bridge existed, it would re-broadcast the same event
4. All panels receive duplicates → infinite loop

### Bootstrap Order

The initialization sequence is critical:

```
1. setupIncomingBridge()    ← Start listening FIRST
2. hydrateEntities()        ← Load stores from disk
3. setupEntityListeners()   ← Register handlers AFTER stores ready
4. Render React app
```

If listeners are set up before the bridge, early events are missed. If stores aren't hydrated first, listeners have no data to refresh.

### How Echo Prevention Works

Entity listeners follow the "events are signals, not data" pattern:

```typescript
eventBus.on(EventName.TASK_UPDATED, async ({ taskId }) => {
  // Always refresh from disk - the single source of truth
  await taskService.refreshTask(taskId);
});
```

This is idempotent - receiving duplicate events just re-reads the same disk state. No recursive emissions occur because listeners only fetch data, never emit events.

---

## Implementation Steps

### Step 1: Add Rust Panel Infrastructure

**File: `src-tauri/src/panels.rs`**

Add alongside existing panel definitions:

```rust
// Tasks Panel - simple list of all tasks
pub fn create_tasks_panel(app: &AppHandle) -> Result<WebviewWindow, Error> {
    let window = WebviewWindowBuilder::new(app, "tasks-panel", WebviewUrl::App("tasks-panel.html".into()))
        .title("Tasks")
        .inner_size(400.0, 500.0)
        .visible(false)
        .decorations(false)
        .resizable(true)
        .skip_taskbar(true)
        .transparent(true)
        .build()?;

    let panel = window.to_panel()?;
    panel.set_level(NSMainMenuWindowLevel + 1);
    panel.set_style_mask(NSWindowStyleMaskNonActivatingPanel);
    panel.set_collection_behaviour(
        NSWindowCollectionBehaviorCanJoinAllSpaces
            | NSWindowCollectionBehaviorStationary
            | NSWindowCollectionBehaviorFullScreenAuxiliary,
    );

    Ok(window)
}
```

Add Tauri commands:

```rust
#[tauri::command]
pub async fn show_tasks_panel(app: AppHandle) -> Result<(), String> {
    // Position near spotlight or center of screen
    if let Some(window) = app.get_webview_window("tasks-panel") {
        let panel = window.to_panel().map_err(|e| e.to_string())?;

        // Position panel (centered horizontally, near top)
        if let Some(monitor) = window.current_monitor().ok().flatten() {
            let size = monitor.size();
            let scale = monitor.scale_factor();
            let panel_width = 400.0;
            let panel_height = 500.0;

            let x = (size.width as f64 / scale - panel_width) / 2.0;
            let y = 100.0; // Near top of screen

            window.set_position(tauri::Position::Logical(LogicalPosition::new(x, y))).ok();
        }

        window.show().map_err(|e| e.to_string())?;
        panel.make_key_window();
    }
    Ok(())
}

#[tauri::command]
pub async fn hide_tasks_panel(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("tasks-panel") {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
```

Register commands in `lib.rs` invoke handler.

### Step 2: Create Frontend Entry Point

**File: `tasks-panel.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Tasks</title>
    <link rel="stylesheet" href="/src/index.css" />
  </head>
  <body class="overflow-hidden">
    <div id="root"></div>
    <script type="module" src="/src/tasks-panel/main.tsx"></script>
  </body>
</html>
```

**File: `src/tasks-panel/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { TasksPanel } from "./tasks-panel";
import { setupIncomingBridge } from "../lib/event-bridge";
import { hydrateEntities } from "../entities/hydrate";
import { setupEntityListeners } from "../entities/listeners";
import "../index.css";

/**
 * Bootstrap sequence is critical - order matters!
 *
 * 1. setupIncomingBridge() - Start listening for cross-window events
 * 2. hydrateEntities() - Load stores from disk
 * 3. setupEntityListeners() - Register event handlers
 *
 * IMPORTANT: Only use setupIncomingBridge(), NOT setupOutgoingBridge().
 * This panel is a "listener" - it receives task updates but does not
 * emit events. Only Spotlight has an outgoing bridge because it spawns
 * agents. This asymmetric setup prevents event echo loops.
 */
async function bootstrap() {
  // 1. Enable listening for broadcast events from other windows
  await setupIncomingBridge();

  // 2. Hydrate entity stores from disk
  await hydrateEntities();

  // 3. Set up entity listeners AFTER bridge and stores are ready
  setupEntityListeners();

  // 4. Render the app
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <TasksPanel />
    </React.StrictMode>
  );
}

bootstrap();
```

**File: `src/tasks-panel/tasks-panel.tsx`**

```tsx
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTaskStore } from "../entities/tasks/store";
import { Task } from "../entities/tasks/types";

export function TasksPanel() {
  const tasks = useTaskStore((s) => s.tasks);
  const loadTasks = useTaskStore((s) => s.loadTasks);

  useEffect(() => {
    loadTasks();

    // Auto-hide on blur
    const unlisten = listen("window_did_resign_key", () => {
      invoke("hide_tasks_panel");
    });

    return () => { unlisten.then((f) => f()); };
  }, []);

  const handleTaskClick = (task: Task) => {
    // Hide this panel
    invoke("hide_tasks_panel");
    // Show simple task panel with this task
    invoke("show_simple_task_panel", { slug: task.slug });
  };

  return (
    <div className="h-screen w-screen bg-zinc-900/95 backdrop-blur-xl rounded-xl border border-zinc-700/50 overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-zinc-700/50">
        <h1 className="text-sm font-medium text-zinc-100">Tasks</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        {tasks.length === 0 ? (
          <div className="p-4 text-center text-zinc-500 text-sm">
            No tasks yet
          </div>
        ) : (
          <ul className="divide-y divide-zinc-800">
            {tasks.map((task) => (
              <li
                key={task.id}
                onClick={() => handleTaskClick(task)}
                className="px-4 py-3 hover:bg-zinc-800/50 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2">
                  <StatusDot status={task.status} />
                  <span className="text-sm text-zinc-100 truncate">
                    {task.title}
                  </span>
                </div>
                {task.repository && (
                  <div className="mt-1 text-xs text-zinc-500 truncate">
                    {task.repository}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: "bg-green-500",
    paused: "bg-yellow-500",
    completed: "bg-blue-500",
    archived: "bg-zinc-500",
  };
  return (
    <span className={`w-2 h-2 rounded-full ${colors[status] || "bg-zinc-500"}`} />
  );
}
```

### Step 3: Update Vite Config

**File: `vite.config.ts`**

Add to the `build.rollupOptions.input` object:

```ts
"tasks-panel": resolve(__dirname, "tasks-panel.html"),
```

### Step 4: Add Spotlight Integration

**File: `src/components/spotlight/types.ts`**

Add to the `SpotlightResult` discriminated union:

```ts
| { type: "action"; action: "open-mort" | "open-repo" | "open-tasks"; label: string }
```

**File: `src/components/spotlight/spotlight.tsx`**

In the search results generation logic, add the "tasks" action:

```tsx
// Add to filtered results when query matches "tasks"
if ("tasks".includes(query.toLowerCase()) && query.length > 0) {
  results.push({
    type: "action",
    action: "open-tasks",
    label: "Open Tasks",
  });
}
```

In the result selection handler:

```tsx
case "action":
  if (result.action === "open-tasks") {
    await invoke("hide_spotlight");
    await invoke("show_tasks_panel");
  }
  // ... existing action handlers
  break;
```

### Step 5: Initialize Panel on App Start

**File: `src-tauri/src/lib.rs`**

In the app setup, create the tasks panel:

```rust
panels::create_tasks_panel(&app)?;
```

### Step 6: Wire Up Event Handlers

Add resign key handler for auto-hide behavior (if not already generalized):

```rust
// In panels.rs or setup
if let Some(window) = app.get_webview_window("tasks-panel") {
    let panel = window.to_panel()?;
    let app_handle = app.clone();
    panel.set_delegate(PanelDelegate::new(
        move || {}, // did_become_key
        move || {
            let _ = app_handle.get_webview_window("tasks-panel")
                .map(|w| w.emit("window_did_resign_key", ()));
        },
    ));
}
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `tasks-panel.html` | Vite entry point |
| `src/tasks-panel/main.tsx` | React bootstrap |
| `src/tasks-panel/tasks-panel.tsx` | Main component |

## Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/panels.rs` | Add create/show/hide functions |
| `src-tauri/src/lib.rs` | Register commands, create panel on setup |
| `vite.config.ts` | Add entry point |
| `src/components/spotlight/types.ts` | Add `open-tasks` action |
| `src/components/spotlight/spotlight.tsx` | Add tasks search + handler |

---

## Testing Checklist

### Basic Functionality
- [ ] Panel appears when typing "tasks" in Spotlight and selecting
- [ ] Panel displays all tasks from store
- [ ] Panel auto-hides when clicking outside
- [ ] Clicking a task opens SimpleTaskPanel with that task
- [ ] Panel floats above fullscreen apps
- [ ] Panel styling matches existing panel aesthetics
- [ ] Task list scrolls when many tasks exist
- [ ] Empty state displays correctly

### Event Bridge (Critical)
- [ ] Task list updates when a new task is created via Spotlight
- [ ] Task list updates when task status changes from another panel
- [ ] No event echo loops occur (check console for duplicate events)
- [ ] Panel survives HMR reload during development
- [ ] Verify `setupOutgoingBridge()` is NOT called (grep the built code)

---

## Future Enhancements (Out of Scope)

- Task filtering/search within the panel
- Task status quick-toggle
- Keyboard navigation (up/down arrows)
- Task grouping by status or repository
