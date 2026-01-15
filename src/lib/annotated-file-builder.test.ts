import { describe, it, expect } from "vitest";
import { buildAnnotatedFiles } from "./annotated-file-builder";
import type { ParsedDiff, ParsedDiffFile, DiffHunk } from "./diff-parser";

function makeFile(
  overrides: Partial<ParsedDiffFile> = {}
): ParsedDiffFile {
  const type = overrides.type ?? "modified";
  return {
    oldPath: "src/file.ts",
    newPath: "src/file.ts",
    type,
    hunks: [],
    stats: { additions: 0, deletions: 0 },
    language: "typescript",
    isBinary: type === "binary",
    ...overrides,
  };
}

function makeHunk(overrides: Partial<DiffHunk> = {}): DiffHunk {
  return {
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
    lines: [],
    ...overrides,
  };
}

describe("buildAnnotatedFiles", () => {
  it("returns empty lines for binary files", () => {
    const diff: ParsedDiff = {
      files: [makeFile({ type: "binary", newPath: "image.png" })],
    };

    const result = buildAnnotatedFiles(diff, {});

    expect(result[0].lines).toEqual([]);
    expect(result[0].priority).toBeDefined(); // Priority is computed even for binary files
  });

  it("returns empty lines for missing content", () => {
    const diff: ParsedDiff = {
      files: [makeFile({ newPath: "missing.ts" })],
    };

    const result = buildAnnotatedFiles(diff, {});

    expect(result[0].lines).toEqual([]);
    expect(result[0].priority).toBeDefined(); // Priority is still computed
  });

  it("handles renamed files with no changes as all unchanged", () => {
    const diff: ParsedDiff = {
      files: [
        makeFile({
          type: "renamed",
          oldPath: "old-name.ts",
          newPath: "new-name.ts",
          hunks: [], // No hunks = no changes
        }),
      ],
    };

    const content = ["line 1", "line 2", "line 3"];
    const result = buildAnnotatedFiles(diff, { "new-name.ts": content });

    expect(result[0].lines).toHaveLength(3);
    expect(result[0].lines.every((l) => l.type === "unchanged")).toBe(true);
  });

  it("uses custom priority function when provided", () => {
    const diff: ParsedDiff = {
      files: [makeFile({ newPath: "test.ts" })],
    };

    const customPriority = () => 999;
    const result = buildAnnotatedFiles(
      diff,
      { "test.ts": ["content"] },
      customPriority
    );

    expect(result[0].priority).toBe(999);
  });

  describe("deleted files", () => {
    it("marks all lines as deletions", () => {
      const diff: ParsedDiff = {
        files: [
          makeFile({
            type: "deleted",
            oldPath: "deleted.ts",
            newPath: null,
          }),
        ],
      };

      const oldContent = ["line 1", "line 2", "line 3"];
      const result = buildAnnotatedFiles(diff, { "deleted.ts": oldContent });

      expect(result[0].lines).toHaveLength(3);
      expect(result[0].lines).toEqual([
        { type: "deletion", content: "line 1", oldLineNumber: 1, newLineNumber: null },
        { type: "deletion", content: "line 2", oldLineNumber: 2, newLineNumber: null },
        { type: "deletion", content: "line 3", oldLineNumber: 3, newLineNumber: null },
      ]);
    });

    it("uses oldPath for content lookup", () => {
      const diff: ParsedDiff = {
        files: [
          makeFile({
            type: "deleted",
            oldPath: "old/path.ts",
            newPath: null,
          }),
        ],
      };

      const result = buildAnnotatedFiles(diff, {
        "old/path.ts": ["content"],
        "new/path.ts": ["wrong content"],
      });

      expect(result[0].lines[0].content).toBe("content");
    });
  });

  describe("addition-only diffs", () => {
    it("marks new lines correctly", () => {
      const diff: ParsedDiff = {
        files: [
          makeFile({
            newPath: "file.ts",
            hunks: [
              makeHunk({
                oldStart: 1,
                newStart: 1,
                lines: [
                  { type: "context", content: "line 1", oldLineNumber: 1, newLineNumber: 1 },
                  { type: "addition", content: "new line", oldLineNumber: null, newLineNumber: 2 },
                  { type: "context", content: "line 2", oldLineNumber: 2, newLineNumber: 3 },
                ],
              }),
            ],
          }),
        ],
      };

      const newContent = ["line 1", "new line", "line 2"];
      const result = buildAnnotatedFiles(diff, { "file.ts": newContent });

      expect(result[0].lines).toEqual([
        { type: "unchanged", content: "line 1", oldLineNumber: 1, newLineNumber: 1 },
        { type: "addition", content: "new line", oldLineNumber: null, newLineNumber: 2 },
        { type: "unchanged", content: "line 2", oldLineNumber: 2, newLineNumber: 3 },
      ]);
    });
  });

  describe("deletion-only diffs", () => {
    it("inserts deleted lines at correct positions", () => {
      const diff: ParsedDiff = {
        files: [
          makeFile({
            newPath: "file.ts",
            hunks: [
              makeHunk({
                oldStart: 1,
                newStart: 1,
                lines: [
                  { type: "context", content: "line 1", oldLineNumber: 1, newLineNumber: 1 },
                  { type: "deletion", content: "deleted line", oldLineNumber: 2, newLineNumber: null },
                  { type: "context", content: "line 2", oldLineNumber: 3, newLineNumber: 2 },
                ],
              }),
            ],
          }),
        ],
      };

      const newContent = ["line 1", "line 2"];
      const result = buildAnnotatedFiles(diff, { "file.ts": newContent });

      expect(result[0].lines).toEqual([
        { type: "unchanged", content: "line 1", oldLineNumber: 1, newLineNumber: 1 },
        { type: "deletion", content: "deleted line", oldLineNumber: 2, newLineNumber: null },
        { type: "unchanged", content: "line 2", oldLineNumber: 3, newLineNumber: 2 },
      ]);
    });
  });

  describe("mixed additions and deletions", () => {
    it("handles replacement correctly", () => {
      // Replacing "old line" with "new line"
      const diff: ParsedDiff = {
        files: [
          makeFile({
            newPath: "file.ts",
            hunks: [
              makeHunk({
                oldStart: 1,
                newStart: 1,
                lines: [
                  { type: "context", content: "line 1", oldLineNumber: 1, newLineNumber: 1 },
                  { type: "deletion", content: "old line", oldLineNumber: 2, newLineNumber: null },
                  { type: "addition", content: "new line", oldLineNumber: null, newLineNumber: 2 },
                  { type: "context", content: "line 3", oldLineNumber: 3, newLineNumber: 3 },
                ],
              }),
            ],
          }),
        ],
      };

      const newContent = ["line 1", "new line", "line 3"];
      const result = buildAnnotatedFiles(diff, { "file.ts": newContent });

      expect(result[0].lines).toEqual([
        { type: "unchanged", content: "line 1", oldLineNumber: 1, newLineNumber: 1 },
        { type: "deletion", content: "old line", oldLineNumber: 2, newLineNumber: null },
        { type: "addition", content: "new line", oldLineNumber: null, newLineNumber: 2 },
        { type: "unchanged", content: "line 3", oldLineNumber: 3, newLineNumber: 3 },
      ]);
    });
  });

  describe("consecutive deletions", () => {
    it("groups multiple deletions at same position", () => {
      const diff: ParsedDiff = {
        files: [
          makeFile({
            newPath: "file.ts",
            hunks: [
              makeHunk({
                oldStart: 1,
                newStart: 1,
                lines: [
                  { type: "context", content: "keep", oldLineNumber: 1, newLineNumber: 1 },
                  { type: "deletion", content: "del 1", oldLineNumber: 2, newLineNumber: null },
                  { type: "deletion", content: "del 2", oldLineNumber: 3, newLineNumber: null },
                  { type: "deletion", content: "del 3", oldLineNumber: 4, newLineNumber: null },
                  { type: "context", content: "also keep", oldLineNumber: 5, newLineNumber: 2 },
                ],
              }),
            ],
          }),
        ],
      };

      const newContent = ["keep", "also keep"];
      const result = buildAnnotatedFiles(diff, { "file.ts": newContent });

      expect(result[0].lines).toEqual([
        { type: "unchanged", content: "keep", oldLineNumber: 1, newLineNumber: 1 },
        { type: "deletion", content: "del 1", oldLineNumber: 2, newLineNumber: null },
        { type: "deletion", content: "del 2", oldLineNumber: 3, newLineNumber: null },
        { type: "deletion", content: "del 3", oldLineNumber: 4, newLineNumber: null },
        { type: "unchanged", content: "also keep", oldLineNumber: 5, newLineNumber: 2 },
      ]);
    });
  });

  describe("deletions at file boundaries", () => {
    it("handles deletions at start of file", () => {
      const diff: ParsedDiff = {
        files: [
          makeFile({
            newPath: "file.ts",
            hunks: [
              makeHunk({
                oldStart: 1,
                newStart: 1,
                lines: [
                  { type: "deletion", content: "removed first", oldLineNumber: 1, newLineNumber: null },
                  { type: "context", content: "now first", oldLineNumber: 2, newLineNumber: 1 },
                ],
              }),
            ],
          }),
        ],
      };

      const newContent = ["now first"];
      const result = buildAnnotatedFiles(diff, { "file.ts": newContent });

      // Deletion at start should appear before line 1
      expect(result[0].lines).toEqual([
        { type: "deletion", content: "removed first", oldLineNumber: 1, newLineNumber: null },
        { type: "unchanged", content: "now first", oldLineNumber: 2, newLineNumber: 1 },
      ]);
    });

    it("handles deletions at end of file", () => {
      const diff: ParsedDiff = {
        files: [
          makeFile({
            newPath: "file.ts",
            hunks: [
              makeHunk({
                oldStart: 1,
                newStart: 1,
                lines: [
                  { type: "context", content: "now last", oldLineNumber: 1, newLineNumber: 1 },
                  { type: "deletion", content: "removed last", oldLineNumber: 2, newLineNumber: null },
                ],
              }),
            ],
          }),
        ],
      };

      const newContent = ["now last"];
      const result = buildAnnotatedFiles(diff, { "file.ts": newContent });

      expect(result[0].lines).toEqual([
        { type: "unchanged", content: "now last", oldLineNumber: 1, newLineNumber: 1 },
        { type: "deletion", content: "removed last", oldLineNumber: 2, newLineNumber: null },
      ]);
    });
  });

  describe("multiple hunks", () => {
    it("processes multiple hunks in same file", () => {
      const diff: ParsedDiff = {
        files: [
          makeFile({
            newPath: "file.ts",
            hunks: [
              makeHunk({
                oldStart: 1,
                newStart: 1,
                lines: [
                  { type: "context", content: "line 1", oldLineNumber: 1, newLineNumber: 1 },
                  { type: "addition", content: "added in hunk 1", oldLineNumber: null, newLineNumber: 2 },
                ],
              }),
              makeHunk({
                oldStart: 5,
                newStart: 6,
                lines: [
                  { type: "context", content: "line 6", oldLineNumber: 5, newLineNumber: 6 },
                  { type: "deletion", content: "deleted in hunk 2", oldLineNumber: 6, newLineNumber: null },
                  { type: "context", content: "line 7", oldLineNumber: 7, newLineNumber: 7 },
                ],
              }),
            ],
          }),
        ],
      };

      // 7 lines after changes (added 1, removed 1)
      const newContent = [
        "line 1",
        "added in hunk 1",
        "line 3",
        "line 4",
        "line 5",
        "line 6",
        "line 7",
      ];
      const result = buildAnnotatedFiles(diff, { "file.ts": newContent });

      const lines = result[0].lines;

      // Check hunk 1 additions
      expect(lines.find((l) => l.content === "added in hunk 1")?.type).toBe("addition");

      // Check hunk 2 deletions
      expect(lines.find((l) => l.content === "deleted in hunk 2")?.type).toBe("deletion");
    });
  });

  describe("newly added files", () => {
    it("marks all lines as additions", () => {
      const diff: ParsedDiff = {
        files: [
          makeFile({
            type: "added",
            oldPath: null,
            newPath: "new-file.ts",
            hunks: [
              makeHunk({
                oldStart: 0,
                newStart: 1,
                lines: [
                  { type: "addition", content: "line 1", oldLineNumber: null, newLineNumber: 1 },
                  { type: "addition", content: "line 2", oldLineNumber: null, newLineNumber: 2 },
                  { type: "addition", content: "line 3", oldLineNumber: null, newLineNumber: 3 },
                ],
              }),
            ],
          }),
        ],
      };

      const newContent = ["line 1", "line 2", "line 3"];
      const result = buildAnnotatedFiles(diff, { "new-file.ts": newContent });

      expect(result[0].lines).toEqual([
        { type: "addition", content: "line 1", oldLineNumber: null, newLineNumber: 1 },
        { type: "addition", content: "line 2", oldLineNumber: null, newLineNumber: 2 },
        { type: "addition", content: "line 3", oldLineNumber: null, newLineNumber: 3 },
      ]);
    });
  });

  describe("unchanged line number computation", () => {
    it("computes correct oldLineNumber for unchanged lines after changes", () => {
      // Scenario: 2 additions and 1 deletion before line 10
      // oldLine = newLine - additions + deletions = 10 - 2 + 1 = 9
      const diff: ParsedDiff = {
        files: [
          makeFile({
            newPath: "file.ts",
            hunks: [
              makeHunk({
                oldStart: 1,
                newStart: 1,
                lines: [
                  { type: "deletion", content: "del", oldLineNumber: 1, newLineNumber: null },
                  { type: "addition", content: "add1", oldLineNumber: null, newLineNumber: 1 },
                  { type: "addition", content: "add2", oldLineNumber: null, newLineNumber: 2 },
                ],
              }),
            ],
          }),
        ],
      };

      const newContent = ["add1", "add2", "line 3", "line 4"];
      const result = buildAnnotatedFiles(diff, { "file.ts": newContent });

      // line 3 in new file should map to old line 2 (3 - 2 additions + 1 deletion = 2)
      const line3 = result[0].lines.find((l) => l.content === "line 3");
      expect(line3?.oldLineNumber).toBe(2);
      expect(line3?.newLineNumber).toBe(3);
    });
  });
});
