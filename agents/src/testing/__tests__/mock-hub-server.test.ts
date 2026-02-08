import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Socket as NetSocket, connect } from "net";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, unlinkSync, mkdirSync } from "fs";
import { randomUUID } from "crypto";
import { MockHubServer } from "../mock-hub-server.js";
import type { SocketMessage, TauriToAgentMessage } from "../../lib/hub/types.js";

/**
 * Helper to create a mock agent client that connects to the hub.
 * Simulates what the HubClient does in production.
 */
class MockAgentClient {
  private socket: NetSocket | null = null;
  private buffer = "";
  private receivedMessages: TauriToAgentMessage[] = [];
  private onMessageCallback: ((msg: TauriToAgentMessage) => void) | null = null;

  constructor(
    private threadId: string,
    private parentId?: string
  ) {}

  async connect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = connect(socketPath);

      this.socket.once("connect", () => {
        this.setupDataHandler();
        resolve();
      });

      this.socket.once("error", reject);
    });
  }

  private setupDataHandler(): void {
    if (!this.socket) return;

    this.socket.on("data", (data) => {
      this.buffer += data.toString();
      this.processBuffer();
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as TauriToAgentMessage;
        this.receivedMessages.push(msg);
        this.onMessageCallback?.(msg);
      } catch {
        // Invalid JSON, skip
      }
    }
  }

  send(msg: Partial<SocketMessage>): void {
    if (this.socket && !this.socket.destroyed) {
      const fullMsg: SocketMessage = {
        senderId: this.threadId,
        threadId: this.threadId,
        type: "unknown",
        ...msg,
      };
      this.socket.write(JSON.stringify(fullMsg) + "\n");
    }
  }

  register(): void {
    this.send({
      type: "register",
      ...(this.parentId && { parentId: this.parentId }),
    });
  }

  sendState(state: unknown): void {
    this.send({ type: "state", state });
  }

  sendEvent(name: string, payload: unknown): void {
    this.send({ type: "event", name, payload });
  }

  getReceivedMessages(): TauriToAgentMessage[] {
    return [...this.receivedMessages];
  }

  onMessage(callback: (msg: TauriToAgentMessage) => void): void {
    this.onMessageCallback = callback;
  }

  waitForMessage(
    predicate: (msg: TauriToAgentMessage) => boolean,
    timeout = 5000
  ): Promise<TauriToAgentMessage> {
    return new Promise((resolve, reject) => {
      // Check already received messages
      const existing = this.receivedMessages.find(predicate);
      if (existing) {
        resolve(existing);
        return;
      }

      const timer = setTimeout(() => {
        this.onMessageCallback = null;
        reject(new Error(`Timeout waiting for message`));
      }, timeout);

      this.onMessageCallback = (msg) => {
        if (predicate(msg)) {
          clearTimeout(timer);
          this.onMessageCallback = null;
          resolve(msg);
        }
      };
    });
  }

  disconnect(): void {
    this.socket?.destroy();
    this.socket = null;
  }
}

/**
 * Generate a unique socket path for test isolation.
 */
function getTestSocketPath(): string {
  const testDir = join(tmpdir(), "mort-test-hub");
  if (!existsSync(testDir)) {
    mkdirSync(testDir, { recursive: true });
  }
  return join(testDir, `test-hub-${randomUUID()}.sock`);
}

