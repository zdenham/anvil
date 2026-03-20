# Claude TUI Content Pane

## Summary

Add Claude TUI support by extending the existing thread schema with a `threadKind` discriminator. Standard GUI threads have `threadKind` undefined; TUI threads set `threadKind: "claude-tui"`. Using `z.string()` (not a closed enum) so we can add new thread kinds in the future without schema migration. TUI threads reuse the same store, service, tree menu, and content pane routing — the only difference is how they render (PTY terminal vs message list) and how they're spawned (`claude` CLI binary vs agent SDK).

## Architecture Decision: Unified Thread Schema

Instead of a separate `ClaudeTuiThread` entity, we add fields to the existing `ThreadMetadata`:

```typescript
// In ThreadMetadataBaseSchema
threadKind: z.string().optional(),
terminalId: z.string().uuid().optional(),       // PTY session ID (TUI threads only)
claudeSessionId: z.string().optional(),          // Claude CLI session ID for --resume
```

This means:

- **No new entity, store, or service** — threads are threads
- **Same tree menu item** — `thread-item.tsx` renders both kinds, differentiated by badge/prefix
- **Same content pane route** — `{ type: "thread"; threadId }` — the thread content component checks `threadKind` to decide whether to render the message list or a terminal
- **Same persistence** — `~/.mort/threads/{id}/metadata.json`
- **Same archiving, naming, visual settings, drag-and-drop** — all just work

## Architecture Decision: PTY-based Claude Process

We spawn `claude` directly in a PTY. This gives users the authentic Claude TUI experience (keyboard shortcuts, `/` commands, visual styling, streaming) while Mort injects value through CLI args and environment variables assembled at spawn time.

**No extra files on disk.** The service builds the `--settings` inline JSON, `--append-system-prompt` string, and all other flags in memory. The PTY spawner (Phase 1) accepts `command`, `args`, and `env` — so the spawn call looks like:

```typescript
terminalSessionService.create({
  cwd: worktreePath,
  command: "claude",
  args: ["--dangerously-skip-permissions", "--settings", settingsJson, "--append-system-prompt", systemPrompt, "--model", "claude-sonnet-4-6"],
  env: { MORT_HUB_URL: "...", MORT_THREAD_ID: id },
})
```

The user never sees the flags — they just see the Claude TUI appear in a content pane.

## Design

### How it works

1. User clicks "New Claude Session" on a worktree
2. Service creates a thread with `threadKind: "claude-tui"` using the existing thread service
3. Args builder constructs CLI args + env vars in memory
4. PTY spawns `claude` with those args/env, `cwd` set to the worktree path
5. Thread metadata updated with `terminalId` linking to the PTY session
6. Content pane renders a terminal (not the message list) when `threadKind` is set
7. Sidebar shows the thread with a `cc` prefix badge
8. When `claude` exits, the thread status is set to "completed"

### Content pane routing

```
thread (threadKind: undefined)      → message list UI (standard)
thread (threadKind: "claude-tui")   → terminal content (PTY)
terminal                            → terminal panel (bottom)
```

No new `ContentPaneView` variant needed. The existing `{ type: "thread"; threadId }` route handles both — the component checks `threadKind` at render time.

### Schema changes

```typescript
// Additions to ThreadMetadataBaseSchema in core/types/threads.ts
threadKind: z.string().optional(),
terminalId: z.string().uuid().optional(),       // PTY session ID (TUI threads only)
claudeSessionId: z.string().optional(),          // Claude CLI --resume session ID
```

## Phases

- [ ] Phase 1: Extend PTY spawning to support custom commands and env vars
- [ ] Phase 2: Add `threadKind` to thread schema and update thread service
- [ ] Phase 3: Content pane branching for TUI threads
- [ ] Phase 4: Tree menu differentiation with "cc" prefix
- [ ] Phase 5: Hook bridge integration (see `plans/claude-tui-hook-bridge.md`)
- [ ] Phase 6: "Use terminal interface" preference setting

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Extend PTY spawning to support custom commands and env vars

Currently `spawn_terminal_inner` in `src-tauri/src/terminal.rs:64` hardcodes the user's `$SHELL -l`. We need to support an optional custom command and extra environment variables.

**Changes:**

### `src-tauri/src/terminal.rs`

- Add optional `command: Option<String>`, `args: Option<Vec<String>>`, and `env: Option<HashMap<String, String>>` parameters to `spawn_terminal_inner`
- When `command` is `Some(cmd)`, use `CommandBuilder::new(cmd)` with the provided args instead of the shell
- Merge `env` entries into the child process environment
- Still set the same base env vars (`TERM`, `COLORTERM`, `LANG`, `PATH`, `HOME`)
- Skip shell integration (ZDOTDIR) and `-l` flag when spawning a custom command

### `src-tauri/src/ws_server/dispatch_misc.rs`

