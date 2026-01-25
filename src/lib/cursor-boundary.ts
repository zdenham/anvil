/**
 * Pure utility functions for cursor boundary detection in text inputs and textareas.
 *
 * Key distinction:
 * - Visual rows: What the user sees after word-wrap (requires layout measurement)
 * - Logical lines: Text separated by \n characters (fast, no layout needed)
 *
 * Use `isOnTopRow`/`isOnBottomRow` for visual row detection (accounts for word-wrap).
 * Use `isOnFirstLine`/`isOnLastLine` for logical line detection (faster, checks \n only).
 */

export type TextInputElement = HTMLTextAreaElement | HTMLInputElement;

export interface CursorPosition {
  /** Character index in the text (selectionStart) */
  index: number;
  /** X coordinate relative to viewport */
  x: number;
  /** Y coordinate relative to viewport */
  y: number;
}

export interface BoundaryInfo {
  // Position boundaries
  isAtStart: boolean; // cursorPos === 0
  isAtEnd: boolean; // cursorPos === text.length
  isEmpty: boolean; // text.length === 0

  // Visual row boundaries (accounts for word-wrap)
  isOnTopRow: boolean; // cursor is on the topmost visual row
  isOnBottomRow: boolean; // cursor is on the bottommost visual row

  // Logical line boundaries (fast, checks \n only)
  isOnFirstLine: boolean; // no \n before cursor
  isOnLastLine: boolean; // no \n after cursor

  // Selection state
  hasSelection: boolean; // selectionStart !== selectionEnd

  // Raw values
  cursorPosition: number;
  textLength: number;
}

// Styles to copy from textarea to mirror div for accurate measurement
const MIRROR_STYLES = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "letter-spacing",
  "line-height",
  "text-transform",
  "word-spacing",
  "text-indent",
  "white-space",
  "word-wrap",
  "word-break",
  "overflow-wrap",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border",
  "border-width",
  "box-sizing",
] as const;

/**
 * Creates a mirror div that matches the textarea's text rendering.
 * Used for measuring cursor position in visual rows.
 */
function createMirrorDiv(element: TextInputElement): HTMLDivElement {
  const mirror = document.createElement("div");
  const computed = window.getComputedStyle(element);

  // Copy relevant styles
  for (const prop of MIRROR_STYLES) {
    mirror.style.setProperty(prop, computed.getPropertyValue(prop));
  }

  // Position off-screen but in document flow for accurate measurement
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.top = "-9999px";
  mirror.style.left = "-9999px";

  // Match textarea wrapping behavior
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflowWrap = "break-word";

  // Critical: same width as the element for accurate wrap points
  mirror.style.width = `${element.clientWidth}px`;

  // Prevent scrollbars from affecting measurement
  mirror.style.overflow = "hidden";

  return mirror;
}

/**
 * Gets the computed line height of an element in pixels.
 */
function getLineHeight(element: TextInputElement): number {
  const computed = window.getComputedStyle(element);
  const lineHeight = parseFloat(computed.lineHeight);

  // If lineHeight is "normal", estimate from fontSize
  if (isNaN(lineHeight)) {
    const fontSize = parseFloat(computed.fontSize);
    return fontSize * 1.2; // Standard approximation
  }

  return lineHeight;
}

/**
 * Measures the Y position of text at a given character index.
 * Returns the offsetTop of a marker span inserted at that position.
 */
function measureYPosition(
  element: TextInputElement,
  charIndex: number,
  mirror: HTMLDivElement
): number {
  const text = element.value;
  const textBefore = text.substring(0, charIndex);
  const textAfter = text.substring(charIndex);

  // Clear and rebuild mirror content
  mirror.textContent = "";

  // Add text before cursor
  if (textBefore) {
    mirror.appendChild(document.createTextNode(textBefore));
  }

  // Add marker span at cursor position
  const marker = document.createElement("span");
  marker.textContent = "\u200B"; // Zero-width space
  mirror.appendChild(marker);

  // Add text after cursor (to ensure proper layout)
  if (textAfter) {
    mirror.appendChild(document.createTextNode(textAfter));
  }

  return marker.offsetTop;
}

/**
 * Pure utility functions for cursor boundary detection.
 * All functions take the element directly - no caching, no stale state.
 */
