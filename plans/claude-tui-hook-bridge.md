# Claude TUI Hook Bridge

## Summary

Connect Claude CLI sessions (spawned in PTY by `plans/claude-tui-content-pane.md`) back to Mort's hub server via the Mort plugin system. The plugin (`~/.mort/`) provides HTTP hooks that POST events to the hub server, enabling lifecycle tracking, permission bridging, and tool deny/allow decisions — with full code sharing between SDK agent runs and CLI TUI runs.

**Depends on**: `plans/claude-tui-content-pane.md` (Phases 1-3 for PTY spawning and thread schema)

## Problem

Mort's SDK-managed threads emit rich lifecycle events: tool calls, permission requests, file changes, sub-agent spawns, token usage, etc. A Claude CLI process in a PTY is a black box — Mort can see terminal output bytes but has no structured understanding of what's happening.

## Architecture

### Plugin-based approach

The Mort plugin at `~/.mort/` already provides skills to both SDK and CLI sessions. This plan extends it with hooks via `~/.mort/hooks/hooks.json` (auto-discovered by the plugin system). The hooks use the **HTTP hook type** to POST events to the sidecar, which already runs a WebSocket server on a TCP port for the frontend.

```
┌─────────────────────┐     HTTP POST        ┌──────────────────┐
│   Claude CLI (PTY)  │ ───────────────────► │  Sidecar          │
│                     │    hook events        │  (HTTP + WS)      │
│  loads plugin at    │ ◄─────────────────── │                   │
│  ~/.mort/           │    JSON response      │  evaluator logic  │
└─────────────────────┘                       │  + hub relay      │
                                              └────────┬─────────┘
                                                       │ broadcast
                                                       ▼
                                              ┌──────────────────┐
                                              │  Mort Frontend    │
                                              │  (permission UI)  │
                                              └──────────────────┘
```

### HTTP hooks via sidecar

The sidecar already listens on a TCP port (`ws://localhost:{PORT}/ws`) for the frontend. We add HTTP routes to the same server for hook handling. This avoids opening a new port and leverages existing infrastructure.

Claude Code supports both `command` hooks (subprocess per invocation, stdin/stdout JSON) and `http` hooks (POST to URL, JSON request/response). We use HTTP because:

- The sidecar is already running on a TCP port — just add HTTP routes alongside WebSocket
- Zero subprocess overhead per hook invocation
- Same connection handles all hook types (PreToolUse, PostToolUse, Stop, SessionStart)
- Thread identification via `X-Mort-Thread-Id` header (env var interpolation in hooks.json)

### Fail-open design

Claude runs with `--dangerously-skip-permissions`. If the sidecar is unreachable (e.g., user runs `claude --plugin local:~/.mort` outside of Mort), HTTP hooks fail and Claude proceeds unblocked. The hooks are a convenience/safety layer, not a security boundary.

HTTP hook type from the SDK:

```typescript
{
  type: 'http';
  url: string;                          // URL to POST the hook input JSON to
  timeout?: number;                     // Timeout in seconds
  headers?: Record<string, string>;     // Can use $VAR_NAME for env var interpolation
  allowedEnvVars?: string[];            // Whitelist of env vars for header interpolation
  statusMessage?: string;               // Spinner text while hook runs
  once?: boolean;                       // Run once then remove
}
```

The CLI POSTs the same `PreToolUseHookInput` / `PostToolUseHookInput` / etc. JSON as the request body, and reads the same `HookJSONOutput` JSON from the response body. Docs: <https://docs.anthropic.com/en/docs/claude-code/hooks> (see "HTTP hook fields" section).

### Code sharing between SDK and CLI

The key insight: SDK hooks and CLI hooks need the **same business logic** — the only difference is transport (in-process callback vs HTTP POST to sidecar).

```
agents/src/hooks/lib/           ← Shared evaluator functions (pure logic)
  git-safety-evaluator.ts         BANNED_COMMANDS + pattern matching
  tool-deny-evaluator.ts          disallowed tool list check

agents/src/hooks/                ← SDK adapters (in-process callbacks for query() options)
  safe-git-hook.ts                 calls git-safety-evaluator, returns JS object
  repl-hook.ts                     calls MortReplRunner/ChildSpawner directly
  comment-resolution-hook.ts       calls emitEvent directly

sidecar/src/hooks/hook-handler.ts  ← HTTP adapter (sidecar route handler for CLI hooks)
                                      receives JSON POST, calls same evaluators,
                                      returns JSON response
```

