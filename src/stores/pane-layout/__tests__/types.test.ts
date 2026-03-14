// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  SplitNodeSchema,
  TabItemSchema,
  PaneGroupSchema,
  PaneLayoutPersistedStateSchema,
} from "@core/types/pane-layout.js";

describe("Zod schemas", () => {
  describe("TabItemSchema", () => {
    it("validates a valid tab", () => {
      const result = TabItemSchema.safeParse({ id: "t1", view: { type: "empty" } });
      expect(result.success).toBe(true);
    });

    it("validates a thread tab", () => {
      const result = TabItemSchema.safeParse({
        id: "t1",
        view: { type: "thread", threadId: "abc" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing id", () => {
      const result = TabItemSchema.safeParse({ view: { type: "empty" } });
      expect(result.success).toBe(false);
    });

    it("rejects invalid view type", () => {
      const result = TabItemSchema.safeParse({ id: "t1", view: { type: "invalid" } });
      expect(result.success).toBe(false);
    });
  });

  describe("PaneGroupSchema", () => {
    it("validates a group with tabs", () => {
      const result = PaneGroupSchema.safeParse({
        id: "g1",
        tabs: [{ id: "t1", view: { type: "empty" } }],
        activeTabId: "t1",
      });
      expect(result.success).toBe(true);
    });

    it("rejects more than 5 tabs", () => {
      const tabs = Array.from({ length: 6 }, (_, i) => ({
        id: `t${i}`,
        view: { type: "empty" as const },
      }));
      const result = PaneGroupSchema.safeParse({
        id: "g1",
        tabs,
        activeTabId: "t0",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("SplitNodeSchema", () => {
    it("validates a leaf node", () => {
      const result = SplitNodeSchema.safeParse({ type: "leaf", groupId: "g1" });
      expect(result.success).toBe(true);
    });

    it("validates a split node with children", () => {
      const result = SplitNodeSchema.safeParse({
        type: "split",
        direction: "horizontal",
        children: [
          { type: "leaf", groupId: "g1" },
          { type: "leaf", groupId: "g2" },
        ],
        sizes: [50, 50],
      });
      expect(result.success).toBe(true);
    });

    it("validates a nested split tree", () => {
      const result = SplitNodeSchema.safeParse({
        type: "split",
        direction: "vertical",
        children: [
          { type: "leaf", groupId: "g1" },
          {
            type: "split",
            direction: "horizontal",
            children: [
              { type: "leaf", groupId: "g2" },
              { type: "leaf", groupId: "g3" },
            ],
            sizes: [50, 50],
          },
        ],
        sizes: [50, 50],
      });
      expect(result.success).toBe(true);
    });

    it("rejects split with fewer than 2 children", () => {
      const result = SplitNodeSchema.safeParse({
        type: "split",
        direction: "horizontal",
        children: [{ type: "leaf", groupId: "g1" }],
        sizes: [100],
      });
      expect(result.success).toBe(false);
    });
  });

  describe("PaneLayoutPersistedStateSchema", () => {
    it("validates a complete state", () => {
      const result = PaneLayoutPersistedStateSchema.safeParse({
        root: { type: "leaf", groupId: "g1" },
        groups: {
          g1: {
            id: "g1",
            tabs: [{ id: "t1", view: { type: "empty" } }],
            activeTabId: "t1",
          },
        },
        activeGroupId: "g1",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing root", () => {
      const result = PaneLayoutPersistedStateSchema.safeParse({
        groups: {},
        activeGroupId: "g1",
      });
      expect(result.success).toBe(false);
    });
  });
});
