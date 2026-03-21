# TUI Runner State Architecture

## Summary

Defines how TUI sidecar builds thread state from Claude CLI processes **without the SDK runner**. Two data sources:

1. **Hooks** — reliable backbone. Fire as HTTP events from Claude CLI. Used for tool lifecycle, file changes, git safety, session start/stop. Stable, documented API.
2. **Transcript file** — enrichment layer. A `.jsonl` file written by Claude CLI containing full conversation history (assistant messages, thinking blocks, token usage). Available via `transcript_path` in every hook input. **Internal format with no stability guarantees** — must be parsed defensively.

**Context**: `plans/claude-tui-hook-bridge.md` defines the HTTP hook transport. This plan focuses on the state architecture.

---

## Key Insight: Hooks Don't Expose Messages

Of 22 hook event types, only `Stop` and `SubagentStop` include assistant message content (`last_assistant_message?: string` — plain text only, no thinking blocks). No hook fires mid-turn with assistant content.

However, every hook input includes `transcript_path` pointing to a `.jsonl` transcript file that contains **full structured messages** — text blocks, thinking blocks, tool_use blocks, and per-message usage data. This changes the architecture fundamentally: hooks are **triggers** ("something happened"), the transcript is the **data source** ("here's what happened").

---

## Approach

1. **Hooks as triggers** — Sidecar HTTP endpoints receive hook events. Used for:

   - Tool state tracking (PreToolUse/PostToolUse)
   - File change extraction (PostToolUse tool_input)
   - Git safety / tool deny evaluation
   - Session lifecycle (SessionStart/Stop)
   - **Triggering transcript reads** when richer data is needed

2. **Transcript as data source** — On key hook events (PostToolUse, Stop, periodic), read the transcript `.jsonl` to extract:

   - Full assistant messages (text + thinking blocks)
   - Token usage per message
   - Cumulative usage (derived)
   - Context pressure (derived from usage)
   - Complete conversation history

3. **Shared hook helpers** — Pure evaluation logic in `core/lib/hooks/`, importable by both `agents/` (SDK runner) and `sidecar/` (TUI handler)

4. **Defensive transcript parsing** — Zod `.safeParse()` on every line. Unknown fields dropped, missing fields get defaults. Version detection from `SDKSystemMessage` init line. Graceful degradation: if parsing fails, tool states from hooks still work.

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
| **Transcript parser** | Parse `.jsonl` transcript → messages, usage, thinking blocks | NEW: `core/lib/transcript/` |

### Agent-Runner-Only (NOT shared)

| Thing | Why Agent-Runner-Only |
| --- | --- |
| StreamAccumulator | SDK streaming events → throttled display. TUI uses PTY. |
| PermissionGate / QuestionGate | SDK async coordination. CLI has its own prompts. |
| answerStash | SDK two-phase internal plumbing. |
| MessageHandler (message routing) | Routes SDK message types. TUI has no SDK messages. |
| HubClient / SocketMessageStream | Agent→Hub WebSocket transport. TUI uses HTTP hooks. |
| QueuedAckManager | SDK message injection lifecycle. |
| REPL hook | `MortReplRunner` + `ChildSpawner` need process-local state. Deferred for TUI. |

### Previously "Agent-Runner-Only" — Now Available via Transcript

| Thing | How |
| --- | --- |
| **Token usage** | Each transcript message has `usage` (input/output/cache tokens) |
| **Context pressure** | Derived: cumulative tokens / model context window |
| **Assistant messages** | Full content blocks (text, thinking, tool_use) in transcript |
| **Conversation history** | Complete message sequence in transcript `.jsonl` |

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

core/lib/transcript/
  parser.ts                  ← readTranscript(path) → ParsedTranscript
  schemas.ts                 ← Zod schemas for transcript line types (safeParse, not parse)
  types.ts                   ← TranscriptMessage, ParsedTranscript, ParseError

agents/src/hooks/
  safe-git-hook.ts           ← thin wrapper: calls git-safety.evaluateGitCommand()
  comment-resolution-hook.ts ← thin wrapper: calls comment-resolution.parse() + emitEvent()
  repl-hook.ts               ← unchanged (agent-runner-only)

sidecar/src/hooks/
  hook-handler.ts            ← HTTP route handler: calls same core/lib/hooks/ functions
  thread-state-writer.ts     ← Writes ThreadState to disk using threadReducer from core
  transcript-reader.ts       ← Reads + parses transcript, merges into ThreadState
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

### Transcript parser

```typescript
// core/lib/transcript/schemas.ts
import { z } from "zod/v4";

// Permissive schemas — safeParse drops unknown fields, defaults missing ones
const UsageSchema = z.object({
  input_tokens: z.number().default(0),
  output_tokens: z.number().default(0),
  cache_creation_input_tokens: z.number().default(0),
  cache_read_input_tokens: z.number().default(0),
}).passthrough();

const ContentBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).passthrough(),
  z.object({ type: z.literal("thinking"), thinking: z.string() }).passthrough(),
  z.object({ type: z.literal("tool_use"), id: z.string(), name: z.string(), input: z.unknown() }).passthrough(),
  z.object({ type: z.literal("tool_result"), tool_use_id: z.string(), content: z.unknown() }).passthrough(),
  // Catch-all for unknown block types — don't crash, just capture
  z.object({ type: z.string() }).passthrough(),
]);

const TranscriptLineSchema = z.object({
  type: z.enum(["user", "assistant", "system", "result"]).catch("unknown" as any),
  message: z.object({
    content: z.array(ContentBlockSchema).default([]),
    usage: UsageSchema.optional(),
    stop_reason: z.string().optional(),
    model: z.string().optional(),
  }).passthrough().optional(),
  uuid: z.string().optional(),
  session_id: z.string().optional(),
  subtype: z.string().optional(),
}).passthrough();
```

