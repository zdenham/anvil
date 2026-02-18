// @vitest-environment node
import { describe, it, expect } from "vitest";
import { findSafeBoundary } from "../use-trickle-text";

describe("findSafeBoundary", () => {
  describe("plain text", () => {
    it("returns 0 for position 0", () => {
      expect(findSafeBoundary("hello world", 0)).toBe(0);
    });

    it("returns full length when position >= length", () => {
      const text = "hello world";
      expect(findSafeBoundary(text, text.length)).toBe(text.length);
      expect(findSafeBoundary(text, text.length + 10)).toBe(text.length);
    });

    it("allows mid-word positions when far from word boundary", () => {
      // Position 1 in "hello world" — space is at 5, distance > 3, no snap
      expect(findSafeBoundary("hello world", 1)).toBe(1);
    });

    it("snaps forward to word boundary when within 3 chars", () => {
      // Position 4 is 'o' in 'hello', space is at 5 — distance 1
      const result = findSafeBoundary("hello world", 4);
      expect(result).toBe(6); // past the space
    });
  });

  describe("bold markers (**)", () => {
    it("snaps back before unclosed bold", () => {
      const text = "normal **bold text** done";
      // Position 10: inside "**bold" — but bold is already closed at 19
      // Let's test an actually unclosed bold
      const unclosed = "normal **bold text is here";
      const pos = 15; // mid-way through the bold
      const result = findSafeBoundary(unclosed, pos);
      expect(result).toBe(7); // snaps back to before **
    });

    it("allows position after closed bold", () => {
      const text = "normal **bold** done";
      const pos = 18; // in " done"
      const result = findSafeBoundary(text, pos);
      // Should not snap back — bold is closed
      expect(result).toBeGreaterThanOrEqual(18);
    });
  });

  describe("inline code (`)", () => {
    it("snaps back before unclosed backtick", () => {
      const text = "use the `someFunction argument";
      const pos = 20;
      const result = findSafeBoundary(text, pos);
      expect(result).toBe(8); // before the backtick
    });

    it("allows position after closed inline code", () => {
      const text = "use the `someFunction` argument";
      const pos = 25;
      const result = findSafeBoundary(text, pos);
      expect(result).toBeGreaterThanOrEqual(25);
    });
  });

  describe("fenced code blocks (```)", () => {
    it("snaps back before unclosed code fence", () => {
      const text = "text\n```typescript\nconst x = 1;\n";
      const pos = 25; // inside the code block
      const result = findSafeBoundary(text, pos);
      expect(result).toBe(5); // before the opening ```
    });

    it("allows position after closed code fence", () => {
      const text = "text\n```typescript\nconst x = 1;\n```\nmore text";
      const pos = 40; // in "more text"
      const result = findSafeBoundary(text, pos);
      expect(result).toBeGreaterThanOrEqual(35);
    });
  });

  describe("links [text](url)", () => {
    it("snaps back before unclosed link", () => {
      const text = "click [here to go";
      const pos = 14;
      const result = findSafeBoundary(text, pos);
      expect(result).toBe(6); // before [
    });

    it("allows position after closed link", () => {
      const text = "click [here](https://example.com) and more";
      const pos = 38;
      const result = findSafeBoundary(text, pos);
      expect(result).toBeGreaterThanOrEqual(33);
    });
  });

  describe("strikethrough (~~)", () => {
    it("snaps back before unclosed strikethrough", () => {
      const text = "normal ~~deleted text is here";
      const pos = 20;
      const result = findSafeBoundary(text, pos);
      expect(result).toBe(7); // before ~~
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      expect(findSafeBoundary("", 0)).toBe(0);
    });

    it("handles position beyond string length", () => {
      expect(findSafeBoundary("hi", 100)).toBe(2);
    });

    it("handles negative position", () => {
      expect(findSafeBoundary("hello", -1)).toBe(0);
    });
  });
});
