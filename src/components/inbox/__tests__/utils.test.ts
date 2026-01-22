import { describe, it, expect, beforeEach } from "vitest";
import { getPlanDisplayName, createUnifiedList } from "../utils";
import { createThread, createPlan, resetAllCounters } from "@/test/factories";

describe("getPlanDisplayName", () => {
  beforeEach(() => {
    resetAllCounters();
  });

  it("should return filename without .md extension", () => {
    const plan = createPlan({ relativePath: "my-feature.md" });
    expect(getPlanDisplayName(plan)).toBe("my-feature");
  });

  it("should handle nested paths and return only filename", () => {
    const plan = createPlan({ relativePath: "features/auth/login-flow.md" });
    expect(getPlanDisplayName(plan)).toBe("login-flow");
  });

  it("should preserve filename if no .md extension", () => {
    const plan = createPlan({ relativePath: "README.txt" });
    expect(getPlanDisplayName(plan)).toBe("README.txt");
  });

  it("should handle deeply nested paths", () => {
    const plan = createPlan({ relativePath: "a/b/c/d/deep-plan.md" });
    expect(getPlanDisplayName(plan)).toBe("deep-plan");
  });

  it("should handle path with only filename", () => {
    const plan = createPlan({ relativePath: "simple.md" });
    expect(getPlanDisplayName(plan)).toBe("simple");
  });
});

describe("createUnifiedList", () => {
  beforeEach(() => {
    resetAllCounters();
  });

  it("should combine threads and plans into single array", () => {
    const threads = [createThread()];
    const plans = [createPlan()];
    const messages = { "thread-1": "Hello world" };

    const result = createUnifiedList(threads, plans, messages);

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.type)).toContain("thread");
    expect(result.map((item) => item.type)).toContain("plan");
  });

  it("should sort items by updatedAt descending (most recent first)", () => {
    const oldThread = createThread({ updatedAt: 1000 });
    const newPlan = createPlan({ updatedAt: 3000 });
    const middleThread = createThread({ updatedAt: 2000 });

    const result = createUnifiedList(
      [oldThread, middleThread],
      [newPlan],
      {}
    );

    expect(result[0].sortKey).toBe(3000);
    expect(result[1].sortKey).toBe(2000);
    expect(result[2].sortKey).toBe(1000);
  });

  it("should set displayText to last message for threads", () => {
    const thread = createThread();
    const messages = { "thread-1": "My last message" };

    const result = createUnifiedList([thread], [], messages);

    expect(result[0].displayText).toBe("My last message");
  });

  it("should set displayText to filename for plans", () => {
    const plan = createPlan({ relativePath: "feature/my-plan.md" });

    const result = createUnifiedList([], [plan], {});

    expect(result[0].displayText).toBe("my-plan");
  });

  it("should return empty array when both inputs are empty", () => {
    const result = createUnifiedList([], [], {});
    expect(result).toEqual([]);
  });

  it("should interleave threads and plans based on updatedAt", () => {
    const thread1 = createThread({ updatedAt: 4000 });
    const plan1 = createPlan({ updatedAt: 3000 });
    const thread2 = createThread({ updatedAt: 2000 });
    const plan2 = createPlan({ updatedAt: 1000 });

    const result = createUnifiedList([thread1, thread2], [plan1, plan2], {});

    expect(result[0].type).toBe("thread");
    expect(result[0].sortKey).toBe(4000);
    expect(result[1].type).toBe("plan");
    expect(result[1].sortKey).toBe(3000);
    expect(result[2].type).toBe("thread");
    expect(result[2].sortKey).toBe(2000);
    expect(result[3].type).toBe("plan");
    expect(result[3].sortKey).toBe(1000);
  });

  it("should fallback to truncated thread ID when no message available", () => {
    const thread = createThread({ id: "12345678-abcd-efgh-ijkl-mnopqrstuvwx" });

    const result = createUnifiedList([thread], [], {});

    expect(result[0].displayText).toBe("12345678");
  });
});
