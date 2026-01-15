/**
 * Output Module Tests - Disk-as-Truth Ordering
 *
 * The disk-as-truth pattern requires: disk write MUST complete BEFORE stdout emit.
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
  stdout: vi.fn(() => {
    callOrder.push("stdout-emit");
  }),
}));

// Import after mocks
import { initState, emitState } from "./output.js";

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
   * Disk write MUST complete BEFORE stdout emit.
   */
  it("disk write completes BEFORE stdout emit (disk-as-truth pattern)", async () => {
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

    // Check the order of operations
    const diskIndex = callOrder.indexOf("disk-write-async");
    const stdoutIndex = callOrder.indexOf("stdout-emit");

    // Both should have been called
    expect(diskIndex).toBeGreaterThanOrEqual(0);
    expect(stdoutIndex).toBeGreaterThanOrEqual(0);

    // Correct behavior: disk write completes BEFORE stdout emit
    // callOrder = ["disk-write-async", "stdout-emit"]
    expect(diskIndex).toBeLessThan(stdoutIndex);
  });

  it("ThreadWriter.writeState is called", async () => {
    callOrder = [];

    // Create a new promise that resolves immediately
    (mockThreadWriter.writeState as ReturnType<typeof vi.fn>).mockResolvedValue("/tmp/test-thread/state.json");

    await emitState();
    expect(mockThreadWriter.writeState).toHaveBeenCalled();
  });
});
