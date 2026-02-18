// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  calculatePriority,
  prioritizeDiffs,
  isSourceFile,
  isTestFile,
  isConfigFile,
} from "./diff-prioritizer";
import type { ParsedDiffFile } from "./diff-parser";

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

describe("isSourceFile", () => {
  it("returns true for source file extensions", () => {
    expect(isSourceFile("src/app.ts")).toBe(true);
    expect(isSourceFile("src/app.tsx")).toBe(true);
    expect(isSourceFile("src/app.js")).toBe(true);
    expect(isSourceFile("src/app.jsx")).toBe(true);
    expect(isSourceFile("main.py")).toBe(true);
    expect(isSourceFile("lib.rs")).toBe(true);
    expect(isSourceFile("main.go")).toBe(true);
    expect(isSourceFile("App.java")).toBe(true);
  });

  it("returns false for test files", () => {
    expect(isSourceFile("src/app.test.ts")).toBe(false);
    expect(isSourceFile("src/app.spec.tsx")).toBe(false);
    expect(isSourceFile("tests/util.ts")).toBe(false);
  });

  it("returns false for non-source files", () => {
    expect(isSourceFile("package.json")).toBe(false);
    expect(isSourceFile("README.md")).toBe(false);
    expect(isSourceFile("styles.css")).toBe(false);
  });

  it("handles null path", () => {
    expect(isSourceFile(null)).toBe(false);
  });
});

describe("isTestFile", () => {
  it("detects .test.ts files", () => {
    expect(isTestFile("src/app.test.ts")).toBe(true);
    expect(isTestFile("src/util.test.tsx")).toBe(true);
    expect(isTestFile("app.test.js")).toBe(true);
  });

  it("detects .spec.ts files", () => {
    expect(isTestFile("src/app.spec.ts")).toBe(true);
    expect(isTestFile("src/util.spec.tsx")).toBe(true);
  });

  it("detects _test.go files", () => {
    expect(isTestFile("main_test.go")).toBe(true);
    expect(isTestFile("util_test.py")).toBe(true);
  });

  it("detects Test.java files", () => {
    expect(isTestFile("AppTest.java")).toBe(true);
  });

  it("detects files in tests/ directory", () => {
    expect(isTestFile("tests/unit/app.ts")).toBe(true);
    expect(isTestFile("test/integration.py")).toBe(true);
  });

  it("returns false for non-test files", () => {
    expect(isTestFile("src/app.ts")).toBe(false);
    expect(isTestFile("testing-utils.ts")).toBe(false);
  });

  it("handles null path", () => {
    expect(isTestFile(null)).toBe(false);
  });
});

describe("isConfigFile", () => {
  it("detects config extensions", () => {
    expect(isConfigFile("package.json")).toBe(true);
    expect(isConfigFile("config.yaml")).toBe(true);
    expect(isConfigFile("settings.yml")).toBe(true);
    expect(isConfigFile("Cargo.toml")).toBe(true);
    expect(isConfigFile(".env")).toBe(true);
  });

  it("detects files with 'config' in path", () => {
    expect(isConfigFile("src/config/database.ts")).toBe(true);
    expect(isConfigFile("vite.config.ts")).toBe(true);
  });

  it("returns false for non-config files", () => {
    expect(isConfigFile("src/app.ts")).toBe(false);
    expect(isConfigFile("README.md")).toBe(false);
  });

  it("handles null path", () => {
    expect(isConfigFile(null)).toBe(false);
  });
});

describe("calculatePriority", () => {
  it("gives higher priority to files with more changes", () => {
    const manyChanges = makeFile({ stats: { additions: 50, deletions: 30 } });
    const fewChanges = makeFile({ stats: { additions: 5, deletions: 3 } });

    expect(calculatePriority(manyChanges)).toBeGreaterThan(
      calculatePriority(fewChanges)
    );
  });

  it("gives source files a bonus", () => {
    const sourceFile = makeFile({ newPath: "src/app.ts" });
    const otherFile = makeFile({ newPath: "README.md" });

    expect(calculatePriority(sourceFile)).toBeGreaterThan(
      calculatePriority(otherFile)
    );
  });

  it("gives test files a smaller bonus than source files", () => {
    const sourceFile = makeFile({ newPath: "src/app.ts" });
    const testFile = makeFile({ newPath: "src/app.test.ts" });

    expect(calculatePriority(sourceFile)).toBeGreaterThan(
      calculatePriority(testFile)
    );
  });

  it("gives new files a bonus", () => {
    const newFile = makeFile({ type: "added" });
    const modifiedFile = makeFile({ type: "modified" });

    expect(calculatePriority(newFile)).toBeGreaterThan(
      calculatePriority(modifiedFile)
    );
  });

  it("gives deleted files a penalty", () => {
    const deletedFile = makeFile({ type: "deleted", newPath: null });
    const modifiedFile = makeFile({ type: "modified" });

    expect(calculatePriority(deletedFile)).toBeLessThan(
      calculatePriority(modifiedFile)
    );
  });

  it("uses oldPath for deleted files", () => {
    const deletedSource = makeFile({
      type: "deleted",
      oldPath: "src/app.ts",
      newPath: null,
    });
    const deletedOther = makeFile({
      type: "deleted",
      oldPath: "README.md",
      newPath: null,
    });

    expect(calculatePriority(deletedSource)).toBeGreaterThan(
      calculatePriority(deletedOther)
    );
  });
});

describe("prioritizeDiffs", () => {
  it("sorts files by priority descending", () => {
    const files = [
      makeFile({ newPath: "README.md", stats: { additions: 1, deletions: 0 } }),
      makeFile({
        newPath: "src/main.ts",
        stats: { additions: 100, deletions: 50 },
      }),
      makeFile({
        newPath: "package.json",
        stats: { additions: 5, deletions: 2 },
      }),
    ];

    const sorted = prioritizeDiffs(files);

    expect(sorted[0].newPath).toBe("src/main.ts");
    expect(sorted[sorted.length - 1].newPath).toBe("README.md");
  });

  it("does not mutate the original array", () => {
    const files = [
      makeFile({ newPath: "b.ts" }),
      makeFile({ newPath: "a.ts" }),
    ];
    const original = [...files];

    prioritizeDiffs(files);

    expect(files).toEqual(original);
  });

  it("handles empty array", () => {
    expect(prioritizeDiffs([])).toEqual([]);
  });
});