export const CursorBoundary = {
  /**
   * Get all boundary information at once.
   * Performs layout measurement - call only when needed.
   */
  getBoundaries(element: TextInputElement | null): BoundaryInfo | null {
    if (!element) return null;

    const cursorPosition = element.selectionStart ?? 0;
    const textLength = element.value.length;
    const text = element.value;

    return {
      isAtStart: cursorPosition === 0,
      isAtEnd: cursorPosition === textLength,
      isEmpty: textLength === 0,
      isOnTopRow: this.isOnTopRow(element),
      isOnBottomRow: this.isOnBottomRow(element),
      isOnFirstLine: !text.substring(0, cursorPosition).includes("\n"),
      isOnLastLine: !text.substring(cursorPosition).includes("\n"),
      hasSelection: element.selectionStart !== element.selectionEnd,
      cursorPosition,
      textLength,
    };
  },

  // === Position Boundaries ===

  /** Check if cursor is at position 0 */
  isAtStart(element: TextInputElement | null): boolean {
    if (!element) return true;
    return (element.selectionStart ?? 0) === 0;
  },

  /** Check if cursor is at the end of the text */
  isAtEnd(element: TextInputElement | null): boolean {
    if (!element) return true;
    return (element.selectionStart ?? 0) === element.value.length;
  },

  /** Check if input has no text */
  isEmpty(element: TextInputElement | null): boolean {
    if (!element) return true;
    return element.value.length === 0;
  },

  // === Visual Row Boundaries (layout measurement) ===

  /**
   * Check if cursor is on the topmost visual row.
   * Accounts for word-wrap and element width.
   */
  isOnTopRow(element: TextInputElement | null): boolean {
    if (!element) return true;

    // HTMLInputElement is always single-line
    if (element instanceof HTMLInputElement) return true;

    const cursorPos = element.selectionStart ?? 0;

    // If cursor is at start, definitely on top row
    if (cursorPos === 0) return true;

    // If element has no width (hidden), fall back to logical line check
    if (element.clientWidth === 0) {
      return !element.value.substring(0, cursorPos).includes("\n");
    }

    const lineHeight = getLineHeight(element);
    const mirror = createMirrorDiv(element);

    document.body.appendChild(mirror);

    try {
      // Measure cursor Y position
      const cursorY = measureYPosition(element, cursorPos, mirror);

      // Measure start Y position (position 0)
      const startY = measureYPosition(element, 0, mirror);

      // Same row if within half line-height tolerance
      return Math.abs(cursorY - startY) < lineHeight * 0.5;
    } finally {
      document.body.removeChild(mirror);
    }
  },

  /**
   * Check if cursor is on the bottommost visual row.
   * Accounts for word-wrap and element width.
   */
  isOnBottomRow(element: TextInputElement | null): boolean {
    if (!element) return true;

    // HTMLInputElement is always single-line
    if (element instanceof HTMLInputElement) return true;

    const cursorPos = element.selectionStart ?? 0;
    const textLength = element.value.length;

    // If cursor is at end, definitely on bottom row
    if (cursorPos === textLength) return true;

    // If element has no width (hidden), fall back to logical line check
    if (element.clientWidth === 0) {
      return !element.value.substring(cursorPos).includes("\n");
    }

    const lineHeight = getLineHeight(element);
    const mirror = createMirrorDiv(element);

    document.body.appendChild(mirror);

    try {
      // Measure cursor Y position
      const cursorY = measureYPosition(element, cursorPos, mirror);

      // Measure end Y position
      const endY = measureYPosition(element, textLength, mirror);

      // Same row if within half line-height tolerance
      return Math.abs(cursorY - endY) < lineHeight * 0.5;
    } finally {
      document.body.removeChild(mirror);
    }
  },

  // === Logical Line Boundaries (fast, no layout) ===

  /**
   * Check if cursor is on the first logical line (no \n before cursor).
   * Faster than isOnTopRow but doesn't account for word-wrap.
   */
  isOnFirstLine(element: TextInputElement | null): boolean {
    if (!element) return true;
    const cursorPos = element.selectionStart ?? 0;
    const textBeforeCursor = element.value.substring(0, cursorPos);
    return !textBeforeCursor.includes("\n");
  },

  /**
   * Check if cursor is on the last logical line (no \n after cursor).
   * Faster than isOnBottomRow but doesn't account for word-wrap.
   */
  isOnLastLine(element: TextInputElement | null): boolean {
    if (!element) return true;
    const cursorPos = element.selectionStart ?? 0;
    const textAfterCursor = element.value.substring(cursorPos);
    return !textAfterCursor.includes("\n");
  },

  // === Selection State ===

  /** Check if text is selected (not just a cursor) */
  hasSelection(element: TextInputElement | null): boolean {
    if (!element) return false;
    return element.selectionStart !== element.selectionEnd;
  },

  // === Position Getters/Setters ===

  /** Get the cursor's current character index */
  getPosition(element: TextInputElement | null): number {
    if (!element) return 0;
    return element.selectionStart ?? 0;
  },

  /**
   * Get cursor coordinates relative to viewport.
   * Requires layout measurement.
   */
  getCoordinates(element: TextInputElement | null): CursorPosition | null {
    if (!element) return null;

    const cursorIndex = element.selectionStart ?? 0;

    // For single-line inputs, use simpler approach
    if (element instanceof HTMLInputElement) {
      const rect = element.getBoundingClientRect();
      // Approximate x position (this is imprecise for inputs)
      return {
        index: cursorIndex,
        x: rect.left,
        y: rect.top,
      };
    }

    // For textareas, use mirror div measurement
    const mirror = createMirrorDiv(element);
    document.body.appendChild(mirror);

    try {
      const text = element.value;
      const textBefore = text.substring(0, cursorIndex);

      mirror.textContent = "";
      if (textBefore) {
        mirror.appendChild(document.createTextNode(textBefore));
      }

      const marker = document.createElement("span");
      marker.textContent = "\u200B";
      mirror.appendChild(marker);

      const markerRect = marker.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();

      // Adjust coordinates relative to the element's position
      return {
        index: cursorIndex,
        x: markerRect.left - mirror.getBoundingClientRect().left + elementRect.left,
        y: markerRect.top - mirror.getBoundingClientRect().top + elementRect.top,
      };
    } finally {
      document.body.removeChild(mirror);
    }
  },

  /** Set cursor position */
  setPosition(element: TextInputElement | null, position: number): void {
    if (!element) return;
    const clampedPos = Math.max(0, Math.min(position, element.value.length));
    element.setSelectionRange(clampedPos, clampedPos);
  },

  /** Move cursor to start */
  moveToStart(element: TextInputElement | null): void {
    if (!element) return;
    element.setSelectionRange(0, 0);
  },

  /** Move cursor to end */
  moveToEnd(element: TextInputElement | null): void {
    if (!element) return;
    const len = element.value.length;
    element.setSelectionRange(len, len);
  },
} as const;
