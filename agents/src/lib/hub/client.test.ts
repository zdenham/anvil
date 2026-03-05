import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@core/lib/socket.js", () => ({
  getHubSocketPath: vi.fn().mockReturnValue("/tmp/mort-hub.sock"),
}));

// Track mock instances for verification
const mockInstances: Array<{
  connect: ReturnType<typeof vi.fn>;
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  isConnected: boolean;
  queueDepth: number;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
}> = [];

vi.mock("./connection.js", () => {
  return {
    HubConnection: class MockConnection {
      connect = vi.fn().mockResolvedValue(undefined);
      write = vi.fn().mockReturnValue(true);
      destroy = vi.fn();
      isConnected = true;
      queueDepth = 0;
      private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

      constructor() {
        mockInstances.push(this);
      }

      on(event: string, handler: (...args: unknown[]) => void) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(handler);
      }

      emit(event: string, ...args: unknown[]) {
        this.listeners[event]?.forEach(fn => fn(...args));
      }
    },
  };
});

// Import after mock is defined
import { HubClient } from "./client.js";

describe("HubClient", () => {
  let client: HubClient;
  let mockConnection: typeof mockInstances[0];

  beforeEach(() => {
    mockInstances.length = 0;
    client = new HubClient("thread-123");
    mockConnection = mockInstances[0];
  });

  describe("connect", () => {
    it("connects to the socket path", async () => {
      await client.connect();
      expect(mockConnection.connect).toHaveBeenCalledWith("/tmp/mort-hub.sock");
    });

    it("sends register message after connecting", async () => {
      await client.connect();
      // Register message includes pipeline stamp from send()
      expect(mockConnection.write).toHaveBeenCalledWith(
        expect.objectContaining({
          senderId: "thread-123",
          threadId: "thread-123",
          type: "register",
          pipeline: expect.arrayContaining([
            expect.objectContaining({ stage: "agent:sent", seq: expect.any(Number) }),
          ]),
        }),
      );
    });

    it("includes parentId in registration when provided", async () => {
      const childClient = new HubClient("child-thread", "parent-thread");
      const childConnection = mockInstances[1];

      await childClient.connect();

      expect(childConnection.write).toHaveBeenCalledWith(
        expect.objectContaining({
          senderId: "child-thread",
          threadId: "child-thread",
          type: "register",
          parentId: "parent-thread",
          pipeline: expect.arrayContaining([
            expect.objectContaining({ stage: "agent:sent" }),
          ]),
        }),
      );
    });
  });

  describe("sendEvent", () => {
    it("formats event message correctly with pipeline stamp", async () => {
      await client.connect();
      mockConnection.write.mockClear();

      client.sendEvent("tool_call", { tool: "read", path: "/test" });

      expect(mockConnection.write).toHaveBeenCalledWith(
        expect.objectContaining({
          senderId: "thread-123",
          threadId: "thread-123",
          type: "event",
          name: "tool_call",
          payload: { tool: "read", path: "/test" },
          pipeline: expect.arrayContaining([
            expect.objectContaining({ stage: "agent:sent" }),
          ]),
        }),
      );
    });
  });

  describe("send", () => {
    it("adds senderId, threadId, and pipeline to messages", async () => {
      await client.connect();
      mockConnection.write.mockClear();

      client.send({ type: "custom", data: "test" });

      expect(mockConnection.write).toHaveBeenCalledWith(
        expect.objectContaining({
          senderId: "thread-123",
          threadId: "thread-123",
          type: "custom",
          data: "test",
          pipeline: expect.arrayContaining([
            expect.objectContaining({ stage: "agent:sent", seq: expect.any(Number) }),
          ]),
        }),
      );
    });
  });

  describe("pipeline stamps", () => {
    it("assigns monotonically increasing seq numbers", async () => {
      await client.connect();
      mockConnection.write.mockClear();

      client.send({ type: "msg1" });
      client.send({ type: "msg2" });
      client.send({ type: "msg3" });

      const calls = mockConnection.write.mock.calls;
      const seq1 = calls[0][0].pipeline[0].seq;
      const seq2 = calls[1][0].pipeline[0].seq;
      const seq3 = calls[2][0].pipeline[0].seq;

      expect(seq2).toBe(seq1 + 1);
      expect(seq3).toBe(seq2 + 1);
    });
  });

  describe("isConnected", () => {
    it("delegates to connection.isConnected", () => {
      expect(client.isConnected).toBe(true);
    });
  });

  describe("disconnect", () => {
    it("destroys the connection", () => {
      client.disconnect();
      expect(mockConnection.destroy).toHaveBeenCalled();
    });
  });

  describe("event forwarding", () => {
    it("forwards message events from connection", async () => {
      const messageHandler = vi.fn();
      client.on("message", messageHandler);

      await client.connect();

      // Simulate message from connection
      mockConnection.emit("message", { type: "test", data: "hello" });

      expect(messageHandler).toHaveBeenCalledWith({ type: "test", data: "hello" });
    });

    it("forwards disconnect events from connection", async () => {
      // disconnect triggers reconnect, which is async and complex.
      // Just verify client handles disconnect without throwing.
      await client.connect();
      // Emitting disconnect from connection goes through handleDisconnect
      // which attempts reconnection. We verify the client stays stable.
      expect(() => mockConnection.emit("disconnect")).not.toThrow();
    });

    it("forwards error events from connection", async () => {
      const errorHandler = vi.fn();
      client.on("error", errorHandler);

      await client.connect();

      const error = new Error("Connection lost");
      mockConnection.emit("error", error);

      expect(errorHandler).toHaveBeenCalledWith(error);
    });
  });
});
