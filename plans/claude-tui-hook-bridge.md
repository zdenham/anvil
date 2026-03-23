# Claude TUI Hook Bridge

## Summary

Connect Claude CLI sessions (spawned in PTY by `plans/claude-tui-content-pane.md`) back to Mort's sidecar via the Mort plugin system. The plugin (`~/.mort/`) provides HTTP hooks that POST events to the sidecar, enabling lifecycle tracking, tool deny/allow decisions, and transcript-based state extraction — with full code sharing between SDK agent runs and CLI TUI runs.

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

SDK hooks and CLI hooks need the **same business logic** — the only difference is transport (in-process callback vs HTTP POST to sidecar). Shared pure-logic helpers live in `core/lib/hooks/`, importable by both `agents/` and `sidecar/`.

```
core/lib/hooks/                   ← Shared evaluator functions (pure logic)
  git-safety.ts                     BANNED_COMMANDS + evaluateGitCommand()
  tool-deny.ts                      DISALLOWED_TOOLS + shouldDenyTool()
  file-changes.ts                   extractFileChange(toolName, toolInput, workingDir)
  comment-resolution.ts             parseCommentResolution(command) → { ids } | null

core/lib/transcript/              ← Transcript parser (defensive, Zod safeParse)
  parser.ts                         readTranscript() + readTranscriptIncremental()
  schemas.ts                        Zod schemas for transcript line types
  types.ts                          TranscriptMessage, ParsedTranscript

agents/src/hooks/                 ← SDK adapters (in-process callbacks for query() options)
  safe-git-hook.ts                  thin wrapper → git-safety.evaluateGitCommand()
  repl-hook.ts                      agent-runner-only (MortReplRunner/ChildSpawner)
  comment-resolution-hook.ts        thin wrapper → comment-resolution.parse() + emitEvent()

sidecar/src/hooks/                ← HTTP adapter (sidecar route handler for CLI hooks)
  hook-handler.ts                   HTTP routes, calls core/lib/hooks/ evaluators
  thread-state-writer.ts            ThreadState via threadReducer, writes to disk
  transcript-reader.ts              Incremental transcript reads, merges into ThreadState
```

### Hooks as triggers, transcript as data source

Hook events are **triggers** ("something happened"). The transcript `.jsonl` file is the **data source** ("here's what happened"). Every hook input includes `transcript_path` — on PostToolUse and Stop, the sidecar reads new transcript lines to extract messages, usage, and thinking blocks. See `plans/tui-runner-state-architecture.md` for full details.

### Hook lifecycle (HTTP)

1. Claude CLI loads the Mort plugin at `~/.mort/`
2. Plugin's `hooks/hooks.json` registers HTTP hooks for PreToolUse, PostToolUse, Stop, SessionStart (URLs have sidecar port baked in)
3. When an event fires, Claude CLI POSTs the event JSON to `http://localhost:{port}/hooks/<event>` with `X-Mort-Thread-Id: $MORT_THREAD_ID` header
4. Sidecar handler calls the appropriate evaluator(s) — same functions used by SDK hooks
5. For PreToolUse: evaluator returns allow/deny decision → sidecar responds with JSON → CLI proceeds or blocks
6. For lifecycle events: sidecar emits to frontend via broadcaster, persists to event log → responds with `{ continue: true }`
7. If sidecar is unreachable (fail-open): hook times out (10s), Claude proceeds unblocked

## Plugin configuration

### `~/.mort/hooks/hooks.json` (dynamically generated)

**Generated by the sidecar on startup** with the resolved port baked in. Not a static file — the sidecar writes this on every startup so the URL always matches its actual port. `$MORT_THREAD_ID` remains an env var since it varies per PTY session.

