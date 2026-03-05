import { describe, it, expect, vi } from "vitest";
import { ReplayHarness } from "@/test/helpers/event-replay";
import { useThreadStore } from "@/entities/threads/store";
import { threadService } from "@/entities/threads/service";
import { MOCK_MORT_DIR, mockFileSystem } from "@/test/mocks/tauri-api";
import { ThreadStateSchema } from "@core/types/events";
import fixture from "@/test/fixtures/hello-world.json";
import type { CapturedEvent } from "@/stores/event-debugger-store";

vi.mock("@/lib/logger-client", () => ({
  logger: { log: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

describe("replay debug", () => {
  it("validates disk state against schema", () => {
    const harness = new ReplayHarness(fixture as CapturedEvent[]);

    const statePath = `${MOCK_MORT_DIR}/threads/${harness.id}/state.json`;
    const raw = JSON.parse(mockFileSystem.get(statePath)!);
    console.log("Raw state keys:", Object.keys(raw));
    console.log("Raw state status:", raw.status);
    console.log("Raw state messages:", raw.messages?.length);

    const result = ThreadStateSchema.safeParse(raw);
    if (result.success) {
      console.log("State schema parse SUCCESS");
    } else {
      console.log("State schema parse FAILED:", result.error.message);
      console.log("Issues:", JSON.stringify(result.error.issues, null, 2));
    }

    expect(result.success).toBe(true);
  });

  it("calls loadThreadState directly and checks result", async () => {
    const harness = new ReplayHarness(fixture as CapturedEvent[]);
    useThreadStore.getState().setActiveThread(harness.id);

    // Refresh metadata first
    await threadService.refreshById(harness.id);
    console.log("After refresh, thread in store:", !!useThreadStore.getState().threads[harness.id]);

    // Load state
    await threadService.loadThreadState(harness.id);

    const state = useThreadStore.getState().threadStates[harness.id];
    console.log("After loadThreadState:", state ? `messages=${state.messages.length}, status=${state.status}` : "undefined");

    expect(state).toBeDefined();
    expect(state.messages.length).toBe(2);
  });
});
