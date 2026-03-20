/**
 * Integration test: Agent hub round-trip via WebSocket.
 *
 * Verifies FR5: full round-trip: frontend → sidecar → agent → sidecar → frontend.
 *
 * Starts a sidecar server on a random port, connects a simulated frontend
 * and agent, and verifies bidirectional message flow.
 */

import { createServer, type Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleConnection } from "../ws-handler.js";
import { createState } from "../state.js";

let server: Server;
let port: number;

function startServer(): Promise<void> {
  server = createServer();
  const state = createState();

  const wssFrontend = new WebSocketServer({ noServer: true });
  const wssAgent = new WebSocketServer({ noServer: true });

  wssFrontend.on("connection", (socket) => handleConnection(socket, state));
  wssAgent.on("connection", (socket) => state.agentHub.handleConnection(socket));

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (pathname === "/ws") {
      wssFrontend.handleUpgrade(request, socket, head, (ws) => {
        wssFrontend.emit("connection", ws, request);
      });
    } else if (pathname === "/ws/agent") {
      wssAgent.handleUpgrade(request, socket, head, (ws) => {
        wssAgent.emit("connection", ws, request);
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

function connectWs(path: string): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function waitForMessage(ws: WebSocket, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for message")),
      timeoutMs,
    );
    ws.once("message", (data) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(data)));
    });
  });
}

describe("Agent hub round-trip", () => {
  beforeAll(async () => {
    await startServer();
  });

  afterAll(async () => {
    await stopServer();
  });

  it("agent registers and appears in list_connected_agents", async () => {
    const frontend = await connectWs("/ws");
    const agent = await connectWs("/ws/agent");

    const threadId = "test-agent-001";
    agent.send(JSON.stringify({
      senderId: threadId,
      threadId,
      type: "register",
      parentId: undefined,
      pid: process.pid,
      pipeline: [{ stage: "agent:sent", seq: 1, ts: Date.now() }],
    }));

    await new Promise((r) => setTimeout(r, 100));

    const listPromise = waitForMessage(frontend);
    frontend.send(JSON.stringify({ id: 1, cmd: "list_connected_agents", args: {} }));
    const listResponse = (await listPromise) as { id: number; result: string[] };

    expect(listResponse.id).toBe(1);
    expect(listResponse.result).toContain(threadId);

    frontend.close();
    agent.close();
  });

  it("agent event pushes to frontend", async () => {
    const frontend = await connectWs("/ws");
    const agent = await connectWs("/ws/agent");

    const threadId = "test-agent-002";
    agent.send(JSON.stringify({
      senderId: threadId,
      threadId,
      type: "register",
      parentId: undefined,
      pid: process.pid,
      pipeline: [{ stage: "agent:sent", seq: 1, ts: Date.now() }],
    }));

    await new Promise((r) => setTimeout(r, 100));

    const pushPromise = waitForMessage(frontend);
    agent.send(JSON.stringify({
      senderId: threadId,
      threadId,
      type: "event",
      name: "agent:status",
      payload: { status: "running" },
      pipeline: [{ stage: "agent:sent", seq: 2, ts: Date.now() }],
    }));

    const pushEvent = (await pushPromise) as { event: string; payload: Record<string, unknown> };
    expect(pushEvent.event).toBe("agent:message");
    expect(pushEvent.payload.type).toBe("event");
    expect(pushEvent.payload.name).toBe("agent:status");

    frontend.close();
    agent.close();
  });

  it("frontend sends message to agent via send_to_agent", async () => {
    const frontend = await connectWs("/ws");
    const agent = await connectWs("/ws/agent");

    const threadId = "test-agent-003";
    agent.send(JSON.stringify({
      senderId: threadId,
      threadId,
      type: "register",
      parentId: undefined,
      pid: process.pid,
      pipeline: [{ stage: "agent:sent", seq: 1, ts: Date.now() }],
    }));

    await new Promise((r) => setTimeout(r, 100));

    const agentMsgPromise = waitForMessage(agent);
    const sendPromise = waitForMessage(frontend);
    const testMessage = JSON.stringify({ type: "cancel" });
    frontend.send(JSON.stringify({
      id: 2,
      cmd: "send_to_agent",
      args: { threadId, message: testMessage },
    }));

    const sendResponse = (await sendPromise) as { id: number; result: unknown };
    expect(sendResponse.id).toBe(2);
    expect(sendResponse).not.toHaveProperty("error");

    const agentMsg = (await agentMsgPromise) as { type: string };
    expect(agentMsg.type).toBe("cancel");

    frontend.close();
    agent.close();
  });

  it("get_agent_socket_path returns WS URL", async () => {
    const frontend = await connectWs("/ws");

    const pathPromise = waitForMessage(frontend);
    frontend.send(JSON.stringify({ id: 3, cmd: "get_agent_socket_path", args: {} }));
    const pathResponse = (await pathPromise) as { id: number; result: string };

    expect(pathResponse.id).toBe(3);
    expect(pathResponse.result).toMatch(/^ws:\/\//);

    frontend.close();
  });
});