```json
{
  "SessionStart": [
    {
      "hooks": [{
        "type": "http",
        "url": "http://localhost:9603/hooks/session-start",
        "headers": { "X-Mort-Thread-Id": "$MORT_THREAD_ID" },
        "allowedEnvVars": ["MORT_THREAD_ID"],
        "timeout": 10,
        "statusMessage": "Connecting to Mort..."
      }]
    }
  ],
  "PreToolUse": [
    {
      "hooks": [{
        "type": "http",
        "url": "http://localhost:9603/hooks/pre-tool-use",
        "headers": { "X-Mort-Thread-Id": "$MORT_THREAD_ID" },
        "allowedEnvVars": ["MORT_THREAD_ID"],
        "timeout": 10,
        "statusMessage": "Checking with Mort..."
      }]
    }
  ],
  "PostToolUse": [
    {
      "hooks": [{
        "type": "http",
        "url": "http://localhost:9603/hooks/post-tool-use",
        "headers": { "X-Mort-Thread-Id": "$MORT_THREAD_ID" },
        "allowedEnvVars": ["MORT_THREAD_ID"],
        "timeout": 10
      }]
    }
  ],
  "Stop": [
    {
      "hooks": [{
        "type": "http",
        "url": "http://localhost:9603/hooks/stop",
        "headers": { "X-Mort-Thread-Id": "$MORT_THREAD_ID" },
        "allowedEnvVars": ["MORT_THREAD_ID"],
        "timeout": 10
      }]
    }
  ]
}
```

*(Port* `9603` *is illustrative — actual port is determined at sidecar startup.)*

### Environment variables on PTY spawn

The content pane plan's `buildSpawnConfig()` is extended to include:

```typescript
args: [
  "--dangerously-skip-permissions",
  "--plugin", `local:${mortDir}`,
  "--model", model,
],
env: {
  MORT_THREAD_ID: threadId,                 // Session identity — sent as X-Mort-Thread-Id header
  MORT_DATA_DIR: mortDir,                   // For disk persistence
}
```

Note: `MORT_SIDECAR_URL` is not needed — the sidecar port is baked into `hooks.json` at sidecar startup.

### `SessionStart` hook for system prompt injection

The `SessionStart` hook returns `additionalContext` to inject **only Mort-specific context** that Claude can't auto-discover. Claude CLI already handles `CLAUDE.md`, git status, and env context natively — duplicating these wastes context window.

Injected via `additionalContext`:

- Thread identity (thread ID, parent thread ID)
- Plan context (if thread is working on a plan)
- Worktree path (if thread is in a worktree)

**Not injected** (Claude auto-discovers these):

- `CLAUDE.md` / coding guidelines
- Git status / branch info
- Environment details
- Permission mode (runs with `--dangerously-skip-permissions`)

```typescript
// Sidecar handler for SessionStart
function handleSessionStart(input: SessionStartHookInput, threadId: string): HookJSONOutput {
  const thread = await getThread(threadId);
  return {
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: buildMortContext({
        threadId: thread.id,
        parentThreadId: thread.parentThreadId,
        planContext: thread.planContext,
        worktreePath: thread.worktreePath,
      }),
    },
  };
}
```

## Phases

- [x] Phase 1: Extract shared helpers into `core/lib/hooks/` + build transcript parser in `core/lib/transcript/`

- [ ] Phase 2: Add HTTP hook endpoints + thread state writer + transcript reader to sidecar

- [ ] Phase 3: Dynamic `hooks.json` generation in sidecar on startup

- [ ] Phase 4: Extend `buildSpawnConfig()` with plugin + env vars

- [ ] Phase 5: Frontend integration for TUI thread state display

- [ ] Phase 6: Lifecycle event emission and tracking

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Extract shared helpers into `core/lib/hooks/`

Refactor existing SDK hooks to separate pure evaluation logic from SDK-specific transport. Shared helpers go in `core/lib/hooks/` (importable by both `agents/` and `sidecar/`). This phase is defined in detail in `plans/tui-runner-state-architecture.md` § "What Needs to Happen" items 1-2.

### Files to create

- `core/lib/hooks/git-safety.ts` — extract `BANNED_COMMANDS` + `evaluateGitCommand()` from `safe-git-hook.ts`
- `core/lib/hooks/tool-deny.ts` — extract `DISALLOWED_TOOLS` + `shouldDenyTool()` from `shared.ts`
- `core/lib/hooks/file-changes.ts` — extract file change detection from PostToolUse hook in `shared.ts`
- `core/lib/hooks/comment-resolution.ts` — extract command parsing from `comment-resolution-hook.ts`

### Update existing SDK hooks

- `safe-git-hook.ts` → thin wrapper calling `evaluateGitCommand()`
- `comment-resolution-hook.ts` → thin wrapper calling `parseCommentResolution()` + `emitEvent()`
- PostToolUse in `shared.ts` → call `extractFileChange()`
- `repl-hook.ts` → unchanged (agent-runner-only)

