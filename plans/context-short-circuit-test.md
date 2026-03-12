# Context Short-Circuit: Live Integration Test

## Summary

Add a live integration test that confirms the context short-circuit nudge is delivered to an agent when context utilization crosses the configured threshold.

## Critical Finding: `contextWindow` Timing Bug

During research, I found a blocker that must be fixed before this test can pass:

`MessageHandler.contextWindow` **is only set in** `handleResult()` (the final SDK message). During the agent loop, `getUtilization()` always returns `null` because `contextWindow` is never populated mid-conversation. The PostToolUse hook checks `utilization !== null && utilization >= limitPercent` — this silently fails because utilization is always null.

The existing unit test (`message-handler.test.ts:49-80`) masks this by sending a `result` message *before* the `assistant` message — the reverse of real execution order.

**Fix**: Add an optional `defaultContextWindow` parameter to `MessageHandler` (or a setter called from `runAgentLoop`). Pass a sensible default like `200_000` so `getUtilization()` returns a real value during the loop. The `handleResult()` contextWindow should override when it arrives.

```ts
// MessageHandler constructor change:
constructor(mortDir?: string, accumulator?: StreamAccumulator, drainManager?: DrainManager, defaultContextWindow?: number) {
  // ...existing...
  if (defaultContextWindow) this.contextWindow = defaultContextWindow;
}

// In runAgentLoop (shared.ts), where handler is created:
const handler = new MessageHandler(config.mortDir, accumulator, drainManager, 200_000);
```

## Test Design

### File: `agents/src/testing/__tests__/context-short-circuit.integration.test.ts`

**Strategy**: Use `AgentTestHarness` with a live Anthropic API key. The test:

1. Creates a custom `RunnerConfig` that passes `--context-short-circuit` with a **very low threshold** (e.g., `limitPercent: 1`) so the nudge fires on the first tool use after the first turn's tokens are accumulated.
2. Prompts the agent to use a tool (e.g., `Read`) to force a multi-turn conversation with a PostToolUse hook fire.
3. Verifies the nudge was delivered by checking:
   - **Socket log messages**: The `[PostToolUse] Context short-circuit:` INFO log captured by `MockHubServer`
   - **Agent response**: The agent's final text references saving progress (soft check — Claude may not obey the nudge verbatim)

### Why live API and not mock?

Mock mode (`mockQuery`) does **not** exercise the PostToolUse hooks from `runAgentLoop`. The hooks are only wired into the real `query()` call. Mock mode uses simplified `onToolResult`/`onToolFailure` callbacks that skip all PostToolUse logic (phase reminders, context short-circuit, file change tracking). Testing the short-circuit end-to-end requires the real SDK path.

### Custom RunnerConfig

The default `buildArgs` doesn't pass `--context-short-circuit`. We need a custom config:

```ts
const shortCircuitRunnerConfig = createRunnerConfig({
  buildArgs: (opts, mortDirPath, repoCwd) => {
    const threadId = opts.threadId ?? randomUUID();
    const repoId = opts.repoId ?? randomUUID();
    const worktreeId = opts.worktreeId ?? randomUUID();

    const shortCircuit = {
      limitPercent: 1, // Very low — triggers after first turn
      message: "CONTEXT_LIMIT_REACHED: Save your progress to a file and stop.",
    };

    return [
      "--prompt", opts.prompt,
      "--thread-id", threadId,
      "--repo-id", repoId,
      "--worktree-id", worktreeId,
      "--mort-dir", mortDirPath,
      "--cwd", opts.cwd ?? repoCwd,
      "--context-short-circuit", JSON.stringify(shortCircuit),
    ];
  },
});
```

### Verification: Socket Log Messages

The `AgentRunOutput.socketMessages` contains all raw socket messages including logs. Filter for the context short-circuit log:

```ts
const logMessages = output.socketMessages.filter(
  (msg): msg is LogMessage => msg.type === "log"
);
const nudgeLog = logMessages.find(
  (msg) => msg.message.includes("Context short-circuit:")
);
expect(nudgeLog).toBeDefined();
```

This is the most reliable check — it confirms the PostToolUse hook fired and `getUtilization()` returned a value above the threshold.

### Prompt Design

The prompt must cause the agent to use at least one tool (triggering PostToolUse) while being cheap on tokens:

```
Read the file at ./package.json and tell me the project name.
```

This causes:

1. First turn: agent decides to use Read tool → PostToolUse fires
2. At 1% threshold with \~3-4k input tokens against a 200k window (\~1.5-2%), the nudge should fire
3. Agent receives `additionalContext` with the nudge message

If 1% is too tight (contextWindow may not be set yet on the first tool use), bump to a value that's still low enough to trigger within a simple conversation. We can compute: \~3k input tokens on first turn / 200k context = 1.5%. So `limitPercent: 1` should work once the contextWindow fix is in place.

## Phases

- [x] Fix `MessageHandler` contextWindow timing: add `defaultContextWindow` parameter so `getUtilization()` works during the agent loop (prerequisite)

- [x] Create `context-short-circuit.integration.test.ts` with custom RunnerConfig and live API test

- [x] Verify test passes locally with `ANTHROPIC_API_KEY`

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## How to Run

```bash
cd agents && ANTHROPIC_API_KEY=sk-... pnpm vitest run src/testing/__tests__/context-short-circuit.integration.test.ts
```

For verbose output (see agent stderr and PostToolUse logs):

```bash
cd agents && DEBUG=1 ANTHROPIC_API_KEY=sk-... pnpm vitest run src/testing/__tests__/context-short-circuit.integration.test.ts
```

## How to Confirm It Works

1. **Primary check**: Test passes — the `[PostToolUse] Context short-circuit:` log message is found in socket messages. This proves:

   - `getUtilization()` returned a non-null value during the agent loop
   - The utilization exceeded the configured threshold
   - The hook returned `additionalContext` with the nudge message

2. **Secondary check** (manual): Run with `DEBUG=1` and look for this in stderr:

   ```
   [PostToolUse] Context short-circuit: X.X% >= 1%, nudging agent
   ```

3. **Negative check**: If the test fails because `nudgeLog` is undefined:

   - Verify the contextWindow fix is in place (check `MessageHandler` constructor)
   - Check that `getUtilization()` returns non-null by adding a temporary log
   - Verify `--context-short-circuit` CLI arg is being parsed correctly (check `SimpleRunnerStrategy.parseArgs`)

## Test Skeleton

```ts
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { AgentTestHarness } from "../agent-harness.js";
import { assertAgent } from "../assertions.js";
import { createRunnerConfig } from "../runner-config.js";
import type { LogMessage } from "../../lib/hub/types.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY ? describe : describe.skip;

const shortCircuitRunnerConfig = createRunnerConfig({
  buildArgs: (opts, mortDirPath, repoCwd) => {
    const threadId = opts.threadId ?? randomUUID();
    const repoId = opts.repoId ?? randomUUID();
    const worktreeId = opts.worktreeId ?? randomUUID();

    const shortCircuit = {
      limitPercent: 1,
      message: "CONTEXT_LIMIT_REACHED: Save your progress to a file and stop.",
    };

    return [
      "--prompt", opts.prompt,
      "--thread-id", threadId,
      "--repo-id", repoId,
      "--worktree-id", worktreeId,
      "--mort-dir", mortDirPath,
      "--cwd", opts.cwd ?? repoCwd,
      "--context-short-circuit", JSON.stringify(shortCircuit),
    ];
  },
});

describeWithApi("Context Short-Circuit - Live Integration", () => {
  let harness: AgentTestHarness;

  afterEach((context) => {
    const failed = context.task.result?.state === "fail";
    harness.cleanup(failed);
  });

  it("delivers nudge when context utilization exceeds threshold", async () => {
    harness = new AgentTestHarness({ runnerConfig: shortCircuitRunnerConfig });

    const output = await harness.run({
      prompt: "Read the file at ./package.json and tell me the project name.",
      timeout: 90_000,
    });

    assertAgent(output).succeeded();

    // Verify the PostToolUse hook fired the context short-circuit nudge
    const logMessages = output.socketMessages.filter(
      (msg): msg is LogMessage => msg.type === "log"
    );
    const nudgeLog = logMessages.find(
      (msg) => msg.message.includes("Context short-circuit:")
    );

    expect(nudgeLog).toBeDefined();
    expect(nudgeLog!.message).toMatch(/Context short-circuit: [\d.]+ >= 1%/);
  }, 90_000);
});
```