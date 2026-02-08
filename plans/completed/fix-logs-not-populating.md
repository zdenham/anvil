# Fix Logs Not Populating to Frontend UI

## Problem Summary

Logs are not being displayed in the frontend Logs tab UI. The logging infrastructure exists but is incomplete - critical Tauri commands were never implemented.

## Part 1: Diagnosis and Proposed Fix

### Root Cause Analysis

After examining the codebase, I identified the following issues:

#### 1. Missing Tauri Commands (Critical)

The `LogBuffer` in `src-tauri/src/logging/mod.rs` exists and correctly captures logs via the `BufferLayer` tracing subscriber. However, **two essential Tauri commands are missing**:

- **`get_buffered_logs`** - Called by `logService.init()` to get existing logs when the Logs tab opens
- **`clear_logs`** - Called by `logService.clear()` to clear all logs

**Evidence**:
- `src-tauri/src/lib.rs` line 816-948: The `generate_handler!` macro does NOT include `get_buffered_logs` or `clear_logs`
- `src/entities/logs/service.ts` line 18: Calls `invoke<RawLogEntry[]>("get_buffered_logs")` which will fail silently
- `plans/completed/logs-tab.md` lines 258-266: Shows these commands were planned but never implemented

#### 2. Missing LogBuffer Methods

The `LogBuffer` struct (line 114-196) only has:
- `new()` - constructor
- `set_app_handle()` - sets the Tauri app handle
- `should_emit()` - throttle check
- `push()` - add a log entry

**Missing methods**:
- `get_all()` - to return all buffered logs for initial hydration
- `clear()` - to clear the buffer

#### 3. Event Emission Works (Partial Success)

The `push()` method at line 180-185 does emit `"log-event"` to the frontend:
```rust
if let Some(handle) = guard.as_ref() {
    let _ = handle.emit("log-event", &log);
}
```

