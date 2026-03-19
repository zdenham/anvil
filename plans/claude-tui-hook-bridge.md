# Claude TUI Hook Bridge

## Summary

Build a hook bridge that connects Claude CLI sessions (spawned in PTY) back to Mort's hub server, enabling full lifecycle event tracking (thread started/ended, tool calls, permissions) for Claude TUI sessions. Without this, TUI sessions are opaque PTY processes — with it, Mort has the same observability and control as SDK-managed threads.

**Depends on**: `plans/claude-tui-content-pane.md` (Phases 1-3 for PTY spawning and settings generation)

## Problem

Mort's SDK-managed threads emit rich lifecycle events: tool calls, permission requests, file changes, sub-agent spawns, token usage, etc. A Claude CLI process in a PTY is a black box — Mort can see terminal output bytes but has no structured understanding of what's happening.

The Claude CLI supports shell-command hooks via `--settings`. These hooks receive JSON on stdin and return JSON on stdout. We can use this as the bridge: a small process that receives hook events from the CLI, forwards them to Mort's hub server, and returns decisions.

## Architecture

```
┌─────────────────────┐     stdin/stdout      ┌──────────────────┐
│   Claude CLI (PTY)  │ ◄──────────────────► │  Hook Bridge      │
│                     │    hook protocol       │  (Node.js script) │
└─────────────────────┘                        └────────┬─────────┘
                                                        │ WebSocket
                                                        ▼
                                               ┌──────────────────┐
                                               │  Mort Hub Server  │
                                               │  (ws_server)      │
                                               └────────┬─────────┘
                                                        │ broadcast
                                                        ▼
                                               ┌──────────────────┐
                                               │  Mort Frontend    │
                                               │  (permission UI)  │
                                               └──────────────────┘
```

### Hook lifecycle

1. Claude CLI is about to call a tool (e.g., `Bash` with `git push`)
2. CLI invokes the hook bridge script, piping tool info as JSON to stdin
3. Bridge opens a WebSocket to the hub server (or reuses a persistent connection)
4. Bridge sends a `claude_tui_hook` message with `{claudeThreadId, hookType, toolName, toolInput, toolUseId}`
5. Hub broadcasts to frontend → frontend shows permission UI (or auto-allows based on mode)
6. Frontend sends decision back through hub → hub forwards to bridge
7. Bridge writes decision JSON to stdout, exits
8. Claude CLI proceeds (allow) or blocks (deny) the tool

### Events to capture

Beyond permissions, the bridge should emit **lifecycle events** so Mort can track TUI session activity:

| Hook point | Events emitted |
|---|---|
| `PreToolUse` | `TOOL_STARTED`, `PERMISSION_DECIDED` (allow/deny/ask) |
| `PostToolUse` | `TOOL_COMPLETED`, `FILE_MODIFIED` (if Write/Edit) |
| `Stop` | `SESSION_ENDED` |
| `NotificationHook` (if available) | `SESSION_STARTED`, token usage updates |

## Phases

- [ ] Phase 1: Define the hub protocol messages
- [ ] Phase 2: Build the hook bridge script
- [ ] Phase 3: Extend hub server to handle bridge messages
- [ ] Phase 4: Frontend integration for permission UI
- [ ] Phase 5: Lifecycle event emission and tracking
- [ ] Phase 6: Settings generation integration

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Define the hub protocol messages

### New message types in `core/types/events.ts`

```typescript
// Frontend → Hub → Bridge (decision response)
interface ClaudeTuiHookResponse {
  type: "claude_tui_hook_response";
  claudeThreadId: string;
  hookId: string;           // correlates request → response
  decision: "allow" | "deny";
  reason?: string;
}

// Bridge → Hub → Frontend (hook request)
interface ClaudeTuiHookRequest {
  type: "claude_tui_hook_request";
  claudeThreadId: string;
  hookId: string;
  hookType: "PreToolUse" | "PostToolUse" | "Stop";
  toolName: string;
  toolInput: Record<string, unknown>;
  toolUseId?: string;
}

// Bridge → Hub (lifecycle event, fire-and-forget)
interface ClaudeTuiLifecycleEvent {
  type: "claude_tui_lifecycle";
  claudeThreadId: string;
  event: string;            // e.g., "TOOL_STARTED", "TOOL_COMPLETED", "SESSION_ENDED"
  payload: Record<string, unknown>;
  timestamp: number;
}
```

