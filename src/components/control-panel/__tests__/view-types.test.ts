/**
 * ControlPanelViewType Tests
 *
 * Tests for the ControlPanelViewType discriminated union.
 * Note: Tab state is managed locally in components, not in the routing type.
 * Note: Inbox view has been moved to a dedicated inbox-list-panel (see plans/inbox-navigation-fix.md)
 */

import { describe, it, expect } from "vitest";
import type { ControlPanelViewType } from "@/entities/events";

describe("ControlPanelViewType", () => {
  it("should support thread view", () => {
    const threadView: ControlPanelViewType = {
      type: "thread",
      threadId: "test-id",
    };
    expect(threadView.type).toBe("thread");
    expect(threadView.threadId).toBe("test-id");
  });

  it("should support plan view", () => {
    const planView: ControlPanelViewType = {
      type: "plan",
      planId: "test-id",
    };
    expect(planView.type).toBe("plan");
    expect(planView.planId).toBe("test-id");
  });

  it("should discriminate between thread and plan views", () => {
    const view: ControlPanelViewType = {
      type: "plan",
      planId: "test-id",
    };

    if (view.type === "plan") {
      // TypeScript should know this is a plan view
      expect(view.planId).toBe("test-id");
    } else {
      // TypeScript should know this is a thread view
      expect(view.threadId).toBeDefined();
    }
  });
});
