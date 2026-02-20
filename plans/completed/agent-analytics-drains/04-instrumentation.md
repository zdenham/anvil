# 04 — Hook Instrumentation

## Summary

Wire up drain event emission at every instrumentation point defined in the original plan. This touches `shared.ts` (hooks) and `message-handler.ts` (API call / context pressure). All emit calls go through `DrainManager` from sub-plan 03.

## Phases

- [x] Instrument PreToolUse hook in `shared.ts` — emit `tool:started`, `tool:denied`, `permission:decided`
- [x] Instrument PostToolUse / PostToolUseFailure hooks in `shared.ts` — emit `tool:completed`, `tool:failed`
- [x] Instrument sub-agent spawn/complete in `shared.ts` — emit `subagent:spawned`, `subagent:completed`
- [x] Instrument `runAgentLoop` entry/exit — emit `thread:lifecycle`
- [x] Instrument `MessageHandler` — emit `api:call`, `context:pressure`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Prerequisite

`DrainManager` from sub-plan 03 must be instantiated in `runAgentLoop()` and passed into hooks and the message handler.

### Threading DrainManager

In `shared.ts`, after creating the hub client:

```typescript
const drainManager = new DrainManager(getHubClient());
```

Pass to `MessageHandler`:

```typescript
const handler = new MessageHandler(config.mortDir, accumulator, drainManager);
```

Hooks access `drainManager` via closure (it's created in the same scope as the hook definitions).

---

## File: `agents/src/runners/shared.ts`

### PreToolUse hook additions

**Location:** Inside the existing PreToolUse hooks (line ~457+). Add drain emission alongside existing logic.

#### `tool:started` — emit at the START of the permission hook

```typescript
// At top of permission hook, before evaluation:
drainManager.startTimer(toolUseId);
// After permission evaluation resolves:
drainManager.emit("tool:started", {
  toolUseId,
  toolName: input.tool_name,
  toolInput: JSON.stringify(input.tool_input).slice(0, 2000), // sanitize + truncate
  permissionDecision: decision,
  permissionReason: reason,
});
```

#### `tool:denied` — emit when permission blocks the call

```typescript
// Inside the deny branch of the permission hook:
drainManager.emit("tool:denied", {
  toolUseId,
  toolName: input.tool_name,
  reason: reason ?? "Permission denied",
  deniedBy: "rule",  // or "user" / "global_override" based on source
});
```

#### `permission:decided` — emit for every permission evaluation

```typescript
drainManager.emit("permission:decided", {
  toolName: input.tool_name,
  toolUseId,
  decision,
  reason,
  modeId: context.permissionModeId ?? "unknown",
  evaluationTimeMs: /* measure evaluation time */,
});
```

### PostToolUse hook additions

**Location:** Existing PostToolUse hooks in `shared.ts`.

#### `tool:completed`

```typescript
const durationMs = drainManager.endTimer(toolUseId);
drainManager.emit("tool:completed", {
  toolUseId,
  toolName,
  durationMs,
  resultLength: result?.length ?? 0,
  resultTruncated: (result?.length ?? 0) > 10000,
  filesModified: JSON.stringify(modifiedFiles),
});
```

### PostToolUseFailure hook additions

#### `tool:failed`

```typescript
const durationMs = drainManager.endTimer(toolUseId);
drainManager.emit("tool:failed", {
  toolUseId,
  toolName,
  durationMs,
  error: errorMessage.slice(0, 1000),
  errorType: classifyError(error), // "permission_denied" | "execution_error" | "timeout" | "unknown"
});
```

### Sub-agent tracking

**Location:** The Task tool PreToolUse/PostToolUse hooks (around line 537+ where `toolUseIdToChildThreadId` is managed).

#### `subagent:spawned` — in the Task PreToolUse hook

```typescript
drainManager.emit("subagent:spawned", {
  childThreadId,
  agentType: input.tool_input.subagent_type ?? "unknown",
  toolUseId,
  promptLength: (input.tool_input.prompt ?? "").length,
});
```

#### `subagent:completed` — in the Task PostToolUse hook

```typescript
drainManager.emit("subagent:completed", {
  childThreadId,
  agentType,
  durationMs: drainManager.endTimer(`subagent:${childThreadId}`),
  resultLength: result?.length ?? 0,
});
```

### Thread lifecycle

**Location:** `runAgentLoop()` entry and exit points (around line ~1052 and ~1086).

#### Entry

```typescript
drainManager.emit("thread:lifecycle", {
  transition: "started",
});
```

#### Exit (in the `finally` block, or after the for-await loop)

```typescript
drainManager.emit("thread:lifecycle", {
  transition: exitCode === 0 ? "completed" : "errored",
  durationMs: Date.now() - loopStartTime,
  // Pull summary stats from output state
  totalCostUsd: output.metrics?.totalCostUsd,
  numTurns: output.metrics?.numTurns,
  totalTokensIn: output.cumulativeUsage?.inputTokens,
  totalTokensOut: output.cumulativeUsage?.outputTokens,
  exitCode,
  error: output.error,
});
```

---

## File: `agents/src/runners/message-handler.ts`

### `api:call` — on assistant message

**Location:** Where `updateUsage()` is called after receiving an assistant message with usage data.

Track a `turnIndex` counter (increment on each assistant message).

```typescript
drainManager.emit("api:call", {
  turnIndex: this.turnIndex++,
  inputTokens: usage.inputTokens,
  outputTokens: usage.outputTokens,
  cacheCreationTokens: usage.cacheCreationTokens,
  cacheReadTokens: usage.cacheReadTokens,
  cacheHitRate: totalInput > 0 ? usage.cacheReadTokens / totalInput : 0,
  stopReason: message.stop_reason ?? "unknown",
  toolUseCount: countToolUseBlocks(message),
  thinkingBlockCount: countThinkingBlocks(message),
  textBlockCount: countTextBlocks(message),
});
```

### `context:pressure` — threshold crossing detection

Add a set of crossed thresholds (`Set<number>`) to `MessageHandler`. After each `api:call`, check:

```typescript
const thresholds = [50, 75, 90, 95];
const utilization = (totalInputTokens / contextWindow) * 100;
for (const threshold of thresholds) {
  if (utilization >= threshold && !this.crossedThresholds.has(threshold)) {
    this.crossedThresholds.add(threshold);
    drainManager.emit("context:pressure", {
      utilization,
      threshold,
      inputTokens: totalInputTokens,
      contextWindow,
      turnIndex: this.turnIndex,
    });
  }
}
```

`contextWindow` comes from `ThreadState.lastCallUsage` or the model's known context window size. If not available, skip the pressure check.

---

## Error classification helper

Add near the drain event emission code:

```typescript
function classifyError(error: unknown): "permission_denied" | "execution_error" | "timeout" | "unknown" {
  const msg = String(error).toLowerCase();
  if (msg.includes("permission") || msg.includes("denied")) return "permission_denied";
  if (msg.includes("timeout") || msg.includes("timed out")) return "timeout";
  if (msg.includes("error")) return "execution_error";
  return "unknown";
}
```

---

## Testing notes

- Drain emission is best tested via integration: run an agent, then query `drain.sqlite3`
- For unit testing, mock `DrainManager` (constructor accepts `null` hub → all emits are no-ops)
- The `DrainManager` no-op behavior means instrumentation code never needs `if (drainManager)` guards
