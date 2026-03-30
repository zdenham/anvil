/**
 * Tests the full hook lifecycle sequence via direct HTTP calls.
 *
 * Exercises: INIT → APPEND_USER_MESSAGE → MARK_TOOL_RUNNING →
 * MARK_TOOL_COMPLETE → COMPLETE with observable state transitions.
 *
 * No CLI or API key needed — runs in CI.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { createHookRouter } from "../hooks/hook-handler.js";
import { EventBroadcaster } from "../push.js";
import { mkdirSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SidecarLogger } from "../logger.js";
import type { ThreadState } from "@core/types/events.js";
import type { LifecycleEvent } from "../hooks/event-writer.js";

function silentLogger(): SidecarLogger {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

async function postHook(
  server: Server,
  path: string,
  body: unknown,
  threadId: string,
): Promise<{ status: number; body: unknown }> {
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("not listening");
  const res = await fetch(`http://127.0.0.1:${addr.port}/hooks${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-anvil-thread-id": threadId,
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

function readState(dataDir: string, threadId: string): ThreadState | null {
  const p = join(dataDir, "threads", threadId, "state.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as ThreadState;
}

function readEvents(dataDir: string, threadId: string): LifecycleEvent[] {
  const p = join(dataDir, "threads", threadId, "events.jsonl");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf-8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LifecycleEvent);
}

describe("Hook lifecycle sequence", () => {
  let dataDir: string;
  let broadcaster: EventBroadcaster;
  let server: Server;
  const threadId = "lifecycle-seq-1";

  beforeEach(async () => {
    dataDir = join(tmpdir(), `anvil-seq-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dataDir, { recursive: true });
    broadcaster = new EventBroadcaster();

    const app = express();
    app.use("/hooks", createHookRouter({ dataDir, broadcaster, log: silentLogger() }));
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("full sequence: INIT → APPEND_USER_MESSAGE → tool lifecycle → COMPLETE", async () => {
    // 1. Session start → INIT
    await postHook(server, "/session-start", { cwd: "/home/test" }, threadId);
    const afterInit = readState(dataDir, threadId);
    expect(afterInit).not.toBeNull();
    expect(afterInit!.status).toBe("running");
    expect(afterInit!.workingDirectory).toBe("/home/test");
    expect(afterInit!.messages).toHaveLength(0);

    // 2. User prompt submit → APPEND_USER_MESSAGE
    await postHook(server, "/user-prompt-submit", { prompt: "Read /etc/hosts" }, threadId);
    const afterPrompt = readState(dataDir, threadId);
    expect(afterPrompt!.messages).toHaveLength(1);
    expect(afterPrompt!.messages[0].role).toBe("user");
    expect(afterPrompt!.messages[0].content).toBe("Read /etc/hosts");
    expect(afterPrompt!.status).toBe("running");

    // 3. Pre-tool-use → MARK_TOOL_RUNNING
    await postHook(server, "/pre-tool-use", {
      tool_name: "Read",
      tool_input: { file_path: "/etc/hosts" },
      tool_use_id: "tu-seq-1",
    }, threadId);
    const afterPreTool = readState(dataDir, threadId);
    expect(afterPreTool!.toolStates["tu-seq-1"]).toBeDefined();
    expect(afterPreTool!.toolStates["tu-seq-1"].status).toBe("running");
    expect(afterPreTool!.toolStates["tu-seq-1"].toolName).toBe("Read");

    // 4. Post-tool-use → MARK_TOOL_COMPLETE
    await postHook(server, "/post-tool-use", {
      tool_name: "Read",
      tool_input: { file_path: "/etc/hosts" },
      tool_use_id: "tu-seq-1",
      tool_result: "127.0.0.1 localhost",
      tool_result_is_error: false,
    }, threadId);
    const afterPostTool = readState(dataDir, threadId);
    expect(afterPostTool!.toolStates["tu-seq-1"].status).toBe("complete");

    // 5. Stop → COMPLETE
    await postHook(server, "/stop", {}, threadId);
    const finalState = readState(dataDir, threadId);
    expect(finalState!.status).toBe("complete");

    // 6. Verify events.jsonl has correct sequence
    const events = readEvents(dataDir, threadId);
    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "SESSION_STARTED",
      "TOOL_STARTED",
      "TOOL_COMPLETED",
      "SESSION_ENDED",
    ]);
  });

  it("multi-tool sequence tracks all tools independently", async () => {
    await postHook(server, "/session-start", { cwd: "/tmp" }, threadId);

    // Start two tools
    await postHook(server, "/pre-tool-use", {
      tool_name: "Read", tool_input: {}, tool_use_id: "tu-a",
    }, threadId);
    await postHook(server, "/pre-tool-use", {
      tool_name: "Write", tool_input: { file_path: "/tmp/x.ts", content: "x" }, tool_use_id: "tu-b",
    }, threadId);

    const midState = readState(dataDir, threadId);
    expect(midState!.toolStates["tu-a"].status).toBe("running");
    expect(midState!.toolStates["tu-b"].status).toBe("running");

    // Complete first, leave second running
    await postHook(server, "/post-tool-use", {
      tool_name: "Read", tool_input: {}, tool_use_id: "tu-a", tool_result: "ok",
    }, threadId);
    const partialState = readState(dataDir, threadId);
    expect(partialState!.toolStates["tu-a"].status).toBe("complete");
    expect(partialState!.toolStates["tu-b"].status).toBe("running");

    // Complete second
    await postHook(server, "/post-tool-use", {
      tool_name: "Write", tool_input: { file_path: "/tmp/x.ts", content: "x" },
      tool_use_id: "tu-b", tool_result: "written",
    }, threadId);
    const allDone = readState(dataDir, threadId);
    expect(allDone!.toolStates["tu-a"].status).toBe("complete");
    expect(allDone!.toolStates["tu-b"].status).toBe("complete");

    // File change should be tracked
    expect(allDone!.fileChanges).toContainEqual({ path: "/tmp/x.ts", operation: "create" });
  });

  it("broadcasts state actions with full payload", async () => {
    const actions: Array<{ type: string }> = [];
    broadcaster.subscribe((e) => {
      const evt = e as { event: string; payload: { action: { type: string } } };
      if (evt.event === "tui-thread-state") {
        actions.push(evt.payload.action);
      }
    });

    await postHook(server, "/session-start", { cwd: "/tmp" }, threadId);
    await postHook(server, "/user-prompt-submit", { prompt: "hello" }, threadId);
    await postHook(server, "/pre-tool-use", {
      tool_name: "Read", tool_input: {}, tool_use_id: "tu-bc",
    }, threadId);
    await postHook(server, "/post-tool-use", {
      tool_name: "Read", tool_input: {}, tool_use_id: "tu-bc", tool_result: "ok",
    }, threadId);
    await postHook(server, "/stop", {}, threadId);

    const types = actions.map((a) => a.type);
    expect(types).toContain("INIT");
    expect(types).toContain("APPEND_USER_MESSAGE");
    expect(types).toContain("MARK_TOOL_RUNNING");
    expect(types).toContain("MARK_TOOL_COMPLETE");
    expect(types).toContain("COMPLETE");
  });

  it("events have timestamps in ascending order", async () => {
    await postHook(server, "/session-start", { cwd: "/tmp" }, threadId);
    await postHook(server, "/pre-tool-use", {
      tool_name: "Read", tool_input: {}, tool_use_id: "tu-ts",
    }, threadId);
    await postHook(server, "/post-tool-use", {
      tool_name: "Read", tool_input: {}, tool_use_id: "tu-ts", tool_result: "ok",
    }, threadId);
    await postHook(server, "/stop", {}, threadId);

    const events = readEvents(dataDir, threadId);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
    }
  });
});
