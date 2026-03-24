/**
 * Tests for the lifecycle event writer (events.jsonl).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventWriter } from "../hooks/event-writer.js";
import type { SidecarLogger } from "../logger.js";

function createTestLogger(): SidecarLogger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

describe("EventWriter", () => {
  let dataDir: string;
  let writer: EventWriter;

  beforeEach(() => {
    dataDir = join(tmpdir(), `anvil-event-writer-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dataDir, { recursive: true });
    writer = new EventWriter(dataDir, createTestLogger());
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  function readEvents(threadId: string): Array<{ type: string; timestamp: number; payload: Record<string, unknown> }> {
    const filePath = join(dataDir, "threads", threadId, "events.jsonl");
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, "utf-8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  it("creates events.jsonl on first write", () => {
    writer.sessionStarted("t1", "/tmp");
    const events = readEvents("t1");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("SESSION_STARTED");
    expect(events[0].payload.workingDirectory).toBe("/tmp");
  });

  it("appends multiple events", () => {
    writer.toolStarted("t2", "Read", "tu-1");
    writer.toolCompleted("t2", "Read", "tu-1", false);
    const events = readEvents("t2");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("TOOL_STARTED");
    expect(events[1].type).toBe("TOOL_COMPLETED");
  });

  it("writes TOOL_DENIED events", () => {
    writer.toolDenied("t3", "EnterWorktree", "tool not allowed");
    const events = readEvents("t3");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("TOOL_DENIED");
    expect(events[0].payload.toolName).toBe("EnterWorktree");
    expect(events[0].payload.reason).toBe("tool not allowed");
  });

  it("writes FILE_MODIFIED events", () => {
    writer.fileModified("t4", "/tmp/foo.ts", "tu-5");
    const events = readEvents("t4");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("FILE_MODIFIED");
    expect(events[0].payload.filePath).toBe("/tmp/foo.ts");
  });

  it("writes SESSION_ENDED events", () => {
    writer.sessionStarted("t5", "/tmp");
    writer.sessionEnded("t5");
    const events = readEvents("t5");
    expect(events).toHaveLength(2);
    expect(events[1].type).toBe("SESSION_ENDED");
  });

  it("includes timestamps on all events", () => {
    const before = Date.now();
    writer.toolStarted("t6", "Bash", "tu-9");
    const after = Date.now();
    const events = readEvents("t6");
    expect(events[0].timestamp).toBeGreaterThanOrEqual(before);
    expect(events[0].timestamp).toBeLessThanOrEqual(after);
  });
});
