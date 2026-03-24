/**
 * Tests for the TUI hook handler HTTP endpoints.
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

function createTestLogger(): SidecarLogger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function makeApp(dataDir: string, broadcaster: EventBroadcaster) {
  const app = express();
  app.use(
    "/hooks",
    createHookRouter({
      dataDir,
      broadcaster,
      log: createTestLogger(),
    }),
  );
  return app;
}

async function post(
  server: Server,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server not listening");

  const res = await fetch(`http://127.0.0.1:${address.port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, body: json };
}

describe("Hook handler", () => {
  let dataDir: string;
  let broadcaster: EventBroadcaster;
  let server: Server;

  beforeEach(async () => {
    dataDir = join(tmpdir(), `mort-hook-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dataDir, { recursive: true });
    broadcaster = new EventBroadcaster();

    const app = makeApp(dataDir, broadcaster);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe("POST /hooks/session-start", () => {
    it("responds with empty JSON on success", async () => {
      const res = await post(server, "/hooks/session-start", { cwd: "/tmp" }, {
        "x-anvil-thread-id": "thread-1",
      });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it("creates state.json for thread", async () => {
      await post(server, "/hooks/session-start", { cwd: "/home/user" }, {
        "x-anvil-thread-id": "thread-init",
      });

      const statePath = join(dataDir, "threads", "thread-init", "state.json");
      expect(existsSync(statePath)).toBe(true);
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(state.status).toBe("running");
      expect(state.workingDirectory).toBe("/home/user");
    });

    it("works without thread ID header", async () => {
      const res = await post(server, "/hooks/session-start", { cwd: "/tmp" });
      expect(res.status).toBe(200);
    });
  });

  describe("POST /hooks/pre-tool-use", () => {
    it("allows normal tools", async () => {
      const res = await post(server, "/hooks/pre-tool-use", {
        tool_name: "Read",
        tool_input: { file_path: "/tmp/foo.ts" },
        tool_use_id: "tu-1",
      }, { "x-anvil-thread-id": "thread-2" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ decision: "allow" });
    });

    it("denies disallowed tools", async () => {
      const res = await post(server, "/hooks/pre-tool-use", {
        tool_name: "EnterWorktree",
        tool_input: {},
        tool_use_id: "tu-2",
      }, { "x-anvil-thread-id": "thread-2" });

      expect(res.status).toBe(200);
      const body = res.body as { decision: string; reason: string };
      expect(body.decision).toBe("deny");
      expect(body.reason).toContain("EnterWorktree");
    });

    it("denies dangerous git commands", async () => {
      const res = await post(server, "/hooks/pre-tool-use", {
        tool_name: "Bash",
        tool_input: { command: "git reset --hard HEAD" },
        tool_use_id: "tu-3",
      }, { "x-anvil-thread-id": "thread-2" });

      expect(res.status).toBe(200);
      const body = res.body as { decision: string; reason: string };
      expect(body.decision).toBe("deny");
      expect(body.reason).toContain("reset --hard");
    });

    it("allows safe git commands", async () => {
      const res = await post(server, "/hooks/pre-tool-use", {
        tool_name: "Bash",
        tool_input: { command: "git status" },
        tool_use_id: "tu-4",
      }, { "x-anvil-thread-id": "thread-2" });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ decision: "allow" });
    });

    it("tracks tool as running in thread state", async () => {
      // Init thread first
      await post(server, "/hooks/session-start", { cwd: "/tmp" }, {
        "x-anvil-thread-id": "thread-tool",
      });

      await post(server, "/hooks/pre-tool-use", {
        tool_name: "Read",
        tool_input: { file_path: "/tmp/foo.ts" },
        tool_use_id: "tu-track",
      }, { "x-anvil-thread-id": "thread-tool" });

      const statePath = join(dataDir, "threads", "thread-tool", "state.json");
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(state.toolStates["tu-track"]).toBeDefined();
      expect(state.toolStates["tu-track"].status).toBe("running");
    });
  });

  describe("POST /hooks/post-tool-use", () => {
    it("marks tool complete and extracts file changes", async () => {
      // Init + pre-tool
      await post(server, "/hooks/session-start", { cwd: "/tmp" }, {
        "x-anvil-thread-id": "thread-post",
      });
      await post(server, "/hooks/pre-tool-use", {
        tool_name: "Write",
        tool_input: { file_path: "/tmp/new.ts", content: "export {}" },
        tool_use_id: "tu-write",
      }, { "x-anvil-thread-id": "thread-post" });

      const res = await post(server, "/hooks/post-tool-use", {
        tool_name: "Write",
        tool_input: { file_path: "/tmp/new.ts", content: "export {}" },
        tool_use_id: "tu-write",
        tool_result: "File written",
        tool_result_is_error: false,
      }, { "x-anvil-thread-id": "thread-post" });

      expect(res.status).toBe(200);

      const statePath = join(dataDir, "threads", "thread-post", "state.json");
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(state.toolStates["tu-write"].status).toBe("complete");
      expect(state.fileChanges).toContainEqual({ path: "/tmp/new.ts", operation: "create" });
    });
  });

  describe("POST /hooks/stop", () => {
    it("marks thread complete", async () => {
      await post(server, "/hooks/session-start", { cwd: "/tmp" }, {
        "x-anvil-thread-id": "thread-stop",
      });

      const res = await post(server, "/hooks/stop", {}, {
        "x-anvil-thread-id": "thread-stop",
      });

      expect(res.status).toBe(200);

      const statePath = join(dataDir, "threads", "thread-stop", "state.json");
      const state = JSON.parse(readFileSync(statePath, "utf-8"));
      expect(state.status).toBe("complete");
    });
  });

  describe("events.jsonl lifecycle events", () => {
    function readEvents(threadId: string) {
      const filePath = join(dataDir, "threads", threadId, "events.jsonl");
      if (!existsSync(filePath)) return [];
      return readFileSync(filePath, "utf-8")
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
    }

    it("writes SESSION_STARTED on session-start", async () => {
      await post(server, "/hooks/session-start", { cwd: "/tmp" }, {
        "x-anvil-thread-id": "thread-evt-1",
      });

      const events = readEvents("thread-evt-1");
      expect(events.some((e: { type: string }) => e.type === "SESSION_STARTED")).toBe(true);
    });

    it("writes TOOL_STARTED and TOOL_COMPLETED on tool lifecycle", async () => {
      await post(server, "/hooks/session-start", { cwd: "/tmp" }, {
        "x-anvil-thread-id": "thread-evt-2",
      });
      await post(server, "/hooks/pre-tool-use", {
        tool_name: "Read",
        tool_input: { file_path: "/tmp/foo.ts" },
        tool_use_id: "tu-evt",
      }, { "x-anvil-thread-id": "thread-evt-2" });
      await post(server, "/hooks/post-tool-use", {
        tool_name: "Read",
        tool_input: { file_path: "/tmp/foo.ts" },
        tool_use_id: "tu-evt",
        tool_result: "contents",
      }, { "x-anvil-thread-id": "thread-evt-2" });

      const events = readEvents("thread-evt-2");
      const types = events.map((e: { type: string }) => e.type);
      expect(types).toContain("TOOL_STARTED");
      expect(types).toContain("TOOL_COMPLETED");
    });

    it("writes TOOL_DENIED when tool is blocked", async () => {
      await post(server, "/hooks/pre-tool-use", {
        tool_name: "EnterWorktree",
        tool_input: {},
        tool_use_id: "tu-deny",
      }, { "x-anvil-thread-id": "thread-evt-3" });

      const events = readEvents("thread-evt-3");
      expect(events.some((e: { type: string }) => e.type === "TOOL_DENIED")).toBe(true);
    });

    it("writes FILE_MODIFIED on file-changing tools", async () => {
      await post(server, "/hooks/session-start", { cwd: "/tmp" }, {
        "x-anvil-thread-id": "thread-evt-4",
      });
      await post(server, "/hooks/post-tool-use", {
        tool_name: "Write",
        tool_input: { file_path: "/tmp/new.ts", content: "x" },
        tool_use_id: "tu-file",
        tool_result: "written",
      }, { "x-anvil-thread-id": "thread-evt-4" });

      const events = readEvents("thread-evt-4");
      expect(events.some((e: { type: string }) => e.type === "FILE_MODIFIED")).toBe(true);
    });

    it("writes SESSION_ENDED on stop", async () => {
      await post(server, "/hooks/session-start", { cwd: "/tmp" }, {
        "x-anvil-thread-id": "thread-evt-5",
      });
      await post(server, "/hooks/stop", {}, {
        "x-anvil-thread-id": "thread-evt-5",
      });

      const events = readEvents("thread-evt-5");
      expect(events.some((e: { type: string }) => e.type === "SESSION_ENDED")).toBe(true);
    });
  });

  describe("broadcasts", () => {
    it("broadcasts tui-thread-state events with full action payload", async () => {
      const events: unknown[] = [];
      broadcaster.subscribe((e) => events.push(e));

      await post(server, "/hooks/session-start", { cwd: "/tmp" }, {
        "x-anvil-thread-id": "thread-bc",
      });

      expect(events.length).toBeGreaterThan(0);
      const event = events[0] as { event: string; payload: { threadId: string; action: { type: string; payload: unknown } } };
      expect(event.event).toBe("tui-thread-state");
      expect(event.payload.threadId).toBe("thread-bc");
      // Full action payload should be included (not just {type})
      expect(event.payload.action.type).toBe("INIT");
      expect(event.payload.action.payload).toBeDefined();
    });
  });
});
