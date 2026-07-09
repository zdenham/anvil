// @vitest-environment node
import { describe, it, expect } from "vitest";
import { globToRegExp } from "./tauri-fs-adapter";

describe("globToRegExp", () => {
  describe("wildcards", () => {
    it("matches `*` against a single path segment only", () => {
      const re = globToRegExp("*.ts");
      expect(re.test("index.ts")).toBe(true);
      expect(re.test("index.js")).toBe(false);
      // `*` must not cross a path separator
      expect(re.test("src/index.ts")).toBe(false);
    });

    it("matches `**` recursively across path separators", () => {
      const re = globToRegExp("**/*.ts");
      expect(re.test("index.ts")).toBe(true);
      expect(re.test("src/index.ts")).toBe(true);
      expect(re.test("src/lib/util.ts")).toBe(true);
      expect(re.test("src/util.js")).toBe(false);
    });

    it("matches `?` against exactly one non-separator character", () => {
      const re = globToRegExp("src/index.?s");
      expect(re.test("src/index.ts")).toBe(true);
      expect(re.test("src/index.js")).toBe(true);
      expect(re.test("src/index.tsx")).toBe(false);
      expect(re.test("src/index./s")).toBe(false);
    });
  });

  describe("regex metacharacters are treated literally", () => {
    it("does not crash and matches literally on `+` (a regex quantifier)", () => {
      // `a+b/*.ts` — the `+` must be a literal plus, not a quantifier.
      const re = globToRegExp("a+b/*.ts");
      expect(re.test("a+b/index.ts")).toBe(true);
      // Without escaping, `a+` would match `aaa`; assert it does NOT.
      expect(re.test("aaab/index.ts")).toBe(false);
      expect(re.test("ab/index.ts")).toBe(false);
    });

    it("treats parentheses as literal, not a capture group", () => {
      // `(x).js` — without escaping this becomes a capture group + `.` wildcard.
      const re = globToRegExp("(x).js");
      expect(re.test("(x).js")).toBe(true);
      // The `.` must be literal: `xXjs` (where X is any char) must NOT match.
      expect(re.test("xZjs")).toBe(false);
      expect(re.test("x.js")).toBe(false);
    });

    it("does not throw on characters that would form invalid regex", () => {
      // Unbalanced/structural metacharacters would throw if passed raw to RegExp.
      const tricky = ["a(b.ts", "a)b.ts", "a[b.ts", "a]b.ts", "a{b.ts", "a$b^c.ts", "a|b.ts"];
      for (const pattern of tricky) {
        expect(() => globToRegExp(pattern)).not.toThrow();
        // Each pattern should match itself literally.
        expect(globToRegExp(pattern).test(pattern)).toBe(true);
      }
    });

    it("escapes `.` so it is not a wildcard", () => {
      const re = globToRegExp("file.ts");
      expect(re.test("file.ts")).toBe(true);
      expect(re.test("fileXts")).toBe(false);
    });

    it("anchors the full string", () => {
      const re = globToRegExp("*.ts");
      expect(re.test("a.ts.bak")).toBe(false);
      expect(re.test("prefix-a.ts")).toBe(true);
    });
  });
});
