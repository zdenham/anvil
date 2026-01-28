# Terminal UI Integration Plan

## Executive Summary

Adding a fully functional terminal UI to Mort is **moderately complex** but well-supported by mature libraries. The core technical challenge is integrating a PTY (pseudo-terminal) backend in Rust with a terminal emulator frontend in React. Replicating macOS Terminal.app's exact behavior with user preferences is more challenging and requires reading system preferences programmatically.

**Estimated Complexity**: Medium-High
- Basic functional terminal: ~2-3 days of focused work
- Terminal with macOS preference integration: ~4-5 days
- Full-featured terminal with tabs, splits, themes: ~1-2 weeks

---

## Recommendation: Direct portable-pty Integration

**We recommend using `portable-pty` directly rather than `tauri-plugin-pty`** for the following reasons:

1. **Mort already has shell infrastructure** in `src-tauri/src/shell.rs` - the patterns for Tauri commands and environment handling are established
2. **More control** over data flow - can integrate with existing event bridge architecture
3. **Fewer dependencies** - no reliance on a small plugin project (v0.2.1, ~640 downloads/month)
4. **Battle-tested** - portable-pty has 2.5M+ downloads, powers WezTerm terminal
5. **Modest code overhead** - only ~100-150 lines of Rust for the PTY manager
6. **Debugging** - easier to troubleshoot when you own the code vs. an abstraction layer

The plugin saves roughly half a day of initial setup but adds a dependency we don't fully control. Given Mort's architecture and long-term maintainability goals, direct integration is the better choice.

---

## Approach Comparison

### Approach 1: tauri-plugin-pty + xterm.js

**Overview**: Use the dedicated Tauri PTY plugin with xterm.js React bindings for the frontend.

**Stack**:
- Backend: `tauri-plugin-pty` (v0.2.1) - wraps `portable-pty`
- Frontend: `@xterm/xterm` + `react-xtermjs` or `@pablo-lion/xterm-react`
- Addons: `@xterm/addon-fit`, `@xterm/addon-webgl`, `@xterm/addon-search`

**Pros**:
- Purpose-built for Tauri 2.x
- Abstracts PTY complexity behind a clean API
- Active maintenance (last update: Jan 2026)
- Frontend/backend communication already implemented
- ~18-64MB dependency footprint

**Cons**:
- Less control over PTY behavior
- Plugin API may not expose all portable-pty features
- Relatively new (v0.2.1), less battle-tested

**Installation**:
```bash
# Rust (Cargo.toml)
cargo add tauri-plugin-pty

# JavaScript
pnpm add tauri-pty @xterm/xterm @xterm/addon-fit @xterm/addon-webgl
```

**Usage Pattern**:
```rust
// src-tauri/src/lib.rs
tauri::Builder::default()
    .plugin(tauri_plugin_pty::init())
```

```typescript
// React component
import { spawn } from 'tauri-pty';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

const terminal = new Terminal({ cols: 80, rows: 24 });
const fitAddon = new FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(containerRef.current);

const pty = await spawn('/bin/zsh', [], { cols: 80, rows: 24 });
pty.onData((data) => terminal.write(data));
terminal.onData((data) => pty.write(data));
```

---

### Approach 2: Direct portable-pty Integration (Recommended)

**Overview**: Implement PTY management directly in Rust using `portable-pty`, with custom Tauri commands for communication.

**Stack**:
- Backend: `portable-pty` (v0.9.0)
- Frontend: `@xterm/xterm` + addons (fit, webgl, search)
- Custom Tauri commands for spawn/read/write/resize

**Pros**:
- Full control over PTY behavior
- Well-established library (2.5M+ downloads, powers WezTerm)
- Can optimize data flow precisely
- No plugin abstraction overhead
- Integrates naturally with Mort's existing shell.rs patterns
- Long-term maintainability (portable-pty is part of WezTerm, actively maintained)

**Cons**:
- More boilerplate code required (~100-150 lines)
- Must handle async I/O yourself
- Need to implement resize, kill, and cleanup logic

**Why This Approach**: The extra code is modest, and we gain full control over behavior plus one fewer external dependency. Mort's existing Tauri command patterns in `shell.rs` provide a template to follow.

