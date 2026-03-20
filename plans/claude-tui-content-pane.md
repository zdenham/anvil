# Claude TUI Content Pane

## Summary

Add a new `claude-thread` content pane type that spawns the real Claude TUI (CLI binary) inside a terminal, with Mort's hooks and system prompt injected via CLI flags. Users who prefer the TUI get Mort's orchestration benefits without leaving the app.

## Architecture Decision: PTY-based Claude Process

We spawn the `claude` binary directly in a PTY rather than reimplementing the TUI or wrapping the SDK. This gives users the authentic Claude TUI experience (keyboard shortcuts, `/` commands, visual styling, streaming) while Mort injects value through CLI flags (`--settings`, `--append-system-prompt`, `--dangerously-skip-permissions`).

**Key insight**: The Claude CLI's `--settings <file-or-json>` flag accepts hook definitions as shell commands. We can bridge Mort's programmatic hooks to CLI-compatible shell-script hooks.

## Design

### How it works

1. User clicks "New Claude Session" (or similar action) on a worktree
2. Mort generates a temporary settings JSON + system prompt
3. A PTY spawns `claude` with flags: `--dangerously-skip-permissions --append-system-prompt "..." --settings /path/to/settings.json --model claude-sonnet-4-6`
4. The terminal renders in a content pane (not the bottom terminal panel)
5. Sidebar shows the session with a `cc` prefix badge
6. When `claude` exits, the PTY exits and the session shows as "exited"

### Content pane routing

```
claude-thread → content zone (main area)
terminal      → terminal panel (bottom)
```

The `claude-thread` type uses `getViewCategory() → "content"` so it routes to the main content area, reusing the same `TerminalContent` xterm.js component for rendering.

### New types

```typescript
// ContentPaneView addition
| { type: "claude-thread"; claudeThreadId: string }

// TreeItemType addition
"claude-thread"

// Entity
interface ClaudeThread {
  id: string;
  terminalId: string;      // Associated PTY terminal session
  worktreeId: string;
  worktreePath: string;
  label: string;
  createdAt: number;
  isAlive: boolean;
  sessionId?: string;       // Claude CLI session ID for --resume
  visualSettings: VisualSettings;
}
```

## Phases

- [ ] Phase 1: Extend PTY spawning to support custom commands

- [ ] Phase 2: Claude thread entity, service, and store

- [ ] Phase 3: Settings generation and CLI flag assembly

- [ ] Phase 4: Content pane type and UI component

- [ ] Phase 5: Tree menu integration with "cc" prefix

- [ ] Phase 6: Hook bridge integration (see `plans/claude-tui-hook-bridge.md`)

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Extend PTY spawning to support custom commands

Currently `spawn_terminal_inner` in `src-tauri/src/terminal.rs:64` hardcodes the user's `$SHELL -l`. We need to support an optional custom command.

**Changes:**

### `src-tauri/src/terminal.rs`

- Add optional `command: Option<String>` and `args: Option<Vec<String>>` parameters to `spawn_terminal_inner`
- When `command` is `Some(cmd)`, use `CommandBuilder::new(cmd)` with the provided args instead of the shell
- Still set the same env vars (`TERM`, `COLORTERM`, `LANG`, `PATH`, `HOME`)
- Skip shell integration (ZDOTDIR) when spawning a custom command
- Skip `-l` flag when not spawning a shell

### `src-tauri/src/ws_server/dispatch_misc.rs`

- Update WS handler to accept optional `command` and `args` fields in the `spawn_terminal` message

### Tauri IPC command

- Update the `spawn_terminal` Tauri command in `src-tauri/src/lib.rs` to accept optional `command` and `args` parameters

### Frontend `invoke` call

- Update `terminalSessionService.create()` to accept optional `command` and `args`
- Pass them through to `invoke("spawn_terminal", { cols, rows, cwd, command, args })`

---

## Phase 2: Claude thread entity, service, and store

Create a new entity for managing Claude TUI sessions, following the same patterns as `terminal-sessions/`.

### `src/entities/claude-threads/types.ts`

```typescript
import { z } from "zod";

export const ClaudeThreadSchema = z.object({
  id: z.string().uuid(),
  terminalId: z.string().uuid(),
  worktreeId: z.string(),
  worktreePath: z.string(),
  label: z.string(),
  createdAt: z.number(),
  isAlive: z.boolean(),
  isArchived: z.boolean().optional(),
  sessionId: z.string().optional(),
  visualSettings: VisualSettingsSchema,
});

export type ClaudeThread = z.infer<typeof ClaudeThreadSchema>;
```

