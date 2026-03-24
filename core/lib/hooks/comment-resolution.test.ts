import { describe, it, expect } from "vitest";
import { parseCommentResolution } from "./comment-resolution.js";

describe("parseCommentResolution", () => {
  it("returns null for non-anvil commands", () => {
    expect(parseCommentResolution("ls -la")).toBeNull();
    expect(parseCommentResolution("echo hello")).toBeNull();
  });

  it("parses single ID", () => {
    const result = parseCommentResolution('anvil-resolve-comment "abc123"');
    expect(result).toEqual({ ids: ["abc123"] });
  });

  it("parses comma-separated IDs", () => {
    const result = parseCommentResolution('anvil-resolve-comment "a,b,c"');
    expect(result).toEqual({ ids: ["a", "b", "c"] });
  });

  it("trims whitespace from IDs", () => {
    const result = parseCommentResolution('anvil-resolve-comment "a, b , c"');
    expect(result).toEqual({ ids: ["a", "b", "c"] });
  });

  it("returns null for anvil-resolve-comment with no args", () => {
    expect(parseCommentResolution("anvil-resolve-comment")).toBeNull();
  });

  it("handles leading whitespace", () => {
    const result = parseCommentResolution('  anvil-resolve-comment "x"');
    expect(result).toEqual({ ids: ["x"] });
  });
});
