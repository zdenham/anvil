# Logs Tab

## Summary

Add a new "Logs" tab to the main window sidebar that displays in-memory logs with live updates, filtering, search, and clear functionality. Logs are captured only while the app is running (no disk reading).

## Current State

- Main window has 3 tabs: Tasks, Threads, Settings (in `main-window-layout.tsx`)
- Tab navigation managed by `TabId` type and `navItems` array in `sidebar.tsx`
- Logging infrastructure writes to `logs/structured.jsonl` (for persistence, but we won't read it)
- Frontend logs via `invoke("web_log", ...)` to Rust backend
- Tracing JSON format includes: `timestamp`, `level` (uppercase), `message`, `target`, `thread_id`, `spans`

## Design

### UI Layout

```
┌─────────────────────────────────────────────────────────────┐
│                         Logs Tab                            │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────┐│
│  │ [Search...                    ] [Level ▾] [Clear]       ││
│  └─────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────┐│
│  │ 12:34:56.789 INFO  [target] Message here...             ││
│  │ 12:34:56.790 WARN  [target] Another message...          ││
│  │ 12:34:56.791 ERROR [target] Error message...            ││
│  │ ...                                                     ││
│  │                                                         ││
│  │                    (virtualized list)                   ││
│  │                                                         ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Features

1. **Log Display**: Scrollable list showing timestamp, level, target, and message
2. **Search**: Text filter on message content (case-insensitive)
3. **Level Filter**: Dropdown/toggle to filter by log level (debug, info, warn, error)
4. **Clear Button**: Clears the in-memory log buffer permanently
5. **Auto-scroll**: New logs scroll into view (with toggle to pause)
6. **Color coding**: Different colors for each log level

## Architecture

### In-Memory Only (No Disk Reading)

Logs are captured in-memory only. The Rust backend maintains a circular buffer of recent logs
and emits events to the frontend. **No logs are read from disk** - only logs generated while
the app is running are displayed. Clear permanently removes logs.

**Pros**: Simple mental model, fast, no file I/O
**Cons**: Logs lost on app restart, requires Tauri event bridge

## File Structure

```
src/entities/logs/
  types.ts              # LogEntry, LogLevel, LogFilter types
  store.ts              # Zustand store for logs (pure state, no async)
  service.ts            # Event subscription, clear action
  index.ts              # Exports

src/components/main-window/
  logs-page.tsx         # Main page component
  logs-toolbar.tsx      # Search, level filter, clear button
  log-entry.tsx         # Single log entry component

src-tauri/src/
  logging.rs            # Add in-memory log buffer and event emission
```

## Implementation Steps

### Step 1: Add Tab to Sidebar

**File**: `src/components/main-window/main-window-layout.tsx`
- Add `"logs"` to `TabId` type union

**File**: `src/components/main-window/sidebar.tsx`
- Add logs nav item with `ScrollText` or `FileText` icon from lucide-react
- Position after Threads, before Settings

### Step 2: Create Log Types

**File**: `src/entities/logs/types.ts`
```typescript
// Lowercase for internal use (normalize from tracing's uppercase)
export type LogLevel = "debug" | "info" | "warn" | "error";

// Raw format from tracing_subscriber JSON output
export interface RawLogEntry {
  timestamp: string;    // ISO timestamp
  level: string;        // Uppercase: DEBUG, INFO, WARN, ERROR
  target: string;       // Module/component name
  message?: string;     // May be at top level or nested
  fields?: {
    message?: string;   // Message may be here instead
    [key: string]: unknown;
  };
  thread_id?: string;   // Snake case in JSON
  spans?: Array<{ name: string }>;
}

// Normalized format for frontend use
export interface LogEntry {
  id: string;           // Generated UUID for React keys
  timestamp: string;    // ISO timestamp
  level: LogLevel;      // Normalized to lowercase
  target: string;       // Module/component name
  message: string;      // Extracted from fields if needed
  threadId?: string;    // Camel case for JS
  spans?: string[];     // Just span names
}

export interface LogFilter {
  search: string;
  levels: LogLevel[];   // Empty = show all
}

// Helper to normalize raw log entry
export function normalizeLogEntry(raw: RawLogEntry, id: string): LogEntry {
  return {
    id,
    timestamp: raw.timestamp,
    level: raw.level.toLowerCase() as LogLevel,
    target: raw.target,
    message: raw.message ?? raw.fields?.message ?? "",
    threadId: raw.thread_id,
    spans: raw.spans?.map(s => s.name),
  };
}
```

### Step 3: Create Logs Store

**File**: `src/entities/logs/store.ts`
```typescript
import { create } from "zustand";
import type { LogEntry } from "./types";

const MAX_LOGS = 10000;

interface LogState {
  logs: LogEntry[];
  _hydrated: boolean;
}

interface LogActions {
  hydrate: (logs: LogEntry[]) => void;
  addLog: (entry: LogEntry) => void;
  addLogs: (entries: LogEntry[]) => void;
  clear: () => void;
}

export const useLogStore = create<LogState & LogActions>((set, get) => ({
  logs: [],
  _hydrated: false,

  hydrate: (logs) => set({ logs, _hydrated: true }),

  addLog: (entry) => set((state) => {
    const newLogs = [...state.logs, entry];
    // Circular buffer: drop oldest if exceeding max
    if (newLogs.length > MAX_LOGS) {
      return { logs: newLogs.slice(-MAX_LOGS) };
    }
    return { logs: newLogs };
  }),

  addLogs: (entries) => set((state) => {
    const newLogs = [...state.logs, ...entries];
    if (newLogs.length > MAX_LOGS) {
      return { logs: newLogs.slice(-MAX_LOGS) };
    }
    return { logs: newLogs };
  }),

  clear: () => set({ logs: [] }),
}));
```

- Follow existing pattern: pure state management, no async/Tauri calls
- Implement circular buffer (drop oldest when exceeding MAX_LOGS)

### Step 4: Create In-Memory Log Buffer

**File**: `src-tauri/src/logging.rs`

Add an in-memory circular buffer that captures logs and emits them to the frontend:

```rust
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

const MAX_BUFFERED_LOGS: usize = 10000;

#[derive(Clone, Serialize)]
pub struct LogEvent {
    pub timestamp: String,
    pub level: String,
    pub target: String,
    pub message: String,
}

/// In-memory log buffer for frontend display
pub struct LogBuffer {
    logs: Mutex<Vec<LogEvent>>,
    app_handle: Mutex<Option<AppHandle>>,
}

impl LogBuffer {
    pub fn new() -> Self {
        Self {
            logs: Mutex::new(Vec::new()),
            app_handle: Mutex::new(None),
        }
    }

    pub fn set_app_handle(&self, handle: AppHandle) {
        *self.app_handle.lock() = Some(handle);
    }

    pub fn push(&self, log: LogEvent) {
        // Emit to frontend
        if let Some(handle) = self.app_handle.lock().as_ref() {
            let _ = handle.emit("log-event", &log);
        }

        // Add to buffer (circular)
        let mut logs = self.logs.lock();
        if logs.len() >= MAX_BUFFERED_LOGS {
            logs.remove(0);
        }
        logs.push(log);
    }

    pub fn get_all(&self) -> Vec<LogEvent> {
        self.logs.lock().clone()
    }

    pub fn clear(&self) {
        self.logs.lock().clear();
    }
}

lazy_static::lazy_static! {
    pub static ref LOG_BUFFER: LogBuffer = LogBuffer::new();
}

/// Get all buffered logs (for initial load when tab opens)
#[tauri::command]
pub fn get_buffered_logs() -> Vec<LogEvent> {
    LOG_BUFFER.get_all()
}

/// Clear all buffered logs permanently
#[tauri::command]
pub fn clear_logs() {
    LOG_BUFFER.clear();
}
```

Then modify the tracing layer setup to also push logs to `LOG_BUFFER`.

**File**: `src-tauri/src/lib.rs`
- Call `LOG_BUFFER.set_app_handle(app.handle().clone())` in setup
- Import commands: `logging::get_buffered_logs`, `logging::clear_logs`
- Add to `generate_handler![...]` macro

### Step 5: Create Logs Service

**File**: `src/entities/logs/service.ts`
```typescript
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useLogStore } from "./store";
import { normalizeLogEntry, type RawLogEntry } from "./types";

