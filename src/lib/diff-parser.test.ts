// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parseDiff } from "./diff-parser";

describe("parseDiff", () => {
  describe("basic parsing", () => {
    it("returns empty files array for empty input", () => {
      expect(parseDiff("")).toEqual({ files: [] });
      expect(parseDiff("   ")).toEqual({ files: [] });
    });

    it("parses a simple single-file diff with correct line numbers", () => {
      const diff = `diff --git a/src/hello.ts b/src/hello.ts
index abc123..def456 100644
--- a/src/hello.ts
+++ b/src/hello.ts
@@ -1,5 +1,6 @@
 const greeting = "hello";
-console.log(greeting);
+console.log(greeting.toUpperCase());
+console.log("world");

 export { greeting };
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(1);
      const file = result.files[0];
      expect(file.oldPath).toBe("src/hello.ts");
      expect(file.newPath).toBe("src/hello.ts");
      expect(file.type).toBe("modified");
      expect(file.language).toBe("typescript");
      expect(file.stats.additions).toBe(2);
      expect(file.stats.deletions).toBe(1);

      expect(file.hunks).toHaveLength(1);
      const hunk = file.hunks[0];
      expect(hunk.oldStart).toBe(1);
      expect(hunk.oldLines).toBe(5);
      expect(hunk.newStart).toBe(1);
      expect(hunk.newLines).toBe(6);

      // Check line number tracking
      expect(hunk.lines[0]).toEqual({
        type: "context",
        content: 'const greeting = "hello";',
        oldLineNumber: 1,
        newLineNumber: 1,
      });
      expect(hunk.lines[1]).toEqual({
        type: "deletion",
        content: "console.log(greeting);",
        oldLineNumber: 2,
        newLineNumber: null,
      });
      expect(hunk.lines[2]).toEqual({
        type: "addition",
        content: "console.log(greeting.toUpperCase());",
        oldLineNumber: null,
        newLineNumber: 2,
      });
      expect(hunk.lines[3]).toEqual({
        type: "addition",
        content: 'console.log("world");',
        oldLineNumber: null,
        newLineNumber: 3,
      });
    });

    it("parses a multi-file diff", () => {
      const diff = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 line1
+added
 line2
diff --git a/src/b.ts b/src/b.ts
index 333..444 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -1,3 +1,2 @@
 line1
-removed
 line3
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(2);
      expect(result.files[0].oldPath).toBe("src/a.ts");
      expect(result.files[0].stats.additions).toBe(1);
      expect(result.files[0].stats.deletions).toBe(0);
      expect(result.files[1].oldPath).toBe("src/b.ts");
      expect(result.files[1].stats.additions).toBe(0);
      expect(result.files[1].stats.deletions).toBe(1);
    });
  });

  describe("file operations", () => {
    it("detects new file creation (oldPath is null)", () => {
      const diff = `diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
index 0000000..abc123
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,3 @@
+export function hello() {
+  return "world";
+}
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(1);
      const file = result.files[0];
      expect(file.oldPath).toBeNull();
      expect(file.newPath).toBe("src/new-file.ts");
      expect(file.type).toBe("added");
      expect(file.stats.additions).toBe(3);
      expect(file.stats.deletions).toBe(0);
    });

    it("detects file deletion (newPath is null)", () => {
      const diff = `diff --git a/src/old-file.ts b/src/old-file.ts
deleted file mode 100644
index abc123..0000000
--- a/src/old-file.ts
+++ /dev/null
@@ -1,3 +0,0 @@
-export function goodbye() {
-  return "farewell";
-}
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(1);
      const file = result.files[0];
      expect(file.oldPath).toBe("src/old-file.ts");
      expect(file.newPath).toBeNull();
      expect(file.type).toBe("deleted");
      expect(file.stats.additions).toBe(0);
      expect(file.stats.deletions).toBe(3);
    });

    it("detects file rename with similarity percentage", () => {
      const diff = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 95%
rename from src/old-name.ts
rename to src/new-name.ts
index abc123..def456 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,3 +1,3 @@
 export function hello() {
-  return "old";
+  return "new";
 }
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(1);
      const file = result.files[0];
      expect(file.oldPath).toBe("src/old-name.ts");
      expect(file.newPath).toBe("src/new-name.ts");
      expect(file.type).toBe("renamed");
      expect(file.similarity).toBe(95);
    });

    it("detects binary file", () => {
      const diff = `diff --git a/assets/logo.png b/assets/logo.png
index abc123..def456 100644
Binary files a/assets/logo.png and b/assets/logo.png differ
`;

      const result = parseDiff(diff);

      expect(result.files).toHaveLength(1);
      const file = result.files[0];
      expect(file.type).toBe("binary");
      expect(file.hunks).toHaveLength(0);
    });
  });

  describe("hunk parsing", () => {
    it("captures section header from hunk", () => {
      const diff = `diff --git a/src/utils.ts b/src/utils.ts
index abc123..def456 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -10,5 +10,7 @@ function processData(input: string) {
   const result = input.trim();
+  // validate
+  if (!result) throw new Error("empty");
   return result;
 }
`;

      const result = parseDiff(diff);

      expect(result.files[0].hunks[0].sectionHeader).toBe(
        "function processData(input: string) {"
      );
    });

    it("handles hunk with no section header", () => {
      const diff = `diff --git a/src/file.ts b/src/file.ts
index abc123..def456 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,4 @@
 line1
+new line
 line2
 line3
`;

      const result = parseDiff(diff);

      expect(result.files[0].hunks[0].sectionHeader).toBeUndefined();
    });

    it("handles hunk with count of 1 (omitted in header)", () => {
      const diff = `diff --git a/src/file.ts b/src/file.ts
index abc123..def456 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1 +1,2 @@
 only line
+new line
`;

      const result = parseDiff(diff);

      const hunk = result.files[0].hunks[0];
      expect(hunk.oldStart).toBe(1);
      expect(hunk.oldLines).toBe(1);
      expect(hunk.newStart).toBe(1);
      expect(hunk.newLines).toBe(2);
    });

    it("handles multiple hunks in single file", () => {
      const diff = `diff --git a/src/file.ts b/src/file.ts
index abc123..def456 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,3 +1,4 @@
 line1
+added at top
 line2
 line3
@@ -10,3 +11,4 @@
 line10
+added at bottom
 line11
 line12
`;

      const result = parseDiff(diff);

      expect(result.files[0].hunks).toHaveLength(2);
      expect(result.files[0].hunks[0].oldStart).toBe(1);
      expect(result.files[0].hunks[1].oldStart).toBe(10);
      expect(result.files[0].stats.additions).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("strips 'No newline at end of file' marker", () => {
      const diff = `diff --git a/src/file.ts b/src/file.ts
index abc123..def456 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,2 +1,2 @@
 line1
-line2
\\ No newline at end of file
+line2 modified
\\ No newline at end of file
`;

      const result = parseDiff(diff);

      const hunk = result.files[0].hunks[0];
      expect(hunk.lines).toHaveLength(3);
      expect(hunk.lines.every((l) => !l.content.includes("No newline"))).toBe(
        true
      );
    });

    it("handles empty context lines in hunk", () => {
      // Note: In git diff output, an empty line in the file is represented
      // with a space prefix, so " " represents an empty context line.
      // We use join to avoid whitespace trimming issues.
      const diff = [
        "diff --git a/src/file.ts b/src/file.ts",
        "index abc123..def456 100644",
        "--- a/src/file.ts",
        "+++ b/src/file.ts",
        "@@ -1,4 +1,5 @@",
        " line1",
        " ", // Empty context line - must have leading space
        "+added after empty",
        " line3",
        " line4",
      ].join("\n");

      const result = parseDiff(diff);

      const hunk = result.files[0].hunks[0];
      expect(hunk.lines[1]).toEqual({
        type: "context",
        content: "",
        oldLineNumber: 2,
        newLineNumber: 2,
      });
    });

    it("handles empty context lines WITHOUT space prefix (diff.suppressBlankEmpty)", () => {
      // When diff.suppressBlankEmpty=true, git strips the leading space from
      // empty context lines, producing truly empty strings in the diff output.
      const diff = [
        "diff --git a/src/file.ts b/src/file.ts",
        "index abc123..def456 100644",
        "--- a/src/file.ts",
        "+++ b/src/file.ts",
        "@@ -1,4 +1,5 @@",
        " line1",
        "", // Empty context line WITHOUT space prefix
        "+added after empty",
        " line3",
        " line4",
      ].join("\n");

      const result = parseDiff(diff);

      const hunk = result.files[0].hunks[0];
      expect(hunk.lines).toHaveLength(5);
      expect(hunk.lines[1]).toEqual({
        type: "context",
        content: "",
        oldLineNumber: 2,
        newLineNumber: 2,
      });
      expect(hunk.lines[2]).toEqual({
        type: "addition",
        content: "added after empty",
        oldLineNumber: null,
        newLineNumber: 3,
      });
    });

    it("does not truncate hunk at empty line between additions", () => {
      const diff = [
        "diff --git a/src/file.ts b/src/file.ts",
        "index abc123..def456 100644",
        "--- a/src/file.ts",
        "+++ b/src/file.ts",
        "@@ -1,5 +1,7 @@",
        " line1",
        "+added1",
        "", // Empty context line (stripped space)
        "+added2",
        " line3",
        "+added3",
        " line4",
      ].join("\n");

      const result = parseDiff(diff);

      const hunk = result.files[0].hunks[0];
      expect(hunk.lines).toHaveLength(7);
      expect(result.files[0].stats.additions).toBe(3);
      // Verify the addition after the empty line was NOT lost
      expect(hunk.lines[3]).toEqual({
        type: "addition",
        content: "added2",
        oldLineNumber: null,
        newLineNumber: 4,
      });
    });

    it("handles multiple consecutive empty lines in a hunk", () => {
      const diff = [
        "diff --git a/src/file.ts b/src/file.ts",
        "index abc123..def456 100644",
        "--- a/src/file.ts",
        "+++ b/src/file.ts",
        "@@ -1,5 +1,5 @@",
        " line1",
        "", // empty context
        "", // empty context
        "-old",
        "+new",
      ].join("\n");

      const result = parseDiff(diff);

      const hunk = result.files[0].hunks[0];
      expect(hunk.lines).toHaveLength(5);
      expect(hunk.lines[1].type).toBe("context");
      expect(hunk.lines[2].type).toBe("context");
      expect(hunk.lines[3].type).toBe("deletion");
      expect(hunk.lines[4].type).toBe("addition");
    });

    it("parsed hunk line counts match header declaration", () => {
      const diff = [
        "diff --git a/src/file.ts b/src/file.ts",
        "index abc123..def456 100644",
        "--- a/src/file.ts",
        "+++ b/src/file.ts",
        "@@ -1,4 +1,6 @@",
        " line1",
        "", // stripped empty context line
        "+added1",
        "+added2",
        " line3",
        " line4",
      ].join("\n");

      const result = parseDiff(diff);

      const hunk = result.files[0].hunks[0];
      // old side: line1, empty, line3, line4 = 4 lines
      const oldCount = hunk.lines.filter(
        (l) => l.type === "context" || l.type === "deletion"
      ).length;
      // new side: line1, empty, added1, added2, line3, line4 = 6 lines
      const newCount = hunk.lines.filter(
        (l) => l.type === "context" || l.type === "addition"
      ).length;
      expect(oldCount).toBe(hunk.oldLines);
      expect(newCount).toBe(hunk.newLines);
    });
  });

  describe("language detection", () => {
    it("detects language from file extension", () => {
      const testCases = [
        { path: "src/app.ts", expected: "typescript" },
        { path: "src/app.tsx", expected: "tsx" },
        { path: "src/app.js", expected: "javascript" },
        { path: "src/app.py", expected: "python" },
        { path: "src/app.rs", expected: "rust" },
        { path: "README.md", expected: "markdown" },
        { path: "config.json", expected: "json" },
        { path: "unknown.xyz", expected: "plaintext" },
      ];

      for (const { path, expected } of testCases) {
        const diff = `diff --git a/${path} b/${path}
index abc..def 100644
--- a/${path}
+++ b/${path}
@@ -1 +1 @@
-old
+new
`;
        const result = parseDiff(diff);
        expect(result.files[0].language).toBe(expected);
      }
    });
  });

  describe("stats calculation", () => {
    it("counts additions and deletions accurately", () => {
      const diff = `diff --git a/src/file.ts b/src/file.ts
index abc123..def456 100644
--- a/src/file.ts
+++ b/src/file.ts
@@ -1,6 +1,8 @@
 context1
-deleted1
-deleted2
+added1
+added2
+added3
 context2
-deleted3
+added4
 context3
`;

      const result = parseDiff(diff);

      expect(result.files[0].stats.additions).toBe(4);
      expect(result.files[0].stats.deletions).toBe(3);
    });
  });
});
