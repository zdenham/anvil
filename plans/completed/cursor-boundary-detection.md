# Cursor Boundary Detection - Implementation Plan

## Overview

Create a reusable utility for detecting cursor position boundaries in text inputs/textareas, enabling conditional navigation behaviors based on whether the cursor is at the start, end, top visual row, or bottom visual row of the input.

**Primary Goal: Visual Row Detection**

The key feature is detecting **visual rows** (what the user actually sees after word-wrap), NOT logical lines (text separated by `\n`). When a user presses ArrowUp, they expect to move up one visual row—if they're already on the top visual row, that's when we should intercept and navigate elsewhere.

## Current State Analysis

### Existing Patterns Found

The codebase has **15+ locations** with cursor boundary or navigation index logic:

| Location | Pattern Used | Boundary Logic |
|----------|--------------|----------------|
| `thread-input.tsx:42-53` | `isCursorOnFirstLine`/`isCursorOnLastLine` | Checks for `\n` before/after cursor |
| `spotlight.tsx:964-967` | `isAtEnd` check | `cursorPos === inputLength` |
| `spotlight.tsx:985` | `notOnFirstWorktree` | Index boundary check |
| `trigger-search-input.tsx:109-111` | `getCursorPosition`/`setCursorPosition` | Uses `selectionStart`/`setSelectionRange` |
| `trigger-search-input.tsx:129-144` | `Math.min`/`Math.max` clamping | Index navigation |
| `use-question-keyboard.ts:49-60` | `Math.min`/`Math.max` clamping | Index navigation |
| `use-code-block-keyboard.ts:28` | Double modulo wrapping | `((i % len) + len) % len` |
| `use-diff-navigation.ts:40-46` | `Math.min`/`Math.max` clamping | Index navigation |
| `permission-store.ts:144-156` | `Math.min`/`Math.max` clamping | Index navigation |
| `quick-actions-store.ts:104-110` | `Math.min`/`Math.max` clamping | Index navigation |
| `clipboard-manager.tsx:146-155` | Ternary stay-at-boundary | Index navigation |
| `InboxListWindow.tsx:136-148` | Conditional wrapping | Index navigation |

### Two Distinct Problem Domains

1. **Cursor Boundary Detection** (text inputs)
   - Is cursor at start/end of text?
   - Is cursor on first/last visual row? (accounting for word wrap)
   - Used for: conditional arrow key behavior in inputs

2. **Index Navigation** (list/item selection)
   - Clamping: stay at boundary
   - Wrapping: cycle around
   - Used for: navigating through lists, results, options

This plan focuses primarily on **#1 (Cursor Boundary Detection)** since that's the specific need mentioned. Index navigation is a related but separate concern that could be addressed in a follow-up.

**⚠️ Critical Distinction:** Most existing code checks for `\n` characters (logical lines), but we need **visual row detection** that accounts for word-wrap. These are fundamentally different—see the next section.

---

## Critical Design Decision: Visual Row Detection (Primary Requirement)

### The Problem

The current `thread-input.tsx` implementation checks for `\n` characters:

```typescript
const isCursorOnFirstLine = (textarea) => {
  const textBeforeCursor = textarea.value.substring(0, cursorPos);
  return !textBeforeCursor.includes('\n');
};
```

This detects **logical lines** (separated by newlines), NOT **visual rows** (what the user sees after word-wrap). Consider:

```
┌─────────────────────┐
│ This is a very long │  ← Visual row 1
│ sentence that wraps │  ← Visual row 2  } Same logical line!
│ around.             │  ← Visual row 3
│                     │
│ Second paragraph.   │  ← Visual row 4 (logical line 2)
└─────────────────────┘
```

If the cursor is at the start of "sentence" (visual row 2), pressing ArrowUp should move within the same logical line—but currently the code would think we're still on the "first line" and might trigger navigation away.

**This is the bug we're fixing:** The utility MUST detect visual rows, not logical lines, to correctly determine when arrow key navigation should be intercepted.

### Visual Row Detection (How It Works)

To detect visual rows, we need to measure where text actually renders. Checking for `\n` characters is **not sufficient**—we must perform actual layout measurement. The reliable approach:

1. **Use a hidden "mirror" div** that matches the textarea's styling
2. **Measure character positions** by inserting a marker span at the cursor position
3. **Compare Y coordinates** to determine which visual row the cursor is on

