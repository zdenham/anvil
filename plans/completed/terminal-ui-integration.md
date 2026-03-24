# Terminal UI Integration Plan

## Overview

Integrate a terminal UI into Anvil using **direct `portable-pty` integration** with xterm.js on the frontend. This approach gives us full control over PTY behavior while leveraging a battle-tested library (2.5M+ downloads, powers WezTerm).

**Stack**:
- Backend: `portable-pty` (v0.9.0) with custom Tauri commands
- Frontend: `@xterm/xterm` + addons (fit, webgl, search)
- Integration: Terminal as a content pane type (aligned with main window refactor)

**Why Direct Integration**:
1. Anvil already has shell infrastructure in `src-tauri/src/shell.rs` - established patterns for Tauri commands and environment handling
2. Full control over data flow - integrates with existing event bridge architecture
3. Fewer dependencies - no reliance on external plugin projects
4. Battle-tested - portable-pty is part of WezTerm, actively maintained
5. Modest code overhead - only ~100-150 lines of Rust for the PTY manager
6. Easier debugging - own the code vs. an abstraction layer

**Reference Projects** (for architecture patterns):
- [marc2332/tauri-terminal](https://github.com/marc2332/tauri-terminal) - Minimal xterm.js + portable-pty example
- [Terminon](https://github.com/Shabari-K-S/terminon) - Full-featured Tauri terminal with tabs/splits

---

## Key Decisions

1. **Content Pane Infrastructure**: Main window refactor is complete. `ContentPaneView` types are in place.

2. **Event System**: Terminal events use the existing event bridge (`src/entities/events.ts`) with a `terminal:` namespace. Events:
   - `terminal:output` - PTY output data
   - `terminal:exit` - Process exited
   - `terminal:created` - New terminal session
   - `terminal:killed` - Terminal archived/killed

3. **Session Lifecycle**:
   - Closing a content pane does NOT kill the terminal - it persists in background
   - Terminals appear in left sidebar menu for reconnection
   - "Archive" button (like other content panes) kills the PTY process
   - Each terminal is its own content pane (VS Code style)

4. **Working Directory**: Defaults to the worktree root from which the terminal was opened.

5. **UI Entry Point**: "New Terminal" option in the repo/worktree context menu (the plus dropdown on each worktree item), NOT in the header. This is alongside "New Thread" etc.

6. **Terminal Display in Sidebar**: Show last executed command with overflow ellipsis (e.g., "npm run dev..." or "git status..."). Falls back to shell name if no command yet.

7. **Exited Terminal Behavior**: Stay in sidebar with visual indicator (dimmed/badge), remain viewable with scrollback history. User must explicitly archive to remove.

8. **Sidebar Organization**: Terminals appear mixed with threads/plans under their respective worktree, NOT in a separate "Terminals" section. Scoped to worktrees.

9. **Content Pane Controls**: Both "close" (hides pane, keeps terminal alive) and "archive" (kills PTY) buttons in content pane header.

10. **Last Command Detection**: Hook into `~/.zsh_history` to get the last executed command for sidebar display. Poll or watch the file for changes.

11. **Terminal Output Buffering**: Store last N lines of output (configurable, e.g., 5000 lines) so users can see scrollback when reopening a closed pane.

12. **Initial Terminal Size**: Use "fit to container" approach - measure container dimensions before spawning, or spawn then immediately resize on mount.

13. **Worktree Deletion**: Automatically kill any terminals associated with a removed worktree.

14. **Error Handling**: Spawn failures show an error state in the content pane (not toast). User sees the error where they expected the terminal.

15. **Zsh History Scope**: Accept that history may show commands from other sessions - simpler approach, history is shared anyway.

16. **Multiple Terminals Same Worktree**: No special differentiation needed - last command display is sufficient.

17. **Terminal Theming**: Hardcoded to match Anvil's dark theme (not configurable initially).

18. **Keyboard Focus**: Terminal receives focus when pane opens and on click. No keyboard capture when focused elsewhere.

19. **Copy/Paste**: macOS only - Cmd+V pastes. Standard Cmd+C copies selection (xterm.js default behavior).

20. **Shell Support**: Only zsh history integration for v1. Other shells (bash, fish) fall back to showing shell name. Can expand later.

21. **Terminal Icon**: Use Lucide `Terminal` icon for sidebar items (consistent with existing header button).

22. **Sidebar Sorting**: Same as threads/plans - sorted by `createdAt` (newest first).

23. **App Quit Behavior**: Kill all terminal PTY processes on quit (clean exit, no orphaned processes).

24. **Accessibility**: Defer to later phase. xterm.js has built-in accessibility features we can enable later.

---

## Terminal Session Entity (`src/entities/terminal-sessions/`)

Following the existing entity pattern (threads, plans, worktrees), terminal sessions need their own entity layer.

### Schema (`src/entities/terminal-sessions/schema.ts`)

```typescript
import { z } from "zod";

export const TerminalSessionSchema = z.object({
  id: z.string(),
  worktreeId: z.string(),
  worktreePath: z.string(),
  lastCommand: z.string().optional(),  // For sidebar display (from zsh_history)
  createdAt: z.string().datetime(),
  isAlive: z.boolean(),
  isArchived: z.boolean(),
});

export type TerminalSession = z.infer<typeof TerminalSessionSchema>;

// Output buffer stored separately (not in schema - runtime only)
export const OUTPUT_BUFFER_MAX_LINES = 5000;
```

### Service (`src/entities/terminal-sessions/service.ts`)

```typescript
import { invoke } from "@tauri-apps/api/core";
import { eventBus } from "@/entities/events";
import type { TerminalSession } from "./schema";

class TerminalSessionService {
  private sessions: Map<string, TerminalSession> = new Map();
  private outputBuffers: Map<string, string[]> = new Map();  // Stores last N lines per terminal

  async create(worktreeId: string, worktreePath: string): Promise<TerminalSession> {
    const numericId = await invoke<number>("spawn_terminal", {
      cols: 80,
      rows: 24,
      cwd: worktreePath,
    });

    const session: TerminalSession = {
      id: String(numericId),
      worktreeId,
      worktreePath,
      lastCommand: undefined,
      createdAt: new Date().toISOString(),
      isAlive: true,
      isArchived: false,
    };

    this.sessions.set(session.id, session);
    eventBus.emit("terminal:created", session);
    return session;
  }

  async archive(id: string): Promise<void> {
    await invoke("kill_terminal", { id: parseInt(id) });
    const session = this.sessions.get(id);
    if (session) {
      session.isArchived = true;
      session.isAlive = false;
      this.sessions.delete(id);
      eventBus.emit("terminal:archived", { id });
    }
  }

  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  getByWorktree(worktreeId: string): TerminalSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.worktreeId === worktreeId && !s.isArchived);
  }

  getAll(): TerminalSession[] {
    return Array.from(this.sessions.values()).filter(s => !s.isArchived);
  }

  updateLastCommand(id: string, command: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.lastCommand = command;
      eventBus.emit("terminal:updated", { id, lastCommand: command });
    }
  }

  markExited(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.isAlive = false;
      eventBus.emit("terminal:exited", { id });
    }
  }

  // Output buffer management
  appendOutput(id: string, data: string): void {
    let buffer = this.outputBuffers.get(id) || [];
    const lines = data.split('\n');
    buffer.push(...lines);
    // Keep only last N lines
    if (buffer.length > OUTPUT_BUFFER_MAX_LINES) {
      buffer = buffer.slice(-OUTPUT_BUFFER_MAX_LINES);
    }
    this.outputBuffers.set(id, buffer);
  }

  getOutputBuffer(id: string): string[] {
    return this.outputBuffers.get(id) || [];
  }

  // Kill terminals when worktree is removed
  async archiveByWorktree(worktreeId: string): Promise<void> {
    const terminals = this.getByWorktree(worktreeId);
    await Promise.all(terminals.map(t => this.archive(t.id)));
  }
}

export const terminalSessionService = new TerminalSessionService();
```

### Hook (`src/entities/terminal-sessions/use-terminal-sessions.ts`)

```typescript
import { useSyncExternalStore } from "react";
import { terminalSessionService } from "./service";
import { eventBus } from "@/entities/events";

export function useTerminalSessions(worktreeId?: string) {
  return useSyncExternalStore(
    (callback) => {
      eventBus.on("terminal:created", callback);
      eventBus.on("terminal:archived", callback);
      eventBus.on("terminal:exited", callback);
      eventBus.on("terminal:updated", callback);
      return () => {
        eventBus.off("terminal:created", callback);
        eventBus.off("terminal:archived", callback);
        eventBus.off("terminal:exited", callback);
        eventBus.off("terminal:updated", callback);
      };
    },
    () => worktreeId
      ? terminalSessionService.getByWorktree(worktreeId)
      : terminalSessionService.getAll()
  );
}
```

### Events (add to `src/entities/events.ts`)

```typescript
// Terminal namespace events
"terminal:created": TerminalSession;
"terminal:archived": { id: string };
"terminal:exited": { id: string };
"terminal:updated": { id: string; lastCommand: string };
"terminal:output": { id: number; data: number[] };
```

---

## Backend Implementation

### PTY Manager (`src-tauri/src/terminal.rs`)

```rust
use portable_pty::{native_pty_system, CommandBuilder, PtySize, PtyPair, Child};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::io::{Read, Write};
use tauri::{AppHandle, Manager};

pub struct TerminalSession {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub child: Box<dyn Child + Send + Sync>,
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
    pub cwd: String,  // Track original working directory for display
}

pub struct TerminalManager {
    sessions: HashMap<u32, TerminalSession>,
    next_id: u32,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: HashMap::new(),
            next_id: 1,
        }
    }
}

pub type TerminalState = Arc<Mutex<TerminalManager>>;

#[tauri::command]
pub async fn spawn_terminal(
    state: tauri::State<'_, TerminalState>,
    app: AppHandle,
    cols: u16,
    rows: u16,
    cwd: String,  // Required - always the worktree root
) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| e.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-l"); // Login shell
    cmd.cwd(&cwd);

    cmd.env("TERM", "xterm-256color");
    cmd.env("HOME", std::env::var("HOME").unwrap_or_default());
    cmd.env("USER", std::env::var("USER").unwrap_or_default());

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let mut manager = state.lock().unwrap();
    let id = manager.next_id;
    manager.next_id += 1;

    // Spawn reader thread to emit output events via event bridge
    let app_clone = app.clone();
    let mut reader_clone = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader_clone.read(&mut buf) {
                Ok(0) => {
                    // Emit via event bridge namespace
                    app_clone.emit("terminal:exit", serde_json::json!({ "id": id })).ok();
                    break;
                }
                Ok(n) => {
                    app_clone.emit("terminal:output", serde_json::json!({
                        "id": id,
                        "data": &buf[..n]
                    })).ok();
                }
                Err(_) => break,
            }
        }
    });

    manager.sessions.insert(id, TerminalSession {
        master: pair.master,
        child,
        reader,
        writer,
        cwd: cwd.clone(),
    });

    // Emit terminal:created event for sidebar to pick up
    app.emit("terminal:created", serde_json::json!({
        "id": id,
        "cwd": cwd
    })).ok();

    Ok(id)
}

#[tauri::command]
pub async fn write_terminal(
    state: tauri::State<'_, TerminalState>,
    id: u32,
    data: Vec<u8>,
) -> Result<(), String> {
    let mut manager = state.lock().unwrap();
    let session = manager.sessions.get_mut(&id).ok_or("Terminal not found")?;
    session.writer.write_all(&data).map_err(|e| e.to_string())?;
    session.writer.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn resize_terminal(
    state: tauri::State<'_, TerminalState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let manager = state.lock().unwrap();
    let session = manager.sessions.get(&id).ok_or("Terminal not found")?;
    session.master.resize(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn kill_terminal(
    state: tauri::State<'_, TerminalState>,
    app: AppHandle,
    id: u32,
) -> Result<(), String> {
    let mut manager = state.lock().unwrap();
    if let Some(mut session) = manager.sessions.remove(&id) {
        session.child.kill().ok();
        // Emit terminal:killed event for sidebar to update
        app.emit("terminal:killed", serde_json::json!({ "id": id })).ok();
    }
    Ok(())
}

#[tauri::command]
pub async fn list_terminals(
    state: tauri::State<'_, TerminalState>,
) -> Result<Vec<u32>, String> {
    let manager = state.lock().unwrap();
    Ok(manager.sessions.keys().copied().collect())
}
```

### Register in Tauri (`src-tauri/src/lib.rs`)

```rust
mod terminal;

use terminal::{TerminalManager, TerminalState};
use std::sync::{Arc, Mutex};

fn main() {
    tauri::Builder::default()
        .manage(Arc::new(Mutex::new(TerminalManager::new())) as TerminalState)
        .invoke_handler(tauri::generate_handler![
            terminal::spawn_terminal,
            terminal::write_terminal,
            terminal::resize_terminal,
            terminal::kill_terminal,
            terminal::list_terminals,
        ])
        .run(tauri::generate_context!())
        .expect("error running tauri application");
}
```

---

## Shell Configuration

The terminal spawns the user's default shell as a login shell:

```rust
let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
let mut cmd = CommandBuilder::new(&shell);
cmd.arg("-l"); // Login shell - loads .zprofile/.bash_profile

cmd.env("TERM", "xterm-256color");
cmd.env("HOME", std::env::var("HOME").unwrap_or_default());
cmd.env("USER", std::env::var("USER").unwrap_or_default());
```

---

## Frontend Implementation

### Terminal Content Component (`src/components/content-pane/terminal-content.tsx`)

```typescript
import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

interface TerminalContentProps {
  paneId: string;
  terminalId: string;
  onClose: () => void;
  onPopOut?: () => void;
}

export function TerminalContent({ terminalId, onClose }: TerminalContentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: 13,
      theme: {
        background: "#1e1e1e",
        foreground: "#d4d4d4",
        cursor: "#d4d4d4",
      },
    });

    const fitAddon = new FitAddon();
    const webglAddon = new WebglAddon();
    const searchAddon = new SearchAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webglAddon);
    terminal.loadAddon(searchAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Listen for PTY output
    let unlisten: UnlistenFn;
    listen<number[]>(`terminal:output:${terminalId}`, (event) => {
      const data = new Uint8Array(event.payload);
      terminal.write(data);
    }).then((fn) => (unlisten = fn));

    // Listen for terminal exit
    let unlistenExit: UnlistenFn;
    listen(`terminal:exit:${terminalId}`, () => {
      terminal.write("\r\n[Process exited]\r\n");
    }).then((fn) => (unlistenExit = fn));

    // Send input to PTY
    terminal.onData((data) => {
      invoke("write_terminal", {
        id: parseInt(terminalId),
        data: Array.from(new TextEncoder().encode(data)),
      });
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      invoke("resize_terminal", {
        id: parseInt(terminalId),
        cols: terminal.cols,
        rows: terminal.rows,
      });
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      unlisten?.();
      unlistenExit?.();
      resizeObserver.disconnect();
      terminal.dispose();
    };
  }, [terminalId]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
    />
  );
}
```

---

## Content Pane Integration

The terminal is a content pane view type, alongside threads, plans, settings, and logs:

Update `ContentPaneView` type in `src/components/content-pane/types.ts`:

```typescript
export type ContentPaneView =
  | { type: "empty" }
  | { type: "thread"; threadId: string }
  | { type: "plan"; planId: string }
  | { type: "settings" }
  | { type: "logs" }
  | { type: "terminal"; terminalId: string };  // ADD
```

---

## Implementation Phases

**Prerequisite**: Main window refactor should be complete or in progress (content pane infrastructure).

### Phase 1: Backend PTY Infrastructure ✅
1. Add `portable-pty = "0.9"` to Cargo.toml
2. Create `src-tauri/src/terminal.rs` with PTY manager (see Backend Implementation above)
3. Register terminal commands in `src-tauri/src/lib.rs`
4. Test spawn/write/resize/kill cycle

### Phase 2: Terminal Session Entity ✅
1. Create `src/entities/terminal-sessions/` following existing entity patterns
2. Implement schema, service, and React hook
3. Add terminal events to `src/entities/events.ts`
4. Wire up Tauri event listeners for backend events

### Phase 3: Frontend Terminal Pane ✅
1. Add xterm.js packages to package.json
2. Create `src/components/content-pane/terminal-content.tsx`
3. Update `ContentPaneView` type to include terminal
4. Update `ContentPane` component to render `TerminalContent`
5. Add both "close" and "archive" buttons to terminal pane header

### Phase 4: UI Integration (Worktree Menu) ✅
1. Add "New Terminal" option to worktree context menu (plus dropdown)
2. Terminal opens in the worktree path from which it was triggered
3. Handle terminal exit (show "[Process exited]" message in pane)

### Phase 5: Tree Menu / Sidebar Integration (Required) ✅
1. Create `terminal-tree-item.tsx` component for sidebar
2. Display terminals under their respective worktree (mixed with threads/plans)
3. Show last command with ellipsis overflow as the item label
4. Visual indicator for exited terminals (dimmed)
5. Click to open/focus content pane
6. Archive button kills PTY and removes from list

### Phase 6: Polish ✅
1. Debounced resize handling
2. Copy/paste keyboard shortcuts (Cmd+C/V)
3. Basic theming (match Anvil dark theme)

### Phase 7: Advanced (Optional)
1. Session persistence across app restart
2. macOS Terminal.app preference import
3. Split terminal panes

---

## Dependencies

### Cargo.toml
```toml
[dependencies]
portable-pty = "0.9"
```

### package.json
```bash
pnpm add @xterm/xterm @xterm/addon-fit @xterm/addon-webgl @xterm/addon-search
```

---

## File Structure

```
src/entities/terminal-sessions/
├── index.ts                    # NEW - Entity exports
├── schema.ts                   # NEW - Zod schema
├── service.ts                  # NEW - Session management
├── use-terminal-sessions.ts    # NEW - React hook

src/components/content-pane/
├── terminal-content.tsx        # NEW - xterm.js wrapper

src/components/tree-menu/
├── terminal-tree-item.tsx      # NEW - Sidebar terminal item

src-tauri/src/
├── terminal.rs                 # NEW - PTY management
├── lib.rs                      # Register terminal commands
```

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| PTY communication issues | portable-pty powers WezTerm, battle-tested |
| Performance with large output | WebGL addon + throttling |
| Window resize edge cases | Debounce resize events |
| Shell environment differences | Test with zsh, bash, fish |

---

## Sources

- [portable-pty](https://docs.rs/portable-pty) - Cross-platform PTY library
- [xterm.js](https://xtermjs.org/) - Terminal emulator
- [marc2332/tauri-terminal](https://github.com/marc2332/tauri-terminal) - Reference implementation
- [Terminon](https://github.com/Shabari-K-S/terminon) - Full-featured Tauri terminal