**Code Example**:
```rust
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

#[tauri::command]
async fn spawn_terminal(cols: u16, rows: u16) -> Result<u32, String> {
    let pty_system = native_pty_system();
    let pair = pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e| e.to_string())?;

    let cmd = CommandBuilder::new("/bin/zsh");
    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

    // Store pair.master and child in state, return handle ID
    Ok(handle_id)
}

#[tauri::command]
async fn write_to_terminal(id: u32, data: Vec<u8>) -> Result<(), String> {
    // Get writer from state, write data
}

#[tauri::command]
async fn resize_terminal(id: u32, cols: u16, rows: u16) -> Result<(), String> {
    // Get master from state, call resize
}
```

---

### Approach 3: Use Existing Reference Project

**Overview**: Fork or heavily reference `marc2332/tauri-terminal` or `Terminon` for architecture patterns.

**Reference Projects**:
1. **marc2332/tauri-terminal** (112 stars)
   - Minimal example: xterm.js + portable-pty
   - Good starting point, but basic

2. **Terminon** (Active development)
   - Full-featured: tabs, splits, profiles, SSH
   - React 19 + Tauri v2 + xterm.js WebGL
   - Translucent UI with theming

**Pros**:
- Proven architecture patterns
- Can copy working code
- Terminon shows how to do tabs/splits

**Cons**:
- May not match Mort's architecture
- License considerations
- May include features you don't need

---

## macOS Terminal.app Preference Integration

### Challenge

macOS Terminal.app stores preferences in `com.apple.Terminal` domain using binary plist format. Reading these programmatically and translating to xterm.js configuration requires:

1. **Reading preferences** via `defaults read com.apple.Terminal`
2. **Parsing the plist** (binary format, contains nested profile data)
3. **Mapping Terminal.app settings** to xterm.js options

### Terminal.app Settings to Map

| Terminal.app Setting | xterm.js Equivalent |
|---------------------|---------------------|
| Font name/size | `fontFamily`, `fontSize` |
| Text color | `theme.foreground` |
| Background color | `theme.background` |
| Cursor style (block/line/underline) | `cursorStyle` |
| Cursor blink | `cursorBlink` |
| Bold as bright | `drawBoldTextInBrightColors` |
| ANSI colors (16 colors) | `theme.black`, `theme.red`, etc. |
| Scrollback lines | `scrollback` |
| Window size (cols x rows) | `cols`, `rows` |

### Implementation Options

#### Option A: Read Preferences at Runtime (Recommended)

```rust
use std::process::Command;

#[tauri::command]
fn get_terminal_preferences() -> Result<TerminalProfile, String> {
    // Read the default profile name
    let output = Command::new("defaults")
        .args(["read", "com.apple.Terminal", "Default Window Settings"])
        .output()
        .map_err(|e| e.to_string())?;

    let profile_name = String::from_utf8_lossy(&output.stdout).trim().to_string();

    // Read the full profiles dictionary (this returns plist/XML)
    let profiles_output = Command::new("defaults")
        .args(["export", "com.apple.Terminal", "-"])
        .output()
        .map_err(|e| e.to_string())?;

    // Parse plist and extract profile settings
    // Return mapped xterm.js configuration
}
```

#### Option B: Import .terminal Theme Files

Users can export Terminal.app profiles as `.terminal` files (XML plist). Mort could:
1. Let users drag-drop or select .terminal files
2. Parse the XML plist
3. Extract colors, fonts, and settings
4. Apply to xterm.js

#### Option C: Offer Preset Themes + Custom

Instead of reading Terminal.app preferences:
1. Provide popular presets (Dracula, Nord, Solarized, macOS default)
2. Let users customize in Mort settings
3. Simpler implementation, more predictable

### Shell Configuration

To use the user's default shell with their configuration:

```rust
use std::env;

fn get_user_shell() -> String {
    // Use SHELL environment variable (set by macOS to user's default)
    env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

fn spawn_login_shell() {
    let shell = get_user_shell();
    let mut cmd = CommandBuilder::new(&shell);

    // -l flag starts a login shell, loading .zprofile/.bash_profile
    cmd.arg("-l");

    // Set HOME and USER from environment
    cmd.env("HOME", env::var("HOME").unwrap_or_default());
    cmd.env("USER", env::var("USER").unwrap_or_default());

    // Set TERM for proper escape sequence support
    cmd.env("TERM", "xterm-256color");
}
```

