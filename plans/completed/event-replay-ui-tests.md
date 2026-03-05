# Event Replay UI Tests — Production-Fidelity Time Travel

## Goal

Replay captured event JSON through the **real production pipeline** — `routeAgentMessage()` → eventBus → listeners → threadService → store → React — with only the filesystem boundary virtualized.

## Phases

- [x] Add `get_paths_info` to Tauri mock (one-line fix)
- [x] Build `ReplayHarness` that pre-computes disk state + replays through `routeAgentMessage`
- [x] First end-to-end test with hello-world fixture
- [x] Add intermediate snapshot support (pause replay for streaming assertions)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Architecture

```
captured JSON events
  → routeAgentMessage()           ← REAL (agent-service.ts)
    → eventBus.emit()             ← REAL (mitt bus)
      → listeners                 ← REAL (setupThreadListeners, already in beforeEach)
        → threadService.*()       ← REAL (refreshById, loadThreadState)
          → appData.readJson()    ← REAL (AppDataStore)
            → invoke("fs_*")     ← MOCKED (virtual filesystem)
              → store mutations   ← REAL (Zustand + ThreadStateMachine)
                → React renders   ← REAL
```

Only the Tauri `invoke()` boundary is mocked. Everything above it is production code.

### What already exists in test infrastructure

- `setup-ui.ts` `beforeEach` calls `setupEntityListeners()` → all listeners wired up
- `setup-ui.ts` `afterEach` calls `TestEvents.clearAllListeners()` → no leaks
- `mockInvoke` handles `fs_exists`, `fs_read_file`, `fs_write_file`, `fs_list_dir_names`
- `mockFileSystem` (Map) backs the virtual disk
- `VirtualFS` helper writes to the right paths under `MOCK_MORT_DIR`
- `TestStores.clear()` resets Zustand state between tests

### What's missing

1. **`get_paths_info` mock** — `appData` calls `invoke("get_paths_info")` to resolve its base directory. Currently throws "Unmocked Tauri command".

2. **`ReplayHarness`** — orchestrates pre-computation, disk seeding, event replay, and AGENT_COMPLETED synthesis.

## Why routeAgentMessage works (with one trick)

In production, `thread_action` events through `routeAgentMessage` emit an empty `AGENT_STATE_DELTA` → the listener drops it (no `full` payload, no patches). State is NOT built from `thread_action` events on the frontend. It's built from:
- `state_event` messages (JSON patches + full snapshots) during streaming
- Disk reads triggered by `AGENT_COMPLETED` on turn end

The captured JSON only contains `thread_action` events (not `state_event`). So during replay, `thread_action` events get dropped — **same as production**. That's correct behavior.

The trick: we **pre-compute** what the agent would have written to state.json (by reducing all `thread_action` payloads through `threadReducer`), seed the virtual filesystem with it, then **synthesize AGENT_COMPLETED** at the end. This triggers `threadService.loadThreadState()` → reads pre-computed state.json from VirtualFS → `store.setThreadState()` → machine hydrates → committed state populated.

During replay before completion, `stream_delta` events build WIP messages through the real pipeline — so tests can assert on streaming state too.

### Event flow during replay

| Captured event | routeAgentMessage → | Listener → | Effect |
|---|---|---|---|
| `thread_action` (INIT, APPEND_USER_MSG, etc.) | emits AGENT_STATE_DELTA (empty) | drops (no `full`) — **same as production** | none |
| `stream_delta` | emits STREAM_DELTA | `store.dispatch(STREAM_DELTA)` | WIP message with isStreaming blocks |
| `event:thread:created` | emits THREAD_CREATED | `threadService.refreshById()` → reads metadata.json from VirtualFS | `threads[id]` populated |
| `event:thread:name:generated` | emits THREAD_NAME_GENERATED | `threadService.refreshById()` → reads metadata.json | name updated |
| `event:thread:status:changed` | emits THREAD_STATUS_CHANGED | `refreshById()` + `markThreadAsUnread()` | status + unread flag |
| `heartbeat` | `useHeartbeatStore.updateHeartbeat()` | — | heartbeat tracking updated |
| `log` | `logger.info()` | — | logged |
| `drain` | no-op | — | — |
| **synthetic** AGENT_COMPLETED | (emitted directly to eventBus) | `refreshById()` + `loadThreadState()` → reads state.json from VirtualFS → `setThreadState()` → machine HYDRATE | committed state populated, WIP cleared |

## Design

### Phase 1: Fix the mock gap