The sidecar HTTP handler receives the same `PreToolUseHookInput` JSON shape that the SDK passes to callbacks. It calls the same evaluator functions and returns the same `HookJSONOutput` JSON.

**Stateless hooks (Phase 1)** — handled directly in the sidecar:

- **Safe-git checks**: `BANNED_COMMANDS` array, pattern matching logic
- **Tool deny lists**: Same list of disallowed tools (Mcp, EnterWorktree, etc.)
- **Lifecycle events**: Tool started/completed/denied, session ended

**Stateful hooks (Phase 2, future)** — require per-thread process ("Terminal Runner"):

- **Repl execution**: `MortReplRunner`, `ChildSpawner` need process-local state
- **Comment resolution**: `emitEvent()` tied to thread context
- **Permission gating**: `permissionGate` waits for user approval

The Terminal Runner follows the same one-process-per-thread pattern as SDK agent threads. The sidecar relays hook requests to the terminal runner via the hub WebSocket. This is deferred until TUI threads need REPL/permission support.

### Hook lifecycle (HTTP)

1. Claude CLI loads the Mort plugin at `~/.mort/`
2. Plugin's `hooks/hooks.json` registers HTTP hooks for PreToolUse, PostToolUse, Stop, SessionStart
3. When an event fires, Claude CLI POSTs the event JSON to `$MORT_SIDECAR_URL/hooks/<event>` with `X-Mort-Thread-Id: $MORT_THREAD_ID` header
4. Sidecar handler calls the appropriate evaluator(s) — same functions used by SDK hooks
5. For PreToolUse: evaluator returns allow/deny decision → sidecar responds with JSON → CLI proceeds or blocks
6. For lifecycle events: sidecar emits to frontend via broadcaster, persists to event log → responds with `{ continue: true }`
7. If sidecar is unreachable (fail-open): hook times out, Claude proceeds unblocked

## Plugin configuration

### `~/.mort/hooks/hooks.json`

```json
{
  "SessionStart": [
    {
      "hooks": [{
        "type": "http",
        "url": "$MORT_SIDECAR_URL/hooks/session-start",
        "headers": { "X-Mort-Thread-Id": "$MORT_THREAD_ID" },
        "allowedEnvVars": ["MORT_SIDECAR_URL", "MORT_THREAD_ID"],
        "timeout": 10,
        "statusMessage": "Connecting to Mort..."
      }]
    }
  ],
  "PreToolUse": [
    {
      "hooks": [{
        "type": "http",
        "url": "$MORT_SIDECAR_URL/hooks/pre-tool-use",
        "headers": { "X-Mort-Thread-Id": "$MORT_THREAD_ID" },
        "allowedEnvVars": ["MORT_SIDECAR_URL", "MORT_THREAD_ID"],
        "timeout": 86400,
        "statusMessage": "Checking with Mort..."
      }]
    }
  ],
  "PostToolUse": [
    {
      "hooks": [{
        "type": "http",
        "url": "$MORT_SIDECAR_URL/hooks/post-tool-use",
        "headers": { "X-Mort-Thread-Id": "$MORT_THREAD_ID" },
        "allowedEnvVars": ["MORT_SIDECAR_URL", "MORT_THREAD_ID"],
        "timeout": 10
      }]
    }
  ],
  "Stop": [
    {
      "hooks": [{
        "type": "http",
        "url": "$MORT_SIDECAR_URL/hooks/stop",
        "headers": { "X-Mort-Thread-Id": "$MORT_THREAD_ID" },
        "allowedEnvVars": ["MORT_SIDECAR_URL", "MORT_THREAD_ID"],
        "timeout": 10
      }]
    }
  ]
}
```

### Environment variables on PTY spawn

The content pane plan's `buildSpawnConfig()` is extended to include:

```typescript
args: [
  "--dangerously-skip-permissions",
  "--plugin", `local:${mortDir}`,
  "--model", model,
],
env: {
  MORT_SIDECAR_URL: sidecar.getHttpUrl(),   // HTTP URL for hook POSTs (same port as WS)
  MORT_THREAD_ID: threadId,                 // Session identity — sent as X-Mort-Thread-Id header
  MORT_DATA_DIR: mortDir,                   // For disk persistence
}
```

### `SessionStart` hook for system prompt injection