---

## Integration with Mort Architecture

### Alignment with Main Window Refactor

**IMPORTANT**: This terminal implementation must align with the main window refactor plan (`plans/main-window-refactor.md`). The terminal will be implemented as a **content pane type**, not a separate page or panel.

### Content Pane Integration

The terminal becomes a first-class content pane view type, alongside threads, plans, settings, and logs:

```typescript
// Updated ContentPaneView type (from main-window-refactor.md)
export type ContentPaneView =
  | { type: "empty" }
  | { type: "thread"; threadId: string }
  | { type: "plan"; planId: string }
  | { type: "settings" }
  | { type: "logs" }
  | { type: "terminal"; terminalId: string };  // NEW

export interface TerminalContentProps {
  paneId: string;
  terminalId: string;
  onClose: () => void;
  onPopOut?: () => void;
}
```

### How Terminal Fits in the New Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│ ┌──────────────┬───────────────────────────────────────────────────┐ │
│ │ Tree Panel   │ Content Pane (uuid-identified)                    │ │
│ │ (resizable)  │                                                   │ │
│ │              │ ┌───────────────────────────────────────────────┐ │ │
│ │ [⚙] [📋] [>_]│ │ Terminal Content (type: "terminal")          │ │ │
│ │ ─────────────│ │                                               │ │ │
│ │ repo-a/main  │ │ ┌───────────────────────────────────────────┐ │ │ │
│ │   · plan1    │ │ │         XTerm.js Instance                 │ │ │ │
│ │   · thread1  │ │ │         + WebGL + Fit + Search            │ │ │ │
│ │   · thread2  │ │ │                                           │ │ │ │
│ │ ─────────────│ │ │  $ ls -la                                 │ │ │ │
│ │ repo-a/feat  │ │ │  total 48                                 │ │ │ │
│ │   · thread3  │ │ │  drwxr-xr-x  12 user  staff   384 ...    │ │ │ │
│ │              │ │ │  █                                        │ │ │ │
│ │              │ │ └───────────────────────────────────────────┘ │ │ │
│ │ [Legend]     │ └───────────────────────────────────────────────┘ │ │
│ └──────────────┴───────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**Key Integration Points:**
- Terminal icon `[>_]` in `TreePanelHeader` opens a new terminal content pane
- Each terminal has a unique `terminalId` (maps to PTY session in Rust backend)
- Terminal content panes can be popped out to standalone windows
- Multiple terminal panes can exist (future multi-pane support)
- Terminal state (working directory, history) persists with `terminalId`

### Terminal in Tree Menu (Optional Enhancement)

Optionally, active terminals could appear in the tree menu under a "Terminals" section:

```
┌──────────────┐
│ [⚙] [📋] [>_]│
│ ─────────────│
│ Terminals    │  ← Optional section
│   · zsh (1)  │
│   · zsh (2)  │
│ ─────────────│
│ repo-a/main  │
│   · plan1    │
│   · thread1  │
└──────────────┘
```

This is a Phase 4 enhancement, not required for MVP.

### Current Mort Shell Usage

Mort already has shell integration in `src-tauri/src/shell.rs`:
- `initialize_shell_environment()` captures login shell PATH
- `command()` creates commands with proper environment
- Used for running git commands, spawning agents, etc.

### Proposed Terminal Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    React Frontend                        │
│  ┌─────────────────────────────────────────────────────┐│
│  │         Terminal Content Pane Component              ││
│  │  ┌─────────────────────────────────────────────────┐││
│  │  │  ContentPaneHeader (title, close, pop-out)      │││
│  │  ├─────────────────────────────────────────────────┤││
│  │  │        XTerm.js Instance                        │││
│  │  │        + WebGL + Fit + Search                   │││
│  │  └─────────────────────────────────────────────────┘││
│  └─────────────────────────────────────────────────────┘│
│                         │                                │
│                    Tauri IPC                            │
└─────────────────────────│────────────────────────────────┘
                          │