This means **live log streaming should work** if the frontend were already listening. However, the initial hydration fails because:
1. `logService.init()` calls `invoke("get_buffered_logs")` first
2. This fails (command doesn't exist)
3. The service may not properly continue to set up the listener

### Proposed Fix

#### Step 1: Add Missing Methods to LogBuffer

Add these methods to the `LogBuffer` impl in `src-tauri/src/logging/mod.rs`:

```rust
impl LogBuffer {
    // ... existing methods ...

    /// Get all buffered logs (for initial frontend load)
    fn get_all(&self) -> Vec<LogEvent> {
        self.logs.lock().map(|logs| logs.clone()).unwrap_or_default()
    }

    /// Clear all buffered logs
    fn clear(&self) {
        if let Ok(mut logs) = self.logs.lock() {
            logs.clear();
        }
        // Also clear the dedup tracker
        if let Ok(mut last_emit) = self.last_emit.lock() {
            last_emit.clear();
        }
    }
}
```

#### Step 2: Add Tauri Commands

Add these commands at the end of `src-tauri/src/logging/mod.rs`:

```rust
/// Get all buffered logs for initial frontend hydration
#[tauri::command]
pub fn get_buffered_logs() -> Vec<LogEvent> {
    LOG_BUFFER.get_all()
}

/// Clear all buffered logs
#[tauri::command]
pub fn clear_logs() {
    LOG_BUFFER.clear();
}
```

#### Step 3: Register Commands in lib.rs

In `src-tauri/src/lib.rs`, add to the `generate_handler!` macro (around line 816):

```rust
.invoke_handler(tauri::generate_handler![
    web_log,
    // Logging commands (NEW)
    logging::get_buffered_logs,
    logging::clear_logs,
    // ... rest of handlers
])
```

#### Step 4: Update Frontend Error Handling (Optional but Recommended)

In `src/entities/logs/service.ts`, add better error handling:

```typescript
async init(): Promise<void> {
  if (unlistenFn) return;

  try {
    const buffered = await invoke<RawLogEntry[]>("get_buffered_logs");
    const logs = buffered.map((raw) =>
      normalizeLogEntry(raw, `log-${idCounter++}`)
    );
    useLogStore.getState().hydrate(logs);
  } catch (e) {
    console.error("Failed to get buffered logs:", e);
    // Still hydrate with empty array so UI shows properly
    useLogStore.getState().hydrate([]);
  }

  // Always set up live listener even if initial fetch fails
  unlistenFn = await listen<RawLogEntry>("log-event", (event) => {
    const log = normalizeLogEntry(event.payload, `log-${idCounter++}`);
    useLogStore.getState().addLog(log);
  });
}
```

### Files to Modify

| File | Changes |
|------|---------|
| `src-tauri/src/logging/mod.rs` | Add `get_all()`, `clear()` methods and `get_buffered_logs`, `clear_logs` commands |
| `src-tauri/src/lib.rs` | Register `logging::get_buffered_logs` and `logging::clear_logs` in `generate_handler!` |
| `src/entities/logs/service.ts` | (Optional) Add error handling for robustness |

---

## Part 2: Verification Strategy

### Automated Verification Approach

The verification should confirm:
1. Logs are being emitted from the backend
2. The `get_buffered_logs` command returns data
3. The `log-event` listener receives live updates
4. The frontend Logs page displays the logs

### Verification Steps

#### Step 1: Start the Development Server

```bash
# In the project root
npm run tauri dev
```

This starts both the Vite dev server and the Tauri application.

#### Step 2: Verify Backend Logging Works

Check that logs are being written to the console and JSON file:
- Console output should show timestamped, colored logs
- Check `~/.config/mortician/logs/structured.jsonl` for JSON log entries

#### Step 3: Navigate to Logs Tab

Since this is a Tauri desktop app, programmatic navigation options:

**Option A: Menu Navigation**
- The app has a View menu with navigation items
- Navigate via menu: View → Logs (or use the menu item ID `nav_logs`)

**Option B: Emit Navigation Event**
- If you have access to browser dev tools in the Tauri window:
```javascript
// In browser console of Tauri window
window.__TAURI__.event.emit('navigate', 'logs');
```

**Option C: Direct URL (if routed)**
- Check if there's a route like `/logs` that can be accessed directly

#### Step 4: Monitor Log Population

Once on the Logs page, verify:

1. **Initial Load**: The "Loading logs..." state should resolve
2. **Log Count**: The toolbar should show log count (e.g., "42 logs")
3. **Log Content**: Logs should appear with:
   - Timestamp (right side, in milliseconds)
   - Level indicator (color-coded: debug=gray, info=blue, warn=amber, error=red)
   - Target (module name)
   - Message

#### Step 5: Verify Live Updates

1. Trigger actions that generate logs:
   - Open/close windows
   - Navigate between tabs
   - Perform git operations
   - Start/stop agents

2. Watch the Logs page - new entries should appear at the bottom (with auto-scroll)

#### Step 6: Verify Filter and Clear

1. **Search**: Type in the search box - logs should filter
2. **Level Filter**: Select different levels - logs should filter by level
3. **Clear**: Click clear button - logs should disappear and backend buffer should empty

### Integration Test Approach

For CI/automated testing, create a test that:

```typescript
// Example integration test concept
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

describe('Logs Integration', () => {
  it('should retrieve buffered logs', async () => {
    const logs = await invoke('get_buffered_logs');
    expect(Array.isArray(logs)).toBe(true);
    // After app starts, there should be at least the "Logging initialized" log
    expect(logs.length).toBeGreaterThan(0);
  });

  it('should receive live log events', async () => {
    const received: any[] = [];
    const unlisten = await listen('log-event', (event) => {
      received.push(event.payload);
    });

    // Trigger a log by calling web_log
    await invoke('web_log', { level: 'info', message: 'Test log' });

    // Wait a bit for event propagation
    await new Promise(r => setTimeout(r, 100));

    expect(received.length).toBeGreaterThan(0);
    expect(received[0].message).toContain('Test log');

    unlisten();
  });

  it('should clear logs', async () => {
    await invoke('clear_logs');
    const logs = await invoke('get_buffered_logs');
    expect(logs.length).toBe(0);
  });
});
```

### Manual Verification Checklist

- [ ] Start `npm run tauri dev`
- [ ] App launches without errors
- [ ] Navigate to Logs tab
- [ ] Logs appear (not stuck on "Loading logs...")
- [ ] Log count shown in toolbar matches visible logs
- [ ] New logs appear when actions are performed
- [ ] Auto-scroll works (new logs stay visible)
- [ ] Manual scroll disables auto-scroll
- [ ] "Scroll to bottom" button appears when scrolled up
- [ ] Search filter works
- [ ] Level filter works
- [ ] Clear button clears all logs
- [ ] After clear, new logs continue to appear

---

## Phases

- [x] Implement LogBuffer `get_all()` and `clear()` methods
- [x] Add `get_buffered_logs` and `clear_logs` Tauri commands
- [x] Register commands in `generate_handler!` macro
- [ ] (Optional) Improve frontend error handling
- [ ] Verify fix with manual testing

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Expected Outcome

After implementing this fix:
1. Opening the Logs tab will show all buffered logs from app startup
2. Live logs will appear in real-time as they're generated
3. The clear button will properly clear all logs
4. The filter and search functionality will work as designed