```typescript
function isOnTopVisualRow(textarea: HTMLTextAreaElement): boolean {
  // Get cursor position's Y coordinate
  const cursorY = getCursorYPosition(textarea);

  // Get the Y coordinate of the first character
  const firstCharY = getCharYPosition(textarea, 0);

  // If they're on the same row (within line-height tolerance)
  return Math.abs(cursorY - firstCharY) < lineHeight;
}
```

### Implementation Approach: Mirror Div

**Why mirror div over alternatives?**
- `contenteditable` would make this trivial (direct `Range.getBoundingClientRect()`) but requires migration effort and has other trade-offs (paste sanitization, form handling, undo behavior)
- "Let it happen, then check" approach (detect if cursor moved after keypress) has perceptible lag
- `caretRangeFromPoint`/`caretPositionFromPoint` APIs give position *from* coordinates, not the other way around

The mirror div approach is battle-tested (CodeMirror, Monaco use variants) and once abstracted, the complexity is hidden:

```typescript
function getCursorCoordinates(
  element: HTMLTextAreaElement | HTMLInputElement
): { x: number; y: number } | null {
  // Create a mirror div with identical styling
  const mirror = createMirrorDiv(element);

  // Insert text up to cursor, then a span marker
  const textBeforeCursor = element.value.substring(0, element.selectionStart);
  const marker = document.createElement('span');
  marker.textContent = '|'; // Or zero-width char

  mirror.textContent = textBeforeCursor;
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const rect = marker.getBoundingClientRect();
  document.body.removeChild(mirror);

  return { x: rect.left, y: rect.top };
}
```

---

## Trade-offs: Hook vs Pure Functions

### Why NOT a Hook

A React hook that returns boundary state has fundamental problems:

1. **Stale closures** - Boundary values computed during render are stale by the time a `keydown` handler fires. The cursor may have moved.

2. **Unnecessary re-renders** - Tracking cursor position in state would cause re-renders on every keystroke/click.

3. **Timing issues** - We need the boundary state *at the exact moment* of the keyboard event, not the last React render cycle.

### Recommended: Pure Utility Functions

Pass the element directly and compute boundaries on-demand:

```typescript
// At the moment of the keydown event:
function handleKeyDown(e: KeyboardEvent) {
  const textarea = e.target as HTMLTextAreaElement;

  if (e.key === 'ArrowUp' && CursorBoundary.isOnTopRow(textarea)) {
    e.preventDefault();
    navigateToQuickActions();
  }
}
```

**Benefits:**
- Always fresh - computed at call time with current DOM state
- No stale closures - no captured values to go stale
- No React overhead - pure DOM operations
- Handles resize automatically - measures current layout each time
- Testable - pure functions with clear inputs/outputs

---

## Proposed API Design

### Pure Utility Module: `CursorBoundary`

```typescript
// src/lib/cursor-boundary.ts

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
  isAtStart: boolean;        // cursorPos === 0
  isAtEnd: boolean;          // cursorPos === text.length
  isEmpty: boolean;          // text.length === 0

  // Visual row boundaries (accounts for word-wrap)
  isOnTopRow: boolean;       // cursor is on the topmost visual row
  isOnBottomRow: boolean;    // cursor is on the bottommost visual row

  // Logical line boundaries (fast, checks \n only)
  isOnFirstLine: boolean;    // no \n before cursor
  isOnLastLine: boolean;     // no \n after cursor

  // Selection state
  hasSelection: boolean;     // selectionStart !== selectionEnd

  // Raw values
  cursorPosition: number;
  textLength: number;
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
  getBoundaries(element: TextInputElement | null): BoundaryInfo | null,

  // === Position Boundaries ===

  /** Check if cursor is at position 0 */
  isAtStart(element: TextInputElement | null): boolean,

  /** Check if cursor is at the end of the text */
  isAtEnd(element: TextInputElement | null): boolean,

  /** Check if input has no text */
  isEmpty(element: TextInputElement | null): boolean,

  // === Visual Row Boundaries (layout measurement) ===

  /**
   * Check if cursor is on the topmost visual row.
   * Accounts for word-wrap and element width.
   */
  isOnTopRow(element: TextInputElement | null): boolean,

  /**
   * Check if cursor is on the bottommost visual row.
   * Accounts for word-wrap and element width.
   */
  isOnBottomRow(element: TextInputElement | null): boolean,

  // === Logical Line Boundaries (fast, no layout) ===

  /**
   * Check if cursor is on the first logical line (no \n before cursor).
   * Faster than isOnTopRow but doesn't account for word-wrap.
   */
  isOnFirstLine(element: TextInputElement | null): boolean,

  /**
   * Check if cursor is on the last logical line (no \n after cursor).
   * Faster than isOnBottomRow but doesn't account for word-wrap.
   */
  isOnLastLine(element: TextInputElement | null): boolean,

  // === Selection State ===

  /** Check if text is selected (not just a cursor) */
  hasSelection(element: TextInputElement | null): boolean,

  // === Position Getters/Setters ===

  /** Get the cursor's current character index */
  getPosition(element: TextInputElement | null): number,

  /** Get cursor coordinates (requires layout measurement) */
  getCoordinates(element: TextInputElement | null): CursorPosition | null,

  /** Set cursor position */
  setPosition(element: TextInputElement | null, position: number): void,

  /** Move cursor to start */
  moveToStart(element: TextInputElement | null): void,

  /** Move cursor to end */
  moveToEnd(element: TextInputElement | null): void,
} as const;
```