let unlistenFn: UnlistenFn | null = null;
let idCounter = 0;

export const logService = {
  /**
   * Initializes log subscription. Called once when Logs tab first opens.
   * Gets buffered logs and subscribes to live updates.
   */
  async init(): Promise<void> {
    if (unlistenFn) return; // Already initialized

    // Get buffered logs from Rust
    const buffered = await invoke<RawLogEntry[]>("get_buffered_logs");
    const logs = buffered.map((raw) => normalizeLogEntry(raw, `log-${idCounter++}`));
    useLogStore.getState().hydrate(logs);

    // Subscribe to live log events
    unlistenFn = await listen<RawLogEntry>("log-event", (event) => {
      const log = normalizeLogEntry(event.payload, `log-${idCounter++}`);
      useLogStore.getState().addLog(log);
    });
  },

  /**
   * Clears all logs permanently (both frontend and backend buffer).
   */
  async clear(): Promise<void> {
    await invoke("clear_logs");
    useLogStore.getState().clear();
  },

  /**
   * Cleanup subscription (call on app unmount if needed).
   */
  destroy(): void {
    if (unlistenFn) {
      unlistenFn();
      unlistenFn = null;
    }
  },
};
```

### Step 6: Create Filtered Logs Hook

**File**: `src/entities/logs/index.ts` (export a hook alongside service)
```typescript
import { useMemo } from "react";
import { useLogStore } from "./store";
import type { LogFilter } from "./types";

export function useFilteredLogs(filter: LogFilter) {
  const logs = useLogStore((s) => s.logs);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // Level filter
      if (filter.levels.length > 0 && !filter.levels.includes(log.level)) {
        return false;
      }
      // Search filter (case-insensitive, searches message and target)
      if (filter.search) {
        const search = filter.search.toLowerCase();
        if (!log.message.toLowerCase().includes(search) &&
            !log.target.toLowerCase().includes(search)) {
          return false;
        }
      }
      return true;
    });
  }, [logs, filter.levels, filter.search]);

  return { filteredLogs, totalCount: logs.length };
}