---

## Phase 2: Add HTTP hook endpoints to sidecar

### `sidecar/src/hooks/hook-handler.ts`

HTTP route handler calling shared `core/lib/hooks/` evaluators + transcript reader for rich state. See `plans/tui-runner-state-architecture.md` for full handler code.

```typescript
// POST /hooks/pre-tool-use
async function handlePreToolUse(input: PreToolUseHookInput, threadId: string): Promise<HookJSONOutput> {
  // 1. Check tool deny list
  const denyResult = shouldDenyTool(input.tool_name);
  if (denyResult.denied) return denyResponse(denyResult.reason);

  // 2. Check safe-git patterns
  if (input.tool_name === "Bash") {
    const gitResult = evaluateGitCommand(input.tool_input.command);
    if (!gitResult.allowed) return denyResponse(gitResult.reason);
  }

  // 3. Track tool as running
  stateWriter.dispatch(threadId, { type: "MARK_TOOL_RUNNING", ... });
  return { continue: true };
}

// POST /hooks/post-tool-use
async function handlePostToolUse(input: PostToolUseHookInput, threadId: string): Promise<HookJSONOutput> {
  // 1. Extract file changes
  const fileChange = extractFileChange(input.tool_name, input.tool_input, workingDir);
  if (fileChange) stateWriter.dispatch(threadId, { type: "UPDATE_FILE_CHANGE", payload: { change: fileChange } });

  // 2. Mark tool complete
  stateWriter.dispatch(threadId, { type: "MARK_TOOL_COMPLETE", ... });

  // 3. Read transcript for messages + usage
  transcriptReader.syncFromTranscript(threadId, input.transcript_path);

  return { continue: true };
}
```

### `sidecar/src/hooks/thread-state-writer.ts`

Writes `ThreadState` to disk using `threadReducer` from `core/lib/thread-reducer.ts`. In-memory cache per active thread, rehydrated from disk on first access. Broadcasts actions to frontend. Uses **per-thread async mutex** to serialize dispatches for the same threadId — parallel tool calls for different threads are fully concurrent, same-thread calls are serialized.

### `sidecar/src/hooks/transcript-reader.ts`

Incremental transcript reads. Maintains a cursor per thread so only new lines are parsed on each hook trigger. Extracts messages, usage, thinking blocks → dispatches to `ThreadStateWriter`.

### Sidecar HTTP routing

Add HTTP routes to the sidecar's existing TCP server (same port as WebSocket):

- `POST /hooks/session-start` → system prompt injection via `additionalContext`
- `POST /hooks/pre-tool-use` → deny/allow + tool state tracking
- `POST /hooks/post-tool-use` → file changes + tool completion + transcript sync
- `POST /hooks/stop` → session end + final transcript sync + thread status update

Thread identification via `X-Mort-Thread-Id` header (injected by `allowedEnvVars` + header interpolation in hooks.json).

---

## Phase 3: Dynamic hooks.json generation in sidecar

### Sidecar writes `~/.mort/hooks/hooks.json` on startup

Instead of a static file synced from `plugins/mort/`, the sidecar **dynamically generates** `hooks.json` on startup with its actual port baked into the URLs. This eliminates the need for `MORT_SIDECAR_URL` env var interpolation.

### `sidecar/src/hooks/hooks-writer.ts`

