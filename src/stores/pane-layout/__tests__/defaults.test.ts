// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createDefaultState, createGroup, createTab, MAX_TABS_PER_GROUP } from "../defaults";
import { PaneLayoutPersistedStateSchema } from "../types";

describe("createDefaultState", () => {
  it("creates a valid state with one group and one tab", () => {
    const state = createDefaultState();
    expect(state.root.type).toBe("leaf");
    expect(Object.keys(state.groups)).toHaveLength(1);

    const group = Object.values(state.groups)[0];
    expect(group.tabs).toHaveLength(1);
    expect(group.tabs[0].view.type).toBe("empty");
    expect(group.activeTabId).toBe(group.tabs[0].id);
    expect(state.activeGroupId).toBe(group.id);
  });

  it("generates unique IDs each time", () => {
    const a = createDefaultState();
    const b = createDefaultState();
    expect(a.activeGroupId).not.toBe(b.activeGroupId);
  });

  it("passes Zod validation", () => {
    const state = createDefaultState();
    const result = PaneLayoutPersistedStateSchema.safeParse(state);
    expect(result.success).toBe(true);
  });
});

describe("createGroup", () => {
  it("creates a group with the given tab as active", () => {
    const tab = createTab({ type: "settings" });
    const group = createGroup(tab);
    expect(group.tabs).toHaveLength(1);
    expect(group.tabs[0]).toBe(tab);
    expect(group.activeTabId).toBe(tab.id);
    expect(group.id).toBeTruthy();
  });
});

describe("createTab", () => {
  it("creates a tab with a UUID and the given view", () => {
    const tab = createTab({ type: "logs" });
    expect(tab.id).toBeTruthy();
    expect(tab.view.type).toBe("logs");
  });
});

describe("MAX_TABS_PER_GROUP", () => {
  it("is 5", () => {
    expect(MAX_TABS_PER_GROUP).toBe(5);
  });
});