describe("MockHubServer", () => {
  let server: MockHubServer;
  let socketPath: string;

  beforeEach(() => {
    socketPath = getTestSocketPath();
    server = new MockHubServer(socketPath);
  });

  afterEach(async () => {
    await server.stop();
    // Clean up socket file if it exists
    if (existsSync(socketPath)) {
      try {
        unlinkSync(socketPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe("server lifecycle", () => {
    it("starts and accepts connections", async () => {
      await server.start();

      // Verify server is running by successfully connecting to it
      const client = new MockAgentClient("test-lifecycle");
      await client.connect(socketPath);

      expect(server.getSocketPath()).toBe(socketPath);

      client.disconnect();
    });

    it("cleans up connections on stop", async () => {
      await server.start();

      // Connect and register
      const client = new MockAgentClient("test-cleanup");
      await client.connect(socketPath);
      client.register();
      await server.waitForRegistration("test-cleanup", 1000);

      expect(server.getConnectedThreadIds()).toContain("test-cleanup");

      await server.stop();

      // Server should have cleaned up connections
      expect(server.getConnectedThreadIds()).toHaveLength(0);
    });

    it("can be stopped multiple times without error", async () => {
      await server.start();
      await server.stop();
      await server.stop(); // Should not throw
    });

    it("generates unique socket path if not provided", () => {
      const server1 = new MockHubServer();
      const server2 = new MockHubServer();

      expect(server1.getSocketPath()).not.toBe(server2.getSocketPath());
    });
  });

  describe("agent connections", () => {
    it("accepts agent connections", async () => {
      await server.start();

      const client = new MockAgentClient("thread-1");
      await client.connect(socketPath);

      // Connection should be established
      expect(server.getConnectedThreadIds()).toHaveLength(0); // Not registered yet

      client.disconnect();
    });

    it("tracks registered agents by threadId", async () => {
      await server.start();

      const client = new MockAgentClient("thread-abc");
      await client.connect(socketPath);
      client.register();

      // Wait for registration to be processed
      await server.waitForRegistration("thread-abc", 1000);

      expect(server.getConnectedThreadIds()).toContain("thread-abc");

      client.disconnect();
    });

    it("handles agent disconnection", async () => {
      await server.start();

      const client = new MockAgentClient("thread-disconnect");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-disconnect", 1000);
      expect(server.getConnectedThreadIds()).toContain("thread-disconnect");

      client.disconnect();

      // Give time for disconnect to be processed
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(server.getConnectedThreadIds()).not.toContain("thread-disconnect");
    });

    it("handles multiple concurrent agents", async () => {
      await server.start();

      const client1 = new MockAgentClient("thread-1");
      const client2 = new MockAgentClient("thread-2");
      const client3 = new MockAgentClient("thread-3");

      await Promise.all([
        client1.connect(socketPath),
        client2.connect(socketPath),
        client3.connect(socketPath),
      ]);

      client1.register();
      client2.register();
      client3.register();

      await Promise.all([
        server.waitForRegistration("thread-1", 1000),
        server.waitForRegistration("thread-2", 1000),
        server.waitForRegistration("thread-3", 1000),
      ]);

      const connectedIds = server.getConnectedThreadIds();
      expect(connectedIds).toContain("thread-1");
      expect(connectedIds).toContain("thread-2");
      expect(connectedIds).toContain("thread-3");
      expect(connectedIds).toHaveLength(3);

      client1.disconnect();
      client2.disconnect();
      client3.disconnect();
    });

    it("times out on missing registration", async () => {
      await server.start();

      const client = new MockAgentClient("thread-never-registers");
      await client.connect(socketPath);
      // Note: not calling client.register()

      await expect(
        server.waitForRegistration("thread-never-registers", 100)
      ).rejects.toThrow(/timeout/i);

      client.disconnect();
    });

    it("times out waiting for non-existent thread", async () => {
      await server.start();

      await expect(
        server.waitForRegistration("non-existent-thread", 100)
      ).rejects.toThrow(/timeout/i);
    });
  });

  describe("message routing", () => {
    it("routes messages by threadId", async () => {
      await server.start();

      const client1 = new MockAgentClient("thread-a");
      const client2 = new MockAgentClient("thread-b");

      await Promise.all([
        client1.connect(socketPath),
        client2.connect(socketPath),
      ]);

      client1.register();
      client2.register();

      await Promise.all([
        server.waitForRegistration("thread-a", 1000),
        server.waitForRegistration("thread-b", 1000),
      ]);

      // Send state from client 1
      client1.sendState({ status: "running", data: "from-a" });

      // Send state from client 2
      client2.sendState({ status: "complete", data: "from-b" });

      // Wait for messages to be received
      await new Promise((resolve) => setTimeout(resolve, 100));

      const messagesA = server.getMessagesForThread("thread-a");
      const messagesB = server.getMessagesForThread("thread-b");

      expect(messagesA.some((m) => m.type === "state")).toBe(true);
      expect(messagesB.some((m) => m.type === "state")).toBe(true);

      // Verify messages are correctly attributed
      const stateA = messagesA.find((m) => m.type === "state");
      const stateB = messagesB.find((m) => m.type === "state");

      expect((stateA as any)?.state?.data).toBe("from-a");
      expect((stateB as any)?.state?.data).toBe("from-b");

      client1.disconnect();
      client2.disconnect();
    });

    it("collects all messages", async () => {
      await server.start();

      const client = new MockAgentClient("thread-collect");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-collect", 1000);

      client.sendState({ status: "running" });
      client.sendEvent("tool:start", { tool: "Bash" });
      client.sendState({ status: "complete" });
      client.sendEvent("tool:end", { tool: "Bash" });

      // Wait for messages
      await new Promise((resolve) => setTimeout(resolve, 100));

      const allMessages = server.getMessages();
      expect(allMessages.length).toBeGreaterThanOrEqual(5); // register + 2 states + 2 events

      const threadMessages = server.getMessagesForThread("thread-collect");
      expect(threadMessages.length).toBeGreaterThanOrEqual(5);

      client.disconnect();
    });
  });

  describe("sending messages to agents", () => {
    it("sendCancel sends cancel message to agent", async () => {
      await server.start();

      const client = new MockAgentClient("thread-cancel");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-cancel", 1000);

      const cancelReceived = client.waitForMessage(
        (msg) => msg.type === "cancel",
        1000
      );

      server.sendCancel("thread-cancel");

      const msg = await cancelReceived;
      expect(msg.type).toBe("cancel");

      client.disconnect();
    });

    it("sendPermissionResponse sends permission response to agent", async () => {
      await server.start();

      const client = new MockAgentClient("thread-permission");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-permission", 1000);

      const permissionReceived = client.waitForMessage(
        (msg) => msg.type === "permission_response",
        1000
      );

      server.sendPermissionResponse("thread-permission", true, "req-123");

      const msg = await permissionReceived;
      expect(msg.type).toBe("permission_response");
      expect((msg as any).payload.decision).toBe("allow");
      expect((msg as any).payload.requestId).toBe("req-123");

      client.disconnect();
    });

    it("sendPermissionResponse sends deny response", async () => {
      await server.start();

      const client = new MockAgentClient("thread-deny");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-deny", 1000);

      const permissionReceived = client.waitForMessage(
        (msg) => msg.type === "permission_response",
        1000
      );

      server.sendPermissionResponse("thread-deny", false, "req-456");

      const msg = await permissionReceived;
      expect(msg.type).toBe("permission_response");
      expect((msg as any).payload.decision).toBe("deny");

      client.disconnect();
    });

    it("sendQueuedMessage sends queued message to agent", async () => {
      await server.start();

      const client = new MockAgentClient("thread-queued");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-queued", 1000);

      const queuedReceived = client.waitForMessage(
        (msg) => msg.type === "queued_message",
        1000
      );

      server.sendQueuedMessage("thread-queued", "Continue with the task");

      const msg = await queuedReceived;
      expect(msg.type).toBe("queued_message");
      expect((msg as any).payload.content).toBe("Continue with the task");

      client.disconnect();
    });

    it("sendToAgent sends message to specific agent", async () => {
      await server.start();

      const client = new MockAgentClient("thread-arbitrary");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-arbitrary", 1000);

      const queuedReceived = client.waitForMessage(
        (msg) => msg.type === "queued_message",
        1000
      );

      // Use a valid TauriToAgentMessage type
      server.sendToAgent("thread-arbitrary", {
        type: "queued_message",
        payload: { content: "test content via sendToAgent" },
      });

      const msg = await queuedReceived;
      expect(msg.type).toBe("queued_message");
      expect((msg as any).payload.content).toBe("test content via sendToAgent");

      client.disconnect();
    });

    it("throws when sending to non-existent thread", async () => {
      await server.start();

      expect(() => server.sendCancel("non-existent")).toThrow();
    });
  });

  describe("waitForMessage", () => {
    it("resolves when matching message is received", async () => {
      await server.start();

      const client = new MockAgentClient("thread-wait");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-wait", 1000);

      const messagePromise = server.waitForMessage(
        (msg) => msg.type === "event" && (msg as any).name === "test:event",
        1000
      );

      // Send the event after a short delay
      setTimeout(() => {
        client.sendEvent("test:event", { value: 42 });
      }, 50);

      const msg = await messagePromise;
      expect(msg.type).toBe("event");
      expect((msg as any).name).toBe("test:event");
      expect((msg as any).payload.value).toBe(42);

      client.disconnect();
    });

    it("resolves immediately if matching message already exists", async () => {
      await server.start();

      const client = new MockAgentClient("thread-exists");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-exists", 1000);

      // Send event first
      client.sendState({ status: "running" });

      // Wait for it to be received
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Now wait for it - should resolve immediately
      const msg = await server.waitForMessage(
        (msg) => msg.type === "state",
        100
      );

      expect(msg.type).toBe("state");

      client.disconnect();
    });

    it("times out if matching message is not received", async () => {
      await server.start();

      const client = new MockAgentClient("thread-timeout");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-timeout", 1000);

      await expect(
        server.waitForMessage(
          (msg) => msg.type === "never_sent",
          100
        )
      ).rejects.toThrow(/timeout/i);

      client.disconnect();
    });

    it("can filter by threadId", async () => {
      await server.start();

      const client1 = new MockAgentClient("thread-filter-1");
      const client2 = new MockAgentClient("thread-filter-2");

      await Promise.all([
        client1.connect(socketPath),
        client2.connect(socketPath),
      ]);

      client1.register();
      client2.register();

      await Promise.all([
        server.waitForRegistration("thread-filter-1", 1000),
        server.waitForRegistration("thread-filter-2", 1000),
      ]);

      // Wait for event from thread-2 specifically
      const messagePromise = server.waitForMessage(
        (msg) =>
          msg.threadId === "thread-filter-2" &&
          msg.type === "event" &&
          (msg as any).name === "specific:event",
        1000
      );

      // Send from thread-1 first (should not match)
      client1.sendEvent("specific:event", { from: "thread-1" });

      // Then send from thread-2 (should match)
      setTimeout(() => {
        client2.sendEvent("specific:event", { from: "thread-2" });
      }, 50);

      const msg = await messagePromise;
      expect(msg.threadId).toBe("thread-filter-2");
      expect((msg as any).payload.from).toBe("thread-2");

      client1.disconnect();
      client2.disconnect();
    });
  });

  describe("message receiving", () => {
    it("receives register messages with parentId", async () => {
      await server.start();

      const childClient = new MockAgentClient("child-thread", "parent-thread");
      await childClient.connect(socketPath);
      childClient.register();

      await server.waitForRegistration("child-thread", 1000);

      const registerMsg = server
        .getMessagesForThread("child-thread")
        .find((m) => m.type === "register");

      expect(registerMsg).toBeDefined();
      expect((registerMsg as any).parentId).toBe("parent-thread");

      childClient.disconnect();
    });

    it("receives state messages", async () => {
      await server.start();

      const client = new MockAgentClient("thread-state");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-state", 1000);

      client.sendState({
        status: "running",
        messages: [],
        toolStates: { "tool-1": { status: "pending" } },
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const stateMsg = server
        .getMessagesForThread("thread-state")
        .find((m) => m.type === "state");

      expect(stateMsg).toBeDefined();
      expect((stateMsg as any).state.status).toBe("running");
      expect((stateMsg as any).state.toolStates["tool-1"].status).toBe("pending");

      client.disconnect();
    });

    it("receives event messages", async () => {
      await server.start();

      const client = new MockAgentClient("thread-event");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-event", 1000);

      client.sendEvent("thread:created", {
        threadId: "thread-event",
        repoId: "repo-123",
      });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const eventMsg = server
        .getMessagesForThread("thread-event")
        .find((m) => m.type === "event" && (m as any).name === "thread:created");

      expect(eventMsg).toBeDefined();
      expect((eventMsg as any).payload.threadId).toBe("thread-event");
      expect((eventMsg as any).payload.repoId).toBe("repo-123");

      client.disconnect();
    });
  });

  describe("edge cases", () => {
    it("handles malformed JSON gracefully", async () => {
      await server.start();

      const socket = connect(socketPath);

      await new Promise<void>((resolve) => {
        socket.once("connect", () => {
          // Send malformed JSON
          socket.write("{ invalid json }\n");
          socket.write('{"type": "register", "threadId": "malformed-test", "senderId": "malformed-test"}\n');
          resolve();
        });
      });

      // Server should still work
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The valid message should have been processed
      expect(server.getConnectedThreadIds()).toContain("malformed-test");

      socket.destroy();
    });

    it("handles rapid message sending", async () => {
      await server.start();

      const client = new MockAgentClient("thread-rapid");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-rapid", 1000);

      // Send many messages rapidly
      for (let i = 0; i < 100; i++) {
        client.sendEvent(`event:${i}`, { index: i });
      }

      // Wait for all messages to be processed
      await new Promise((resolve) => setTimeout(resolve, 500));

      const messages = server.getMessagesForThread("thread-rapid");
      const eventMessages = messages.filter((m) => m.type === "event");

      expect(eventMessages.length).toBe(100);

      client.disconnect();
    });

    it("handles reconnection after disconnect", async () => {
      await server.start();

      const client = new MockAgentClient("thread-reconnect");
      await client.connect(socketPath);
      client.register();

      await server.waitForRegistration("thread-reconnect", 1000);
      expect(server.getConnectedThreadIds()).toContain("thread-reconnect");

      client.disconnect();

      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(server.getConnectedThreadIds()).not.toContain("thread-reconnect");

      // Clear messages so waitForRegistration looks for new registration
      server.clearMessages();

      // Reconnect with same threadId
      const client2 = new MockAgentClient("thread-reconnect");
      await client2.connect(socketPath);
      client2.register();

      await server.waitForRegistration("thread-reconnect", 1000);
      expect(server.getConnectedThreadIds()).toContain("thread-reconnect");

      client2.disconnect();
    });
  });
});
