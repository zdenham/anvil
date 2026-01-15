import { describe, it, expect } from "vitest";
import {
  extractDiffFromToolResult,
  generateEditDiff,
  generateWriteDiff,
} from "./diff-extractor";

describe("extractDiffFromToolResult", () => {
  describe("valid Edit tool results", () => {
    it("extracts diff from Edit tool JSON result", () => {
      const result = JSON.stringify({
        filePath: "/src/foo.ts",
        success: true,
        diff: "diff --git a/src/foo.ts...",
      });

      const extracted = extractDiffFromToolResult("Edit", result);

      expect(extracted).toEqual({
        filePath: "/src/foo.ts",
        diff: "diff --git a/src/foo.ts...",
        operation: "modify",
      });
    });

    it("extracts diff from Write tool result", () => {
      const result = JSON.stringify({
        filePath: "/src/new.ts",
        success: true,
        diff: "diff --git...",
        operation: "create",
      });

      const extracted = extractDiffFromToolResult("Write", result);

      expect(extracted?.operation).toBe("create");
    });

    it("uses modify as default operation when not specified", () => {
      const result = JSON.stringify({
        filePath: "/src/foo.ts",
        diff: "diff content",
      });

      const extracted = extractDiffFromToolResult("Edit", result);

      expect(extracted?.operation).toBe("modify");
    });
  });

  describe("invalid inputs", () => {
    it("returns null for non-Edit/Write tools", () => {
      expect(extractDiffFromToolResult("Read", "...")).toBeNull();
      expect(extractDiffFromToolResult("Bash", "...")).toBeNull();
      expect(extractDiffFromToolResult("Glob", "...")).toBeNull();
    });

    it("returns null for undefined result", () => {
      expect(extractDiffFromToolResult("Edit", undefined)).toBeNull();
    });

    it("returns null for empty string result", () => {
      expect(extractDiffFromToolResult("Edit", "")).toBeNull();
    });

    it("returns null for non-JSON result", () => {
      expect(extractDiffFromToolResult("Edit", "not json")).toBeNull();
    });

    it("returns null when diff field missing", () => {
      const result = JSON.stringify({ filePath: "/foo.ts", success: true });
      expect(extractDiffFromToolResult("Edit", result)).toBeNull();
    });

    it("returns null when filePath field missing", () => {
      const result = JSON.stringify({ diff: "...", success: true });
      expect(extractDiffFromToolResult("Edit", result)).toBeNull();
    });

    it("returns null when diff is not a string", () => {
      const result = JSON.stringify({ filePath: "/foo.ts", diff: 123 });
      expect(extractDiffFromToolResult("Edit", result)).toBeNull();
    });

    it("returns null when filePath is not a string", () => {
      const result = JSON.stringify({ filePath: null, diff: "..." });
      expect(extractDiffFromToolResult("Edit", result)).toBeNull();
    });
  });
});

