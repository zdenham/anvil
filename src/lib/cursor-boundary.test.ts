import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CursorBoundary } from "./cursor-boundary";

describe("CursorBoundary", () => {
  let textarea: HTMLTextAreaElement;
  let input: HTMLInputElement;

  beforeEach(() => {
    // Create real DOM elements for testing
    textarea = document.createElement("textarea");
    textarea.style.width = "200px";
    textarea.style.fontSize = "16px";
    textarea.style.fontFamily = "monospace";
    textarea.style.lineHeight = "20px";
    textarea.style.padding = "0";
    textarea.style.border = "none";
    document.body.appendChild(textarea);

    input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
  });

  afterEach(() => {
    document.body.removeChild(textarea);
    document.body.removeChild(input);
  });

  describe("isAtStart", () => {
    it("returns true when cursor at position 0", () => {
      textarea.value = "hello world";
      textarea.setSelectionRange(0, 0);
      expect(CursorBoundary.isAtStart(textarea)).toBe(true);
    });

    it("returns false when cursor not at start", () => {
      textarea.value = "hello world";
      textarea.setSelectionRange(5, 5);
      expect(CursorBoundary.isAtStart(textarea)).toBe(false);
    });

    it("returns true for null element", () => {
      expect(CursorBoundary.isAtStart(null)).toBe(true);
    });

    it("returns true for empty input with cursor at 0", () => {
      textarea.value = "";
      textarea.setSelectionRange(0, 0);
      expect(CursorBoundary.isAtStart(textarea)).toBe(true);
    });
  });

  describe("isAtEnd", () => {
    it("returns true when cursor at text length", () => {
      textarea.value = "hello";
      textarea.setSelectionRange(5, 5);
      expect(CursorBoundary.isAtEnd(textarea)).toBe(true);
    });

    it("returns false when cursor not at end", () => {
      textarea.value = "hello";
      textarea.setSelectionRange(2, 2);
      expect(CursorBoundary.isAtEnd(textarea)).toBe(false);
    });

    it("returns true for empty input", () => {
      textarea.value = "";
      expect(CursorBoundary.isAtEnd(textarea)).toBe(true);
    });

    it("returns true for null element", () => {
      expect(CursorBoundary.isAtEnd(null)).toBe(true);
    });
  });

  describe("isEmpty", () => {
    it("returns true when input has no text", () => {
      textarea.value = "";
      expect(CursorBoundary.isEmpty(textarea)).toBe(true);
    });

    it("returns false when input has text", () => {
      textarea.value = "some text";
      expect(CursorBoundary.isEmpty(textarea)).toBe(false);
    });

    it("returns true for null element", () => {
      expect(CursorBoundary.isEmpty(null)).toBe(true);
    });
  });

  describe("isOnFirstLine", () => {
    it("returns true when no newline before cursor", () => {
      textarea.value = "first line\nsecond line";
      textarea.setSelectionRange(5, 5); // Middle of first line
      expect(CursorBoundary.isOnFirstLine(textarea)).toBe(true);
    });

    it("returns false when newline exists before cursor", () => {
      textarea.value = "first line\nsecond line";
      textarea.setSelectionRange(15, 15); // On second line
      expect(CursorBoundary.isOnFirstLine(textarea)).toBe(false);
    });

    it("returns true for empty input", () => {
      textarea.value = "";
      expect(CursorBoundary.isOnFirstLine(textarea)).toBe(true);
    });

    it("returns true for null element", () => {
      expect(CursorBoundary.isOnFirstLine(null)).toBe(true);
    });

    it("returns true even when text wraps (ignores word-wrap)", () => {
      // Long text that would wrap visually but has no \n
      textarea.value = "This is a very long line that will definitely wrap";
      textarea.setSelectionRange(30, 30);
      expect(CursorBoundary.isOnFirstLine(textarea)).toBe(true);
    });
  });

  describe("isOnLastLine", () => {
    it("returns true when no newline after cursor", () => {
      textarea.value = "first line\nsecond line";
      textarea.setSelectionRange(15, 15); // On second line
      expect(CursorBoundary.isOnLastLine(textarea)).toBe(true);
    });

    it("returns false when newline exists after cursor", () => {
      textarea.value = "first line\nsecond line";
      textarea.setSelectionRange(5, 5); // On first line
      expect(CursorBoundary.isOnLastLine(textarea)).toBe(false);
    });

    it("returns true for empty input", () => {
      textarea.value = "";
      expect(CursorBoundary.isOnLastLine(textarea)).toBe(true);
    });

    it("returns true for null element", () => {
      expect(CursorBoundary.isOnLastLine(null)).toBe(true);
    });

    it("handles trailing newline correctly", () => {
      textarea.value = "line one\n";
      textarea.setSelectionRange(4, 4); // Before the newline
      expect(CursorBoundary.isOnLastLine(textarea)).toBe(false);

      textarea.setSelectionRange(9, 9); // After the newline
      expect(CursorBoundary.isOnLastLine(textarea)).toBe(true);
    });
  });

  describe("isOnTopRow (visual row detection)", () => {
    it("returns true when cursor on first visual row", () => {
      textarea.value = "short";
      textarea.setSelectionRange(2, 2);
      expect(CursorBoundary.isOnTopRow(textarea)).toBe(true);
    });

    it("returns true when cursor at position 0", () => {
      textarea.value = "some text here";
      textarea.setSelectionRange(0, 0);
      expect(CursorBoundary.isOnTopRow(textarea)).toBe(true);
    });

    it("returns false when on second line after newline", () => {
      textarea.value = "first\nsecond";
      textarea.setSelectionRange(8, 8); // On "second"
      expect(CursorBoundary.isOnTopRow(textarea)).toBe(false);
    });

    it("returns true for empty input", () => {
      textarea.value = "";
      expect(CursorBoundary.isOnTopRow(textarea)).toBe(true);
    });

    it("returns true for null element", () => {
      expect(CursorBoundary.isOnTopRow(null)).toBe(true);
    });

    it("returns true for HTMLInputElement (always single row)", () => {
      input.value = "some long text that would wrap if it were a textarea";
      input.setSelectionRange(30, 30);
      expect(CursorBoundary.isOnTopRow(input)).toBe(true);
    });
  });

  describe("isOnBottomRow (visual row detection)", () => {
    it("returns true when cursor on last visual row", () => {
      textarea.value = "first\nlast";
      textarea.setSelectionRange(8, 8); // On "last"
      expect(CursorBoundary.isOnBottomRow(textarea)).toBe(true);
    });

    it("returns true when cursor at end of text", () => {
      textarea.value = "some text";
      textarea.setSelectionRange(9, 9);
      expect(CursorBoundary.isOnBottomRow(textarea)).toBe(true);
    });

    it("returns false when cursor is above last visual row", () => {
      textarea.value = "first\nsecond\nthird";
      textarea.setSelectionRange(3, 3); // On "first"
      expect(CursorBoundary.isOnBottomRow(textarea)).toBe(false);
    });

    it("returns true for empty input", () => {
      textarea.value = "";
      expect(CursorBoundary.isOnBottomRow(textarea)).toBe(true);
    });

    it("returns true for null element", () => {
      expect(CursorBoundary.isOnBottomRow(null)).toBe(true);
    });

    it("returns true for HTMLInputElement (always single row)", () => {
      input.value = "some text";
      input.setSelectionRange(3, 3);
      expect(CursorBoundary.isOnBottomRow(input)).toBe(true);
    });
  });

  describe("hasSelection", () => {
    it("returns true when text is selected", () => {
      textarea.value = "hello world";
      textarea.setSelectionRange(0, 5); // Select "hello"
      expect(CursorBoundary.hasSelection(textarea)).toBe(true);
    });

    it("returns false when only cursor (no selection)", () => {
      textarea.value = "hello world";
      textarea.setSelectionRange(5, 5); // Just cursor
      expect(CursorBoundary.hasSelection(textarea)).toBe(false);
    });

    it("returns false for null element", () => {
      expect(CursorBoundary.hasSelection(null)).toBe(false);
    });

    it("returns false for empty input", () => {
      textarea.value = "";
      expect(CursorBoundary.hasSelection(textarea)).toBe(false);
    });
  });

  describe("getPosition", () => {
    it("returns cursor position", () => {
      textarea.value = "hello world";
      textarea.setSelectionRange(5, 5);
      expect(CursorBoundary.getPosition(textarea)).toBe(5);
    });

    it("returns 0 for null element", () => {
      expect(CursorBoundary.getPosition(null)).toBe(0);
    });

    it("returns 0 for empty input", () => {
      textarea.value = "";
      expect(CursorBoundary.getPosition(textarea)).toBe(0);
    });
  });

  describe("setPosition", () => {
    it("sets cursor position", () => {
      textarea.value = "hello world";
      CursorBoundary.setPosition(textarea, 5);
      expect(textarea.selectionStart).toBe(5);
      expect(textarea.selectionEnd).toBe(5);
    });

    it("clamps position to valid range (too high)", () => {
      textarea.value = "hello";
      CursorBoundary.setPosition(textarea, 100);
      expect(textarea.selectionStart).toBe(5);
    });

    it("clamps position to valid range (negative)", () => {
      textarea.value = "hello";
      CursorBoundary.setPosition(textarea, -5);
      expect(textarea.selectionStart).toBe(0);
    });

    it("does nothing for null element", () => {
      expect(() => CursorBoundary.setPosition(null, 5)).not.toThrow();
    });
  });

  describe("moveToStart", () => {
    it("moves cursor to position 0", () => {
      textarea.value = "hello world";
      textarea.setSelectionRange(8, 8);
      CursorBoundary.moveToStart(textarea);
      expect(textarea.selectionStart).toBe(0);
      expect(textarea.selectionEnd).toBe(0);
    });

    it("does nothing for null element", () => {
      expect(() => CursorBoundary.moveToStart(null)).not.toThrow();
    });
  });

  describe("moveToEnd", () => {
    it("moves cursor to end of text", () => {
      textarea.value = "hello world";
      textarea.setSelectionRange(0, 0);
      CursorBoundary.moveToEnd(textarea);
      expect(textarea.selectionStart).toBe(11);
      expect(textarea.selectionEnd).toBe(11);
    });

    it("does nothing for null element", () => {
      expect(() => CursorBoundary.moveToEnd(null)).not.toThrow();
    });
  });

  describe("getBoundaries", () => {
    it("returns null for null element", () => {
      expect(CursorBoundary.getBoundaries(null)).toBe(null);
    });

    it("returns all boundary info for empty input", () => {
      textarea.value = "";
      const boundaries = CursorBoundary.getBoundaries(textarea);

      expect(boundaries).toEqual({
        isAtStart: true,
        isAtEnd: true,
        isEmpty: true,
        isOnTopRow: true,
        isOnBottomRow: true,
        isOnFirstLine: true,
        isOnLastLine: true,
        hasSelection: false,
        cursorPosition: 0,
        textLength: 0,
      });
    });

    it("returns correct boundaries for cursor in middle of multiline text", () => {
      textarea.value = "first line\nsecond line\nthird line";
      textarea.setSelectionRange(15, 15); // Middle of "second line"

      const boundaries = CursorBoundary.getBoundaries(textarea);

      expect(boundaries?.isAtStart).toBe(false);
      expect(boundaries?.isAtEnd).toBe(false);
      expect(boundaries?.isEmpty).toBe(false);
      expect(boundaries?.isOnFirstLine).toBe(false);
      expect(boundaries?.isOnLastLine).toBe(false);
      expect(boundaries?.hasSelection).toBe(false);
      expect(boundaries?.cursorPosition).toBe(15);
      expect(boundaries?.textLength).toBe(33);
    });

    it("returns correct boundaries for cursor at end", () => {
      textarea.value = "hello";
      textarea.setSelectionRange(5, 5);

      const boundaries = CursorBoundary.getBoundaries(textarea);

      expect(boundaries?.isAtStart).toBe(false);
      expect(boundaries?.isAtEnd).toBe(true);
      expect(boundaries?.isOnFirstLine).toBe(true);
      expect(boundaries?.isOnLastLine).toBe(true);
    });
  });

  describe("getCoordinates", () => {
    it("returns null for null element", () => {
      expect(CursorBoundary.getCoordinates(null)).toBe(null);
    });

    it("returns coordinates with cursor index", () => {
      textarea.value = "hello world";
      textarea.setSelectionRange(5, 5);

      const coords = CursorBoundary.getCoordinates(textarea);

      expect(coords).not.toBe(null);
      expect(coords?.index).toBe(5);
      expect(typeof coords?.x).toBe("number");
      expect(typeof coords?.y).toBe("number");
    });

    it("returns coordinates for HTMLInputElement", () => {
      input.value = "hello";
      input.setSelectionRange(2, 2);

      const coords = CursorBoundary.getCoordinates(input);

      expect(coords).not.toBe(null);
      expect(coords?.index).toBe(2);
    });
  });
});
