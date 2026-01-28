import { describe, it, expect } from "vitest";
import { EventName } from "../events";

describe("event system", () => {
  it("includes WORKTREE_NAME_GENERATED event", () => {
    expect(EventName.WORKTREE_NAME_GENERATED).toBe("worktree:name:generated");
  });

  it("includes THREAD_NAME_GENERATED event", () => {
    expect(EventName.THREAD_NAME_GENERATED).toBe("thread:name:generated");
  });

  it("includes all expected worktree-related events", () => {
    expect(EventName.WORKTREE_ALLOCATED).toBe("worktree:allocated");
    expect(EventName.WORKTREE_RELEASED).toBe("worktree:released");
    expect(EventName.WORKTREE_NAME_GENERATED).toBe("worktree:name:generated");
  });
});
