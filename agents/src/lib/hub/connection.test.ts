import { describe, it, expect, vi, beforeEach } from "vitest";
import { HubConnection } from "./connection.js";
import { EventEmitter } from "events";

// Mock the net module
vi.mock("net", () => ({
  connect: vi.fn(),
}));

describe("HubConnection", () => {
  let connection: HubConnection;
  let mockSocket: EventEmitter & { write: ReturnType<typeof vi.fn>; destroyed: boolean; destroy: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    const { connect } = await import("net");
    mockSocket = Object.assign(new EventEmitter(), {
      write: vi.fn(),
      destroyed: false,
      destroy: vi.fn(),
    });
    vi.mocked(connect).mockReturnValue(mockSocket as any);
    connection = new HubConnection();
  });

  describe("connect", () => {
    it("resolves on successful connection", async () => {
      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await expect(connectPromise).resolves.toBeUndefined();
    });

    it("rejects on connection error", async () => {
      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("error", new Error("ENOENT"));
      await expect(connectPromise).rejects.toThrow("ENOENT");
    });
  });

  describe("message parsing", () => {
    it("parses newline-delimited JSON messages", async () => {
      const messageHandler = vi.fn();
      connection.on("message", messageHandler);

      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      mockSocket.emit("data", Buffer.from('{"type":"test","senderId":"a","threadId":"b"}\n'));

      expect(messageHandler).toHaveBeenCalledWith({
        type: "test",
        senderId: "a",
        threadId: "b",
      });
    });

    it("handles partial messages across multiple data events", async () => {
      const messageHandler = vi.fn();
      connection.on("message", messageHandler);

      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      mockSocket.emit("data", Buffer.from('{"type":"te'));
      mockSocket.emit("data", Buffer.from('st","senderId":"a","threadId":"b"}\n'));

      expect(messageHandler).toHaveBeenCalledTimes(1);
      expect(messageHandler).toHaveBeenCalledWith({
        type: "test",
        senderId: "a",
        threadId: "b",
      });
    });

    it("handles multiple messages in single data event", async () => {
      const messageHandler = vi.fn();
      connection.on("message", messageHandler);

      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      mockSocket.emit("data", Buffer.from(
        '{"type":"first","senderId":"a","threadId":"b"}\n{"type":"second","senderId":"a","threadId":"b"}\n'
      ));

      expect(messageHandler).toHaveBeenCalledTimes(2);
    });

    it("skips invalid JSON lines", async () => {
      const messageHandler = vi.fn();
      connection.on("message", messageHandler);

      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      mockSocket.emit("data", Buffer.from('not-json\n{"type":"valid","senderId":"a","threadId":"b"}\n'));

      expect(messageHandler).toHaveBeenCalledTimes(1);
      expect(messageHandler).toHaveBeenCalledWith({
        type: "valid",
        senderId: "a",
        threadId: "b",
      });
    });
  });

  describe("write", () => {
    it("writes JSON with newline terminator", async () => {
      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      connection.write({ type: "test", senderId: "a", threadId: "b" });

      expect(mockSocket.write).toHaveBeenCalledWith('{"type":"test","senderId":"a","threadId":"b"}\n');
    });

    it("does not write to destroyed socket", async () => {
      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      mockSocket.destroyed = true;
      connection.write({ type: "test", senderId: "a", threadId: "b" });

      expect(mockSocket.write).not.toHaveBeenCalled();
    });
  });

  describe("isConnected", () => {
    it("returns true when socket is connected", async () => {
      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      expect(connection.isConnected).toBe(true);
    });

    it("returns false when socket is destroyed", async () => {
      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      mockSocket.destroyed = true;
      expect(connection.isConnected).toBe(false);
    });
  });

  describe("destroy", () => {
    it("destroys the socket and clears buffer", async () => {
      const connectPromise = connection.connect("/tmp/test.sock");
      mockSocket.emit("connect");
      await connectPromise;

      connection.destroy();

      expect(mockSocket.destroy).toHaveBeenCalled();
      expect(connection.isConnected).toBe(false);
    });
  });
});
