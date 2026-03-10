# Test: Worktree Interception Live Agent Tests

## Goal

Create a live agent integration test that verifies the worktree interception behavior from `plans/parse-agent-worktree-creation.md`. The test spawns real agents via `AgentTestHarness` and asserts:

1. `EnterWorktree` **is blocked** — agent cannot use it (either via `disallowedTools` or permission deny)
2. `git worktree add` **via Bash triggers a** `WORKTREE_SYNCED` **event** — PostToolUse detection works

## Phases

- [x] Create the integration test file with both test cases

- [x] Verify tests pass against the implemented worktree interception code

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Design

### Test Location

`agents/src/experimental/__tests__/worktree-interception.integration.test.ts`

Follows the existing pattern: live API tests live in `agents/src/experimental/__tests__/` and are gated behind `ANTHROPIC_API_KEY`.

### Test 1: `EnterWorktree` is blocked

Follows the exact same pattern as `safe-git-hook.integration.test.ts` — prompt the agent to use `EnterWorktree`, assert it gets denied and the agent sees the denial.

```typescript
it("blocks EnterWorktree and agent sees denial", async () => {
  harness = new AgentTestHarness({ timeout: 90_000 });

  const result = await harness.run({
    prompt: [
      "Use the EnterWorktree tool to create a new worktree.",
      "If the tool is blocked, denied, or unavailable, respond with exactly: BLOCKED",
      "If it succeeds, respond with exactly: SUCCESS",
      "Do not run any other commands.",
    ].join("\n"),
    timeout: 90_000,
  });

  expect(result.exitCode).toBe(0);

  // Check agent messages for denial evidence
  const lastState = result.states[result.states.length - 1];
  expect(lastState).toBeDefined();
  const allText = JSON.stringify(lastState.state.messages);

  // Agent should see BLOCKED — either because:
  // 1. disallowedTools removed it (agent says "I don't have that tool")
  // 2. Permission deny fired (agent sees deny reason)
  expect(allText).toContain("BLOCKED");
});
```

**Why this works**: If `disallowedTools` removes `EnterWorktree`, the model will never try to call it and will report it's unavailable. If somehow it does try, the `GLOBAL_OVERRIDES` deny rule catches it. Either way, the agent should output "BLOCKED".

### Test 2: `git worktree add` emits `WORKTREE_SYNCED` event

This test is more involved — it needs to verify the PostToolUse hook detects `git worktree add` and emits the event. The key challenge: the event needs to be observable via the MockHubServer.

```typescript
it("git worktree add triggers WORKTREE_SYNCED event", async () => {
  const threadId = randomUUID();
  harness = new AgentTestHarness({ timeout: 90_000 });

  const runPromise = harness.run({
    prompt: [
      "Run this exact bash command: git worktree add ../test-worktree test-branch",
      "If it fails, just say FAILED. If it works, say SUCCESS.",
    ].join("\n"),
    threadId,
    timeout: 90_000,
  });

  // Wait for MockHubServer to be available
  let mockHub = harness.getMockHub();
  const hubWaitStart = Date.now();
  while (!mockHub && Date.now() - hubWaitStart < 10_000) {
    await new Promise((r) => setTimeout(r, 100));
    mockHub = harness.getMockHub();
  }
  if (!mockHub) throw new Error("MockHubServer not available");

  // Wait for the WORKTREE_SYNCED event
  let syncEvent: SocketMessage | null = null;
  try {
    syncEvent = await mockHub.waitForMessage(
      (msg) => msg.type === "event" && (msg as any).name === "worktree:synced",
      60_000,
    );
  } catch {
    // Will assert below
  }

  const result = await runPromise;
  expect(result.exitCode).toBe(0);

  // Verify the sync event was emitted
  expect(syncEvent).toBeDefined();

  // Also check events array from collected output
  const worktreeSyncEvents = result.events.filter(
    (e) => e.name === "worktree:synced"
  );
  expect(worktreeSyncEvents.length).toBeGreaterThanOrEqual(1);
});
```

**Setup consideration**: The test repo created by `TestRepository` is a real git repo. `git worktree add ../test-worktree test-branch` should work from within it. We may need to create a branch first, or use `git worktree add -b test-branch ../test-worktree` to create one on the fly.

Alternatively, adjust the prompt to use `git worktree add -b test-branch ../test-worktree HEAD` which creates the branch and worktree in one command.

### Test Structure

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { AgentTestHarness } from "../../testing/agent-harness.js";
import type { SocketMessage } from "../../lib/hub/types.js";

const describeWithApi = process.env.ANTHROPIC_API_KEY
  ? describe
  : describe.skip;

describeWithApi("Worktree interception (live agent)", () => {
  let harness: AgentTestHarness;

  afterEach(() => {
    harness?.cleanup();
  });

  it("blocks EnterWorktree and agent sees denial", async () => { ... }, 120_000);

  it("git worktree add triggers WORKTREE_SYNCED event", async () => { ... }, 120_000);
});
```

### Cleanup

The `afterEach` -&gt; `harness.cleanup()` pattern handles temp directory cleanup. For the worktree test, the worktree will be created as a sibling to the temp repo dir (e.g., `/tmp/test-repo-xyz/../test-worktree`), which gets cleaned up when the temp dir is removed. If not, we can add explicit `git worktree remove` or `rmSync` in the cleanup.

### Key Files

| File | Purpose |
| --- | --- |
| `agents/src/experimental/__tests__/worktree-interception.integration.test.ts` | New test file |
| `agents/src/testing/agent-harness.ts` | Existing harness (no changes) |
| `agents/src/testing/mock-hub-server.ts` | Existing mock hub (no changes) |

### Running

```bash
cd agents && ANTHROPIC_API_KEY=sk-... pnpm vitest run src/experimental/__tests__/worktree-interception.integration.test.ts
```

Or with debug output:

```bash
cd agents && DEBUG=1 ANTHROPIC_API_KEY=sk-... pnpm vitest run src/experimental/__tests__/worktree-interception.integration.test.ts
```