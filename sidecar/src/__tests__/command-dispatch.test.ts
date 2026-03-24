/**
 * Integration test: Command dispatch over WebSocket.
 *
 * Verifies FR1: each command category is routable and returns valid responses
 * over the WebSocket protocol ({id, cmd, args} → {id, result/error}).
 *
 * Tests representative commands from each dispatch module:
 *   - misc: get_paths_info, get_agent_types, get_process_memory, web_log + get_buffered_logs
 *   - fs: fs_exists, fs_get_home_dir
 *   - git: git_get_default_branch
 *   - agent hub: list_connected_agents (covered more deeply in agent-hub-roundtrip.test.ts)
 */

import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleConnection } from "../ws-handler.js";
import { createState } from "../state.js";

let server: Server;
let port: number;

function startServer(): Promise<void> {
  server = createServer();
  const state = createState();

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (socket) => handleConnection(socket, state));

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    if (pathname === "/ws") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      port = typeof addr === "object" && addr ? addr.port : 0;
      resolve();
    });
  });
}

function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function connectWs(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function sendCommand(
  ws: WebSocket,
  id: number,
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<{ id: number; result?: unknown; error?: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for response to ${cmd}`)),
      5000,
    );
    const onMessage = (data: unknown) => {
      const parsed = JSON.parse(String(data));
      // Skip push events (they have "event" key, not "id")
      if (parsed.id !== id) return;
      clearTimeout(timeout);
      ws.off("message", onMessage);
      resolve(parsed);
    };
    ws.on("message", onMessage);
    ws.send(JSON.stringify({ id, cmd, args }));
  });
}

describe("Command dispatch over WebSocket", () => {
  let ws: WebSocket;

  beforeAll(async () => {
    await startServer();
    ws = await connectWs();
  });

  afterAll(async () => {
    ws.close();
    await stopServer();
  });

  // ── Misc commands ───────────────────────────────────────────────────

  it("get_paths_info returns data_dir and config_dir", async () => {
    const res = await sendCommand(ws, 1, "get_paths_info");
    expect(res.id).toBe(1);
    expect(res.result).toHaveProperty("data_dir");
    expect(res.result).toHaveProperty("config_dir");
  });

  it("get_agent_types returns an array", async () => {
    const res = await sendCommand(ws, 2, "get_agent_types");
    expect(res.id).toBe(2);
    expect(Array.isArray(res.result)).toBe(true);
    expect((res.result as string[]).length).toBeGreaterThan(0);
  });

  it("get_process_memory returns rss", async () => {
    const res = await sendCommand(ws, 3, "get_process_memory");
    expect(res.id).toBe(3);
    expect(res.result).toHaveProperty("rss");
    expect(typeof (res.result as { rss: number }).rss).toBe("number");
  });

  it("web_log + get_buffered_logs round-trip", async () => {
    await sendCommand(ws, 4, "web_log", {
      level: "info",
      message: "test log entry",
    });

    const logsRes = await sendCommand(ws, 5, "get_buffered_logs");
    expect(logsRes.id).toBe(5);
    const logs = logsRes.result as { level: string; message: string }[];
    expect(logs.some((l) => l.message === "test log entry")).toBe(true);
  });

  // ── FS commands ─────────────────────────────────────────────────────

  it("fs_exists returns true for known path", async () => {
    const res = await sendCommand(ws, 10, "fs_exists", { path: "/" });
    expect(res.id).toBe(10);
    expect(res.result).toBe(true);
  });

  it("fs_exists returns false for non-existent path", async () => {
    const res = await sendCommand(ws, 11, "fs_exists", {
      path: "/nonexistent-path-abc123",
    });
    expect(res.id).toBe(11);
    expect(res.result).toBe(false);
  });

  it("fs_get_home_dir returns a string", async () => {
    const res = await sendCommand(ws, 12, "fs_get_home_dir");
    expect(res.id).toBe(12);
    expect(typeof res.result).toBe("string");
    expect((res.result as string).startsWith("/")).toBe(true);
  });

  // ── Git commands ────────────────────────────────────────────────────

  it("git_get_default_branch returns a branch name", async () => {
    const repoPath = process.cwd().replace(/\/sidecar$/, "");
    const res = await sendCommand(ws, 20, "git_get_default_branch", {
      repoPath,
    });
    expect(res.id).toBe(20);
    expect(typeof res.result).toBe("string");
    expect((res.result as string).length).toBeGreaterThan(0);
  });

  it("git_list_anvil_branches returns an array", async () => {
    const repoPath = process.cwd().replace(/\/sidecar$/, "");
    const res = await sendCommand(ws, 21, "git_list_anvil_branches", {
      repoPath,
    });
    expect(res.id).toBe(21);
    expect(Array.isArray(res.result)).toBe(true);
  });

  // ── Terminal commands ────────────────────────────────────────────────

  it("spawn_terminal returns a session ID", async () => {
    const res = await sendCommand(ws, 30, "spawn_terminal", {
      cols: 80,
      rows: 24,
      cwd: "/tmp",
    });
    expect(res.id).toBe(30);
    expect(typeof res.result).toBe("number");
    expect(res.result).toBeGreaterThan(0);

    // Cleanup
    await sendCommand(ws, 31, "kill_terminal", { id: res.result });
  });

  it("list_terminals returns an array", async () => {
    const res = await sendCommand(ws, 32, "list_terminals");
    expect(res.id).toBe(32);
    expect(Array.isArray(res.result)).toBe(true);
  });

  // ── File watcher commands ──────────────────────────────────────────

  it("start_watch + list_watches + stop_watch round-trip", async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "dispatch-watch-"));
    try {
      await sendCommand(ws, 40, "start_watch", {
        watchId: "test-w",
        path: tmpDir,
        recursive: false,
      });

      const listRes = await sendCommand(ws, 41, "list_watches");
      expect(listRes.id).toBe(41);
      expect(listRes.result).toContain("test-w");

      await sendCommand(ws, 42, "stop_watch", { watchId: "test-w" });

      const listRes2 = await sendCommand(ws, 43, "list_watches");
      expect((listRes2.result as string[]).includes("test-w")).toBe(false);
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  // ── Error handling ──────────────────────────────────────────────────

  it("unknown command returns error", async () => {
    const res = await sendCommand(ws, 99, "nonexistent_command_xyz");
    expect(res.id).toBe(99);
    expect(res.error).toBeDefined();
    expect(typeof res.error).toBe("string");
  });
});
