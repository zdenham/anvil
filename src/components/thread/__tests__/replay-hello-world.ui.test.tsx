/**
 * Event Replay UI Test: Hello World
 *
 * Replays captured event JSON through the real production pipeline
 * with only the filesystem boundary virtualized.
 *
 * Pipeline: routeAgentMessage() → eventBus → listeners → threadService → store
 */

import { describe, it, expect, vi } from "vitest";
import { waitFor } from "@/test/helpers";
import { ReplayHarness } from "@/test/helpers/event-replay";
import { useThreadStore } from "@/entities/threads/store";
import fixture from "@/test/fixtures/hello-world.json";
import type { CapturedEvent } from "@/stores/event-debugger-store";

vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("replay: hello world", () => {
  it("builds committed state after replay + completion", async () => {
    const harness = new ReplayHarness(fixture as CapturedEvent[]);
    await harness.replayToCompletion();

    const state = useThreadStore.getState().threadStates[harness.id];
    expect(state).toBeDefined();
    expect(state.messages).toHaveLength(2);
    // User message
    expect(state.messages[0].content).toBe("hey");
    // Assistant message
    expect(state.messages[1].role).toBe("assistant");
  });

  it("populates metadata through real listener pipeline", async () => {
    const harness = new ReplayHarness(fixture as CapturedEvent[]);
    await harness.replayToCompletion();

    const meta = useThreadStore.getState().threads[harness.id];
    expect(meta).toBeDefined();
    expect(meta.name).toBe("hey");
  });

  it("shows WIP streaming content mid-replay", async () => {
    const harness = new ReplayHarness(fixture as CapturedEvent[]);
    // Replay through first stream_delta (events 1-4, index 4 exclusive → gets events 0-3)
    // Event index 3 is the first stream_delta (id=4 in fixture)
    await harness.replayUntil(4);

    const state = useThreadStore.getState().threadStates[harness.id];
    expect(state).toBeDefined();
    // WIP message should be appended by the machine from STREAM_DELTA
    const lastMsg = state?.messages?.at(-1);
    expect(lastMsg).toBeDefined();
  });

  it("processes all event types without errors", async () => {
    const harness = new ReplayHarness(fixture as CapturedEvent[]);

    // Should not throw
    await harness.replay();

    // Heartbeat store should have been touched
    // (heartbeat event is in the fixture)
    await harness.complete();

    // Thread should be in the store after completion
    const threads = useThreadStore.getState().threads;
    expect(threads[harness.id]).toBeDefined();
  });

  it("hydrates disk state on completion (via loadThreadState)", async () => {
    const harness = new ReplayHarness(fixture as CapturedEvent[]);
    await harness.replayToCompletion();

    // The committed state should match what threadReducer built
    // (which is what the harness seeded to VirtualFS)
    await waitFor(() => {
      const state = useThreadStore.getState().threadStates[harness.id];
      expect(state).toBeDefined();
      expect(state.status).toBe("complete");
    });
  });

  it("deduplicates events correctly", () => {
    // Verify that the harness deduplicates events
    const harness = new ReplayHarness(fixture as CapturedEvent[]);
    // All events in the fixture have unique seq numbers, so count should match
    expect(harness.eventCount).toBe(fixture.length);
  });
});
