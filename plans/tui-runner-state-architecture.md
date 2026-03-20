# TUI Runner State Architecture

## Summary

Defines how to share hook logic between the SDK agent runner and the TUI sidecar hook handler. The sidecar receives HTTP hook events from Claude CLI processes and calls the **same shared functions** the agent runner uses, then writes thread state to disk.

**Context**: `plans/claude-tui-hook-bridge.md` defines the HTTP hook transport. This plan focuses on the code structure for sharing hook logic.

---

## Approach

1. **Sidecar** hosts HTTP hook endpoints that receive `PreToolUseHookInput` / `PostToolUseHookInput` / etc. from Claude CLI
2. These endpoints call **shared hook helpers** that live in a location importable by both `agents/` (SDK runner) and `sidecar/` (TUI handler)
3. The **agent runner** calls these same helpers AND does additional SDK-specific work (streaming, permission gates, message accumulation, etc.)

The shared helpers are the **pure evaluation and state-writing logic**. The agent runner wraps them with SDK-specific side effects.

---

## What's Shared vs Agent-Runner-Only

### Shared (used by both sidecar and agent runner)

| Function | What It Does | Current Location |
| --- | --- | --- |
| **Git safety evaluation** | `BANNED_COMMANDS` + regex matching → allow/deny | `agents/src/hooks/safe-git-hook.ts` (embedded in factory) |
| **Tool deny list** | Check tool name against disallowed list → deny | `agents/src/runners/shared.ts:1452` (inline in `query()` config) |
| **File change extraction** | Parse `tool_input` for file paths from Write/Edit/NotebookEdit → `FileChange` | `agents/src/runners/shared.ts` PostToolUse hook (inline) |
| **Comment resolution** | Parse `mort-resolve-comment` command → extract IDs, emit events | `agents/src/hooks/comment-resolution-hook.ts` |
| **Tool state tracking** | PreToolUse → `markToolRunning()`, PostToolUse → `markToolComplete()` | `agents/src/runners/shared.ts` + `output.ts` |
| **Plan detection + phase parsing** | Detect plan file writes, parse `## Phases` sections | `agents/src/runners/shared.ts` PostToolUse hook (inline) |

### Agent-Runner-Only (NOT shared)

| Thing | Why Agent-Runner-Only |
| --- | --- |
| StreamAccumulator | SDK streaming events → throttled display. TUI uses PTY. |
| PermissionGate / QuestionGate | SDK async coordination. CLI has its own prompts. |
| answerStash | SDK two-phase internal plumbing. |
| MessageHandler (message routing) | Routes SDK message types. TUI has no SDK messages. |
| HubClient / SocketMessageStream | Agent→Hub WebSocket transport. TUI uses HTTP hooks. |
| QueuedAckManager | SDK message injection lifecycle. |
| Context pressure tracking | Derived from SDK usage data not available in hooks. |
| REPL hook | `MortReplRunner` + `ChildSpawner` need process-local state. Deferred for TUI. |

---

## File Structure

Shared helpers need to be importable from both `agents/` and `sidecar/`. Current type layering: `src/ → agents/ → core/` (imports flow inward). Both `agents/` and `sidecar/` already import from `core/`.

```
core/lib/hooks/
  git-safety.ts              ← BANNED_COMMANDS + evaluateGitCommand()
  tool-deny.ts               ← DISALLOWED_TOOLS + shouldDenyTool()
  file-changes.ts            ← extractFileChange(toolName, toolInput, workingDir) → FileChange | null
  comment-resolution.ts      ← parseCommentResolution(command) → { ids } | null
  plan-detection.ts          ← isPlanPath() + parsePhases() (check if already in core)

agents/src/hooks/
  safe-git-hook.ts           ← thin wrapper: calls git-safety.evaluateGitCommand()
  comment-resolution-hook.ts ← thin wrapper: calls comment-resolution.parse() + emitEvent()
  repl-hook.ts               ← unchanged (agent-runner-only)

sidecar/src/hooks/
  hook-handler.ts            ← HTTP route handler: calls same core/lib/hooks/ functions
  thread-state-writer.ts     ← Writes ThreadState to disk using threadReducer from core
```

### What each shared helper looks like

```typescript
// core/lib/hooks/git-safety.ts
export const BANNED_COMMANDS: Array<{ pattern: RegExp; reason: string; suggestion: string }> = [...];

export type GitEvalResult = { allowed: true } | { allowed: false; reason: string; suggestion: string };

export function evaluateGitCommand(command: string): GitEvalResult { ... }
```

```typescript
// core/lib/hooks/tool-deny.ts
export const DISALLOWED_TOOLS = ["EnterWorktree", "Mcp", ...];

export function shouldDenyTool(toolName: string): { denied: boolean; reason?: string } { ... }
```

```typescript
// core/lib/hooks/file-changes.ts
import type { FileChange } from "@core/types/events.js";

const FILE_MODIFYING_TOOLS = ["Write", "Edit", "NotebookEdit", "MultiEdit"];

export function extractFileChange(
  toolName: string,
  toolInput: Record<string, unknown>,
  workingDir: string,
): FileChange | null { ... }
```

```typescript
// core/lib/hooks/comment-resolution.ts
export function parseCommentResolution(command: string): { ids: string[] } | null { ... }
```