describe("generateEditDiff", () => {
  it("marks replaced lines as deletion + addition", () => {
    const result = generateEditDiff({
      file_path: "/test.txt",
      old_string: "hello world",
      new_string: "hello universe",
    });

    expect(result.filePath).toBe("/test.txt");
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toMatchObject({ type: "deletion", content: "hello world" });
    expect(result.lines[1]).toMatchObject({ type: "addition", content: "hello universe" });
    expect(result.stats).toEqual({ additions: 1, deletions: 1 });
  });

  it("handles multiline edits with additions", () => {
    const result = generateEditDiff({
      file_path: "/test.txt",
      old_string: "line1\nline2",
      new_string: "line1\nline2\nline3",
    });

    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toMatchObject({ type: "unchanged", content: "line1" });
    expect(result.lines[1]).toMatchObject({ type: "unchanged", content: "line2" });
    expect(result.lines[2]).toMatchObject({ type: "addition", content: "line3" });
    expect(result.stats).toEqual({ additions: 1, deletions: 0 });
  });

  it("handles multiline edits with deletions", () => {
    const result = generateEditDiff({
      file_path: "/test.txt",
      old_string: "line1\nline2\nline3",
      new_string: "line1\nline3",
    });

    expect(result.lines).toHaveLength(3);
    expect(result.lines[0]).toMatchObject({ type: "unchanged", content: "line1" });
    expect(result.lines[1]).toMatchObject({ type: "deletion", content: "line2" });
    expect(result.lines[2]).toMatchObject({ type: "unchanged", content: "line3" });
    expect(result.stats).toEqual({ additions: 0, deletions: 1 });
  });

  it("returns empty diff for identical strings", () => {
    const result = generateEditDiff({
      file_path: "/test.txt",
      old_string: "same",
      new_string: "same",
    });

    expect(result.lines).toHaveLength(0);
    expect(result.stats).toEqual({ additions: 0, deletions: 0 });
  });

  it("handles empty old_string (insert at beginning)", () => {
    const result = generateEditDiff({
      file_path: "/test.txt",
      old_string: "",
      new_string: "new content",
    });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ type: "addition", content: "new content" });
    expect(result.stats).toEqual({ additions: 1, deletions: 0 });
  });

  it("handles empty new_string (delete all)", () => {
    const result = generateEditDiff({
      file_path: "/test.txt",
      old_string: "old content",
      new_string: "",
    });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ type: "deletion", content: "old content" });
    expect(result.stats).toEqual({ additions: 0, deletions: 1 });
  });

  it("handles complex multiline changes", () => {
    const result = generateEditDiff({
      file_path: "/test.txt",
      old_string: "function foo() {\n  return 1;\n}",
      new_string: "function foo() {\n  return 2;\n  // comment\n}",
    });

    expect(result.stats.additions).toBe(2); // "return 2;" and "// comment"
    expect(result.stats.deletions).toBe(1); // "return 1;"
  });

  it("preserves line numbers correctly", () => {
    const result = generateEditDiff({
      file_path: "/test.txt",
      old_string: "a\nb\nc",
      new_string: "a\nx\nc",
    });

    expect(result.lines[0]).toMatchObject({
      type: "unchanged",
      content: "a",
      oldLineNumber: 1,
      newLineNumber: 1,
    });
    expect(result.lines[1]).toMatchObject({
      type: "deletion",
      content: "b",
      oldLineNumber: 2,
      newLineNumber: null,
    });
    expect(result.lines[2]).toMatchObject({
      type: "addition",
      content: "x",
      oldLineNumber: null,
      newLineNumber: 2,
    });
    expect(result.lines[3]).toMatchObject({
      type: "unchanged",
      content: "c",
      oldLineNumber: 3,
      newLineNumber: 3,
    });
  });
});

describe("generateWriteDiff", () => {
  it("marks all lines as additions for new file", () => {
    const result = generateWriteDiff({
      file_path: "/new.txt",
      content: "line1\nline2",
    });

    expect(result.filePath).toBe("/new.txt");
    expect(result.lines).toHaveLength(2);
    expect(result.lines.every((l) => l.type === "addition")).toBe(true);
    expect(result.stats).toEqual({ additions: 2, deletions: 0 });
  });

  it("assigns correct line numbers for new file", () => {
    const result = generateWriteDiff({
      file_path: "/new.txt",
      content: "a\nb\nc",
    });

    expect(result.lines[0]).toMatchObject({
      type: "addition",
      content: "a",
      oldLineNumber: null,
      newLineNumber: 1,
    });
    expect(result.lines[1]).toMatchObject({
      type: "addition",
      content: "b",
      oldLineNumber: null,
      newLineNumber: 2,
    });
    expect(result.lines[2]).toMatchObject({
      type: "addition",
      content: "c",
      oldLineNumber: null,
      newLineNumber: 3,
    });
  });

  it("computes diff when existing content provided", () => {
    const result = generateWriteDiff(
      { file_path: "/test.txt", content: "new content" },
      "old content"
    );

    expect(result.lines.some((l) => l.type === "deletion")).toBe(true);
    expect(result.lines.some((l) => l.type === "addition")).toBe(true);
  });

  it("handles empty new content (clearing file)", () => {
    const result = generateWriteDiff(
      { file_path: "/test.txt", content: "" },
      "existing\ncontent"
    );

    expect(result.lines.every((l) => l.type === "deletion")).toBe(true);
    expect(result.stats.deletions).toBe(2);
    expect(result.stats.additions).toBe(0);
  });

  it("handles empty existing content", () => {
    const result = generateWriteDiff(
      { file_path: "/test.txt", content: "new\ncontent" },
      ""
    );

    expect(result.lines.every((l) => l.type === "addition")).toBe(true);
    expect(result.stats.additions).toBe(2);
    expect(result.stats.deletions).toBe(0);
  });

  it("handles identical content (no changes)", () => {
    const result = generateWriteDiff(
      { file_path: "/test.txt", content: "same\ncontent" },
      "same\ncontent"
    );

    expect(result.lines.every((l) => l.type === "unchanged")).toBe(true);
    expect(result.stats).toEqual({ additions: 0, deletions: 0 });
  });

  it("handles single line file", () => {
    const result = generateWriteDiff({
      file_path: "/single.txt",
      content: "only line",
    });

    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({
      type: "addition",
      content: "only line",
      newLineNumber: 1,
    });
  });
});