export { useLogStore } from "./store";
export { logService } from "./service";
export * from "./types";
```

### Step 7: Create Log Entry Component

**File**: `src/components/main-window/log-entry.tsx`
```tsx
import type { LogEntry, LogLevel } from "@/entities/logs";

const levelStyles: Record<LogLevel, { text: string; bg: string }> = {
  debug: { text: "text-slate-400", bg: "" },
  info:  { text: "text-blue-400",  bg: "" },
  warn:  { text: "text-amber-400", bg: "bg-amber-950/20" },
  error: { text: "text-red-400",   bg: "bg-red-950/30" },
};

interface LogEntryRowProps {
  log: LogEntry;
}

export function LogEntryRow({ log }: LogEntryRowProps) {
  const style = levelStyles[log.level];
  const time = new Date(log.timestamp).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });

  return (
    <div className={`flex gap-2 px-2 py-0.5 font-mono text-xs ${style.bg}`}>
      <span className="text-slate-500 shrink-0">{time}</span>
      <span className={`w-12 shrink-0 uppercase ${style.text}`}>{log.level}</span>
      <span className="text-slate-500 shrink-0 truncate max-w-32">[{log.target}]</span>
      <span className="text-slate-300 truncate">{log.message}</span>
    </div>
  );
}
```

- Monospace font, compact rows
- Color coded levels with subtle row backgrounds for warn/error
- Timestamp formatted as HH:MM:SS.mmm
- Truncate target and message (consider expand on click as enhancement)

### Step 8: Create Logs Toolbar

**File**: `src/components/main-window/logs-toolbar.tsx`
- Search input (reuse pattern from existing toolbars)
- Level filter chips (toggleable: debug, info, warn, error) with matching colors
- Clear button (permanently clears all logs)
- Count display: "Showing X of Y logs"

### Step 9: Create Logs Page

**File**: `src/components/main-window/logs-page.tsx`
- State: `filter: LogFilter`, `autoScroll: boolean`
- Use `useFilteredLogs(filter)` hook
- Initialize: call `logService.init()` on first mount via `useEffect`
- Render toolbar + scrollable log list
- Handle empty state and loading state
- Auto-scroll to bottom when new logs arrive (if enabled)
- Live updates arrive automatically via event subscription

### Step 10: Wire Up Main Window

**File**: `src/components/main-window/main-window-layout.tsx`
- Add `"logs"` to `TabId` type: `type TabId = "tasks" | "threads" | "logs" | "settings";`
- Import `LogsPage`
- Add case for `activeTab === "logs"` rendering `<LogsPage />`

### Step 11: Export from Entities Index

**File**: `src/entities/index.ts`
- Add exports for logs module:
```typescript
// Logs
export { useLogStore, useFilteredLogs } from "./logs";
export { logService } from "./logs";
export * from "./logs/types";
```

**Note**: Do NOT add `logService.init()` to `hydrateEntities()`.
Logs are initialized lazily when the Logs tab is first opened.
Event subscription only starts when the tab is accessed.

## Optional Enhancements (Future)

1. **Export**: Button to export filtered logs as JSON/text
2. **Persistence**: Remember filter settings
3. **Log Details Modal**: Click to see full log entry with all metadata
4. **Virtualization**: Use `react-window` for very large log lists
5. **Regex Search**: Advanced search with regex support

## Dependencies

- Rust: `lazy_static` and `parking_lot` (check if already in Cargo.toml)
- Uses existing: lucide-react, zustand, tailwind

## Key Imports Reference

| Import | Source | Purpose |
|--------|--------|---------|
| `ScrollText` | `lucide-react` | Tab icon |
| `invoke` | `@tauri-apps/api/core` | Call Rust commands |
| `listen` | `@tauri-apps/api/event` | Subscribe to log events |
| `create` | `zustand` | Log store |
| `useFilteredLogs` | `@/entities/logs` | Filtered logs hook |
| `logService` | `@/entities/logs` | Service for init/clear |
| `LogEntry`, `LogLevel` | `@/entities/logs` | Type definitions |

## Testing Checklist

- [ ] Tab appears in sidebar between Threads and Settings
- [ ] Buffered logs load on first tab open
- [ ] Live logs appear in real-time as they're generated
- [ ] Search filters logs by message and target content
- [ ] Level filter chips work (toggle each level, visual feedback)
- [ ] Level colors display correctly (debug=slate, info=blue, warn=amber, error=red)
- [ ] Error/warn rows have subtle background highlighting
- [ ] Clear button permanently empties logs (frontend and backend)
- [ ] Buffer limit prevents memory issues (circular buffer works)
- [ ] Auto-scroll follows new logs (when enabled)
- [ ] Empty state displays appropriately
- [ ] Timestamps formatted as HH:MM:SS.mmm