### `src/entities/claude-threads/store.ts`

- Zustand store following entity-store pattern
- `sessions: Record<string, ClaudeThread>`
- Methods: `hydrate`, `addSession`, `updateSession`, `removeSession`, `markExited`
- Selector: `getByWorktree(worktreeId)`

### `src/entities/claude-threads/service.ts`

- `ClaudeThreadService` class
- `create(worktreeId, worktreePath)`:
  1. Generate settings JSON file (Phase 3)
  2. Build CLI args array
  3. Create terminal session with custom command via `terminalSessionService.create()` (extended in Phase 1) — or spawn directly with command
  4. Persist metadata to `~/.mort/claude-threads/{id}/metadata.json`
- `hydrate()`: Load from disk, mark all as not alive
- `archive(id)`: Kill terminal, remove from disk
- `resume(id)`: Revive with `claude --resume <sessionId>` flag
- `get`, `getAll`, `getByWorktree` accessors

### Persistence

- Directory: `~/.mort/claude-threads/{id}/`
- `metadata.json`: ClaudeThread entity
- `settings.json`: Generated Claude CLI settings (hooks, etc.)

---

## Phase 3: Settings generation and CLI flag assembly

Generate the CLI arguments and settings file that configure each Claude TUI session.

### `src/entities/claude-threads/settings-builder.ts`

Responsible for building the `--settings` JSON and CLI args.

**Settings JSON structure:**

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": ["~/.mort/hooks/safe-git-hook.sh"]
      }
    ]
  }
}
```

**CLI args assembly:**

```typescript
function buildClaudeArgs(options: {
  worktreePath: string;
  settingsPath: string;
  systemPrompt: string;
  sessionId?: string;  // for resume
  model?: string;
}): string[] {
  const args = [
    "--dangerously-skip-permissions",
    "--append-system-prompt", options.systemPrompt,
    "--settings", options.settingsPath,
    "--model", options.model ?? "claude-sonnet-4-6",
  ];
  if (options.sessionId) {
    args.push("--resume", options.sessionId);
  }
  return args;
}
```

**System prompt content:**

- Reuse `buildEnvironmentContext()` and `buildGitContext()` from `agents/src/context.ts` (or a simplified version)
- Include working directory, git branch, platform info
- Include Mort-specific context (data dir, worktree info)

### `~/.mort/hooks/safe-git-hook.sh`

- Shell script version of `agents/src/hooks/safe-git-hook.ts`
- Reads JSON from stdin, checks `tool_input.command` against destructive patterns
- Returns `{"decision": "deny", "reason": "..."}` or `{"decision": "allow"}`
- Written once at app startup by the service

---

## Phase 4: Content pane type and UI component

### `src/components/content-pane/types.ts`

Add to `ContentPaneView`:

```typescript
| { type: "claude-thread"; claudeThreadId: string }
```

Update `getViewCategory`:

```typescript
export function getViewCategory(type: ContentPaneView["type"]): ViewCategory {
  if (type === "terminal") return "terminal";
  return "content";  // claude-thread routes to content zone
}
```

### `src/components/content-pane/claude-thread-content.tsx`

- Thin wrapper around `TerminalContent`
- On mount: check if claude-thread's terminal is alive, if not spawn/revive
- Pass `terminalId` from the claude-thread entity to `TerminalContent`
- Handle session resumption (if the user reopens a closed session, use `--resume`)

```typescript
export function ClaudeThreadContent({ claudeThreadId }: { claudeThreadId: string }) {
  const claudeThread = useClaudeThreadStore(s => s.sessions[claudeThreadId]);
  if (!claudeThread) return <EmptyPaneContent />;
  return <TerminalContent terminalId={claudeThread.terminalId} />;
}
```

### `src/components/content-pane/content-pane.tsx`

Add case:

```typescript
{view.type === "claude-thread" && <ClaudeThreadContent claudeThreadId={view.claudeThreadId} />}
```

### Tab label

- Show `cc: {label}` in tab bar for claude-thread views
- Differentiate from regular terminals visually

---

## Phase 5: Tree menu integration with "cc" prefix

### `src/stores/tree-menu/types.ts`

Add `"claude-thread"` to `TreeItemType`.

### `src/hooks/tree-node-builders.ts`

Add `claudeThreadToNode()`:

```typescript
export function claudeThreadToNode(session: ClaudeThread): TreeItemNode {
  return {
    type: "claude-thread",
    id: session.id,
    title: `cc ${session.label}`,  // "cc" prefix
    status: session.isAlive ? "running" : "read",
    depth: 0,
    isFolder: false,
    worktreeId: session.worktreeId,
    visualSettings: session.visualSettings,
  };
}
```

### `src/hooks/use-tree-data.ts`

Include claude-threads in the unified tree builder, sorted alongside threads.

### `src/components/tree-menu/claude-thread-item.tsx`

Similar to `ThreadItem` but:

- Shows a `cc` badge/prefix before the label (monospace, muted color)
- Status dot: running (green pulse when alive), read (gray when exited)
- Archive button (same pattern as ThreadItem)
- Context menu: Rename, Archive, Resume, Copy Session ID

### `src/components/tree-menu/tree-item-renderer.tsx`

Add case:

```typescript
case "claude-thread":
  return <ClaudeThreadItem item={item} isSelected={isSelected} onSelect={onItemSelect} />;
