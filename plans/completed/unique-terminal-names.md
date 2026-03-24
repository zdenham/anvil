# Unique Terminal Names

Make terminal names unique and auto-name them after the first command run.

## Problem

All terminals for the same worktree display the same name (directory name fallback), making them indistinguishable. The `updateLastCommand()` method exists in the service but is never called from anywhere.

## Command Detection: Shell Integration vs Keystroke Tracking

PTYs have no command lifecycle hooks — they're just byte pipes. But shells do. The previous plan proposed keystroke tracking (buffering input, detecting Enter), which is essentially a keylogger that:

- Breaks on tab completion, history navigation, multiline commands
- Can't tell what actually executed vs what was typed and cancelled
- Has bad optics as a "keylogger"

**The proven alternative is shell integration** — the same technique used by VS Code, iTerm2, and Warp. The shell itself tells us what command ran via escape sequences emitted through the PTY output stream.

### How shell integration works

1. **At PTY spawn**, Anvil sets `ZDOTDIR` to a temp directory containing a tiny `.zshenv`
2. That `.zshenv` restores the original `ZDOTDIR` (so the user's normal config loads), then adds a `preexec` hook
3. The `preexec` hook runs before every command and emits a custom OSC escape sequence: `\e]7727;cmd;<command_text>\a`
4. **In the frontend**, xterm.js parses the OSC via `terminal.parser.registerOscHandler(7727, ...)` and calls `updateLastCommand()`

The preexec hook is \~3 lines of zsh. It uses `preexec_functions` (an array), so it doesn't override user hooks.

### Why OSC 7727?

Private-use number to avoid conflicts with iTerm2 (1337), VS Code (633), and standard OSC sequences.

### Shell support

- **zsh** (macOS default): ZDOTDIR injection. Covered in this plan.
- **bash**: `--rcfile` injection. Follow-up.
- **fish**: `--init-command` injection. Follow-up.
- **Unsupported shells**: Terminal works normally, just no command names — falls back to auto-generated label.

## Naming Priority

Three tiers, from highest to lowest:

| Priority | Source | Example | When set |
| --- | --- | --- | --- |
| 1\. User override | `label` via sidebar rename | "My Server" | User calls `setLabel()` |
| 2\. Last command | `lastCommand` via shell integration | "npm run dev" | Shell preexec hook fires |
| 3\. Auto-generated | `worktree-name N` | "anvil 1" | Terminal created |

**Key rule**: User overrides always win. Once the user renames a terminal, commands no longer change the display name. This is tracked via `isUserLabel: true` on the session.

## Phases

- [ ] Create zsh shell integration script and write it to `~/.anvil/shell-integration/`

- [ ] Inject ZDOTDIR override at PTY spawn in Rust

- [ ] Parse OSC 7727 in xterm.js and wire to `updateLastCommand()`

- [ ] Add `isUserLabel` field and apply unified display priority across all three display locations

- [ ] Auto-generate fallback labels (`worktree-name N`) in `create()` and `createPlaceholder()`

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Design

### Phase 1: Shell integration script

**Location**: Written to `~/.anvil/shell-integration/zsh/.zshenv` by the terminal service on first use.

```zsh
# Anvil shell integration for zsh
# Restores original ZDOTDIR so user config loads normally,
# then adds a minimal preexec hook for command tracking.

# 1. Restore original ZDOTDIR
if [[ -n "$ANVIL_ORIGINAL_ZDOTDIR" ]]; then
  ZDOTDIR="$ANVIL_ORIGINAL_ZDOTDIR"
  unset ANVIL_ORIGINAL_ZDOTDIR
else
  unset ZDOTDIR
fi

# 2. Source the user's real .zshenv (if it exists)
[[ -f "${ZDOTDIR:-$HOME}/.zshenv" ]] && source "${ZDOTDIR:-$HOME}/.zshenv"

# 3. Add preexec hook — emits OSC 7727 with the command text
__anvil_preexec() { printf '\e]7727;cmd;%s\a' "$1"; }
preexec_functions+=(__anvil_preexec)
```

**Why** `.zshenv`**?** It's the first file zsh reads for any shell type (login, interactive, script). By the time `.zshrc` loads, ZDOTDIR is already restored and our hook is registered.

**Implementation**: New file `src/entities/terminal-sessions/shell-integration.ts` with a function `ensureShellIntegration()` that writes the script to `~/.anvil/shell-integration/zsh/.zshenv` if it doesn't exist (or if the content has changed). Called lazily from `create()`.

### Phase 2: ZDOTDIR injection at PTY spawn

**File**: `src-tauri/src/terminal.rs` — `spawn_terminal_inner()`

Add env vars before spawning:

```rust
// Shell integration: redirect zsh's ZDOTDIR so our .zshenv loads first
if shell.ends_with("zsh") {
    let original_zdotdir = std::env::var("ZDOTDIR").unwrap_or_default();
    cmd.env("ANVIL_ORIGINAL_ZDOTDIR", &original_zdotdir);
    // ~/.anvil/shell-integration/zsh/ contains our .zshenv
    let integration_dir = paths::anvil_data_dir().join("shell-integration/zsh");
    cmd.env("ZDOTDIR", integration_dir.to_str().unwrap_or_default());
}
```

The `paths::anvil_data_dir()` function already resolves `~/.anvil`. Just need to construct the path.

### Phase 3: Parse OSC 7727 in frontend

**File**: `src/components/content-pane/terminal-content.tsx`

After `terminal.open(containerRef.current)`, register the OSC handler:

```ts
// Shell integration: parse command names from OSC 7727
terminal.parser.registerOscHandler(7727, (data) => {
  if (data.startsWith("cmd;")) {
    const command = data.slice(4).trim();
    if (command) {
      terminalSessionService.updateLastCommand(terminalId, command);
    }
  }
  return true; // handled
});
```

This is a one-liner addition to the existing xterm.js setup. `registerOscHandler` is part of xterm.js's public API (`allowProposedApi: true` is already set).

### Phase 4: `isUserLabel` field and unified display priority

**Types** (`src/entities/terminal-sessions/types.ts`):

Add to `TerminalSessionSchema`:

```ts
isUserLabel: z.boolean().optional(),
```

**Service** (`src/entities/terminal-sessions/service.ts`):

- `setLabel()`: Set `isUserLabel: true` alongside the label
- `create()` / `createPlaceholder()`: When setting auto-label, set `isUserLabel: false` (or leave undefined)

**Display logic** — a pure function used by all three locations:

```ts
function getTerminalDisplayName(session: TerminalSession): string {
  // 1. User override always wins
  if (session.label && session.isUserLabel) return session.label;
  // 2. Last command from shell integration
  if (session.lastCommand) return session.lastCommand;
  // 3. Auto-generated fallback
  return session.label ?? "Terminal";
}
```

**Three locations to update:**

1. **Tabs** (`src/components/split-layout/use-tab-label.ts` line 60): Currently `session.lastCommand ?? session.worktreePath.split("/").pop()`. Replace with `getTerminalDisplayName(session)`.

2. **Sidebar** (`src/hooks/tree-node-builders.ts` line 149): Currently `terminal.label ?? terminal.lastCommand ?? terminal.worktreePath.split("/").pop()`. Replace with `getTerminalDisplayName(terminal)`.

3. **Header** (`src/components/content-pane/content-pane-header.tsx` line 433): Currently `session?.label ?? session?.lastCommand ?? ...`. Replace with `getTerminalDisplayName(session)`.

Extract `getTerminalDisplayName()` into `src/entities/terminal-sessions/display-name.ts` so all three locations import the same function.

### Phase 5: Auto-generated fallback labels

**Service** (`src/entities/terminal-sessions/service.ts`):

In `create()` and `createPlaceholder()`, generate `label` as `"dirname N"`:

```ts
const dirname = worktreePath.split("/").pop() ?? "terminal";
const existing = this.getByWorktree(worktreeId);
const n = existing.length + 1;
const label = `${dirname} ${n}`;
```

Set `isUserLabel: false` (or omit — undefined is treated as false).

**Net result**: New terminal shows `anvil 1`. After `npm run dev`, shows `npm run dev`. User renames to "My Server" — stays "My Server" regardless of commands.

## Files Changed

| File | Change |
| --- | --- |
| `src/entities/terminal-sessions/shell-integration.ts` | New — writes zsh integration script to `~/.anvil/shell-integration/` |
| `src-tauri/src/terminal.rs` | Set `ZDOTDIR` + `ANVIL_ORIGINAL_ZDOTDIR` env vars for zsh |
| `src/components/content-pane/terminal-content.tsx` | Register OSC 7727 handler to capture commands |
| `src/entities/terminal-sessions/types.ts` | Add `isUserLabel` boolean field |
| `src/entities/terminal-sessions/service.ts` | Auto-generate labels, set `isUserLabel` in `setLabel()` |
| `src/entities/terminal-sessions/display-name.ts` | New — `getTerminalDisplayName()` shared display logic |
| `src/components/split-layout/use-tab-label.ts` | Use `getTerminalDisplayName()` |
| `src/hooks/tree-node-builders.ts` | Use `getTerminalDisplayName()` |
| `src/components/content-pane/content-pane-header.tsx` | Use `getTerminalDisplayName()` |
