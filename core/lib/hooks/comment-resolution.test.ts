import { describe, it, expect } from "vitest";
import { parseCommentResolution } from "./comment-resolution.js";

describe("parseCommentResolution", () => {
  it("returns null for non-mort commands", () => {
    expect(parseCommentResolution("ls -la")).toBeNull();
    expect(parseCommentResolution("echo hello")).toBeNull();
  });

  it("parses single ID", () => {
    const result = parseCommentResolution('mort-resolve-comment "abc123"');
    expect(result).toEqual({ ids: ["abc123"] });
  });

  it("parses comma-separated IDs", () => {
    const result = parseCommentResolution('mort-resolve-comment "a,b,c"');
    expect(result).toEqual({ ids: ["a", "b", "c"] });
  });

  it("trims whitespace from IDs", () => {
    const result = parseCommentResolution('mort-resolve-comment "a, b , c"');
    expect(result).toEqual({ ids: ["a", "b", "c"] });
  });

  it("returns null for mort-resolve-comment with no args", () => {
    expect(parseCommentResolution("mort-resolve-comment")).toBeNull();
  });

  it("handles leading whitespace", () => {
    const result = parseCommentResolution('  mort-resolve-comment "x"');
    expect(result).toEqual({ ids: ["x"] });
  });
});
