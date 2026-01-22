import { describe, it, expect, beforeEach } from "vitest";
import {
  getThreadDotColor,
  getPlanDotColor,
  getThreadStatusVariant,
  getPlanStatusVariant,
} from "../thread-colors";
import { createThread, resetAllCounters } from "@/test/factories";

describe("getThreadStatusVariant", () => {
  beforeEach(() => {
    resetAllCounters();
  });

  it("should return 'running' for running threads", () => {
    const thread = createThread({ status: "running" });
    expect(getThreadStatusVariant(thread)).toBe("running");
  });

  it("should return 'unread' for unread non-running threads", () => {
    const thread = createThread({ status: "idle", isRead: false });
    expect(getThreadStatusVariant(thread)).toBe("unread");
  });

  it("should return 'read' for read non-running threads", () => {
    const thread = createThread({ status: "idle", isRead: true });
    expect(getThreadStatusVariant(thread)).toBe("read");
  });

  it("should return 'running' for running thread even if unread", () => {
    const thread = createThread({ status: "running", isRead: false });
    expect(getThreadStatusVariant(thread)).toBe("running");
  });
});

describe("getPlanStatusVariant", () => {
  it("should return 'running' when hasRunningThread is true", () => {
    expect(getPlanStatusVariant(true, true)).toBe("running");
    expect(getPlanStatusVariant(false, true)).toBe("running");
  });

  it("should return 'unread' when not read and no running thread", () => {
    expect(getPlanStatusVariant(false, false)).toBe("unread");
  });

  it("should return 'read' when read and no running thread", () => {
    expect(getPlanStatusVariant(true, false)).toBe("read");
  });
});

describe("getThreadDotColor", () => {
  beforeEach(() => {
    resetAllCounters();
  });

  it("should return CSS class for running threads", () => {
    const thread = createThread({ status: "running" });
    const result = getThreadDotColor(thread);

    expect(result.color).toBe("status-dot-running");
    expect(result.animation).toBeUndefined();
  });

  it("should return blue color without animation for unread non-running threads", () => {
    const thread = createThread({ status: "idle", isRead: false });
    const result = getThreadDotColor(thread);

    expect(result.color).toBe("bg-blue-500");
    expect(result.animation).toBeUndefined();
  });

  it("should return grey without animation for read non-running threads", () => {
    const thread = createThread({ status: "idle", isRead: true });
    const result = getThreadDotColor(thread);

    expect(result.color).toBe("bg-zinc-400");
    expect(result.animation).toBeUndefined();
  });

  it("should return CSS class for running thread even if unread", () => {
    const thread = createThread({ status: "running", isRead: false });
    const result = getThreadDotColor(thread);

    expect(result.color).toBe("status-dot-running");
    expect(result.animation).toBeUndefined();
  });

  it("should return grey for completed read threads", () => {
    const thread = createThread({ status: "completed", isRead: true });
    const result = getThreadDotColor(thread);

    expect(result.color).toBe("bg-zinc-400");
    expect(result.animation).toBeUndefined();
  });

  it("should return blue for error threads that are unread", () => {
    const thread = createThread({ status: "error", isRead: false });
    const result = getThreadDotColor(thread);

    expect(result.color).toBe("bg-blue-500");
    expect(result.animation).toBeUndefined();
  });
});

describe("getPlanDotColor", () => {
  it("should return CSS class when hasRunningThread is true", () => {
    const result = getPlanDotColor(true, true);

    expect(result.color).toBe("status-dot-running");
    expect(result.animation).toBeUndefined();
  });

  it("should return blue color without animation when unread and no running thread", () => {
    const result = getPlanDotColor(false, false);

    expect(result.color).toBe("bg-blue-500");
    expect(result.animation).toBeUndefined();
  });

  it("should return grey without animation when read and no running thread", () => {
    const result = getPlanDotColor(true, false);

    expect(result.color).toBe("bg-zinc-400");
    expect(result.animation).toBeUndefined();
  });

  it("should prioritize running thread over read status", () => {
    // Even if read, should show CSS class if has running thread
    const result = getPlanDotColor(true, true);

    expect(result.color).toBe("status-dot-running");
    expect(result.animation).toBeUndefined();
  });

  it("should prioritize running thread over unread status", () => {
    // Even if unread, should show CSS class if has running thread
    const result = getPlanDotColor(false, true);

    expect(result.color).toBe("status-dot-running");
    expect(result.animation).toBeUndefined();
  });
});
