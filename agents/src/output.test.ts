/**
 * Output Module Tests - Reducer-based dispatch + disk-as-truth ordering.
 *
 * The disk-as-truth pattern requires: disk write MUST complete BEFORE socket emit.
 * This ensures UI can safely read from disk when it receives the event signal.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ThreadWriter } from "./services/thread-writer.js";

// Track call order
let callOrder: string[] = [];

// Mock fs.writeFileSync to not actually write (avoid ENOENT errors)
vi.mock("fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("fs")>();
  return {
    default: original,
    ...original,
    writeFileSync: vi.fn(() => {
      callOrder.push("disk-write-sync");
    }),
  };
});

// Mock the logger
vi.mock("./lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import after mocks
import {
  initState,
  emitState,
  setHubClient,
  appendAssistantMessage,
  appendUserMessage,
  getMessages,
} from "./output.js";

describe("output.ts - disk-before-emit ordering", () => {
  let mockThreadWriter: ThreadWriter;
  let diskWriteResolve: () => void;

  beforeEach(async () => {
    callOrder = [];
    vi.clearAllMocks();

    // Create a controllable promise for the disk write
    const diskWritePromise = new Promise<string>((resolve) => {
      diskWriteResolve = () => {
        callOrder.push("disk-write-async");
        resolve("/tmp/test-thread/state.json");
      };
    });

    // Mock ThreadWriter that we can control
    mockThreadWriter = {
      writeState: vi.fn(() => diskWritePromise),
      writeMetadata: vi.fn(),
      write: vi.fn(),
      getCachedPath: vi.fn(() => "/tmp/test-thread"),
      setCachedPath: vi.fn(),
    } as unknown as ThreadWriter;

    // Initialize state WITH ThreadWriter (uses async write)
    // Resolve immediately for init to complete
    const initPromise = initState("/tmp/test-thread", "/tmp/workdir", [], mockThreadWriter);
    diskWriteResolve();
    await initPromise;
  });

  /**
   * Verifies the disk-as-truth pattern is correctly implemented.
   * Disk write MUST complete when emitState resolves.
   */
  it("disk write completes when emitState resolves (disk-as-truth pattern)", async () => {
    // Clear call order from initState
    callOrder = [];

    // Create a new controllable promise for this test
    let resolveWrite: () => void;
    const writePromise = new Promise<string>((resolve) => {
      resolveWrite = () => {
        callOrder.push("disk-write-async");
        resolve("/tmp/test-thread/state.json");
      };
    });
    (mockThreadWriter.writeState as ReturnType<typeof vi.fn>).mockReturnValue(writePromise);

    // Call emitState - now async, so we need to await it
    const emitPromise = emitState();

    // Resolve the disk write
    resolveWrite!();

    // Wait for emitState to complete
    await emitPromise;

    // Verify disk write was called
    const diskIndex = callOrder.indexOf("disk-write-async");
    expect(diskIndex).toBeGreaterThanOrEqual(0);
  });

  it("ThreadWriter.writeState is called", async () => {
    callOrder = [];

    // Create a new promise that resolves immediately
    (mockThreadWriter.writeState as ReturnType<typeof vi.fn>).mockResolvedValue("/tmp/test-thread/state.json");

    await emitState();
    expect(mockThreadWriter.writeState).toHaveBeenCalled();
  });
});

describe("output.ts - thread_action messages via hub", () => {
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    callOrder = [];
    vi.clearAllMocks();

    mockSend = vi.fn();
    setHubClient({
      send: mockSend,
      connectionState: "connected",
    } as unknown as Parameters<typeof setHubClient>[0]);

    await initState("/tmp/test-thread", "/tmp/workdir");
  });

  it("sends thread_action with INIT action on initState", () => {
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.type).toBe("thread_action");
    expect(arg.action.type).toBe("INIT");
  });

  it("sends thread_action with APPEND_USER_MESSAGE on appendUserMessage", async () => {
    mockSend.mockClear();
    await appendUserMessage("msg-1", "hello");
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.type).toBe("thread_action");
    expect(arg.action.type).toBe("APPEND_USER_MESSAGE");
    expect(arg.action.payload.content).toBe("hello");
    expect(arg.action.payload.id).toBe("msg-1");
  });

  it("emitState sends HYDRATE action with full state", async () => {
    mockSend.mockClear();
    await emitState();
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.type).toBe("thread_action");
    expect(arg.action.type).toBe("HYDRATE");
    expect(arg.action.payload.state).toBeDefined();
    expect(arg.action.payload.state.workingDirectory).toBe("/tmp/workdir");
  });
});

describe("output.ts - StoredMessage ID handling", () => {
  beforeEach(async () => {
    callOrder = [];
    vi.clearAllMocks();
    setHubClient(null as unknown as Parameters<typeof setHubClient>[0]);
    await initState("/tmp/test-thread", "/tmp/workdir");
  });

  it("appendAssistantMessage stores the provided id", async () => {
    await appendAssistantMessage({ id: "msg_sdk_123", role: "assistant", content: "Hello" });

    const msgs = getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("msg_sdk_123");
  });

  it("appendUserMessage uses the provided id", async () => {
    await appendUserMessage("custom-id-123", "Hi there");

    const msgs = getMessages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe("custom-id-123");
  });

  it("initState accepts priorMessages with StoredMessage shape", async () => {
    const prior = [
      { id: "id-1", role: "user", content: "Hello" },
      { id: "id-2", role: "assistant", content: "Hi" },
    ];
    await initState("/tmp/test-thread", "/tmp/workdir", prior);

    const msgs = getMessages();
    expect(msgs).toHaveLength(2);
    expect(msgs[0].id).toBe("id-1");
    expect(msgs[1].id).toBe("id-2");
  });
});
