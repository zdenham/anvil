import { describe, it, expect, vi } from "vitest";
import { ReplayHarness } from "@/test/helpers/event-replay";
import { useThreadStore } from "@/entities/threads/store";
import { threadService } from "@/entities/threads/service";
import { MOCK_ANVIL_DIR, mockFileSystem } from "@/test/mocks/tauri-api";
import { ThreadStateSchema } from "@core/types/events";
import fixture from "@/test/fixtures/hello-world.json";
import type { CapturedEvent } from "@/stores/event-debugger-store";

vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("replay debug", () => {
  it("validates disk state against schema", () => {
    const harness = new ReplayHarness(fixture as CapturedEvent[]);

    const statePath = `${MOCK_ANVIL_DIR}/threads/${harness.id}/state.json`;
    const raw = JSON.parse(mockFileSystem.get(statePath)!);
    const result = ThreadStateSchema.safeParse(raw);
    expect(result.success).toBe(true);
  });

  it("calls loadThreadState directly and checks result", async () => {
    const harness = new ReplayHarness(fixture as CapturedEvent[]);
    useThreadStore.getState().setActiveThread(harness.id);

    // Refresh metadata first
    await threadService.refreshById(harness.id);

    // Load state
    await threadService.loadThreadState(harness.id);

    const state = useThreadStore.getState().threadStates[harness.id];

    expect(state).toBeDefined();
    expect(state.messages.length).toBe(2);
  });
});