### Usage Examples

```typescript
// In a keydown handler - always fresh, never stale
function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  const textarea = e.currentTarget;

  if (e.key === 'ArrowUp' && CursorBoundary.isOnTopRow(textarea)) {
    e.preventDefault();
    onNavigateToQuickActions();
    return;
  }

  if (e.key === 'ArrowRight' && CursorBoundary.isAtEnd(textarea)) {
    e.preventDefault();
    cycleToNextWorktree();
    return;
  }
}

// Can also get all boundaries at once if checking multiple
function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  const boundaries = CursorBoundary.getBoundaries(e.currentTarget);
  if (!boundaries) return;

  if (e.key === 'ArrowUp' && boundaries.isOnTopRow) { ... }
  if (e.key === 'ArrowDown' && boundaries.isOnBottomRow) { ... }
}
```

---

## Implementation Details

### Visual Row Detection Algorithm

```typescript
function isOnTopRow(element: TextInputElement): boolean {
  if (!element) return true;

  const cursorPos = element.selectionStart ?? 0;
  if (cursorPos === 0) return true;

  // Get computed styles for accurate measurement
  const styles = window.getComputedStyle(element);
  const lineHeight = parseFloat(styles.lineHeight) ||
                     parseFloat(styles.fontSize) * 1.2;

  // Create mirror div matching element's text rendering
  const mirror = document.createElement('div');
  copyStyles(element, mirror);
  mirror.style.position = 'absolute';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';      // Match textarea wrapping
  mirror.style.wordWrap = 'break-word';
  mirror.style.width = `${element.clientWidth}px`;  // Critical: same width!

  // Measure cursor Y position
  const textBefore = element.value.substring(0, cursorPos);
  const cursorMarker = document.createElement('span');
  cursorMarker.textContent = '\u200B'; // Zero-width space

  mirror.textContent = '';
  mirror.appendChild(document.createTextNode(textBefore));
  mirror.appendChild(cursorMarker);

  document.body.appendChild(mirror);
  const cursorY = cursorMarker.offsetTop;

  // Measure first character Y position
  mirror.textContent = '';
  const startMarker = document.createElement('span');
  startMarker.textContent = '\u200B';
  mirror.appendChild(startMarker);
  mirror.appendChild(document.createTextNode(element.value));

  const startY = startMarker.offsetTop;
  document.body.removeChild(mirror);

  // Same row if within line-height tolerance
  return Math.abs(cursorY - startY) < lineHeight * 0.5;
}
```

### Performance Considerations

1. **Layout measurement is expensive** - `isOnTopRow`/`isOnBottomRow` trigger layout. Use `isOnFirstLine`/`isOnLastLine` when word-wrap isn't a concern.

2. **Call sparingly** - Only call boundary checks in response to specific events (keydown), not on every render.

3. **Mirror div caching** - Could cache the mirror div and reuse it, but the overhead is minimal for event-driven checks.

4. **`getBoundaries()` batches measurements** - If checking multiple boundaries, use `getBoundaries()` once rather than multiple individual calls.

---

## Implementation Steps

### Phase 1: Core Implementation

1. **Create `src/lib/cursor-boundary.ts`**
   - Implement all pure utility functions
   - Handle edge cases (null element, empty input, single-line inputs)
   - Add JSDoc comments

2. **Create `src/lib/cursor-boundary.test.ts`**
   - Unit tests with JSDOM
   - Test visual row detection with controlled widths
   - Test edge cases