The `SessionStart` hook returns `additionalContext` to inject Mort-specific instructions — replacing `--append-system-prompt`. This is where worktree context, plan context, and coding guidelines get injected.

```typescript
// Hub handler for SessionStart
function handleSessionStart(input: SessionStartHookInput, threadId: string): HookJSONOutput {
  const thread = await getThread(threadId);
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: buildSystemContext({
        worktreePath: thread.worktreePath,
        planContext: thread.planContext,
      }),
    },
  };
}
```

## Phases

- [ ] Phase 1: Extract shared evaluator functions from SDK hooks

- [ ] Phase 2: Add HTTP hook endpoints to hub server

- [ ] Phase 3: Create `hooks/hooks.json` in plugin directory

- [ ] Phase 4: Extend `buildSpawnConfig()` with plugin + env vars

- [ ] Phase 5: Frontend integration for permission UI

- [ ] Phase 6: Lifecycle event emission and tracking

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Extract shared evaluator functions from SDK hooks

Refactor existing SDK hooks to separate pure evaluation logic from SDK-specific transport.

### `agents/src/hooks/lib/git-safety-evaluator.ts`

Extract from `safe-git-hook.ts`:

```typescript
export type GitEvaluationResult =
  | { allowed: true }
  | { allowed: false; reason: string; suggestion: string };

export const BANNED_COMMANDS: Array<{ pattern: RegExp; reason: string; suggestion: string }>;

export function evaluateGitCommand(command: string): GitEvaluationResult;
```

### `agents/src/hooks/lib/tool-deny-evaluator.ts`

```typescript
export const DISALLOWED_TOOLS = [
  "Mcp", "ListMcpResources", "ReadMcpResource",
  "SubscribeMcpResource", "UnsubscribeMcpResource",
  "SubscribePolling", "UnsubscribePolling", "EnterWorktree",
];

export function shouldDenyTool(toolName: string): { denied: boolean; reason?: string };
```

### Update existing SDK hooks

`safe-git-hook.ts`, `repl-hook.ts`, `comment-resolution-hook.ts` become thin SDK adapters that call the shared evaluators. No behavior change — just a refactor.

---

## Phase 2: Add HTTP hook endpoints to sidecar

### `sidecar/src/hooks/hook-handler.ts`

New route handler that processes incoming hook POSTs from the CLI. Handles **stateless** hooks only (safe-git, tool-deny, lifecycle). Stateful hooks (REPL, comment resolution, permission gating) are deferred to the Terminal Runner architecture.

```typescript
// POST /hooks/pre-tool-use
async function handlePreToolUse(input: PreToolUseHookInput, threadId: string): Promise<HookJSONOutput> {
  // 1. Fast path: check tool deny list
  const denyResult = shouldDenyTool(input.tool_name);
  if (denyResult.denied) return denyResponse(denyResult.reason);

  // 2. Fast path: check safe-git patterns
  if (input.tool_name === "Bash") {
    const gitResult = evaluateGitCommand(input.tool_input.command);
    if (!gitResult.allowed) return denyResponse(gitResult.reason);
  }

  // 3. Default: allow
  return { continue: true };
}
```

### Sidecar HTTP routing

Add HTTP routes to the sidecar's existing TCP server (same port as WebSocket):

- `POST /hooks/session-start` → system prompt injection via `additionalContext`
- `POST /hooks/pre-tool-use` → deny/allow decisions (stateless evaluators)
- `POST /hooks/post-tool-use` → lifecycle events (emit to frontend via broadcaster)
- `POST /hooks/stop` → session completion notification

Thread identification via `X-Mort-Thread-Id` header (injected by `allowedEnvVars` + header interpolation in hooks.json).

---

## Phase 3: Create `hooks/hooks.json` in plugin directory

### `plugins/mort/hooks/hooks.json`

Add the hooks config file to the Mort plugin source. It gets synced to `~/.mort/hooks/hooks.json` on app startup (same as skills sync).

The hooks use `$MORT_SIDECAR_URL` env var interpolation for the URL, so they're inert when the hub isn't running (e.g., if the user runs `claude` outside of Mort — the POST fails and the hook falls through with `{ continue: true }`).

### Plugin sync update

Update the plugin sync logic to copy `hooks/hooks.json` alongside skills.

---

## Phase 4: Extend `buildSpawnConfig()` with plugin + env vars

### `src/lib/claude-tui-args-builder.ts`

Extend the args builder from the content pane plan:

```typescript
function buildSpawnConfig(options: {
  mortDir: string;
  hubUrl: string;
  threadId: string;
  sessionId?: string;
  model?: string;
}): ClaudeTuiSpawnConfig {
  return {
    args: [
      "--dangerously-skip-permissions",
      "--plugin", `local:${options.mortDir}`,
      "--model", options.model ?? "claude-sonnet-4-6",
    ],
    env: {
      MORT_SIDECAR_URL: options.hubUrl,
      MORT_THREAD_ID: options.threadId,
      MORT_DATA_DIR: options.mortDir,
    },
  };
}
```

---

## Phase 5: Frontend integration for permission UI

### Reuse existing permission approval flow

The frontend already has permission approval UI for SDK-managed threads. Extend it to work with TUI sessions:

- Listen for hook requests forwarded from the hub
- Show the same approval UI (overlay or notification on the terminal content pane)
- When user approves/denies, send decision back through hub → hub responds to the HTTP hook
- Tree menu item shows `needs-input` status (amber shimmer) when a permission is pending

### Status dot mapping

```typescript
function getClaudeThreadStatus(thread: ThreadMetadata, hasPendingPermission: boolean): StatusDotVariant {
  if (thread.status === "completed") return "read";
  if (hasPendingPermission) return "needs-input";
  return "running";
}
```

---

## Phase 6: Lifecycle event emission and tracking

### Events emitted from hub hook handlers

| Event | When | Payload |
| --- | --- | --- |
| `TOOL_STARTED` | PreToolUse handler receives request | `{toolName, toolInput, toolUseId}` |
| `TOOL_COMPLETED` | PostToolUse handler receives request | `{toolName, toolResult, toolUseId, durationMs}` |
| `TOOL_DENIED` | PreToolUse returns deny | `{toolName, reason, toolUseId}` |
| `FILE_MODIFIED` | PostToolUse for Write/Edit | `{filePath, toolUseId}` |
| `SESSION_ENDED` | Stop handler receives request | `{sessionId, totalTokens}` |

### Event persistence

Events are written to `~/.mort/threads/{id}/events.jsonl` (append-only log). Enables post-session review, cost tracking, and file change tracking.

---

## Key files

| File | Purpose |
| --- | --- |
| `agents/src/hooks/lib/git-safety-evaluator.ts` | Shared safe-git evaluation logic |
| `agents/src/hooks/lib/tool-deny-evaluator.ts` | Shared tool deny list |
| `sidecar/src/hooks/hook-handler.ts` | Sidecar HTTP handler for hook events |
| `plugins/mort/hooks/hooks.json` | Plugin hook config (HTTP hooks) |
| `src/lib/claude-tui-args-builder.ts` | Extended with `--plugin` and env vars |
| `core/types/events.ts` | New message types for hook events |

## Resolved decisions

1. **Fail-open**: If sidecar is unreachable, hooks fail and Claude proceeds unblocked. Users chose `--dangerously-skip-permissions` knowingly. Hooks are a convenience/safety layer, not a security boundary.
2. **Thread ID propagation**: Via `X-Mort-Thread-Id` header using env var interpolation (`$MORT_THREAD_ID`) in hooks.json. Stateless, no session-to-thread mapping needed.
3. **HTTP endpoint location**: Sidecar's existing TCP port (same as WebSocket). No new port needed.
4. **Stateful vs stateless hooks**: Start with stateless hooks only (safe-git, tool-deny, lifecycle). Stateful hooks (REPL, comment resolution, permission gating) deferred to Terminal Runner architecture.

## Open questions

1. **Terminal Runner architecture (Q4)**: For stateful hooks (REPL, permissions), the plan proposes a per-thread "Terminal Runner" Node process that receives relayed hook requests from the sidecar via hub WebSocket. This follows the same one-process-per-thread pattern as SDK agent threads. **Decision pending** — see architecture options in plan discussion.
2. **Plugin hooks vs user hooks**: If the user has their own hooks configured, both sets run. Need to verify hook ordering (plugin hooks vs project hooks).
3. **Graceful degradation**: When `MORT_SIDECAR_URL` is not set (user runs `claude --plugin local:~/.mort` outside Mort), HTTP hooks should fail silently and fall through.
4. **Repl hook timeout**: The PreToolUse timeout is set to 86400s to accommodate future REPL execution via Terminal Runner. For stateless-only phase, this could be reduced.