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

We spawn `claude` directly in a PTY with minimal CLI args. This gives users the authentic Claude TUI experience (keyboard shortcuts, `/` commands, visual styling, streaming). This plan covers the UI scaffolding only — hooks, plugin integration, lifecycle events, and permission bridging are layered on by `plans/claude-tui-hook-bridge.md`.

### Initial spawn (this plan)

Bare-minimum invocation — just enough to get a working Claude TUI in a content pane:

```typescript
terminalSessionService.create({
  cwd: worktreePath,
  command: "claude",
  args: [
    "--dangerously-skip-permissions",
    "--model", "claude-sonnet-4-6",
  ],
  env: {},
})
```

This is an unmanaged Claude session — no hooks, no Mort observability, no permission bridging. The user gets a raw Claude TUI that Mort can display, name, archive, and resume. That's the scope of this plan.

### Follow-up: Plugin + Hook bridge (`plans/claude-tui-hook-bridge.md`)

The hook bridge plan will extend the spawn call with the Mort plugin (`--plugin local:~/.mort`) and env vars, enabling:

| Concern | How (added by hook bridge plan) |
| --- | --- |
| **Skills** | Plugin auto-discovers `~/.mort/skills/` |
| **Hooks** | Plugin auto-discovers `~/.mort/hooks/hooks.json` — HTTP hooks POST to hub server |
| **Disallowed tools** | PreToolUse hook returns `permissionDecision: "deny"` at runtime |
| **System prompt context** | `SessionStart` hook returns `additionalContext` |
| **Lifecycle events** | PostToolUse/Stop hooks emit events to hub |
| **Permission bridging** | PreToolUse hook forwards to hub → frontend shows approval UI |
| **Code sharing** | Hub HTTP handler calls the same evaluator functions as SDK hooks (safe-git, repl, comment-resolution) |

The args builder in this plan is designed to be extended — the hook bridge plan adds `--plugin` and env vars to `buildSpawnConfig()` without changing the content pane code.

## Design

### How it works

1. User clicks "New Claude Session" on a worktree
2. Service creates a thread with `threadKind: "claude-tui"` using the existing thread service
3. Args builder constructs minimal CLI args (`--dangerously-skip-permissions`, `--model`)
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

- [x] Phase 1: Extend PTY spawning to support custom commands and env vars

- [x] Phase 2: Add `threadKind` to thread schema and update thread service

- [x] Phase 3: Content pane branching for TUI threads

- [x] Phase 4: Tree menu differentiation with "cc" prefix

- [ ] Phase 5: Hook bridge integration (see `plans/claude-tui-hook-bridge.md`)

- [x] Phase 6: "Use terminal interface" preference setting

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Extend PTY spawning to support custom commands and env vars

The sidecar's `TerminalManager` (in `sidecar/src/managers/terminal-manager.ts`) currently spawns the user's default shell. We need to support an optional custom command and extra environment variables.

**Changes:**

### `sidecar/src/managers/terminal-manager.ts`

- Add optional `command`, `args`, and `env` parameters to the `spawn()` method
- When `command` is provided, use it instead of the default shell
- Merge `env` entries into the child process environment via node-pty's spawn options
- Still set the same base env vars (`TERM`, `COLORTERM`, etc.)

### `sidecar/src/dispatch/dispatch-terminal.ts`

- Update the `spawn_terminal` dispatch handler to accept optional `command`, `args`, and `env` fields in the message payload
- Pass them through to `TerminalManager.spawn()`

### Frontend `terminalSessionService`

- Update `terminalSessionService.create()` to accept optional `command`, `args`, and `env`
- Pass them through the sidecar WebSocket dispatch

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

Builds the minimal CLI args for an unmanaged Claude TUI session. The hook bridge plan will extend this to add `--plugin` and env vars.

```typescript
interface ClaudeTuiSpawnConfig {
  args: string[];
  env: Record<string, string>;
}

function buildSpawnConfig(options: {
  sessionId?: string;
  model?: string;
}): ClaudeTuiSpawnConfig
```

Initially returns just `["--dangerously-skip-permissions", "--model", model]` and an empty env object.

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

**Out of scope** — see `plans/claude-tui-hook-bridge.md`.

Adds the Mort plugin (`--plugin local:~/.mort`) and env vars to the spawn call, enabling hooks, skills, lifecycle events, permission bridging, and system prompt injection via the plugin system. Extends `buildSpawnConfig()` from Phase 2.

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
- **Plan follow-up** — already calls `createThread()`, plan context passed via env var once hook bridge is integrated
- **Cmd+N** (`main-window-layout.tsx`) — currently calls `threadService.create()` directly, must change to call `createThread()`. For TUI mode, resolve worktree from selection or MRU; fall back to managed if no worktree available.

### Prompt handling for TUI threads

- Prompt provided → pass via `--message "prompt text"` so Claude starts immediately
- No prompt (Cmd+N) → spawn PTY with no `--message`, user types in terminal
- Plan context → passed via env var (`MORT_PLAN_CONTEXT`), injected into Claude's context by the plugin's `SessionStart` hook `additionalContext`

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
| `src/components/main-window/main-window-layout.tsx` | Cmd+N through router |
| `src/components/tree-menu/worktree-menus.tsx` | Override menu item |

---

## Key files to modify

| File | Change |
| --- | --- |
| `sidecar/src/managers/terminal-manager.ts` | Accept optional command/args/env in `spawn()` |
| `sidecar/src/dispatch/dispatch-terminal.ts` | Pass command/args/env through dispatch handler |
| `core/types/threads.ts` | Add `threadKind`, `terminalId`, `claudeSessionId` fields |
| `src/entities/threads/service.ts` | Add TUI thread creation and exit detection |
| `src/lib/claude-tui-args-builder.ts` | New file: builds minimal CLI args and env vars |
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
5. [**CLAUDE.md**](http://CLAUDE.md): The CLI auto-reads project `CLAUDE.md` — coding guidelines apply automatically.
6. **Empty TUI threads**: Cmd+N with no prompt — spawn PTY immediately or show prompt input first?
7. **CLI fallback**: If `claude` CLI isn't on PATH, silently fall back to managed or show error?