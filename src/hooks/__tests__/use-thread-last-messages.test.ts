import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useThreadLastMessages } from "../use-thread-last-messages";
import {
  createThread,
  createThreadTurn,
  resetAllCounters,
} from "@/test/factories";

describe("useThreadLastMessages", () => {
  beforeEach(() => {
    resetAllCounters();
  });

  it("should return a record keyed by thread ID", () => {
    const thread1 = createThread({
      id: "thread-abc",
      turns: [createThreadTurn({ prompt: "First message" })],
    });
    const thread2 = createThread({
      id: "thread-xyz",
      turns: [createThreadTurn({ prompt: "Second message" })],
    });

    const { result } = renderHook(() =>
      useThreadLastMessages([thread1, thread2])
    );

    expect(result.current).toHaveProperty("thread-abc");
    expect(result.current).toHaveProperty("thread-xyz");
  });

  it("should return last user message for each thread", () => {
    const thread = createThread({
      turns: [
        createThreadTurn({ index: 0, prompt: "First prompt" }),
        createThreadTurn({ index: 1, prompt: "Second prompt" }),
        createThreadTurn({ index: 2, prompt: "Last prompt" }),
      ],
    });

    const { result } = renderHook(() => useThreadLastMessages([thread]));

    expect(result.current[thread.id]).toBe("Last prompt");
  });

  it("should return empty object when threads array is empty", () => {
    const { result } = renderHook(() => useThreadLastMessages([]));

    expect(result.current).toEqual({});
  });

  it("should update when threads array changes", () => {
    const thread1 = createThread({
      id: "thread-1",
      turns: [createThreadTurn({ prompt: "Message 1" })],
    });
    const thread2 = createThread({
      id: "thread-2",
      turns: [createThreadTurn({ prompt: "Message 2" })],
    });

    const { result, rerender } = renderHook(
      (props: { threads: typeof thread1[] }) =>
        useThreadLastMessages(props.threads),
      { initialProps: { threads: [thread1] } }
    );

    expect(Object.keys(result.current)).toHaveLength(1);
    expect(result.current["thread-1"]).toBe("Message 1");

    rerender({ threads: [thread1, thread2] });

    expect(Object.keys(result.current)).toHaveLength(2);
    expect(result.current["thread-1"]).toBe("Message 1");
    expect(result.current["thread-2"]).toBe("Message 2");
  });

  it("should fallback to truncated ID when no turns exist", () => {
    const thread = createThread({
      id: "12345678-abcd-efgh-ijkl-mnopqrstuvwx",
      turns: [],
    });

    const { result } = renderHook(() => useThreadLastMessages([thread]));

    expect(result.current[thread.id]).toBe("12345678");
  });

  it("should fallback to truncated ID when turn has no prompt", () => {
    const thread = createThread({
      id: "abcdefgh-1234-5678-ijkl-mnopqrstuvwx",
      turns: [{ index: 0, prompt: "", startedAt: Date.now(), completedAt: null }],
    });

    const { result } = renderHook(() => useThreadLastMessages([thread]));

    // Empty string is falsy, so falls back to truncated ID
    expect(result.current[thread.id]).toBe("abcdefgh");
  });

  it("should truncate long messages", () => {
    const longMessage = "A".repeat(150); // Longer than 100 chars
    const thread = createThread({
      turns: [createThreadTurn({ prompt: longMessage })],
    });

    const { result } = renderHook(() => useThreadLastMessages([thread]));

    expect(result.current[thread.id].length).toBe(103); // 100 chars + "..."
    expect(result.current[thread.id]).toMatch(/\.\.\.$/);
  });

  it("should not truncate messages under 100 chars", () => {
    const shortMessage = "A".repeat(50);
    const thread = createThread({
      turns: [createThreadTurn({ prompt: shortMessage })],
    });

    const { result } = renderHook(() => useThreadLastMessages([thread]));

    expect(result.current[thread.id]).toBe(shortMessage);
    expect(result.current[thread.id].length).toBe(50);
  });
});
