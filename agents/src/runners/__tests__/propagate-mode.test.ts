import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// Mock the output module to control getHubClient
vi.mock("../../output.js", () => ({
  getHubClient: vi.fn(),
  setHubClient: vi.fn(),
  initState: vi.fn(),
  emitState: vi.fn(),
  appendUserMessage: vi.fn(),
  appendAssistantMessage: vi.fn(),
  markToolRunning: vi.fn(),
  markToolComplete: vi.fn(),
  updateFileChange: vi.fn(),
  complete: vi.fn(),
  error: vi.fn(),
  cancelled: vi.fn(),
  getMessages: vi.fn(),
  getSessionId: vi.fn(),
  setSessionId: vi.fn(),
  updateUsage: vi.fn(),
  writeUsageToMetadata: vi.fn(),
}));

// Mock logger to avoid noise
vi.mock("../../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { propagateModeToChildren } from "../shared.js";
import { getHubClient } from "../../output.js";

const mockedGetHubClient = vi.mocked(getHubClient);

describe("propagateModeToChildren", () => {
  let mortDir: string;
  let threadsDir: string;

  beforeEach(() => {
    mortDir = join(
      tmpdir(),
      `mort-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    threadsDir = join(mortDir, "threads");
    mkdirSync(threadsDir, { recursive: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(mortDir, { recursive: true, force: true });
  });

  // Helper to create a thread directory with metadata
  function createThread(id: string, metadata: Record<string, unknown>): void {
    const threadDir = join(threadsDir, id);
    mkdirSync(threadDir, { recursive: true });
    writeFileSync(
      join(threadDir, "metadata.json"),
      JSON.stringify(metadata, null, 2),
    );
  }

  function readMetadata(id: string): Record<string, unknown> {
    return JSON.parse(
      readFileSync(join(threadsDir, id, "metadata.json"), "utf-8"),
    );
  }

  it("propagates mode to running child threads", () => {
    const mockRelay = vi.fn();
    mockedGetHubClient.mockReturnValue({
      isConnected: true,
      relay: mockRelay,
    } as any);

    createThread("child-1", {
      id: "child-1",
      parentThreadId: "parent-1",
      status: "running",
      permissionMode: "plan",
    });

    propagateModeToChildren("parent-1", "implement", mortDir);

    // Verify relay was called
    expect(mockRelay).toHaveBeenCalledWith("child-1", {
      type: "permission_mode_changed",
      payload: { modeId: "implement" },
    });

    // Verify metadata was persisted
    const metadata = readMetadata("child-1");
    expect(metadata.permissionMode).toBe("implement");
    expect(metadata.updatedAt).toBeDefined();
  });

  it("skips non-running child threads", () => {
    const mockRelay = vi.fn();
    mockedGetHubClient.mockReturnValue({
      isConnected: true,
      relay: mockRelay,
    } as any);

    createThread("child-completed", {
      id: "child-completed",
      parentThreadId: "parent-1",
      status: "completed",
      permissionMode: "plan",
    });

    propagateModeToChildren("parent-1", "implement", mortDir);

    expect(mockRelay).not.toHaveBeenCalled();
    // Metadata should not be updated
    const metadata = readMetadata("child-completed");
    expect(metadata.permissionMode).toBe("plan");
  });

  it("skips threads belonging to other parents", () => {
    const mockRelay = vi.fn();
    mockedGetHubClient.mockReturnValue({
      isConnected: true,
      relay: mockRelay,
    } as any);

    createThread("other-child", {
      id: "other-child",
      parentThreadId: "different-parent",
      status: "running",
      permissionMode: "plan",
    });

    propagateModeToChildren("parent-1", "implement", mortDir);

    expect(mockRelay).not.toHaveBeenCalled();
  });

  it("propagates to multiple running children", () => {
    const mockRelay = vi.fn();
    mockedGetHubClient.mockReturnValue({
      isConnected: true,
      relay: mockRelay,
    } as any);

    createThread("child-a", {
      id: "child-a",
      parentThreadId: "parent-1",
      status: "running",
      permissionMode: "plan",
    });
    createThread("child-b", {
      id: "child-b",
      parentThreadId: "parent-1",
      status: "running",
      permissionMode: "plan",
    });

    propagateModeToChildren("parent-1", "approve", mortDir);

    expect(mockRelay).toHaveBeenCalledTimes(2);
    expect(readMetadata("child-a").permissionMode).toBe("approve");
    expect(readMetadata("child-b").permissionMode).toBe("approve");
  });

  it("persists mode even when hub is not connected", () => {
    mockedGetHubClient.mockReturnValue(null);

    createThread("child-1", {
      id: "child-1",
      parentThreadId: "parent-1",
      status: "running",
      permissionMode: "plan",
    });

    propagateModeToChildren("parent-1", "implement", mortDir);

    // Mode should still be persisted to disk
    const metadata = readMetadata("child-1");
    expect(metadata.permissionMode).toBe("implement");
  });

  it("handles missing threads directory gracefully", () => {
    mockedGetHubClient.mockReturnValue(null);

    // Use a mortDir with no threads directory
    const emptyDir = join(tmpdir(), `mort-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });

    // Should not throw
    expect(() =>
      propagateModeToChildren("parent-1", "implement", emptyDir),
    ).not.toThrow();

    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("skips entries without metadata.json", () => {
    const mockRelay = vi.fn();
    mockedGetHubClient.mockReturnValue({
      isConnected: true,
      relay: mockRelay,
    } as any);

    // Create a directory with no metadata.json
    const threadDir = join(threadsDir, "no-metadata");
    mkdirSync(threadDir, { recursive: true });

    // Create a valid child alongside it
    createThread("child-valid", {
      id: "child-valid",
      parentThreadId: "parent-1",
      status: "running",
      permissionMode: "plan",
    });

    propagateModeToChildren("parent-1", "implement", mortDir);

    // Only the valid child should be relayed
    expect(mockRelay).toHaveBeenCalledTimes(1);
    expect(mockRelay).toHaveBeenCalledWith("child-valid", {
      type: "permission_mode_changed",
      payload: { modeId: "implement" },
    });
  });

  it("skips relay when hub is connected but not relayable", () => {
    mockedGetHubClient.mockReturnValue({
      isConnected: false,
      relay: vi.fn(),
    } as any);

    createThread("child-1", {
      id: "child-1",
      parentThreadId: "parent-1",
      status: "running",
      permissionMode: "plan",
    });

    propagateModeToChildren("parent-1", "implement", mortDir);

    // Hub relay should NOT be called since isConnected is false
    const hub = mockedGetHubClient();
    expect(hub!.relay).not.toHaveBeenCalled();

    // But disk persistence should still happen
    const metadata = readMetadata("child-1");
    expect(metadata.permissionMode).toBe("implement");
  });

  it("updates updatedAt timestamp on persisted metadata", () => {
    mockedGetHubClient.mockReturnValue(null);

    const originalTime = Date.now() - 10_000;
    createThread("child-1", {
      id: "child-1",
      parentThreadId: "parent-1",
      status: "running",
      permissionMode: "plan",
      updatedAt: originalTime,
    });

    propagateModeToChildren("parent-1", "implement", mortDir);

    const metadata = readMetadata("child-1");
    expect(metadata.updatedAt).toBeGreaterThan(originalTime);
  });

  it("only propagates to children matching the given parentThreadId", () => {
    const mockRelay = vi.fn();
    mockedGetHubClient.mockReturnValue({
      isConnected: true,
      relay: mockRelay,
    } as any);

    createThread("child-of-p1", {
      id: "child-of-p1",
      parentThreadId: "parent-1",
      status: "running",
      permissionMode: "plan",
    });
    createThread("child-of-p2", {
      id: "child-of-p2",
      parentThreadId: "parent-2",
      status: "running",
      permissionMode: "plan",
    });
    createThread("completed-of-p1", {
      id: "completed-of-p1",
      parentThreadId: "parent-1",
      status: "completed",
      permissionMode: "plan",
    });

    propagateModeToChildren("parent-1", "approve", mortDir);

    // Only the running child of parent-1 should be relayed
    expect(mockRelay).toHaveBeenCalledTimes(1);
    expect(mockRelay).toHaveBeenCalledWith("child-of-p1", {
      type: "permission_mode_changed",
      payload: { modeId: "approve" },
    });

    // Only child-of-p1 should have updated metadata
    expect(readMetadata("child-of-p1").permissionMode).toBe("approve");
    expect(readMetadata("child-of-p2").permissionMode).toBe("plan");
    expect(readMetadata("completed-of-p1").permissionMode).toBe("plan");
  });
});