```typescript
function writeHooksJson(mortDir: string, port: number): void {
  const hooksDir = path.join(mortDir, "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const baseUrl = `http://localhost:${port}`;
  const hooks = buildHooksConfig(baseUrl);  // Returns the JSON structure above
  writeFileSync(path.join(hooksDir, "hooks.json"), JSON.stringify(hooks, null, 2));
}
```

Called after the sidecar binds its port (in the `listening` event handler, alongside writing the `.port` file).

### Graceful degradation

If the sidecar isn't running, `hooks.json` may point to a dead port. HTTP POSTs will fail → fail-open → Claude proceeds unblocked. If the sidecar restarts on a different port, it rewrites `hooks.json` with the new port.

---

## Phase 4: Extend `buildSpawnConfig()` with plugin + env vars

### `src/lib/claude-tui-args-builder.ts`

Extend the args builder from the content pane plan:

```typescript
function buildSpawnConfig(options: {
  mortDir: string;
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
      MORT_THREAD_ID: options.threadId,
      MORT_DATA_DIR: options.mortDir,
    },
  };
}
```

Note: No `MORT_SIDECAR_URL` needed — the sidecar port is baked into `~/.mort/hooks/hooks.json` at sidecar startup (Phase 3).

---

## Phase 5: Frontend integration for TUI thread state display

### Thread state from hooks + transcript

The sidecar writes `ThreadState` to `~/.mort/threads/{id}/state.json` and broadcasts updates to the frontend. The frontend can display:

- **Tool activity**: Currently running tools (from PreToolUse), recently completed tools (from PostToolUse)
- **File changes**: Files modified by the TUI session (extracted from PostToolUse tool_input)
- **Token usage**: Cumulative usage (extracted from transcript)
- **Status**: Running → completed (from Stop hook / PTY exit)

### Status dot mapping

```typescript
function getTuiThreadStatus(thread: ThreadMetadata): StatusDotVariant {
  if (thread.status === "completed") return "read";
  return "running";  // TUI threads run with --dangerously-skip-permissions, no permission prompts
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
| `core/lib/hooks/git-safety.ts` | Shared safe-git evaluation logic |
| `core/lib/hooks/tool-deny.ts` | Shared tool deny list |
| `core/lib/hooks/file-changes.ts` | Shared file change extraction |
| `core/lib/hooks/comment-resolution.ts` | Shared comment resolution parsing |
| `core/lib/transcript/parser.ts` | Transcript `.jsonl` parser (incremental) |
| `core/lib/transcript/schemas.ts` | Zod schemas for transcript lines |
| `sidecar/src/hooks/hook-handler.ts` | Sidecar HTTP handler for hook events |
| `sidecar/src/hooks/thread-state-writer.ts` | ThreadState via threadReducer |
| `sidecar/src/hooks/transcript-reader.ts` | Incremental transcript → state sync |
| `plugins/mort/hooks/hooks.json` | Plugin hook config (HTTP hooks) |
| `src/lib/claude-tui-args-builder.ts` | Extended with `--plugin` and env vars |

## Resolved decisions

1. **Fail-open**: If sidecar is unreachable, hooks fail and Claude proceeds unblocked. Users chose `--dangerously-skip-permissions` knowingly. Hooks are a convenience/safety layer, not a security boundary.
2. **Thread ID propagation**: Via `X-Mort-Thread-Id` header using env var interpolation (`$MORT_THREAD_ID`) in hooks.json. Stateless, no session-to-thread mapping needed.
3. **HTTP endpoint location**: Sidecar's existing TCP port (same as WebSocket). No new port needed.
4. **State architecture**: Hooks are triggers, transcript `.jsonl` is the data source. No per-thread Terminal Runner process needed — the sidecar reads the transcript incrementally on hook events to extract messages, usage, and thinking blocks. See `plans/tui-runner-state-architecture.md`.
5. **Shared helper location**: `core/lib/hooks/` (not `agents/src/hooks/lib/`) — importable by both `agents/` and `sidecar/`.
6. **SessionStart context**: Inject only Mort-specific context (thread ID, parent thread ID, plan context, worktree path). Claude auto-discovers [CLAUDE.md](http://CLAUDE.md), git, env natively — no duplication.
7. **PreToolUse timeout**: 10s for all hooks. Current hooks are stateless and sub-millisecond. Increase later if/when REPL or permission gating is added.
8. **hooks.json generation**: Dynamically generated by sidecar on startup with resolved port baked into URLs. Not a static file synced from `plugins/mort/`. Eliminates need for `MORT_SIDECAR_URL` env var.
9. **Concurrent hook requests**: Per-thread async mutex in `ThreadStateWriter`. Parallel tool calls for different threads are fully concurrent; same-thread calls are serialized.

## Open questions

1. **Plugin hooks vs user hooks**: If the user has their own hooks configured, both sets run. Need to verify hook ordering (plugin hooks vs project hooks).
2. **Graceful degradation**: When sidecar isn't running, hooks.json points to a dead port → fail-open. Acceptable?
3. **REPL hook for TUI**: Deferred. `MortReplRunner` + `ChildSpawner` need process-local state. When needed, either run in sidecar or spawn per-thread process.
4. **Transcript write timing**: Does Claude CLI flush transcript lines before firing hooks? If racy, add retry with backoff in transcript reader.