```typescript
// core/lib/transcript/parser.ts
export interface ParsedTranscript {
  messages: TranscriptMessage[];       // Successfully parsed messages
  errors: ParseError[];                // Lines that failed to parse (line number + raw text)
  cliVersion?: string;                 // From init message if present
  cumulativeUsage: TokenUsage;         // Summed across all assistant messages
}

export interface ParseError {
  lineNumber: number;
  raw: string;
  error: string;
}

/**
 * Read transcript .jsonl file and parse each line defensively.
 * - Lines that fail JSON.parse → logged to errors, skipped
 * - Lines that fail Zod safeParse → logged to errors, skipped
 * - Returns whatever we could parse. Caller decides if partial data is acceptable.
 */
export function readTranscript(filePath: string): ParsedTranscript { ... }

/**
 * Incremental read — only parse lines after `fromLine`.
 * Used for polling: on each hook trigger, read only new lines since last read.
 */
export function readTranscriptIncremental(
  filePath: string,
  fromLine: number,
): { transcript: ParsedTranscript; lastLine: number } { ... }
```

```typescript
// core/lib/transcript/types.ts
export interface TranscriptMessage {
  role: "user" | "assistant" | "system" | "result";
  content: ContentBlock[];             // Parsed content blocks
  usage?: TokenUsage;                  // Per-message usage (assistant only)
  uuid?: string;
  stopReason?: string;
  model?: string;
  raw?: Record<string, unknown>;       // Passthrough fields we didn't parse
}
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

The sidecar HTTP handler calls the same shared helpers, reads the transcript for rich data, then writes state to disk:

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

  // Read transcript for messages + usage that hooks don't carry
  transcriptReader.syncFromTranscript(threadId, input.transcript_path);

  return { continue: true };
}
```

```typescript
// sidecar/src/hooks/transcript-reader.ts
import { readTranscriptIncremental } from "@core/lib/transcript/parser.js";

class TranscriptReader {
  // Track read position per thread so we only parse new lines
  private cursors = new Map<string, number>();

  syncFromTranscript(threadId: string, transcriptPath: string): void {
    const cursor = this.cursors.get(threadId) ?? 0;
    const { transcript, lastLine } = readTranscriptIncremental(transcriptPath, cursor);
    this.cursors.set(threadId, lastLine);

    if (transcript.errors.length > 0) {
      logger.warn("transcript-parse-errors", {
        threadId,
        errorCount: transcript.errors.length,
        // Don't log raw content — could be large
        lines: transcript.errors.map((e) => e.lineNumber),
      });
    }

    // Merge new messages into thread state
    for (const msg of transcript.messages) {
      if (msg.role === "assistant") {
        stateWriter.dispatch(threadId, {
          type: "UPSERT_MESSAGE",
          payload: { message: msg },
        });
      }
    }

    // Update cumulative usage
    if (transcript.cumulativeUsage) {
      stateWriter.dispatch(threadId, {
        type: "UPDATE_USAGE",
        payload: { usage: transcript.cumulativeUsage },
      });
    }
  }
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

1. **Transcript format stability** — The `.jsonl` format is internal to Claude CLI with no stability guarantees. Mitigation: Zod safeParse, version detection from init message, graceful degradation. But we should pin to a known-good CLI version range and test transcript parsing on upgrades.
2. **Transcript write timing** — Does Claude CLI flush transcript lines synchronously before firing hooks, or could there be a race where the hook fires but the transcript hasn't been written yet? Needs empirical testing. If racy, add a short retry with backoff on `readTranscriptIncremental`.
3. **Child thread ID propagation** — When TUI Claude spawns a sub-agent, how does the child get a `MORT_THREAD_ID`? May need self-registration via SessionStart hook. The `SubagentStop` hook includes `agent_transcript_path` which could be read separately.
4. **Concurrent hook requests** — Parallel tools mean concurrent writes for the same thread. `ThreadStateWriter` needs per-thread serialization.
5. **REPL hook for TUI** — Deferred. Needs process-local state. When needed, either run in sidecar or spawn per-thread process.
6. **Streaming gap** — Hooks + transcript cannot provide streaming deltas. The TUI content pane shows PTY output for real-time text, so this may be acceptable. But it means Mort can't show structured "thinking in progress" state the way the SDK runner can.

## Phases

- [x] Audit all stateful objects in agent runner

- [x] Categorize as needed/not-needed for TUI

- [x] Define shared helper structure and file layout

- [x] Define transcript parser architecture (schemas, incremental reads, error handling)

- [ ] Extract shared helpers into `core/lib/hooks/`

- [ ] Build transcript parser in `core/lib/transcript/`

- [ ] Update agent runner hooks to use shared helpers

- [ ] Add sidecar hook endpoints + thread state writer + transcript reader

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---