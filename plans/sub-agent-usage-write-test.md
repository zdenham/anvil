# Sub-Agent Usage Write Test

Verify that child thread `metadata.json` contains `lastCallUsage` and `cumulativeUsage` after a sub-agent completes — even for single-turn tasks.

## Problem

The `ContextMeter` component reads `thread.lastCallUsage` from metadata. If that field is never written to the child thread's `metadata.json`, the meter renders nothing (`return null`).

Observed behavior: a simple sub-agent task like "Say hello world" completes with `metadata.json` that has no `lastCallUsage` or `cumulativeUsage` fields at all. The data never reaches disk.

### Root Cause Hypothesis

There are two code paths that write child thread state:

1. **`MessageHandler.handleForChildThread`** (message-handler.ts) — processes SDK `assistant` messages with `parent_tool_use_id`. Extracts `msg.message.usage` and calls `writeUsageToMetadata()`. This works for multi-turn sub-agents but may never fire for single-turn tasks if the SDK doesn't emit a separate `assistant` message (the response may come back only in `PostToolUse:Task`'s `tool_response`).

2. **`PostToolUse:Task` hook** (shared.ts ~line 788) — fires when the Task tool completes. Reads metadata from disk, sets `status: "completed"`, writes turns, and saves. But it **does not write `lastCallUsage` or `cumulativeUsage`** to metadata. It also overwrites `state.json` with a fresh object that lacks usage fields.

So for a single-turn sub-agent where the SDK only emits the result through the `PostToolUse` hook (no intermediate `assistant` messages with `parent_tool_use_id`), usage is never written.

## Approach

Write a **live integration test** using `AgentTestHarness` with a real Anthropic API key. The test will:

1. Spawn a parent agent with a prompt that triggers a simple sub-agent task
2. Wait for completion
3. Read the child thread's `metadata.json` from disk
4. Assert that `lastCallUsage` and `cumulativeUsage` are present with non-zero token counts

This test will **fail** with current code, proving the bug. It becomes the regression test for the fix.

### Test File

`agents/src/testing/__tests__/sub-agent-usage.integration.test.ts`

### Test Structure

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { AgentTestHarness } from "../agent-harness.js";
import { assertAgent } from "../assertions.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Sub-Agent Usage in Metadata", () => {
  let harness: AgentTestHarness;

  afterEach((context) => {
    const failed = context.task.result?.state === "fail";
    harness?.cleanup(failed);
  });

  it("writes lastCallUsage and cumulativeUsage to child metadata.json for single-turn sub-agent", async () => {
    harness = new AgentTestHarness();

    const output = await harness.run({
      prompt: 'Use the Task tool to spawn a sub-agent that simply says "Hello world" and nothing else. Set subagent_type to "general-purpose" and description to "say hello". Do nothing else.',
      timeout: 120000,
    });

    assertAgent(output).succeeded();
    assertAgent(output).usedTools(["Task"]);

    // Find child thread on disk
    const mortDir = harness.tempDirPath!;
    const threadsDir = join(mortDir, "threads");
    const threadDirs = readdirSync(threadsDir);

    let childMetadata: Record<string, unknown> | null = null;
    let childMetadataPath: string | null = null;

    for (const threadDir of threadDirs) {
      const metadataPath = join(threadsDir, threadDir, "metadata.json");
      if (existsSync(metadataPath)) {
        const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
        if (metadata.parentThreadId) {
          childMetadata = metadata;
          childMetadataPath = metadataPath;
          break;
        }
      }
    }

    expect(childMetadata).not.toBeNull();
    console.log(`[LIVE TEST] Child metadata path: ${childMetadataPath}`);
    console.log(`[LIVE TEST] Child metadata keys: ${Object.keys(childMetadata!)}`);
    console.log(`[LIVE TEST] lastCallUsage: ${JSON.stringify(childMetadata!.lastCallUsage)}`);
    console.log(`[LIVE TEST] cumulativeUsage: ${JSON.stringify(childMetadata!.cumulativeUsage)}`);

    // THE KEY ASSERTIONS: usage must be written to child metadata
    expect(childMetadata!.lastCallUsage).toBeDefined();
    const usage = childMetadata!.lastCallUsage as {
      inputTokens: number;
      outputTokens: number;
      cacheCreationTokens: number;
      cacheReadTokens: number;
    };
    expect(usage.inputTokens).toBeGreaterThan(0);
    expect(usage.outputTokens).toBeGreaterThan(0);

    expect(childMetadata!.cumulativeUsage).toBeDefined();
    const cumulative = childMetadata!.cumulativeUsage as {
      inputTokens: number;
      outputTokens: number;
    };
    expect(cumulative.inputTokens).toBeGreaterThan(0);
    expect(cumulative.outputTokens).toBeGreaterThan(0);
  }, 180000);
});
```

### What the Fix Looks Like (for context)

The fix lives in the `PostToolUse:Task` hook in `agents/src/runners/shared.ts`. When finalizing a child thread, it should:

1. Read `state.json` to check for `lastCallUsage` / `cumulativeUsage` (may have been written by `handleForChildThread` for multi-turn agents)
2. If present in state, copy them to `metadata.json` before writing
3. If not present in state (single-turn case), extract usage from the `SDKResultSuccess` `modelUsage` field on the result, or from the `PostToolUse` input if available

The simplest reliable fix: in the `PostToolUse:Task` handler, after reading `state.json`, check if it has usage fields and write them to metadata. This covers both single-turn and multi-turn cases as a safety net.

## Phases

- [ ] Write the integration test in `agents/src/testing/__tests__/sub-agent-usage.integration.test.ts`
- [ ] Run the test to confirm it fails (proving the bug exists)
- [ ] Fix the `PostToolUse:Task` handler to propagate usage from state to metadata
- [ ] Re-run the test to confirm it passes

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Notes

- The existing `sub-agent.integration.test.ts` already tests child thread creation, linking, and state files — but never checks usage fields
- The existing `context-meter.integration.test.ts` only tests the parent thread's state `lastCallUsage`, not child metadata
- The race condition fix (moving `writeUsageToMetadata` before `emitChildThreadState` in message-handler.ts) is also needed but is only relevant for multi-turn sub-agents where `handleForChildThread` fires
- For single-turn sub-agents, the `PostToolUse:Task` handler is the only reliable write point