Add to `src/test/mocks/tauri-api.ts` in the `mockInvoke` switch:

```typescript
case "get_paths_info":
  return { data_dir: MOCK_MORT_DIR, app_suffix: null };
```

This unblocks `appData.readJson()` / `appData.exists()` in any test that goes through `threadService`.

### Phase 2: `ReplayHarness`

New file: `src/test/helpers/event-replay.ts`

```typescript
import { routeAgentMessage } from "@/lib/agent-service";
import { eventBus } from "@/entities/events";
import { EventName } from "@core/types/events";
import { threadReducer, type ThreadAction } from "@core/lib/thread-reducer";
import { VirtualFS } from "./virtual-fs";
import { MOCK_MORT_DIR } from "../mocks/tauri-api";
import { waitForReact } from "./event-emitter";
import type { CapturedEvent } from "@/stores/event-debugger-store";
import type { ThreadState } from "@core/types/events";

/**
 * Replays captured events through the real production pipeline.
 *
 * Pre-computes what the agent would have written to disk (by reducing
 * thread_actions through threadReducer), seeds the virtual filesystem,
 * then feeds every event through routeAgentMessage() — the same entry
 * point as live socket messages.
 *
 * The routing, eventBus, listeners, service layer, store, and machine
 * are all real. Only the filesystem (invoke) is virtual.
 */
export class ReplayHarness {
  private events: CapturedEvent[];
  private threadId: string;
  private diskState: ThreadState;
  private diskMetadata: Record<string, unknown>;

  constructor(rawEvents: CapturedEvent[]) {
    this.events = deduplicateEvents(rawEvents);
    this.threadId = this.events[0]?.threadId ?? "";
    this.diskState = this.buildDiskState();
    this.diskMetadata = this.buildDiskMetadata();
    this.seedVirtualDisk();
  }

  /** Reduce thread_action payloads → what agent wrote to state.json */
  private buildDiskState(): ThreadState {
    let state: ThreadState = {
      messages: [], fileChanges: [], workingDirectory: "",
      status: "running", timestamp: 0, toolStates: {},
    };
    for (const event of this.events) {
      if (event.type === "thread_action" && event.payload?.action) {
        state = threadReducer(state, event.payload.action as ThreadAction);
      }
    }
    return state;
  }

  /** Extract metadata from named events → what agent wrote to metadata.json */
  private buildDiskMetadata(): Record<string, unknown> {
    const meta: Record<string, unknown> = {
      id: this.threadId,
      status: "running",
      createdAt: this.events[0]?.timestamp ?? Date.now(),
      updatedAt: Date.now(),
      isRead: true,
      permissionMode: "implement",
      turns: [{ index: 0, startedAt: this.events[0]?.timestamp, completedAt: null }],
    };
    for (const event of this.events) {
      if (event.type !== "event") continue;
      const p = event.payload?.payload;
      if (!p) continue;
      switch (event.name) {
        case "thread:created":
          meta.repoId = p.repoId;
          meta.worktreeId = p.worktreeId;
          break;
        case "thread:name:generated":
          meta.name = p.name;
          break;
        case "thread:status:changed":
          meta.status = p.status;
          break;
      }
    }
    return meta;
  }

  /** Seed VirtualFS so threadService reads succeed */
  private seedVirtualDisk(): void {
    const dir = `${MOCK_MORT_DIR}/threads/${this.threadId}`;
    VirtualFS.seed({
      [`${dir}/metadata.json`]: this.diskMetadata,
      [`${dir}/state.json`]: this.diskState,
    });
  }

  /**
   * Replay all captured events through routeAgentMessage().
   * Each event flows through the real production pipeline.
   */
  async replay(): Promise<void> {
    for (const event of this.events) {
      routeAgentMessage(event.payload as any);
      await waitForReact();
    }
  }

  /**
   * Replay up to a specific event index (for intermediate snapshots).
   */
  async replayUntil(stopIndex: number): Promise<void> {
    const limit = Math.min(stopIndex, this.events.length);
    for (let i = 0; i < limit; i++) {
      routeAgentMessage(this.events[i].payload as any);
      await waitForReact();
    }
  }

  /**
   * Synthesize AGENT_COMPLETED to trigger final state hydration.
   *
   * In production this is a Tauri process lifecycle event (fired when
   * the agent subprocess exits), not a socket message — so it's never
   * in the captured JSON. But it triggers the critical loadThreadState()
   * call that reads state.json from disk and hydrates committed state.
   */
  async complete(): Promise<void> {
    eventBus.emit(EventName.AGENT_COMPLETED, {
      threadId: this.threadId,
      exitCode: 0,
    });
    await waitForReact();
  }

  /** Replay all events + synthesize completion */
  async replayToCompletion(): Promise<void> {
    await this.replay();
    await this.complete();
  }

  get id(): string { return this.threadId; }
  get state(): ThreadState { return this.diskState; }
}

/** Keep only hub:emitted events (deduplicate hub:received duplicates) */
function deduplicateEvents(events: CapturedEvent[]): CapturedEvent[] {
  const seqMap = new Map<number, CapturedEvent>();
  for (const event of events) {
    const seq = event.pipeline?.[0]?.seq;
    if (seq == null) continue;
    const hasEmitted = event.pipeline?.some(s => s.stage === "hub:emitted");
    if (!seqMap.has(seq) || hasEmitted) {
      seqMap.set(seq, event);
    }
  }
  return [...seqMap.values()].sort((a, b) => a.id - b.id);
}
```