### Hub protocol additions in `agents/src/lib/hub/`

Add these message types to the hub's message schema. The hub needs to:
- Accept connections from bridge scripts (new client type: `"claude-tui-bridge"`)
- Route `claude_tui_hook_request` from bridge → frontend
- Route `claude_tui_hook_response` from frontend → bridge
- Store `claude_tui_lifecycle` events (emit to frontend for UI updates)

---

## Phase 2: Build the hook bridge script

### `agents/src/claude-tui-bridge/bridge.ts`

Compiled to a standalone JS file at `~/.mort/hooks/bridge.js` (bundled at build time or copied at runtime).

**Behavior per invocation:**

```
1. Read JSON from stdin (Claude CLI hook protocol)
2. Parse: { hook_type, tool_name, tool_input, tool_use_id, session_id }
3. Connect to hub WebSocket at MORT_HUB_URL (env var set by Mort when spawning PTY)
4. Send ClaudeTuiHookRequest
5. Wait for ClaudeTuiHookResponse (with timeout)
6. Write response JSON to stdout per Claude CLI hook protocol
7. Exit
```

**Key design decisions:**

- **Stateless per invocation**: Each hook call spawns a fresh bridge process. Simple, no connection management. The CLI spawns/kills it.
- **Environment variables**: `MORT_HUB_URL` (WebSocket URL), `MORT_CLAUDE_THREAD_ID` (session identity), `MORT_DATA_DIR`
- **Timeout**: Configurable via `MORT_HOOK_TIMEOUT_MS`, default 300000 (5 min) for permission requests. PostToolUse events use a short timeout (5s) since they're fire-and-forget.
- **Failure mode**: If hub is unreachable or times out, default to **allow** (fail-open) so the user isn't stuck. Log a warning.

### Claude CLI hook protocol

The bridge must conform to whatever stdin/stdout JSON format Claude CLI uses for shell hooks. We need to verify the exact format. Expected shape:

**stdin (from CLI):**
```json
{
  "hook_type": "PreToolUse",
  "tool_name": "Bash",
  "tool_input": { "command": "git push" },
  "tool_use_id": "toolu_abc123",
  "session_id": "session_xyz"
}
```

**stdout (to CLI):**
```json
{
  "decision": "allow"
}
```
or
```json
{
  "decision": "deny",
  "reason": "Destructive git operation blocked by Mort"
}
```

### `agents/src/claude-tui-bridge/safe-git-check.ts`

Inline the safe-git pattern matching so the bridge can make instant local decisions without round-tripping to the hub for known-bad patterns. This is a fast path:
- If the tool is `Bash` and matches a destructive git pattern → instant deny, no hub call
- Otherwise → forward to hub for full permission evaluation

---

## Phase 3: Extend hub server to handle bridge messages

### `src-tauri/src/ws_server/` or `agents/src/lib/hub/`

Wherever the hub server lives, add handlers for:

1. **Bridge client registration**: When a bridge connects, it sends `{type: "register", clientType: "claude-tui-bridge", claudeThreadId: "..."}`. Hub tracks it.

2. **Hook request routing**: When bridge sends `claude_tui_hook_request`:
   - Hub stores the pending request keyed by `hookId`
   - Broadcasts to frontend clients
   - When frontend sends `claude_tui_hook_response` with matching `hookId`, hub forwards to the bridge client

3. **Lifecycle event handling**: When bridge sends `claude_tui_lifecycle`:
   - Hub emits to frontend for real-time UI updates
   - Optionally persists to the claude-thread's event log on disk

### Connection management

- Bridge scripts are short-lived (connect, send, wait, disconnect)
- Hub needs to handle rapid connect/disconnect gracefully
- Consider a connection pool or keep-alive if performance becomes an issue

---

## Phase 4: Frontend integration for permission UI

### Reuse existing permission approval flow

The frontend already has permission approval UI for SDK-managed threads (the approval gate). We extend it to work with claude-tui sessions:

### `src/entities/claude-threads/listeners.ts`

Listen for `claude_tui_hook_request` events from the hub:
- When a permission request arrives, show the same approval UI used for regular threads
- Map the request to the claude-thread entity so the UI shows context (which session, what tool)
- When user approves/denies, send `claude_tui_hook_response` back through the hub

### UI considerations

