# Network Debugger — Integration Test

Minimal live-API integration test confirming the network interceptor actually captures SDK traffic and delivers it to the hub.

## Phases

- [x] Write integration test using AgentTestHarness
- [x] If test fails: add debug logging to interceptor and runner to diagnose

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Context

Read these files before starting:
- `agents/src/testing/agent-harness.ts` — `AgentTestHarness` spawns subprocess, captures via `MockHubServer` socket
- `agents/src/testing/mock-hub-server.ts` — `MockHubServer` with `waitForMessage()` and `getMessages()`
- `agents/src/testing/types.ts` — `AgentTestOptions` (has `env` field for passing env vars)
- `agents/src/runner.ts:365-376` — interceptor init block (checks `MORT_NETWORK_DEBUG=1`, sends via hub)
- `agents/src/lib/network-interceptor.ts` — the `NetworkInterceptor` class under test
- `agents/src/experimental/__tests__/fast-mode-spike.integration.test.ts` — reference for live-API test gating pattern

## Phase 1: Integration test

**New file: `agents/src/lib/__tests__/network-interceptor.integration.test.ts`** (~80 lines)

Single test that proves the full pipeline works: interceptor → hub socket → MockHubServer receives `network` messages.

### Test structure

```ts
import { describe, it, expect, afterEach } from "vitest";
import { AgentTestHarness } from "../../testing/agent-harness.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("NetworkInterceptor — live integration", () => {
  let harness: AgentTestHarness;

  afterEach(() => {
    harness?.cleanup();
  });

  it("captures SDK HTTP traffic and delivers network messages to hub", async () => {
    harness = new AgentTestHarness({
      prompt: "Say hello in one sentence.",
      timeout: 90_000,
      env: {
        MORT_NETWORK_DEBUG: "1",
      },
    });

    const output = await harness.run();
    const hub = harness.getMockHub()!;
    const allMessages = hub.getMessages();

    // Filter for network messages
    const networkMessages = allMessages.filter(
      (m) => m.type === "network"
    );

    // Debug: log what we got if things look wrong
    if (networkMessages.length === 0) {
      process.stderr.write(
        `[net-debug] No network messages found. Total hub messages: ${allMessages.length}\n`
      );
      process.stderr.write(
        `[net-debug] Message types: ${[...new Set(allMessages.map((m) => m.type))].join(", ")}\n`
      );
      process.stderr.write(
        `[net-debug] Exit code: ${output.exitCode}\n`
      );
      process.stderr.write(
        `[net-debug] Stderr (first 2000): ${output.stderr.slice(0, 2000)}\n`
      );
    }

    // Core assertion: we received at least one network message
    expect(networkMessages.length).toBeGreaterThan(0);

    // Verify the lifecycle: should see request-start, response-headers, and response-end
    const networkTypes = networkMessages.map(
      (m) => (m as Record<string, unknown>).networkType
    );
    expect(networkTypes).toContain("request-start");
    expect(networkTypes).toContain("response-headers");

    // At least one request should be to Anthropic's API
    const requestStarts = networkMessages.filter(
      (m) => (m as Record<string, unknown>).networkType === "request-start"
    );
    const hasAnthropicRequest = requestStarts.some((m) => {
      const url = (m as Record<string, unknown>).url as string;
      return url?.includes("anthropic.com");
    });
    expect(hasAnthropicRequest).toBe(true);

    // Verify sensitive headers are redacted
    for (const msg of requestStarts) {
      const headers = (msg as Record<string, unknown>).headers as
        Record<string, string> | undefined;
      if (headers?.["x-api-key"]) {
        expect(headers["x-api-key"]).toBe("[REDACTED]");
      }
    }

    // Log summary for visibility
    process.stderr.write(
      `\n=== NETWORK INTERCEPTOR INTEGRATION TEST ===\n`
    );
    process.stderr.write(
      `Network messages captured: ${networkMessages.length}\n`
    );
    process.stderr.write(
      `Event types: ${[...new Set(networkTypes)].join(", ")}\n`
    );
    process.stderr.write(
      `Anthropic requests: ${requestStarts.filter((m) => ((m as Record<string, unknown>).url as string)?.includes("anthropic.com")).length}\n`
    );
    process.stderr.write(`Agent exit code: ${output.exitCode}\n`);
    process.stderr.write(`===\n\n`);
  }, 90_000);
});
```

### Key design decisions

1. **Uses `AgentTestHarness`** — not a custom spawn. This runs the real runner.ts with a real MockHubServer, so we test the full pipeline including the `MORT_NETWORK_DEBUG` env check and dynamic import.

2. **Passes `MORT_NETWORK_DEBUG: "1"` via the `env` option** — the harness merges this into the subprocess env (see `agent-harness.ts:149`), which triggers the interceptor init at `runner.ts:365`.

3. **Simple prompt** — "Say hello in one sentence." keeps the API call cheap and fast. One query to the Anthropic API = at minimum one `request-start` + `response-headers` + `response-end` (or `response-chunk` + `response-end` for streaming).

4. **Assertions verify the full event lifecycle**, not just that _some_ message appeared. We check for `request-start` and `response-headers` to confirm the interceptor is actually wrapping fetch calls end-to-end.

5. **Header redaction check** — verifies the sanitization logic works in production (not just the unit test mock).

6. **Gated behind `ANTHROPIC_API_KEY`** — follows the established pattern from the fast-mode spike tests. Skips entirely when no key is set, so CI doesn't fail.

## Phase 2: Debug logging (only if Phase 1 fails)

If the test reveals that network messages aren't arriving at the hub, add targeted debug logging to diagnose why:

### `agents/src/lib/network-interceptor.ts`

Add logger import and trace-level logs:

```ts
import { logger } from "@/lib/logger-client.js";

// In enable():
logger.info("[network-interceptor] Interceptor enabled");

// In interceptedFetch(), before emitting request-start:
logger.debug(`[network-interceptor] Intercepting ${method} ${url}`);

// In the emitFn wrapper, after calling the emit callback:
// (Could wrap the constructor's emitFn to add logging)
```

### `agents/src/runner.ts` (around line 365)

Add a confirmation log when the interceptor is initialized:

```ts
if (process.env.MORT_NETWORK_DEBUG === "1") {
  logger.info("[runner] Network debug enabled, initializing interceptor");
  // ... existing code ...
  interceptor.enable();
  logger.info("[runner] Network interceptor active");
}
```

### Potential failure modes to investigate

1. **`globalThis.fetch` replacement doesn't capture SDK calls** — The Claude Agent SDK may use its own `fetch` import rather than `globalThis.fetch`. If so, we need to intercept at the `undici` level or use Node's `--experimental-network-inspection` flag.
2. **Hub connection not ready when first fetch fires** — The interceptor emits immediately but `hub` might be `null`. Check that `hub?.send()` silently drops (it should due to optional chaining) vs timing issue.
3. **Messages sent but not arriving at MockHubServer** — Could be a framing/buffering issue. Check that `\n`-delimited JSON is being written correctly.

---

## Files summary

### New files
| File | ~Lines |
|------|--------|
| `agents/src/lib/__tests__/network-interceptor.integration.test.ts` | ~80 |

### Conditionally modified files (only if Phase 1 fails)
| File | Change |
|------|--------|
| `agents/src/lib/network-interceptor.ts` | Add debug logging (~5 lines) |
| `agents/src/runner.ts` | Add init confirmation log (~2 lines) |
