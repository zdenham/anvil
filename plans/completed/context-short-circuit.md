# Context Short-Circuit for Spawned Agents

## Summary

Add an optional `contextShortCircuit` argument to `mort.spawn()` that nudges a child agent to save its progress when context pressure gets high, so another agent can continue with a fresh context window.

## Motivation

Long-running agents eventually hit context limits and get auto-truncated or error out. By nudging them before that happens, we can have them save progress to a file so orchestration code can spawn a continuation agent.

## Design

### New Type: `ContextShortCircuit`

```ts
// agents/src/lib/mort-repl/types.ts
interface ContextShortCircuit {
  /** Percentage of context window (0-100) at which to start nudging */
  limitPercent: number;
  /** Message injected as additionalContext each turn after the limit is reached */
  message: string;
}
```

### How It Works

1. **User specifies** `contextShortCircuit` on `mort.spawn()`:

   ```ts
   await mort.spawn({
     prompt: "Implement the auth module",
     contextShortCircuit: {
       limitPercent: 80,
       message: "You are running low on context. Save your progress to plans/auth-progress.md with what's done and what remains, then stop.",
     },
   });
   ```

2. **ChildSpawner passes it** as a CLI arg (`--context-short-circuit <json>`) to the runner process.

3. **The runner** (`runner.ts` → `runAgentLoop`) picks it up and installs a **PostToolUse hook** that checks context pressure each turn. Once `cumulativeInputTokens / contextWindow >= limitPercent/100`, the hook returns `additionalContext` with the configured message — the same pattern already used by phase reminders.

4. **The nudge repeats every turn** after the threshold is crossed (it's not a one-shot). This gives the agent persistent pressure to wrap up without hard-stopping it.

### Implementation Approach: PostToolUse hook with `additionalContext`

The existing phase-reminder system proves the pattern works:

- `PostToolUse` hooks can return `{ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: string } }`
- The SDK appends this to the next assistant turn as context
- It fires after every tool use, giving us per-turn nudging

### Getting Context Pressure Data

`MessageHandler` already tracks `cumulativeInputTokens` and `contextWindow` as private fields (lines 61-64 of `message-handler.ts`). It already calculates utilization for the `CONTEXT_PRESSURE` drain event (line 403). The same data is also written to `metadata.json` via `state.lastCallUsage`/`state.cumulativeUsage` for the frontend context meter.

**No new** `ContextPressureTracker` **class needed.** Just add a public `getUtilization(): number | null` method to `MessageHandler`. The `handler` instance is created in `runAgentLoop` (line 1459 of `shared.ts`) — it's in scope when hooks are built, so the PostToolUse hook can call `handler.getUtilization()` directly.

## Files to Change

| File | Change |
| --- | --- |
| `agents/src/lib/mort-repl/types.ts` | Add `ContextShortCircuit` interface, add it to `SpawnOptions` |
| `agents/src/lib/mort-repl/child-spawner.ts` | Pass `--context-short-circuit` CLI arg when spawning |
| `agents/src/lib/mort-repl/mort-sdk.ts` | Update `spawn()` signature to accept `contextShortCircuit` |
| `agents/src/runners/types.ts` | Add `contextShortCircuit?` to `RunnerConfig` |
| `agents/src/runners/message-handler.ts` | Add public \`getUtilization(): number |
| `agents/src/runners/shared.ts` | Add PostToolUse hook that calls `handler.getUtilization()` and returns `additionalContext` when threshold crossed |
| `agents/src/runners/simple-runner-strategy.ts` | Parse `--context-short-circuit` CLI arg into `RunnerConfig` |
| `plugins/mort/skills/orchestrate/SKILL.md` | Brief mention of `contextShortCircuit` option (not encouraged — other skills will instruct its use) |
| `agents/src/lib/mort-repl/__tests__/child-spawner.test.ts` | Test that CLI arg is passed through |

## Phases

- [x] Add types: `ContextShortCircuit` to `types.ts`, `SpawnOptions`, `RunnerConfig`
- [x] Add `getUtilization()` public method to `MessageHandler` (reuse existing `cumulativeInputTokens`/`contextWindow` fields)
- [x] Add PostToolUse hook in `runAgentLoop` that calls `handler.getUtilization()` against config threshold and returns `additionalContext`
- [x] Wire CLI: `simple-runner-strategy.ts` parses `--context-short-circuit`, `child-spawner.ts` passes it
- [x] Update `MortReplSdk.spawn()` and `ChildSpawner.spawn()` to accept and forward `contextShortCircuit`
- [x] Brief mention in orchestrate SKILL.md (just document the option exists, don't encourage use)
- [x] Add tests for `getUtilization()` and CLI arg forwarding

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Detail: MessageHandler.getUtilization()

```ts
// agents/src/runners/message-handler.ts
// Add to the MessageHandler class — reuses existing private fields

/** Returns context utilization as 0-100 percentage, or null if context window unknown */
getUtilization(): number | null {
  if (!this.contextWindow || this.contextWindow <= 0) return null;
  return (this.cumulativeInputTokens / this.contextWindow) * 100;
}
```

This is the same calculation already done in `checkContextPressure()` (line 403). No duplication of state tracking needed.

## Detail: PostToolUse Hook

Inside `runAgentLoop`, after the existing phase-reminder hook. Note: `handler` is already in scope (created at line 1459).

```ts
// Context short-circuit nudge hook
// Check handler.getUtilization() against configured threshold
if (config.contextShortCircuit) {
  const { limitPercent, message } = config.contextShortCircuit;
  // ... inside the existing PostToolUse hook array, after phase reminder check:
  const utilization = handler.getUtilization();
  if (utilization !== null && utilization >= limitPercent) {
    logger.info(
      `[PostToolUse] Context short-circuit: ${utilization.toFixed(1)}% >= ${limitPercent}%, nudging agent`
    );
    return {
      hookSpecificOutput: {
        hookEventName: "PostToolUse" as const,
        additionalContext: message,
      },
    };
  }
}
```

**Timing concern**: The PostToolUse hook fires on tool completions during the agent loop. However, `handler` processes messages *after* the loop yields them (line 1472). The utilization value the hook sees is from the *previous* assistant turn, since the current turn's usage hasn't been processed by `handleAssistant()` yet. This is fine — it's one turn behind at most, and the nudge is meant to be approximate.

## Detail: CLI Arg Passing

In `child-spawner.ts`:

```ts
if (contextShortCircuit) {
  args.push("--context-short-circuit", JSON.stringify(contextShortCircuit));
}
```

## Non-Goals

- **Hard stop**: This is a nudge, not an abort. The agent can ignore it.
- **Automatic continuation**: The orchestration code in `mort-repl` decides whether/how to spawn a continuation agent. We just provide the mechanism.
- **Built-in SDK agents (Task/Agent tool)**: This only applies to mort-repl spawned children for now. SDK sub-agents don't go through our runner.