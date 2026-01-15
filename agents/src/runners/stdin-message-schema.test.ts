import { describe, it, expect } from "vitest";
import { StdinMessageSchema, parseStdinMessage } from "./stdin-message-schema.js";

describe("StdinMessageSchema", () => {
  it("validates a valid queued_message", () => {
    const msg = {
      type: "queued_message",
      id: "550e8400-e29b-41d4-a716-446655440000",
      content: "Hello, agent!",
      timestamp: 1700000000000,
    };

    const result = StdinMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
  });

  it("rejects messages with wrong type", () => {
    const msg = {
      type: "other_message",
      id: "550e8400-e29b-41d4-a716-446655440000",
      content: "Hello",
      timestamp: 1700000000000,
    };

    const result = StdinMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it("rejects messages with invalid UUID", () => {
    const msg = {
      type: "queued_message",
      id: "not-a-uuid",
      content: "Hello",
      timestamp: 1700000000000,
    };

    const result = StdinMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it("rejects messages with empty content", () => {
    const msg = {
      type: "queued_message",
      id: "550e8400-e29b-41d4-a716-446655440000",
      content: "",
      timestamp: 1700000000000,
    };

    const result = StdinMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });

  it("rejects messages with missing fields", () => {
    const msg = {
      type: "queued_message",
      id: "550e8400-e29b-41d4-a716-446655440000",
      // missing content and timestamp
    };

    const result = StdinMessageSchema.safeParse(msg);
    expect(result.success).toBe(false);
  });
});

describe("parseStdinMessage", () => {
  it("parses valid JSON line", () => {
    const line = JSON.stringify({
      type: "queued_message",
      id: "550e8400-e29b-41d4-a716-446655440000",
      content: "Test message",
      timestamp: 1700000000000,
    });

    const result = parseStdinMessage(line);
    expect(result).not.toBeNull();
    expect(result?.content).toBe("Test message");
    expect(result?.id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns null for invalid JSON", () => {
    const result = parseStdinMessage("not json at all");
    expect(result).toBeNull();
  });

  it("returns null for valid JSON that does not match schema", () => {
    const result = parseStdinMessage(JSON.stringify({ foo: "bar" }));
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = parseStdinMessage("");
    expect(result).toBeNull();
  });

  it("returns null for JSON with wrong message type", () => {
    const line = JSON.stringify({
      type: "other_type",
      id: "550e8400-e29b-41d4-a716-446655440000",
      content: "Test",
      timestamp: 1700000000000,
    });

    const result = parseStdinMessage(line);
    expect(result).toBeNull();
  });
});