┌─────────────────────────│────────────────────────────────┐
│              Rust Backend (Tauri)                        │
│  ┌─────────────────────────────────────────────────────┐│
│  │              Terminal Manager                        ││
│  │  ┌─────────────────────────────────────────────────┐││
│  │  │  HashMap<TerminalId, TerminalSession>           │││
│  │  │    - PtyPair (master/slave)                     │││
│  │  │    - Child process handle                       │││
│  │  │    - Read/Write streams                         │││
│  │  │    - Working directory                          │││
│  │  └─────────────────────────────────────────────────┘││
│  │                                                      ││
│  │  Commands: spawn, write, resize, kill, list         ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

### UI Integration (Content Pane Approach)

**Primary approach: Terminal as Content Pane**

The terminal is rendered inside the `ContentPaneContainer` just like threads, plans, settings, and logs. This means:

1. **New Terminal Button**: Icon in `TreePanelHeader` creates a new terminal
2. **Content Pane View**: Terminal renders in main content area
3. **Pane State**: `content-panes-store.ts` tracks terminal panes by UUID
4. **Backend Session**: Each terminal pane maps to a `terminalId` in Rust
5. **Pop-out Support**: Can detach terminal to standalone window

**NOT implementing:**
- ~~Dedicated Terminal Page~~ (deprecated by main window refactor)
- ~~Panel/Drawer~~ (doesn't fit content pane model)
- ~~Floating by default~~ (content pane first, pop-out optional)

---

## Recommended Implementation Path

**Prerequisite**: Main window refactor Phase 1-4 should be complete or in progress, as the terminal depends on the content pane infrastructure.

### Phase 1: Backend PTY Infrastructure

1. Add `portable-pty` to Cargo.toml
2. Create Rust PTY manager in `src-tauri/src/terminal.rs`:
   - `spawn_terminal(cols, rows, cwd?)` - create PTY, spawn shell, return `terminalId`
   - `write_terminal(id, data)` - write input to PTY
   - `resize_terminal(id, cols, rows)` - handle resize
   - `kill_terminal(id)` - cleanup and close PTY
   - `list_terminals()` - list active terminal sessions
3. Implement Tauri event streaming for PTY output:
   - `terminal:output:{id}` - stream stdout/stderr to frontend
   - `terminal:exit:{id}` - notify when shell exits
4. Add terminal commands to Tauri app builder
5. Use user's default shell from SHELL env var

### Phase 2: Frontend Terminal Content Pane

1. Add `@xterm/xterm` and addons to package.json
2. Create `src/components/content-pane/terminal-content.tsx`:
   ```typescript
   interface TerminalContentProps {
     paneId: string;
     terminalId: string;
     onClose: () => void;
     onPopOut?: () => void;
   }
   ```
   - Initialize xterm.js with WebGL addon
   - Use FitAddon for responsive sizing within content pane
   - Connect to PTY via Tauri invoke/events
   - Handle pane resize events (from resizable panel)
3. Update `ContentPaneView` type to include terminal:
   ```typescript
   | { type: "terminal"; terminalId: string }
   ```
4. Update `ContentPane` component to render `TerminalContent`
5. Add terminal icon to `TreePanelHeader`:
   - Click creates new terminal and opens in content pane
   - Stores new pane in `content-panes-store`

### Phase 3: Terminal State Management

1. Create `src/stores/terminal-store.ts`:
   ```typescript
   interface TerminalState {
     terminals: Record<string, TerminalSession>;
     createTerminal: (cwd?: string) => Promise<string>; // returns terminalId
     closeTerminal: (id: string) => void;
     getTerminal: (id: string) => TerminalSession | undefined;
   }

   interface TerminalSession {
     id: string;
     title: string; // e.g., "zsh" or custom name
     cwd: string;
     createdAt: Date;
     isAlive: boolean;
   }
   ```
2. Wire terminal creation to content pane creation:
   - Create terminal session → get `terminalId`
   - Create content pane with `{ type: "terminal", terminalId }`
3. Handle terminal exit:
   - Mark session as dead
   - Show "Terminal exited" message in content pane
   - Option to restart or close

### Phase 4: Polish & Features

1. Add search functionality (@xterm/addon-search)
2. Implement proper resize handling (debounced)
3. Add copy/paste keyboard shortcuts (Cmd+C/V)
4. Handle terminal exit gracefully (restart option)
5. Add basic theming (dark theme matching Mort UI)
6. Support custom working directory (open terminal in repo root)

### Phase 5: Tree Menu Integration (Optional)

1. Add "Terminals" section to tree menu
2. Show active terminal sessions as tree items
3. Click terminal in tree → focus that content pane
4. Right-click → rename, kill terminal

### Phase 6: macOS Integration (Optional)

1. Read Terminal.app default profile preferences
2. Map colors and fonts to xterm.js
3. OR: Implement custom theme picker in settings

### Phase 7: Advanced Features (Optional)

1. Session persistence (reconnect to terminals on app restart)
2. Integration with Mort tasks (run commands in worktree context)
3. Split terminal panes (when multi-pane content area is implemented)

---

## Dependencies to Add

### Cargo.toml
```toml
[dependencies]
portable-pty = "0.9"
```

### package.json
```json
{
  "dependencies": {
    "@xterm/xterm": "^5.4.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-webgl": "^0.18.0",
    "@xterm/addon-search": "^0.15.0"
  }
}
```

Optional React wrapper (if preferred over direct xterm.js usage):
```json
{
  "dependencies": {
    "react-xtermjs": "^1.0.0"
  }
}
```

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| PTY communication issues | Low | High | portable-pty is battle-tested (powers WezTerm) |
| Performance with large output | Medium | Medium | Use WebGL addon, implement throttling |
| macOS preference parsing fails | Medium | Low | Fall back to sensible defaults |
| Window resize edge cases | High | Low | Debounce resize events |
| Shell environment differences | Medium | Medium | Test with zsh, bash, fish |
| Async I/O complexity | Medium | Medium | Reference marc2332/tauri-terminal patterns |

---

## Alternatives Considered

### Electron-based Terminal (Not Recommended)
- Could embed Hyper or similar
- Would require Electron dependency
- Conflicts with Tauri architecture

### WebSocket-based Backend (Overkill)
- Separate terminal server process
- More moving parts
- No benefit over direct PTY

### Native macOS Terminal.app Embedding (Not Possible)
- Cannot embed Terminal.app in another app
- Would need to use AppleScript to control separate window
- Poor UX

---

## File Structure (Aligned with Main Window Refactor)

The terminal files integrate with the structure defined in `plans/main-window-refactor.md`:

```
src/components/
├── content-pane/
│   ├── index.ts
│   ├── types.ts                    # Updated to include terminal type
│   ├── content-pane.tsx
│   ├── content-pane-container.tsx
│   ├── content-pane-header.tsx
│   ├── thread-content.tsx
│   ├── plan-content.tsx
│   ├── settings-content.tsx
│   ├── logs-content.tsx
│   └── terminal-content.tsx        # NEW - Terminal content pane
├── tree-menu/
│   ├── tree-panel-header.tsx       # Add terminal icon button
│   └── ...
└── ...

src/stores/
├── content-panes-store.ts          # Handles terminal panes
├── terminal-store.ts               # NEW - Terminal session state
└── ...

src-tauri/src/
├── terminal.rs                     # NEW - PTY management
├── lib.rs                          # Register terminal commands
└── ...
```

### Types to Update

```typescript
// src/components/content-pane/types.ts
export type ContentPaneView =
  | { type: "empty" }
  | { type: "thread"; threadId: string }
  | { type: "plan"; planId: string }
  | { type: "settings" }
  | { type: "logs" }
  | { type: "terminal"; terminalId: string };  // ADD THIS
```

---

## Sources

- [xterm.js](https://xtermjs.org/) - Terminal emulator library
- [react-xtermjs](https://www.qovery.com/blog/react-xtermjs-a-react-library-to-build-terminals) - React bindings
- [portable-pty](https://docs.rs/portable-pty) - Cross-platform PTY library (recommended)
- [tauri-plugin-pty](https://lib.rs/crates/tauri-plugin-pty) - Tauri PTY plugin (considered, not recommended)
- [marc2332/tauri-terminal](https://github.com/marc2332/tauri-terminal) - Reference implementation
- [Terminon](https://github.com/Shabari-K-S/terminon) - Full-featured Tauri terminal
- [macOS defaults command](https://www.shell-tips.com/mac/defaults/) - Reading system preferences
- [Terminal.app Profile Settings](https://support.apple.com/guide/terminal/change-profiles-shell-preferences-trmlshll/mac) - Apple documentation