- Update WS handler to accept optional `command`, `args`, and `env` fields in the `spawn_terminal` message

### Tauri IPC command

- Update the `spawn_terminal` Tauri command in `src-tauri/src/lib.rs` to accept optional `command`, `args`, and `env` parameters

### Frontend `invoke` call

- Update `terminalSessionService.create()` to accept optional `command`, `args`, and `env`
- Pass them through to `invoke("spawn_terminal", { cols, rows, cwd, command, args, env })`

---

## Phase 2: Add `threadKind` to thread schema and update thread service

### `core/types/threads.ts`

Add to `ThreadMetadataBaseSchema`:

```typescript
threadKind: z.string().optional(),
terminalId: z.string().uuid().optional(),
claudeSessionId: z.string().optional(),
```

Add to `CreateThreadInput`:

```typescript
threadKind?: string;  // "claude-tui" for TUI threads, undefined for standard GUI
```

Add to `UpdateThreadInput`:

```typescript
terminalId?: string;
claudeSessionId?: string;
```

### `src/entities/threads/service.ts`

Add a `createTuiThread` method (or extend `create` with a `threadKind` option):

1. Create thread metadata with `threadKind: "claude-tui"`, `status: "running"`
2. Build CLI args and env vars in memory (via args builder)
3. Spawn terminal with `command: "claude"`, the args, env, and `cwd: worktreePath`
4. Update thread with `terminalId` from the spawned terminal
5. Return thread metadata

### `src/lib/claude-tui-args-builder.ts`

Builds the CLI args and env vars in memory. No files written.

```typescript
function buildClaudeArgs(options: {
  settingsJson: string;
  systemPrompt: string;
  sessionId?: string;
  model?: string;
}): string[]

function buildSettingsJson(hooks: HookConfig[]): string

function buildSystemPrompt(worktreePath: string): string
```

### `src/lib/thread-creation-service.ts`

Add a `createTuiThread` path that:

1. Creates thread with `threadKind: "claude-tui"` via the existing thread service
2. Builds args, spawns the PTY
3. Updates thread with `terminalId`
4. Navigates to the thread

### Exit detection

- Watch for terminal exit events. When the PTY backing a TUI thread exits, update the thread status to `"completed"`.

---

## Phase 3: Content pane branching for TUI threads

### `src/components/content-pane/thread-content.tsx`

Branch on `threadKind` at the top of the component:

```typescript
if (thread.threadKind === "claude-tui") {
  return <TuiThreadContent thread={thread} />;
}
// ... existing GUI thread rendering
```

### `src/components/content-pane/tui-thread-content.tsx`

Thin wrapper around `TerminalContent`:

```typescript
export function TuiThreadContent({ thread }: { thread: ThreadMetadata }) {
  if (!thread.terminalId) return <EmptyPaneContent />;
  return <TerminalContent terminalId={thread.terminalId} />;
}
```

### Tab label

Show `cc: {name}` in the tab bar for TUI threads, visually differentiated from GUI threads.

---

## Phase 4: Tree menu differentiation with "cc" prefix

### `src/hooks/tree-node-builders.ts`

Update `threadToNode()` to check `threadKind`:

- TUI threads get title: `cc {name}` with a monospace/muted badge
- Status mapping: `running` → green pulse, `completed` → gray, same as GUI threads

### `src/components/tree-menu/thread-item.tsx`

- Detect TUI threads and show `cc` badge/prefix
- Context menu additions for TUI threads: Resume, Copy Session ID
- Archive works the same as GUI threads (already inherited)

### No new tree item type needed

TUI threads use the existing `"thread"` tree item type. The visual differentiation is purely cosmetic based on `threadKind`.

### Creation UX

"New Claude Session" in worktree menu (next to "New Thread" and "New Terminal").

---

## Phase 5: Hook bridge integration

Full lifecycle event tracking and permission forwarding via the hook bridge.

**Detailed plan**: `plans/claude-tui-hook-bridge.md`

This phase ensures:

- The bridge script is bundled/deployed to `~/.mort/hooks/bridge.js`
- Env vars (`MORT_HUB_URL`, `MORT_THREAD_ID`) are passed via the PTY `env` parameter (Phase 1)
- The inline settings JSON includes PreToolUse/PostToolUse/Stop hooks pointing to the bridge
- Frontend listeners handle incoming hook requests and lifecycle events

### `~/.mort/hooks/safe-git-hook.sh`

- Shell script version of `agents/src/hooks/safe-git-hook.ts`
- Referenced in the inline settings JSON
- Written once at app startup by the service

---

## Phase 6: "Use terminal interface" preference setting

A global checkbox that makes TUI threads the default for all thread creation surfaces.

### Setting

```typescript
// In src/entities/settings/types.ts — add to WorkspaceSettingsSchema
preferTerminalInterface: z.boolean().default(false),
```