---

## How Each Consumer Uses the Shared Helpers

### Agent runner (SDK)

The agent runner's hooks in `shared.ts` become thin wrappers that call the shared helper, then do SDK-specific work:

```typescript
// PreToolUse hook (simplified)
import { evaluateGitCommand } from "@core/lib/hooks/git-safety.js";

async (hookInput) => {
  const result = evaluateGitCommand(command);       // ← shared
  if (!result.allowed) return denyResponse(...);

  // Agent-runner-only: permission evaluation, REPL interception, streaming, etc.
  return { continue: true };
};
```

### Sidecar (TUI)

The sidecar HTTP handler calls the same shared helpers, then writes state to disk:

```typescript
// sidecar/src/hooks/hook-handler.ts
import { evaluateGitCommand } from "@core/lib/hooks/git-safety.js";
import { shouldDenyTool } from "@core/lib/hooks/tool-deny.js";
import { extractFileChange } from "@core/lib/hooks/file-changes.js";

async function handlePreToolUse(input: PreToolUseHookInput, threadId: string) {
  const deny = shouldDenyTool(input.tool_name);             // ← shared
  if (deny.denied) return denyResponse(deny.reason);

  if (input.tool_name === "Bash") {
    const gitResult = evaluateGitCommand(command);           // ← shared
    if (!gitResult.allowed) return denyResponse(...);
  }

  // Sidecar-specific: write tool state to disk, broadcast to frontend
  stateWriter.dispatch(threadId, { type: "MARK_TOOL_RUNNING", ... });
  return { continue: true };
}

async function handlePostToolUse(input: PostToolUseHookInput, threadId: string) {
  const fileChange = extractFileChange(input.tool_name, input.tool_input, workingDir);  // ← shared
  if (fileChange) {
    stateWriter.dispatch(threadId, { type: "UPDATE_FILE_CHANGE", payload: { change: fileChange } });
  }

  stateWriter.dispatch(threadId, { type: "MARK_TOOL_COMPLETE", ... });
  return { continue: true };
}
```

---

## State Writing in the Sidecar

The sidecar writes `state.json` and `metadata.json` using the same `threadReducer` from `core/lib/thread-reducer.ts`:

```typescript
// sidecar/src/hooks/thread-state-writer.ts
import { threadReducer, type ThreadAction } from "@core/lib/thread-reducer.js";

class ThreadStateWriter {
  private states = new Map<string, ThreadState>();  // in-memory cache

  dispatch(threadId: string, action: ThreadAction): void {
    let state = this.states.get(threadId) ?? this.loadFromDisk(threadId);
    state = threadReducer(state, action);
    this.states.set(threadId, state);
    this.writeToDisk(threadId, state);
    this.broadcastToFrontend(threadId, action);
  }
}
```

Only in-memory state: a cache of `ThreadState` per active thread. Thrown away on restart, rehydrated from disk.

### Per-thread ephemeral state

```typescript
interface TuiThreadContext {
  threadId: string;
  threadPath: string;
  toolTimers: Map<string, number>;  // toolUseId → Date.now() for duration tracking
}
```

Created on first hook request, cleaned up on Stop hook.

---

## What Needs to Happen

### 1. Extract shared helpers from agent runner into `core/lib/hooks/`

- **git-safety.ts** — Extract `BANNED_COMMANDS` + matching from `safe-git-hook.ts`
- **tool-deny.ts** — Extract `disallowedTools` from `shared.ts:1452`
- **file-changes.ts** — Extract file change detection from PostToolUse hook in `shared.ts`
- **comment-resolution.ts** — Extract command parsing from `comment-resolution-hook.ts`
- **plan-detection.ts** — Check if already in core; if not, move there

### 2. Update agent runner hooks to use shared helpers

- `safe-git-hook.ts` → call `evaluateGitCommand()`
- `comment-resolution-hook.ts` → call `parseCommentResolution()`
- PostToolUse in `shared.ts` → call `extractFileChange()`

### 3. Add sidecar hook endpoints

- `sidecar/src/hooks/hook-handler.ts` — HTTP handlers calling shared helpers
- `sidecar/src/hooks/thread-state-writer.ts` — ThreadState via `threadReducer`
- Register routes on sidecar's existing HTTP server

---

## Open Questions

1. **Token usage** — HTTP hooks don't include usage data. TUI threads won't have token tracking unless we find an alternative source. Accept the gap for now.
2. **Child thread ID propagation** — When TUI Claude spawns a sub-agent, how does the child get a `MORT_THREAD_ID`? May need self-registration via SessionStart hook.
3. **Concurrent hook requests** — Parallel tools mean concurrent writes for the same thread. `ThreadStateWriter` needs per-thread serialization.
4. **REPL hook for TUI** — Deferred. Needs process-local state. When needed, either run in sidecar or spawn per-thread process.

## Phases

- [x] Audit all stateful objects in agent runner

- [x] Categorize as needed/not-needed for TUI

- [x] Define shared helper structure and file layout

- [ ] Extract shared helpers into `core/lib/hooks/`

- [ ] Update agent runner hooks to use shared helpers

- [ ] Add sidecar hook endpoints + thread state writer

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---