### Phase 3: First test

Save the user's JSON blob as `src/test/fixtures/hello-world.json`, then:

```typescript
// src/components/thread/__tests__/replay-hello-world.ui.test.tsx
import { describe, it, expect, vi } from "vitest";
import { screen, waitFor, render } from "@/test/helpers";
import { ReplayHarness } from "@/test/helpers/event-replay";
import { useThreadStore } from "@/entities/threads/store";
import { ThreadView } from "../thread-view";
import fixture from "@/test/fixtures/hello-world.json";

vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("replay: hello world", () => {
  it("builds committed state after replay + completion", async () => {
    const harness = new ReplayHarness(fixture);
    await harness.replayToCompletion();

    const state = useThreadStore.getState().threadStates[harness.id];
    expect(state).toBeDefined();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].content).toBe("hey");
    expect(state.messages[1].role).toBe("assistant");
  });

  it("populates metadata through real listener pipeline", async () => {
    const harness = new ReplayHarness(fixture);
    await harness.replayToCompletion();

    const meta = useThreadStore.getState().threads[harness.id];
    expect(meta).toBeDefined();
    expect(meta.name).toBe("hey");
  });

  it("shows WIP streaming content mid-replay", async () => {
    const harness = new ReplayHarness(fixture);
    // Replay through first stream_delta only
    await harness.replayUntil(36);

    const state = useThreadStore.getState().threadStates[harness.id];
    const lastMsg = state?.messages?.at(-1);
    expect(lastMsg?.content?.[0]?.isStreaming).toBe(true);
  });

  it("renders the assistant response in ThreadView", async () => {
    const harness = new ReplayHarness(fixture);
    await harness.replayToCompletion();

    const state = useThreadStore.getState().threadStates[harness.id];
    render(
      <ThreadView
        threadId={harness.id}
        messages={state.messages}
        status="completed"
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/What can I help you with/)).toBeInTheDocument();
    });
  });
});
```

### Phase 4: Intermediate snapshots

`replayUntil(index)` enables testing any point in the event timeline:

```typescript
// Mid-streaming: WIP message with isStreaming blocks
await harness.replayUntil(36);

// Mid-tool-use: tool state is "running"
await harness.replayUntil(toolUseIndex);

// After completion: committed messages, status complete
await harness.replayToCompletion();
```

## What's real vs mocked

| Layer | Real? |
|---|---|
| `routeAgentMessage()` | Real |
| eventBus (mitt) | Real |
| All listeners (thread, repo, plan, etc.) | Real |
| `threadService.refreshById()` | Real |
| `threadService.loadThreadState()` | Real |
| `appData` (AppDataStore) | Real |
| `invoke()` (Tauri IPC) | **Mocked** → `mockFileSystem` |
| `useThreadStore` (Zustand) | Real |
| `ThreadStateMachine` | Real |
| `threadReducer` | Real (used to pre-compute disk state) |
| React rendering | Real |

## Side effects exercised

- `routeAgentMessage` routing (type dispatch)
- eventBus emission for every event type
- Thread listeners: refreshById, loadThreadState, markThreadAsUnread, chain tracking
- threadService: disk reads via appData → VirtualFS
- Store mutations: thread metadata + thread state + heartbeat tracking
- ThreadStateMachine: HYDRATE (on completion), STREAM_DELTA (during streaming)
- Usage sync: cumulativeUsage/lastCallUsage copied to metadata
- Heartbeat tracking: updateHeartbeat calls
- Cleanup on completion: heartbeat removal, chain state clear, disk stats clear