```

### Navigation

Add to `navigation-service.ts`:

```typescript
async navigateToClaudeThread(claudeThreadId: string, options?: NavigateOptions) {
  await treeMenuService.setSelectedItem(claudeThreadId);
  const view: ContentPaneView = { type: "claude-thread", claudeThreadId };
  await this.openOrFind(view, options);
}
```

### Creation UX

Add a "New Claude Session" button/option in the worktree menu (next to "New Thread" and "New Terminal"):

- In `worktree-item.tsx` or the worktree context menu
- Calls `claudeThreadService.create(worktreeId, worktreePath)`
- Navigates to the new session

---

## Phase 6: Hook bridge integration

Full lifecycle event tracking and permission forwarding via the hook bridge. This is what makes TUI sessions first-class citizens in Mort rather than opaque terminal processes.

**Detailed plan**: `plans/claude-tui-hook-bridge.md`

This phase wires the bridge into the settings generation (Phase 3) and ensures:

- The bridge script is bundled/deployed to `~/.mort/hooks/bridge.js`
- Environment variables (`MORT_HUB_URL`, `MORT_CLAUDE_THREAD_ID`) are set on the PTY
- The settings JSON includes PreToolUse/PostToolUse/Stop hooks pointing to the bridge
- Frontend listeners handle incoming hook requests and lifecycle events

---

## Key files to modify

| File | Change |
| --- | --- |
| `src-tauri/src/terminal.rs` | Accept optional command/args in `spawn_terminal_inner` |
| `src-tauri/src/ws_server/dispatch_misc.rs` | Pass command/args through WS handler |
| `src-tauri/src/lib.rs` | Update Tauri command signature |
| `src/entities/claude-threads/` | New entity: types, store, service |
| `src/components/content-pane/types.ts` | Add `claude-thread` to ContentPaneView |
| `src/components/content-pane/content-pane.tsx` | Add rendering case |
| `src/components/content-pane/claude-thread-content.tsx` | New component |
| `src/stores/tree-menu/types.ts` | Add `claude-thread` to TreeItemType |
| `src/hooks/tree-node-builders.ts` | Add `claudeThreadToNode()` |
| `src/hooks/use-tree-data.ts` | Include claude-threads in tree |
| `src/components/tree-menu/claude-thread-item.tsx` | New sidebar item |
| `src/components/tree-menu/tree-item-renderer.tsx` | Add rendering case |
| `src/stores/navigation-service.ts` | Add `navigateToClaudeThread()` |
| `src/stores/pane-layout/service.ts` | Handle `claude-thread` view category |

## Open questions

1. **Model selection**: Should claude-thread sessions default to the same model as Mort threads, or let the user pick? The `--model` flag makes this configurable.
2. **Session persistence**: Claude CLI supports `--resume <sessionId>`. Should we capture the session ID from the TUI output and persist it for later resumption?
3. **Keyboard shortcut**: Should there be a keybinding to create a new Claude session (like Ctrl+\` for terminals)?
4. **Multiple sessions per worktree**: Allow unlimited, or cap like terminals?
5. [**CLAUDE.md**](http://CLAUDE.md): The Claude CLI auto-reads project `CLAUDE.md`. This means the project's coding guidelines apply automatically — no extra work needed.