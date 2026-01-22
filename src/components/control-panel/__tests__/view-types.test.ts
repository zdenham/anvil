/**
 * ControlPanelViewType Tests
 *
 * Tests for the ControlPanelViewType discriminated union.
 * Note: Tab state is managed locally in components, not in the routing type.
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

  it("should support inbox view", () => {
    const inboxView: ControlPanelViewType = {
      type: "inbox",
    };
    expect(inboxView.type).toBe("inbox");
  });

  it("should discriminate between thread, plan, and inbox views", () => {
    const view: ControlPanelViewType = {
      type: "plan",
      planId: "test-id",
    };

    if (view.type === "plan") {
      // TypeScript should know this is a plan view
      expect(view.planId).toBe("test-id");
    } else if (view.type === "inbox") {
      // TypeScript should know this is an inbox view
      expect(view.type).toBe("inbox");
    } else {
      // TypeScript should know this is a thread view
      expect(view.threadId).toBeDefined();
    }
  });
});
