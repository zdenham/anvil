# Control Panel Pop-Out Windows

## Overview

Implement a "Pop Out" feature that transforms the NSPanel control panel into a regular WebviewWindow at the same location, with support for multiple simultaneous windows.

**User Flow:**
1. User opens thread → NSPanel appears (current behavior)
2. User clicks "Pop Out" button (or hotkey)
3. NSPanel hides, WebviewWindow opens at same position and focuses
4. User can pop out multiple threads into separate windows
5. Each window can be independently positioned, resized, closed

---

## Architecture

### Current State

- Single NSPanel with label `control-panel`
- Global state: `PENDING_CONTROL_PANEL`, `CONTROL_PANEL_PINNED`
- Frontend gets thread info from URL params or `get_pending_control_panel` IPC

### Target State

- NSPanel remains singleton for quick floating access (unchanged behavior)
- Multiple WebviewWindows with labels `control-panel-window-{uuid}`
- Instance registry tracking popped-out WebviewWindows only
- Each popped-out window is independent (own thread, own position)

---

## State Isolation Model

**Key insight:** The NSPanel remains a singleton. There is only ever one floating panel. Multi-window support applies only to popped-out WebviewWindows.

### NSPanel (Singleton) - No Changes Required

The existing global state remains valid because there's only one NSPanel:

| State | Purpose | Why It's Fine |
|-------|---------|---------------|
| `PENDING_CONTROL_PANEL` | Stores thread/task for NSPanel to fetch on mount | Only one NSPanel ever reads this |
| `CONTROL_PANEL_PINNED` | Tracks if panel is pinned (won't auto-hide) | Only NSPanel pins/unpins |
| `CONTROL_PANEL_LABEL` | Hardcoded label `"control-panel"` | Only one NSPanel exists |

**NSPanel data flow (unchanged):**
```
Backend: open_control_panel(thread_id, task_id)
  → set_pending_control_panel(...)
  → show_control_panel_internal()

Frontend (on mount): invoke("get_pending_control_panel")
  → Returns thread_id, task_id
  → Renders thread content
```

### WebviewWindows (Multiple) - Fully Isolated

Popped-out windows **do not use any of the singleton state**. They are completely independent:

| Mechanism | How It Works |
|-----------|--------------|
| Thread/task ID | Passed via URL params (`?threadId=...&taskId=...`) |
| Window identity | Unique label (`control-panel-window-{uuid}`) |
| Lifecycle tracking | `CONTROL_PANEL_WINDOWS` registry (new, separate from NSPanel state) |

**WebviewWindow data flow:**
```
Backend: pop_out_control_panel(thread_id, task_id)
  → create WebviewWindow with URL: control-panel.html?threadId=...&instanceId=...
  → register in CONTROL_PANEL_WINDOWS (for cleanup tracking only)

Frontend (on mount): parse URL params
  → threadId from URL (NOT from get_pending_control_panel)
  → Renders thread content
```

### No State Conflicts

Because:
1. NSPanel uses `PENDING_CONTROL_PANEL` singleton → only one consumer
2. WebviewWindows use URL params → no shared mutable state
3. Frontend Zustand stores (`useThreadStore`, etc.) are already thread-safe (data filtered by `threadId`)
4. The `CONTROL_PANEL_WINDOWS` registry is only for tracking open windows for cleanup, not for passing data

---

## Backend Implementation

### 1. Instance Registry

```rust
// src-tauri/src/panels.rs

use std::collections::HashMap;
use std::sync::Mutex;
use once_cell::sync::Lazy;

#[derive(Clone, Debug)]
pub struct ControlPanelWindowInstance {
    pub thread_id: String,
    pub task_id: String,
}

static CONTROL_PANEL_WINDOWS: Lazy<Mutex<HashMap<String, ControlPanelWindowInstance>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn register_window_instance(instance_id: &str, data: ControlPanelWindowInstance) {
    if let Ok(mut instances) = CONTROL_PANEL_WINDOWS.lock() {
        instances.insert(instance_id.to_string(), data);
    }
}

pub fn unregister_window_instance(instance_id: &str) {
    if let Ok(mut instances) = CONTROL_PANEL_WINDOWS.lock() {
        instances.remove(instance_id);
    }
}

pub fn get_window_instance(instance_id: &str) -> Option<ControlPanelWindowInstance> {
    CONTROL_PANEL_WINDOWS.lock().ok()?.get(instance_id).cloned()
}
```

### 2. Get Panel Position

```rust
pub fn get_control_panel_position(app: &AppHandle) -> Result<(f64, f64, f64, f64), String> {
    let panel = app.get_webview_panel(CONTROL_PANEL_LABEL)
        .map_err(|e| format!("Panel not found: {:?}", e))?;

    let frame = panel.as_panel().frame();
    Ok((frame.origin.x, frame.origin.y, frame.size.width, frame.size.height))
}
```

### 3. Create Window at Position

```rust
use tauri::WebviewWindowBuilder;

pub fn create_control_panel_window(
    app: &AppHandle,
    thread_id: &str,
    task_id: &str,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<String, Box<dyn std::error::Error>> {
    let instance_id = uuid::Uuid::new_v4().to_string();
    let label = format!("control-panel-window-{}", instance_id);

    let window = WebviewWindowBuilder::new(
        app,
        &label,
        tauri::WebviewUrl::App(
            format!(
                "control-panel.html?instanceId={}&view=thread&threadId={}",
                instance_id, thread_id
            ).into()
        ),
    )
    .title("Thread")
    .inner_size(width, height)
    .position(x, y)
    .resizable(true)
    .decorations(false)
    .transparent(true)
    .visible(true)
    .always_on_top(true)
    .build()?;

    // Focus the new window
    window.set_focus()?;

    // Register instance
    register_window_instance(&instance_id, ControlPanelWindowInstance {
        thread_id: thread_id.to_string(),
        task_id: task_id.to_string(),
    });

    // Set up close handler to unregister
    let instance_id_clone = instance_id.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            unregister_window_instance(&instance_id_clone);
        }
    });

    Ok(instance_id)
}
```

### 4. Pop Out Command

```rust
#[tauri::command]
pub fn pop_out_control_panel(
    app: AppHandle,
    thread_id: String,
    task_id: String,
) -> Result<String, String> {
    // Get current panel position
    let (x, y, width, height) = get_control_panel_position(&app)?;

    // Hide the NSPanel
    if let Ok(panel) = app.get_webview_panel(CONTROL_PANEL_LABEL) {
        panel.hide();
    }
    clear_pending_control_panel();

    // Create new window at same position
    let instance_id = create_control_panel_window(
        &app,
        &thread_id,
        &task_id,
        x, y, width, height,
    ).map_err(|e| e.to_string())?;

    Ok(instance_id)
}
```

### 5. Close Window Command

```rust
#[tauri::command]
pub fn close_control_panel_window(
    app: AppHandle,
    instance_id: String,
) -> Result<(), String> {
    let label = format!("control-panel-window-{}", instance_id);

    if let Ok(window) = app.get_webview_window(&label) {
        window.close().map_err(|e| e.to_string())?;
    }

    // unregister happens in on_window_event handler
    Ok(())
}
```

### 6. Get Window Instance Data

```rust
#[tauri::command]
pub fn get_control_panel_window_data(
    instance_id: String,
) -> Result<ControlPanelWindowInstance, String> {
    get_window_instance(&instance_id)
        .ok_or_else(|| format!("Window instance {} not found", instance_id))
}
```

### 7. Register Commands

```rust
// In lib.rs, add to invoke_handler
.invoke_handler(tauri::generate_handler![
    // ... existing commands
    pop_out_control_panel,
    close_control_panel_window,
    get_control_panel_window_data,
])
```

---

## Frontend Implementation

### 1. Detect Window Type

```typescript
// src/control-panel-main.tsx

interface WindowConfig {
  type: 'panel' | 'window';
  instanceId: string | null;
  threadId: string | null;
}

function detectWindowConfig(): WindowConfig {
  const params = new URLSearchParams(window.location.search);
  const instanceId = params.get('instanceId');

  return {
    type: instanceId ? 'window' : 'panel',
    instanceId,
    threadId: params.get('threadId'),
  };
}

const windowConfig = detectWindowConfig();
```

### 2. Pop Out Button

```typescript
// In control panel header component

interface PopOutButtonProps {
  threadId: string;
  taskId: string;
}

function PopOutButton({ threadId, taskId }: PopOutButtonProps) {
  const handlePopOut = async () => {
    try {
      await invoke('pop_out_control_panel', { threadId, taskId });
      // NSPanel will hide automatically, new window opens and focuses
    } catch (err) {
      console.error('Failed to pop out:', err);
    }
  };

  return (
    <button
      onClick={handlePopOut}
      title="Open in new window"
      className="p-1 hover:bg-surface-700 rounded"
    >
      <ExternalLinkIcon className="w-4 h-4" />
    </button>
  );
}
```

### 3. Control Panel Header Updates

```typescript
// Show pop-out button only in NSPanel, show close button only in windows

function ControlPanelHeader({ threadId, taskId }: Props) {
  const config = detectWindowConfig();
  const isWindow = config.type === 'window';

  const handleClose = async () => {
    if (isWindow && config.instanceId) {
      await invoke('close_control_panel_window', { instanceId: config.instanceId });
    } else {
      await invoke('hide_control_panel');
    }
  };

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-surface-700">
      <h2 className="text-sm font-medium">Thread</h2>
      <div className="flex items-center gap-1">
        {!isWindow && (
          <PopOutButton threadId={threadId} taskId={taskId} />
        )}
        <button onClick={handleClose} className="p-1 hover:bg-surface-700 rounded">
          <XIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
```

### 4. Window-Specific Behavior

```typescript
// Windows don't hide on blur - they behave like regular windows
// This is handled by NOT setting up the blur handler for windows

function useControlPanelBehavior() {
  const config = detectWindowConfig();

  useEffect(() => {
    if (config.type === 'panel') {
      // Panel-specific blur handling (if any frontend handling needed)
    }
    // Windows: no special handling, standard window behavior
  }, [config.type]);
}
```

---

## Implementation Steps

### Phase 1: Backend Infrastructure
1. Add instance registry (`ControlPanelWindowInstance`, `CONTROL_PANEL_WINDOWS`)
2. Add `get_control_panel_position()` function
3. Add `create_control_panel_window()` function
4. Add `pop_out_control_panel` command
5. Add `close_control_panel_window` command
6. Register commands in `lib.rs`

### Phase 2: Frontend
1. Add `detectWindowConfig()` utility
2. Add Pop Out button to control panel header
3. Update close button behavior based on window type
4. Test URL param flow for windows

### Phase 3: Polish
1. Add keyboard shortcut for pop-out (e.g., Cmd+Shift+P)
2. Remember window positions (optional)
3. Add visual indicator that window is "popped out" vs panel

---

## Trade-offs Acknowledged

**What popped-out windows lose vs NSPanel:**
- Cannot float above fullscreen apps (`always_on_top` is below fullscreen level)
- App activates when window is focused

**What popped-out windows gain:**
- Standard window behavior (minimize, close button)
- Can be moved to other desktop spaces
- Multiple simultaneous windows
- More familiar window management

---

## Testing Checklist

- [ ] Pop out creates window at exact panel position
- [ ] New window receives focus
- [ ] NSPanel hides when popping out
- [ ] Window shows correct thread content
- [ ] Close button closes only that window
- [ ] Multiple windows can coexist
- [ ] Windows persist when NSPanel is shown again
- [ ] Registry cleaned up when windows close
