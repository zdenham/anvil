import { describe, it, expect, vi, beforeEach } from "vitest";

// We need a mock that works with `new WebSocket(url)`.
// Create a class-based mock that captures the instance.
let latestWs: any;

vi.mock("ws", async () => {
  const { EventEmitter } = await import("events");
  class MockWebSocket extends EventEmitter {
    static OPEN = 1;
    static CLOSED = 3;
    send = vi.fn();
    close = vi.fn();
    terminate = vi.fn();
    readyState = 1;
    removeListener = vi.fn(function (this: any, event: string, fn: (...args: any[]) => void) {
      EventEmitter.prototype.removeListener.call(this, event, fn);
      return this;
    });

    constructor(_url: string) {
      super();
      latestWs = this;
    }
  }
  return { default: MockWebSocket };
});

// Import after mock
import { HubConnection } from "./connection.js";

describe("HubConnection", () => {
  let connection: HubConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    connection = new HubConnection();
  });

  describe("connect", () => {
    it("resolves on successful connection", async () => {
      const connectPromise = connection.connect("ws://127.0.0.1:9600/ws/agent");
      latestWs.emit("open");
      await expect(connectPromise).resolves.toBeUndefined();
    });

    it("rejects on connection error", async () => {
      const connectPromise = connection.connect("ws://127.0.0.1:9600/ws/agent");
      latestWs.emit("error", new Error("ECONNREFUSED"));
      await expect(connectPromise).rejects.toThrow("ECONNREFUSED");
    });
  });

  describe("message parsing", () => {
    it("parses JSON messages", async () => {
      const messageHandler = vi.fn();
      connection.on("message", messageHandler);

      const connectPromise = connection.connect("ws://127.0.0.1:9600/ws/agent");
      latestWs.emit("open");
      await connectPromise;

      latestWs.emit("message", Buffer.from('{"type":"test","senderId":"a","threadId":"b"}'));

      expect(messageHandler).toHaveBeenCalledWith({
        type: "test",
        senderId: "a",
        threadId: "b",
      });
    });

    it("skips invalid JSON", async () => {
      const messageHandler = vi.fn();
      connection.on("message", messageHandler);

      const connectPromise = connection.connect("ws://127.0.0.1:9600/ws/agent");
      latestWs.emit("open");
      await connectPromise;

      latestWs.emit("message", Buffer.from("not-json"));
      expect(messageHandler).not.toHaveBeenCalled();

      latestWs.emit("message", Buffer.from('{"type":"valid","senderId":"a","threadId":"b"}'));
      expect(messageHandler).toHaveBeenCalledTimes(1);
    });
  });

  describe("write", () => {
    it("sends JSON via WebSocket", async () => {
      const connectPromise = connection.connect("ws://127.0.0.1:9600/ws/agent");
      latestWs.emit("open");
      await connectPromise;

      connection.write({ type: "test", senderId: "a", threadId: "b" });

      expect(latestWs.send).toHaveBeenCalledWith('{"type":"test","senderId":"a","threadId":"b"}');
    });

    it("returns false when WebSocket is not open", async () => {
      const connectPromise = connection.connect("ws://127.0.0.1:9600/ws/agent");
      latestWs.emit("open");
      await connectPromise;

      latestWs.readyState = 3; // CLOSED
      const result = connection.write({ type: "test", senderId: "a", threadId: "b" });

      expect(result).toBe(false);
      expect(latestWs.send).not.toHaveBeenCalled();
    });
  });

  describe("isConnected", () => {
    it("returns true when WebSocket is open", async () => {
      const connectPromise = connection.connect("ws://127.0.0.1:9600/ws/agent");
      latestWs.emit("open");
      await connectPromise;

      expect(connection.isConnected).toBe(true);
    });

    it("returns false when WebSocket is closed", async () => {
      const connectPromise = connection.connect("ws://127.0.0.1:9600/ws/agent");
      latestWs.emit("open");
      await connectPromise;

      latestWs.readyState = 3;
      expect(connection.isConnected).toBe(false);
    });
  });

  describe("destroy", () => {
    it("terminates the WebSocket", async () => {
      const connectPromise = connection.connect("ws://127.0.0.1:9600/ws/agent");
      latestWs.emit("open");
      await connectPromise;

      connection.destroy();

      expect(latestWs.terminate).toHaveBeenCalled();
      expect(connection.isConnected).toBe(false);
    });
  });
});
