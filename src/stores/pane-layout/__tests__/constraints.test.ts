// @vitest-environment node
import { describe, it, expect } from "vitest";
import { canSplitHorizontal, canSplitVertical } from "../constraints";
import type { SplitNode } from "@core/types/pane-layout.js";

const leaf = (groupId: string): SplitNode => ({ type: "leaf", groupId });
const split = (
  direction: "horizontal" | "vertical",
  children: SplitNode[],
): SplitNode => ({
  type: "split",
  direction,
  children,
  sizes: children.map(() => 100 / children.length),
});

describe("canSplitHorizontal", () => {
  it("allows splitting a root leaf", () => {
    expect(canSplitHorizontal(leaf("g1"), "g1")).toBe(true);
  });

  it("allows splitting when parent has fewer than 4 horizontal children", () => {
    const tree = split("horizontal", [leaf("g1"), leaf("g2"), leaf("g3")]);
    expect(canSplitHorizontal(tree, "g2")).toBe(true);
  });

  it("disallows splitting when parent already has 4 horizontal children", () => {
    const tree = split("horizontal", [leaf("g1"), leaf("g2"), leaf("g3"), leaf("g4")]);
    expect(canSplitHorizontal(tree, "g2")).toBe(false);
  });

  it("allows horizontal split in a vertical parent (creates nested split)", () => {
    const tree = split("vertical", [leaf("g1"), leaf("g2"), leaf("g3")]);
    expect(canSplitHorizontal(tree, "g2")).toBe(true);
  });

  it("returns false for non-existent group", () => {
    expect(canSplitHorizontal(leaf("g1"), "missing")).toBe(false);
  });
});

describe("canSplitVertical", () => {
  it("allows splitting a root leaf", () => {
    expect(canSplitVertical(leaf("g1"), "g1")).toBe(true);
  });

  it("allows splitting when parent has fewer than 3 vertical children", () => {
    const tree = split("vertical", [leaf("g1"), leaf("g2")]);
    expect(canSplitVertical(tree, "g1")).toBe(true);
  });

  it("disallows splitting when parent already has 3 vertical children", () => {
    const tree = split("vertical", [leaf("g1"), leaf("g2"), leaf("g3")]);
    expect(canSplitVertical(tree, "g2")).toBe(false);
  });

  it("allows vertical split in a horizontal parent (creates nested split)", () => {
    const tree = split("horizontal", [leaf("g1"), leaf("g2"), leaf("g3"), leaf("g4")]);
    expect(canSplitVertical(tree, "g2")).toBe(true);
  });
});
