import { describe, it, expect } from "vitest";
import { shouldDenyTool, DISALLOWED_TOOLS } from "./tool-deny.js";

describe("shouldDenyTool", () => {
  it("denies disallowed tools", () => {
    for (const tool of DISALLOWED_TOOLS) {
      const result = shouldDenyTool(tool);
      expect(result.denied).toBe(true);
    }
  });

  it("allows normal tools", () => {
    expect(shouldDenyTool("Bash")).toEqual({ denied: false });
    expect(shouldDenyTool("Read")).toEqual({ denied: false });
    expect(shouldDenyTool("Write")).toEqual({ denied: false });
    expect(shouldDenyTool("Edit")).toEqual({ denied: false });
  });

  it("includes reason when denied", () => {
    const result = shouldDenyTool("EnterWorktree");
    if (result.denied) {
      expect(result.reason).toContain("EnterWorktree");
    }
  });
});
