import { describe, it, expect, vi } from "vitest";
import { StdinMessageStream, createStdinMessageStream } from "./stdin-message-stream.js";

// Mock logger
vi.mock("../lib/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("StdinMessageStream", () => {
  describe("constructor", () => {
    it("generates a session ID on construction", () => {
      const stream = new StdinMessageStream();
      expect(stream.getSessionId()).toBeDefined();
      expect(stream.getSessionId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  describe("setSessionId", () => {
    it("allows setting a custom session ID", () => {
      const stream = new StdinMessageStream();
      const originalId = stream.getSessionId();

      stream.setSessionId("custom-session-id");
      expect(stream.getSessionId()).toBe("custom-session-id");
      expect(stream.getSessionId()).not.toBe(originalId);
    });
  });

  describe("createStream", () => {
    it("yields initial prompt first with isSynthetic: true", async () => {
      const stream = new StdinMessageStream();
      const generator = stream.createStream("Hello, agent!");

      const first = await generator.next();
      expect(first.done).toBe(false);
      expect(first.value).toMatchObject({
        type: "user",
        message: { role: "user", content: "Hello, agent!" },
        isSynthetic: true,
        parent_tool_use_id: null,
      });

      // Clean up
      stream.close();
    });

    it("includes session_id in yielded messages", async () => {
      const stream = new StdinMessageStream();
      stream.setSessionId("test-session");
      const generator = stream.createStream("Test");

      const first = await generator.next();
      expect(first.value).toMatchObject({
        session_id: "test-session",
      });

      stream.close();
    });
  });

  describe("close", () => {
    it("resolves pending waitForMessage with null", async () => {
      const stream = new StdinMessageStream();
      const generator = stream.createStream("Test");

      // Get initial prompt
      await generator.next();

      // Start waiting for next message (will block)
      const nextPromise = generator.next();

      // Close the stream
      stream.close();

      // The generator should complete
      const result = await nextPromise;
      expect(result.done).toBe(true);
    });

    it("is idempotent (calling close multiple times does not throw)", async () => {
      const stream = new StdinMessageStream();
      const generator = stream.createStream("Test");

      await generator.next();

      // Call close multiple times - should not throw
      expect(() => {
        stream.close();
        stream.close();
        stream.close();
      }).not.toThrow();
    });

    it("causes generator to complete on subsequent next()", async () => {
      const stream = new StdinMessageStream();
      const generator = stream.createStream("Test");

      await generator.next();
      stream.close();

      const afterClose = await generator.next();
      expect(afterClose.done).toBe(true);
    });
  });
});

describe("createStdinMessageStream", () => {
  it("returns stream and controller", () => {
    const { stream, controller } = createStdinMessageStream("Test prompt");

    expect(stream).toBeDefined();
    expect(controller).toBeInstanceOf(StdinMessageStream);

    // Clean up
    controller.close();
  });

  it("controller can be used to close stream", async () => {
    const { stream, controller } = createStdinMessageStream("Test prompt");

    // Get initial prompt
    await stream.next();

    controller.close();

    // Further iteration should complete
    const result = await stream.next();
    expect(result.done).toBe(true);
  });

  it("passes abort signal to controller", async () => {
    const abortController = new AbortController();
    const { stream, controller } = createStdinMessageStream(
      "Test prompt",
      abortController.signal
    );

    // Get initial prompt
    await stream.next();

    // Start waiting for next
    const nextPromise = stream.next();

    // Abort should trigger close
    abortController.abort();

    // Stream should complete
    const result = await nextPromise;
    expect(result.done).toBe(true);
  });
});