### Phase 2: Migration

Refactor existing components:

| File | Current Code | Migration |
|------|--------------|-----------|
| `thread-input.tsx` | Inline `isCursorOnFirstLine`/`isCursorOnLastLine` (checks `\n` only) | Use `CursorBoundary.isOnTopRow`/`isOnBottomRow` (visual row detection) |
| `spotlight.tsx` | Inline `cursorPos === inputLength` | Use `CursorBoundary.isAtEnd` |
| `trigger-search-input.tsx` | Inline `selectionStart` access | Use `CursorBoundary.getPosition`/`setPosition` |

### Phase 3: Optional - Index Navigation Utility

Separate utility for list navigation patterns:

```typescript
// src/lib/index-navigation.ts

export type WrapBehavior = 'clamp' | 'wrap' | 'stay';

export function navigateIndex(
  current: number,
  direction: 'next' | 'prev',
  length: number,
  behavior: WrapBehavior = 'clamp'
): number;
```

---

## Files to Create

1. `src/lib/cursor-boundary.ts` - Pure utility functions
2. `src/lib/cursor-boundary.test.ts` - Unit tests

## Files to Modify

1. `src/components/reusable/thread-input.tsx`
   - Remove inline `isCursorOnFirstLine`/`isCursorOnLastLine`
   - Import and use `CursorBoundary`

2. `src/components/spotlight/spotlight.tsx`
   - Replace inline cursor position checks

3. `src/components/reusable/trigger-search-input.tsx`
   - Use `CursorBoundary.getPosition`/`setPosition` in imperative handle

---

## Edge Cases to Handle

1. **Null element** - Return safe defaults (`true` for boundary checks, `false` for `hasSelection`)
2. **Empty input** - `isEmpty` true, `isAtStart`, `isAtEnd`, `isOnTopRow`, `isOnBottomRow` all true
3. **Single character** - All boundary checks true when cursor at either end
4. **HTMLInputElement** - Always single row, so `isOnTopRow`/`isOnBottomRow` always true
5. **Hidden element** - Layout measurement may fail; fall back to logical line checks
6. **Zero-width element** - Treat as single column, all on same row
7. **RTL text** - X coordinates may differ, but Y-based row detection still works
8. **Text selected** - `hasSelection` true; boundary checks use `selectionStart` for position

---

## Testing Strategy

### Unit Tests

```typescript
describe('CursorBoundary', () => {
  describe('isAtStart', () => {
    it('returns true when cursor at position 0');
    it('returns false when cursor not at start');
    it('returns true for null element');
  });

  describe('isAtEnd', () => {
    it('returns true when cursor at text length');
    it('returns false when cursor not at end');
    it('returns true for empty input');
  });

  describe('isEmpty', () => {
    it('returns true when input has no text');
    it('returns false when input has text');
    it('returns true for null element');
  });

  describe('isOnTopRow', () => {
    it('returns true when cursor on first visual row');
    it('returns false when on wrapped portion of first logical line');
    it('returns false when on second line after newline');
    it('handles word-wrap correctly');
    it('recalculates when element width changes');
  });

  describe('isOnBottomRow', () => {
    it('returns true when cursor on last visual row');
    it('returns false when cursor is above last visual row');
    it('handles trailing newline correctly');
  });

  describe('isOnFirstLine / isOnLastLine', () => {
    it('checks for newline characters only');
    it('ignores word-wrap (returns true even when text wraps)');
  });

  describe('hasSelection', () => {
    it('returns true when text is selected');
    it('returns false when only cursor (no selection)');
    it('returns false for null element');
  });
});
```

### Integration Tests

- Test keyboard navigation in `thread-input` with resize
- Test worktree cycling in spotlight

---

## Summary

**Use pure utility functions, not a hook:**

1. `CursorBoundary` module with static methods
2. Pass element directly at call time (in event handlers)
3. No stale closures, no React state, no timing issues
4. **Visual row detection via layout measurement** - the primary feature that accounts for word-wrap
5. Logical line checks (`isOnFirstLine`/`isOnLastLine`) available as faster alternative when wrap doesn't matter

**Key Takeaway:** The whole point of this utility is to detect **visual rows** (where text renders after word-wrap), not logical lines (text between `\n` characters). The `isOnTopRow`/`isOnBottomRow` functions perform actual DOM layout measurement to determine the cursor's visual position.