- Permission requests should show in the claude-thread's content pane (overlay or notification)
- Since the terminal is rendering Claude's TUI output, an overlay or sidebar notification works better than inline
- The tree menu item should show `needs-input` status (amber shimmer) when a permission is pending

### Status dot mapping

```typescript
function getClaudeThreadStatus(session: ClaudeThread, hasPendingPermission: boolean): StatusDotVariant {
  if (!session.isAlive) return "read";
  if (hasPendingPermission) return "needs-input";
  return "running";
}
```

---

## Phase 5: Lifecycle event emission and tracking

### Events to emit from the bridge

For each hook invocation, the bridge emits lifecycle events to the hub as fire-and-forget messages. These enable the frontend to show activity indicators and the backend to build an audit trail.

| Event | When | Payload |
|---|---|---|
| `TOOL_STARTED` | PreToolUse hook fires | `{toolName, toolInput, toolUseId}` |
| `TOOL_COMPLETED` | PostToolUse hook fires | `{toolName, toolResult, toolUseId, durationMs}` |
| `TOOL_DENIED` | PreToolUse returns deny | `{toolName, reason, toolUseId}` |
| `FILE_MODIFIED` | PostToolUse for Write/Edit | `{filePath, toolUseId}` |
| `SESSION_ENDED` | Stop hook fires | `{sessionId, totalTokens}` |

### Frontend event display

- Tool calls show as activity indicators on the claude-thread tree item
- `TOOL_DENIED` shows a brief toast or log entry
- `SESSION_ENDED` transitions the session to "exited" state
- Token usage updates the session's cumulative usage display (if we add one)

### Persisting events

Events are written to `~/.mort/claude-threads/{id}/events.jsonl` (append-only log). This enables:
- Post-session review of what the TUI did
- Cost tracking via token usage events
- File change tracking for the changes view

---

## Phase 6: Settings generation integration

Wire the bridge into the settings JSON generated by `claude-tui-content-pane.md` Phase 3.

### Updated settings JSON

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "hooks": ["node ~/.mort/hooks/bridge.js"]
      }
    ],
    "PostToolUse": [
      {
        "hooks": ["node ~/.mort/hooks/bridge.js"]
      }
    ],
    "Stop": [
      {
        "hooks": ["node ~/.mort/hooks/bridge.js"]
      }
    ]
  }
}
```

### Environment variables set on PTY spawn

```typescript
// Set these on the PTY process environment when spawning claude
const env = {
  MORT_HUB_URL: hubServer.getUrl(),           // WebSocket URL for bridge
  MORT_CLAUDE_THREAD_ID: claudeThread.id,      // Session identity
  MORT_DATA_DIR: mortDir,                       // For disk persistence
  MORT_HOOK_TIMEOUT_MS: "300000",              // 5 min for permissions
};
```

The safe-git check is now **built into the bridge** (Phase 2) as a fast path, so we no longer need a separate `safe-git-hook.sh`. The bridge handles everything: fast local decisions for known patterns, hub round-trip for everything else.

---

## Key files

| File | Purpose |
|---|---|
| `agents/src/claude-tui-bridge/bridge.ts` | Hook bridge script (stdin/stdout ↔ WebSocket) |
| `agents/src/claude-tui-bridge/safe-git-check.ts` | Fast-path destructive git detection |
| `core/types/events.ts` | New message types for bridge protocol |
| `agents/src/lib/hub/` | Hub server extensions for bridge routing |
| `src/entities/claude-threads/listeners.ts` | Frontend listener for hook requests |
| `src/entities/claude-threads/settings-builder.ts` | Updated to include bridge hooks |

## Open questions

1. **Claude CLI hook protocol**: Need to verify the exact stdin/stdout JSON format for shell hooks. The `--settings` hook format may differ from the SDK's programmatic hooks.
2. **Connection strategy**: Stateless (connect per invocation) vs persistent (long-lived WebSocket). Stateless is simpler but adds latency. Could start stateless and optimize later.
3. **Fail-open vs fail-closed**: Currently proposed as fail-open (allow on timeout). Should this be configurable per permission mode?
4. **PostToolUse availability**: Does the Claude CLI support `PostToolUse` and `Stop` hooks via `--settings`? If not, we're limited to `PreToolUse` events only, and we'd need another approach for lifecycle tracking.
5. **Bridge bundling**: Should the bridge be compiled to a single JS file (esbuild bundle), or rely on the user having Node.js available? A compiled binary (pkg/bun compile) would be more portable.
