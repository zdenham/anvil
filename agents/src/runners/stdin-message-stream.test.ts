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
  stdout: vi.fn(),
}));

// Mock output module
vi.mock("../output.js", () => ({
  appendUserMessage: vi.fn(),
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

describe("StdinMessageStream uuid handling", () => {
  it("initial prompt has isSynthetic: true and no uuid", async () => {
    const stream = new StdinMessageStream();
    const generator = stream.createStream("Hello, agent!");

    const first = await generator.next();
    expect(first.done).toBe(false);
    expect(first.value.isSynthetic).toBe(true);
    // Initial prompt should not have a uuid (it's not a queued message)
    expect(first.value.uuid).toBeUndefined();

    // Clean up
    stream.close();
  });

  it("formatUserMessage sets uuid field when queuedMessageId is provided", () => {
    const stream = new StdinMessageStream();
    const testUuid = "550e8400-e29b-41d4-a716-446655440000";

    // Access formatUserMessage via type assertion since it's private
    const formatted = (stream as unknown as {
      formatUserMessage: (content: string, isSynthetic: boolean, queuedMessageId?: string) => {
        uuid?: string;
        isSynthetic: boolean;
        message: { content: string };
      };
    }).formatUserMessage(
      "Test content",
      false,
      testUuid
    );

    expect(formatted.uuid).toBe(testUuid);
    expect(formatted.isSynthetic).toBe(false);
    expect(formatted.message.content).toBe("Test content");

    stream.close();
  });

  it("formatUserMessage leaves uuid undefined when queuedMessageId is not provided", () => {
    const stream = new StdinMessageStream();

    const formatted = (stream as unknown as {
      formatUserMessage: (content: string, isSynthetic: boolean, queuedMessageId?: string) => {
        uuid?: string;
        isSynthetic: boolean;
        message: { content: string };
      };
    }).formatUserMessage(
      "Content",
      true
      // no queuedMessageId
    );

    expect(formatted.uuid).toBeUndefined();
    expect(formatted.isSynthetic).toBe(true);

    stream.close();
  });

  it("formatUserMessage sets isSynthetic correctly for non-queued messages", () => {
    const stream = new StdinMessageStream();

    // Synthetic (initial prompt)
    const synthetic = (stream as unknown as {
      formatUserMessage: (content: string, isSynthetic: boolean, queuedMessageId?: string) => {
        uuid?: string;
        isSynthetic: boolean;
      };
    }).formatUserMessage("Initial", true);
    expect(synthetic.isSynthetic).toBe(true);

    // Non-synthetic (queued message)
    const nonSynthetic = (stream as unknown as {
      formatUserMessage: (content: string, isSynthetic: boolean, queuedMessageId?: string) => {
        uuid?: string;
        isSynthetic: boolean;
      };
    }).formatUserMessage("Follow-up", false, "test-uuid");
    expect(nonSynthetic.isSynthetic).toBe(false);

    stream.close();
  });

  it("formatted message includes all required SDKUserMessage fields", () => {
    const stream = new StdinMessageStream();
    stream.setSessionId("test-session-123");

    const formatted = (stream as unknown as {
      formatUserMessage: (content: string, isSynthetic: boolean, queuedMessageId?: string) => {
        type: string;
        message: { role: string; content: string };
        parent_tool_use_id: null;
        session_id: string;
        isSynthetic: boolean;
        uuid?: string;
      };
    }).formatUserMessage("Test", false, "my-uuid");

    expect(formatted.type).toBe("user");
    expect(formatted.message.role).toBe("user");
    expect(formatted.message.content).toBe("Test");
    expect(formatted.parent_tool_use_id).toBeNull();
    expect(formatted.session_id).toBe("test-session-123");
    expect(formatted.isSynthetic).toBe(false);
    expect(formatted.uuid).toBe("my-uuid");

    stream.close();
  });
});
