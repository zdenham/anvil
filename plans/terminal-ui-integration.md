# Terminal UI Integration Plan

## Overview

Integrate a terminal UI into Mort using **direct `portable-pty` integration** with xterm.js on the frontend. This approach gives us full control over PTY behavior while leveraging a battle-tested library (2.5M+ downloads, powers WezTerm).

**Stack**:
- Backend: `portable-pty` (v0.9.0) with custom Tauri commands
- Frontend: `@xterm/xterm` + addons (fit, webgl, search)
- Integration: Terminal as a content pane type (aligned with main window refactor)

**Why Direct Integration**:
1. Mort already has shell infrastructure in `src-tauri/src/shell.rs` - established patterns for Tauri commands and environment handling
2. Full control over data flow - integrates with existing event bridge architecture
3. Fewer dependencies - no reliance on external plugin projects
4. Battle-tested - portable-pty is part of WezTerm, actively maintained
5. Modest code overhead - only ~100-150 lines of Rust for the PTY manager
6. Easier debugging - own the code vs. an abstraction layer

**Reference Projects** (for architecture patterns):
- [marc2332/tauri-terminal](https://github.com/marc2332/tauri-terminal) - Minimal xterm.js + portable-pty example
- [Terminon](https://github.com/Shabari-K-S/terminon) - Full-featured Tauri terminal with tabs/splits

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
    cwd: Option<String>,
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

    if let Some(dir) = cwd {
        cmd.cwd(dir);
    }

    cmd.env("TERM", "xterm-256color");
    cmd.env("HOME", std::env::var("HOME").unwrap_or_default());
    cmd.env("USER", std::env::var("USER").unwrap_or_default());

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let mut manager = state.lock().unwrap();
    let id = manager.next_id;
    manager.next_id += 1;

    // Spawn reader thread to emit output events
    let app_clone = app.clone();
    let mut reader_clone = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader_clone.read(&mut buf) {
                Ok(0) => {
                    app_clone.emit(&format!("terminal:exit:{}", id), ()).ok();
                    break;
                }
                Ok(n) => {
                    app_clone.emit(&format!("terminal:output:{}", id), &buf[..n]).ok();
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
    });

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
    id: u32,
) -> Result<(), String> {
    let mut manager = state.lock().unwrap();
    if let Some(mut session) = manager.sessions.remove(&id) {
        session.child.kill().ok();
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

### Terminal Store (`src/stores/terminal-store.ts`)

```typescript
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

interface TerminalSession {
  id: string;
  title: string;
  cwd: string;
  createdAt: Date;
  isAlive: boolean;
}

interface TerminalStore {
  terminals: Record<string, TerminalSession>;
  createTerminal: (cwd?: string) => Promise<string>;
  closeTerminal: (id: string) => Promise<void>;
  getTerminal: (id: string) => TerminalSession | undefined;
}

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  terminals: {},

  createTerminal: async (cwd?: string) => {
    const numericId = await invoke<number>("spawn_terminal", {
      cols: 80,
      rows: 24,
      cwd,
    });
    const id = String(numericId);

    set((state) => ({
      terminals: {
        ...state.terminals,
        [id]: {
          id,
          title: "zsh",
          cwd: cwd || process.env.HOME || "/",
          createdAt: new Date(),
          isAlive: true,
        },
      },
    }));

    return id;
  },

  closeTerminal: async (id: string) => {
    await invoke("kill_terminal", { id: parseInt(id) });
    set((state) => {
      const { [id]: _, ...rest } = state.terminals;
      return { terminals: rest };
    });
  },

  getTerminal: (id: string) => get().terminals[id],
}));
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

### Phase 1: Backend PTY Infrastructure
1. Add `portable-pty = "0.9"` to Cargo.toml
2. Create `src-tauri/src/terminal.rs` with PTY manager (see Backend Implementation above)
3. Register terminal commands in `src-tauri/src/lib.rs`
4. Test spawn/write/resize/kill cycle

### Phase 2: Frontend Terminal Pane
1. Add xterm.js packages to package.json
2. Create `src/components/content-pane/terminal-content.tsx` (see Frontend Implementation above)
3. Create `src/stores/terminal-store.ts` for session state
4. Update `ContentPaneView` type to include terminal
5. Update `ContentPane` component to render `TerminalContent`

### Phase 3: UI Integration
1. Add terminal icon button to `TreePanelHeader`
2. Wire button to create terminal + open content pane
3. Handle terminal exit (show message, restart option)

### Phase 4: Polish (Optional)
1. Debounced resize handling
2. Copy/paste keyboard shortcuts (Cmd+C/V)
3. Basic theming (match Mort dark theme)
4. Custom working directory (open in repo root)

### Phase 5: Tree Menu Integration (Optional)
1. Add "Terminals" section showing active sessions
2. Click to focus terminal pane
3. Right-click to rename/kill

### Phase 6: Advanced (Optional)
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
src/components/content-pane/
├── terminal-content.tsx        # NEW - xterm.js wrapper

src/stores/
├── terminal-store.ts           # NEW - Terminal session state

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
