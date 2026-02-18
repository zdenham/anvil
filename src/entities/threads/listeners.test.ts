// @vitest-environment node
/**
 * Thread Listeners Tests
 *
 * Documents the thread listener behavior for AGENT_STATE events.
 *
 * NOTE: The listener correctly follows the disk-as-truth pattern by reading
 * from disk. The actual bug is in agents/src/output.ts which emits to stdout
 * BEFORE the disk write completes. See agents/src/output.test.ts for the
 * primary bug test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { useThreadStore } from "./store.js";
import type { ThreadState } from "@/lib/types/agent-messages";

// Mock logger
vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Thread Listeners - store behavior", () => {
  const TEST_THREAD_ID = "test-thread-123";

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store to initial state
    useThreadStore.setState({
      threads: {},
      activeThreadId: null,
      threadStates: {},
      activeThreadLoading: false,
      threadErrors: {},
      _hydrated: true,
    });
  });

  /**
   * Verifies the store's setThreadState method works correctly.
   * This is used by loadThreadState after reading from disk.
   */
  it("setThreadState correctly stores state in the store", () => {
    const state: ThreadState = {
      messages: [],
      fileChanges: [],
      workingDirectory: "/test",
      status: "running",
      timestamp: Date.now(),
      toolStates: {
        tool_1: { status: "complete", toolName: "Read" },
      },
    };

    // Directly call the store method
    useThreadStore.getState().setThreadState(TEST_THREAD_ID, state);

    // Verify it worked
    const stored = useThreadStore.getState().threadStates[TEST_THREAD_ID];
    expect(stored).toEqual(state);
    expect(stored?.toolStates?.["tool_1"]?.status).toBe("complete");
  });
});
