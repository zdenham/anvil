# Hook Lifecycle Test Rig

## Goal

Create an integration test rig that runs a real Claude Code CLI process with `-p` (or interactive TUI), connected to a live sidecar via the plugin/hooks system, and asserts on the full hook lifecycle: `SessionStart → UserPromptSubmit → PreToolUse/PostToolUse → Stop` with observable state transitions.

This enables verifying that the full hook lifecycle fires correctly during real agent turns — something no existing test covers.

## Problem

Current testing has gaps at the integration boundary:

| Layer | Covered? | How |
| --- | --- | --- |
| Hook HTTP endpoints (unit) | Yes | `hook-handler.test.ts` — mock HTTP requests |
| Agent hooks via SDK | Yes | `AgentTestHarness` — spawns agent subprocess with SDK hooks |
| Full CLI → sidecar HTTP hooks | **No** | Nothing runs `claude -p` with `--plugin-dir` pointing at a live sidecar |

The missing layer is: **Claude CLI process → HTTP hooks → sidecar state writer → persistence assertions**.

## Approach

A test harness that:

1. Starts a sidecar instance on an ephemeral port (isolated from dev sidecar)
2. Writes a `hooks.json` pointing at that sidecar
3. Spawns `claude -p "simple prompt"` with `--plugin-dir` pointing at the hooks directory
4. Collects hook invocations and state transitions via WebSocket subscription
5. Asserts on the expected lifecycle sequence after the CLI exits

### Key Design Decisions

**Use** `-p` **mode (not interactive TUI):** A single-turn `-p` invocation is deterministic — it sends one prompt, the agent responds (possibly using tools), then exits. This gives a clean `SessionStart → UserPromptSubmit → [PreToolUse/PostToolUse]* → Stop` sequence without needing to manage terminal I/O.

**Isolated sidecar:** Spin up a dedicated sidecar on a random port with `ANVIL_SIDECAR_NO_AUTH=1` and a temp data directory. This avoids interfering with the user's running dev environment.

**Disk-based assertions:** After the CLI exits, read `state.json` and `events.jsonl` from the temp thread directory to verify the hook lifecycle was persisted correctly. This is the primary assertion mechanism — simple and deterministic.

**WebSocket observer (optional):** Can also connect a WS client to collect live events for richer assertions, but disk state is sufficient for the core tests.

## Phases

- [x] Research: audit existing harness patterns and sidecar startup API

- [x] Implement the test harness (`SidecarTestHarness` class)

- [x] Write the first lifecycle assertion test

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase Details

### Phase 1: Research existing patterns

Audit these files to understand reusable infrastructure:

- `agents/src/testing/agent-harness.ts` — how `AgentTestHarness` manages subprocess lifecycle
- `sidecar/src/server.ts` — how sidecar binds to port, what env vars it needs
- `sidecar/src/hooks/hooks-writer.ts` — how `hooks.json` is generated
- `core/sdk/__tests__/integration/` — how `AnvilFixture` sets up isolated test environments
- `sidecar/src/__tests__/hook-handler.test.ts` — how hook tests create isolated Express routers
- `src/lib/claude-tui-args-builder.ts` — what env vars and args the CLI needs

Determine:

- Can we import and call `createServer()` from sidecar programmatically, or do we need to spawn it as a subprocess?
- What's the minimal env/config to get a functional sidecar that receives hooks?
- How does `hooks.json` need to be structured for `--plugin-dir`?

### Phase 2: Implement `SidecarTestHarness`

Create `sidecar/src/testing/sidecar-test-harness.ts`:

```typescript
class SidecarTestHarness {
  private server: http.Server;
  private ws: WebSocket;
  private events: PushEvent[] = [];
  private tmpDir: string;
  private port: number;

  /** Start sidecar on ephemeral port, write hooks.json, connect WS observer */
  async setup(): Promise<void>;

  /** Spawn `claude -p` with ANVIL_THREAD_ID and --plugin-dir pointing at tmpDir */
  async runCli(prompt: string, opts?: { cwd?: string; env?: Record<string, string> }): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
    threadId: string;
  }>;

  /** Get collected WebSocket events filtered by threadId */
  getEvents(threadId: string): PushEvent[];

  /** Get hook action types in order (e.g., ["INIT", "APPEND_USER_MESSAGE", "MARK_TOOL_RUNNING", ...]) */
  getActionSequence(threadId: string): string[];

  /** Read state.json for a thread from the temp data dir */
  async readThreadState(threadId: string): Promise<ThreadState>;

  /** Read events.jsonl for a thread */
  async readLifecycleEvents(threadId: string): Promise<LifecycleEvent[]>;

  /** Stop sidecar, clean up temp dir */
  async teardown(): Promise<void>;
}
```

Key implementation details:

- Use `tmp` or `os.tmpdir()` for isolated data directory
- Set `ANVIL_DATA_DIR` to temp dir for both sidecar and CLI
- Generate a UUID for `ANVIL_THREAD_ID` per `runCli()` call
- Write `hooks.json` using the same format as `hooks-writer.ts` but pointing at the test port
- WebSocket client connects to `ws://localhost:{port}/ws` and collects all push events
- CLI spawn uses `child_process.execFile` or `execa` with timeout

### Phase 3: First lifecycle assertion test

Create `sidecar/src/__tests__/hook-lifecycle.integration.test.ts`:

```typescript
describe("hook lifecycle (integration)", () => {
  let harness: SidecarTestHarness;

  beforeAll(async () => {
    harness = new SidecarTestHarness();
    await harness.setup();
  });

  afterAll(async () => {
    await harness.teardown();
  });

  it("single-turn -p produces correct hook sequence", async () => {
    const { threadId, exitCode } = await harness.runCli(
      "What is 2+2? Answer in one word.",
      { cwd: "/tmp" }
    );

    expect(exitCode).toBe(0);

    const actions = harness.getActionSequence(threadId);

    // Must start with INIT (SessionStart) and APPEND_USER_MESSAGE (UserPromptSubmit)
    expect(actions[0]).toBe("INIT");
    expect(actions[1]).toBe("APPEND_USER_MESSAGE");

    // Must end with COMPLETE (Stop)
    expect(actions[actions.length - 1]).toBe("COMPLETE");

    // Verify state.json reflects completed status
    const state = await harness.readThreadState(threadId);
    expect(state.status).toBe("completed");

    // Verify events.jsonl has SESSION_STARTED and SESSION_ENDED
    const events = await harness.readLifecycleEvents(threadId);
    const eventTypes = events.map(e => e.type);
    expect(eventTypes[0]).toBe("SESSION_STARTED");
    expect(eventTypes[eventTypes.length - 1]).toBe("SESSION_ENDED");
  });

  it("tool-using prompt produces PreToolUse/PostToolUse hooks", async () => {
    const { threadId } = await harness.runCli(
      "Run: echo hello",
      { cwd: "/tmp" }
    );

    const actions = harness.getActionSequence(threadId);

    // Should contain tool lifecycle
    expect(actions).toContain("MARK_TOOL_RUNNING");
    expect(actions).toContain("MARK_TOOL_COMPLETE");

    // Tool events in events.jsonl
    const events = await harness.readLifecycleEvents(threadId);
    const eventTypes = events.map(e => e.type);
    expect(eventTypes).toContain("TOOL_STARTED");
    expect(eventTypes).toContain("TOOL_COMPLETED");
  });
});
```

## Prerequisites

- `ANTHROPIC_API_KEY` must be set (these tests make real LLM calls)
- `claude` CLI must be on PATH
- Tests should be tagged/skipped in CI unless explicitly opted in (they're slow and require API access)

## Key Files

| File | Role |
| --- | --- |
| `sidecar/src/testing/sidecar-test-harness.ts` | New — test harness class |
| `sidecar/src/__tests__/hook-lifecycle.integration.test.ts` | New — lifecycle tests |
| `sidecar/src/server.ts` | Reference — sidecar startup |
| `sidecar/src/hooks/hooks-writer.ts` | Reference — hooks.json format |
| `agents/src/testing/agent-harness.ts` | Reference — existing harness pattern |