No migration needed — `.default(false)` handles existing settings files.

### Settings UI (`src/components/main-window/settings-page.tsx`)

Checkbox labeled **"Use terminal interface"** with helper text: *"New threads open Claude's terminal UI instead of the managed conversation view"*. Place near the permission mode section. Uses `updateSetting("preferTerminalInterface", checked)`.

### Thread creation routing (`src/lib/thread-creation-service.ts`)

`createThread()` becomes a mode-aware router:

```typescript
export async function createThread(options: CreateThreadOptions) {
  const settings = getWorkspaceSettings();
  const useTerminal = options.forceManaged ? false
    : options.forceTui ? true
    : settings.preferTerminalInterface;

  if (useTerminal) {
    return createTuiThread(options);  // from Phase 2
  }
  return createManagedThread(options);  // existing behavior
}
```

`forceManaged` / `forceTui` flags let explicit menu items override the default.

### Surfaces affected

All thread creation surfaces flow through `createThread()` and automatically respect the preference:

- **Spotlight** (type + Enter) — already calls `createThread()`
- **Empty pane input** — already calls `createThread()`
- **Plan follow-up** — already calls `createThread()`, plan context passed via `--append-system-prompt`
- **Cmd+N** (`main-window-layout.tsx`) — currently calls `threadService.create()` directly, must change to call `createThread()`. For TUI mode, resolve worktree from selection or MRU; fall back to managed if no worktree available.

### Prompt handling for TUI threads

- Prompt provided → pass via `--message "prompt text"` so Claude starts immediately
- No prompt (Cmd+N) → spawn PTY with no `--message`, user types in terminal
- Plan context → `--append-system-prompt` with plan summary (add `planContext` option to `buildSystemPrompt()` in args builder)

### Override menu items (`src/components/tree-menu/worktree-menus.tsx`)

"New Thread" always uses the preference. Add an explicit override item:

- When `preferTerminalInterface` is `false`: "New Thread" = managed, also show "New Claude Session" (`forceTui: true`)
- When `preferTerminalInterface` is `true`: "New Thread" = TUI, also show "New Managed Thread" (`forceManaged: true`)

### Key files

| File | Change |
| --- | --- |
| `src/entities/settings/types.ts` | Add `preferTerminalInterface` boolean |
| `src/components/main-window/settings-page.tsx` | Checkbox UI |
| `src/lib/thread-creation-service.ts` | Route on preference |
| `src/lib/claude-tui-args-builder.ts` | `planContext` support in `buildSystemPrompt()` |
| `src/components/main-window/main-window-layout.tsx` | Cmd+N through router |
| `src/components/tree-menu/worktree-menus.tsx` | Override menu item |

---

## Key files to modify

| File | Change |
| --- | --- |
| `src-tauri/src/terminal.rs` | Accept optional command/args/env in `spawn_terminal_inner` |
| `src-tauri/src/ws_server/dispatch_misc.rs` | Pass command/args/env through WS handler |
| `src-tauri/src/lib.rs` | Update Tauri command signature |
| `core/types/threads.ts` | Add `threadKind`, `terminalId`, `claudeSessionId` fields |
| `src/entities/threads/service.ts` | Add TUI thread creation and exit detection |
| `src/lib/claude-tui-args-builder.ts` | New file: builds CLI args and env vars |
| `src/lib/thread-creation-service.ts` | Add `createTuiThread` path + preference routing |
| `src/components/content-pane/thread-content.tsx` | Branch on `threadKind` |
| `src/components/content-pane/tui-thread-content.tsx` | New thin wrapper component |
| `src/hooks/tree-node-builders.ts` | TUI thread badge in `threadToNode()` |
| `src/components/tree-menu/thread-item.tsx` | `cc` prefix and TUI-specific context menu items |
| `src/entities/settings/types.ts` | Add `preferTerminalInterface` boolean |
| `src/components/main-window/settings-page.tsx` | Checkbox UI for terminal preference |
| `src/components/main-window/main-window-layout.tsx` | Cmd+N through `createThread()` router |
| `src/components/tree-menu/worktree-menus.tsx` | Override menu item for non-default mode |

## Open questions

1. **Model selection**: Default to same model as Mort threads, or let user pick?
2. **Session persistence**: Capture Claude CLI session ID from TUI output for `--resume`?
3. **Keyboard shortcut**: Keybinding for new Claude session?
4. **Multiple sessions per worktree**: Unlimited or capped?
5. **CLAUDE.md**: The CLI auto-reads project `CLAUDE.md` — coding guidelines apply automatically.
6. **Empty TUI threads**: Cmd+N with no prompt — spawn PTY immediately or show prompt input first?
7. **CLI fallback**: If `claude` CLI isn't on PATH, silently fall back to managed or show error?