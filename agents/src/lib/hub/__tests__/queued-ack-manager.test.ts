import { describe, it, expect, beforeEach, vi } from "vitest";
import { QueuedAckManager } from "../queued-ack-manager.js";

// Mock the logger
vi.mock("../../logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("QueuedAckManager", () => {
  let emitEvent: ReturnType<typeof vi.fn>;
  let moveMessageToEnd: ReturnType<typeof vi.fn>;
  let manager: QueuedAckManager;

  beforeEach(() => {
    emitEvent = vi.fn();
    moveMessageToEnd = vi.fn().mockResolvedValue(undefined);
    manager = new QueuedAckManager(emitEvent, moveMessageToEnd);
  });

  it("emits ack after 2 assistant turns", async () => {
    manager.register("msg-1");
    await manager.onAssistantTurn(); // turn 1
    expect(emitEvent).not.toHaveBeenCalled();

    await manager.onAssistantTurn(); // turn 2 → ack
    expect(emitEvent).toHaveBeenCalledWith(
      "queued-message:ack",
      { messageId: "msg-1" },
      "QueuedAckManager:ack",
    );
  });

  it("emits nack on drainNacks after only 1 turn", async () => {
    manager.register("msg-1");
    await manager.onAssistantTurn(); // turn 1

    manager.drainNacks();
    expect(emitEvent).toHaveBeenCalledWith(
      "queued-message:nack",
      { messageId: "msg-1" },
      "QueuedAckManager:nack",
    );
  });

  it("tracks multiple messages independently", async () => {
    manager.register("msg-1");
    await manager.onAssistantTurn(); // msg-1: 1 turn

    manager.register("msg-2");
    await manager.onAssistantTurn(); // msg-1: 2 turns (ack), msg-2: 1 turn

    expect(emitEvent).toHaveBeenCalledWith(
      "queued-message:ack",
      { messageId: "msg-1" },
      "QueuedAckManager:ack",
    );
    expect(emitEvent).not.toHaveBeenCalledWith(
      "queued-message:ack",
      { messageId: "msg-2" },
      expect.anything(),
    );

    await manager.onAssistantTurn(); // msg-2: 2 turns (ack)
    expect(emitEvent).toHaveBeenCalledWith(
      "queued-message:ack",
      { messageId: "msg-2" },
      "QueuedAckManager:ack",
    );
  });

  it("drainNacks with empty map emits no events", () => {
    manager.drainNacks();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it("size reflects pending count accurately", async () => {
    expect(manager.size).toBe(0);

    manager.register("msg-1");
    expect(manager.size).toBe(1);

    await manager.onAssistantTurn(); // msg-1: 1 turn

    manager.register("msg-2");
    expect(manager.size).toBe(2);

    // 2nd turn: msg-1 reaches 2 (acked), msg-2 reaches 1
    await manager.onAssistantTurn();
    expect(manager.size).toBe(1); // msg-2 still pending

    manager.drainNacks();
    expect(manager.size).toBe(0);
  });

  it("drainNacks clears all pending after nacking", () => {
    manager.register("msg-1");
    manager.register("msg-2");
    manager.drainNacks();

    expect(emitEvent).toHaveBeenCalledTimes(2);
    expect(manager.size).toBe(0);
  });
});
