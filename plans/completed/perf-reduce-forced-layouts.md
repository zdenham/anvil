# Audit and Reduce Forced Layouts During Streaming

Extracted from `memory-and-perf-from-timeline.md` Phase 4.

## Phases

- [x] Identify forced layout call sites via code audit
- [ ] Fix search-input.tsx forced layout (HIGH — every keystroke)
- [ ] Fix cursor-boundary.ts forced layouts (MEDIUM — cursor row detection)
- [ ] Add CSS containment to virtualized containers
- [ ] Verify improvement with timeline recording

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Problem

27 forced synchronous layouts during 10s recording, with 13 (48%) concentrated during peak streaming activity. Layout invalidations triple from ~55/sec baseline to ~160/sec during streaming. 1,524ms total compositing time.

**Root cause**: Code reading layout properties (e.g. `scrollHeight`, `offsetWidth`, `getBoundingClientRect()`) after DOM mutations forces the browser to compute layout synchronously instead of batching it.

## Phase 1: Audit Results (COMPLETE)

Full codebase audit of all layout-triggering property reads. The original suspects (`message-list.tsx`, `thread-view.tsx`) turned out to be clean — Virtuoso handles all scroll synchronization internally. The `flushSync` in `thread-content.tsx` is also safe (no layout reads follow it).

### Confirmed Forced Layout Sites

#### 1. `src/components/reusable/search-input.tsx:80-81` — HIGH

```typescript
// checkExpansion() callback, lines 71-109
measure.textContent = lastLine || "\u00A0";           // DOM WRITE
const textWidth = measure.offsetWidth;                 // FORCED LAYOUT READ
const containerWidth = textarea.clientWidth - 32;      // FORCED LAYOUT READ
```

- **Trigger**: `handleChange()` (every keystroke) + `useEffect` (every value change)
- **Impact**: HIGH — fires on every single keystroke in any search/text input
- **Pattern**: Classic write-then-read in same synchronous block

#### 2. `src/lib/cursor-boundary.ts:95` — MEDIUM

```typescript
// createMirrorDiv(), line 95
mirror.style.width = `${element.clientWidth}px`;
```

- **Trigger**: Called from `isOnTopRow()`, `isOnBottomRow()`, `getCoordinates()` for cursor visual row detection
- **Impact**: MEDIUM — fires during cursor position detection in text inputs

#### 3. `src/lib/cursor-boundary.ts:150` — MEDIUM

```typescript
// measureYPosition(), lines 123-151
// appendChild calls at lines 137, 143, 147 (DOM WRITES)
return marker.offsetTop;  // FORCED LAYOUT READ
```

- **Trigger**: Helper for visual row detection — DOM mutations (appendChild) then immediate offsetTop read
- **Impact**: MEDIUM — called indirectly through cursor boundary detection

### Safe Patterns (No Action Needed)

| File | Pattern | Why Safe |
|------|---------|----------|
| `thread/message-list.tsx` | Virtuoso scroll APIs | Layout delegated to Virtuoso internally |
| `thread/thread-view.tsx` | No layout logic at all | Pure wrapper component |
| `content-pane/thread-content.tsx:325` | `flushSync` for optimistic messages | No layout reads follow the sync flush |
| `thread/use-thread-search.ts:276` | `getBoundingClientRect` x2 | Deferred via `setTimeout(100ms)`, reads grouped before write |
| `main-window/logs-page.tsx:49` | `scrollTop/scrollHeight/clientHeight` | Read in scroll event handler, no prior DOM mutation |
| `diff-viewer/use-diff-navigation.ts` | `IntersectionObserver` + `scrollIntoView` | Async observer, smooth scroll behavior |
| `terminal-content.tsx:194` | `ResizeObserver` → `requestAnimationFrame` | Double-deferred |
| Various components | `requestAnimationFrame` for scroll | Properly deferred to next frame |

### Inventory of All Layout Property Reads

| File | Line | Property | Context | Verdict |
|------|------|----------|---------|---------|
| `search-input.tsx` | 80-81 | `offsetWidth`, `clientWidth` | `checkExpansion()` | **FIX** |
| `cursor-boundary.ts` | 95 | `clientWidth` | `createMirrorDiv()` | **FIX** |
| `cursor-boundary.ts` | 150 | `offsetTop` | `measureYPosition()` | **FIX** |
| `cursor-boundary.ts` | 76,107 | `getComputedStyle` | Font/line-height measurement | OK |
| `cursor-boundary.ts` | 335,361 | `getBoundingClientRect` | Visual row detection utility | OK |
| `use-thread-search.ts` | 276-283 | `getBoundingClientRect` x2, `scrollTop` | Search scroll (100ms defer) | OK |
| `logs-page.tsx` | 49-50 | `scrollTop`, `scrollHeight`, `clientHeight` | Scroll event handler | OK |
| `use-content-search.ts` | 68 | `scrollIntoView` | Smooth scroll | OK |
| `use-diff-navigation.ts` | 30 | `scrollIntoView` | Smooth scroll | OK |
| `trigger-search-input.tsx` | 88 | `getBoundingClientRect` | Dropdown positioning | OK |
| `trigger-dropdown.tsx` | 133 | `getBoundingClientRect` | Dropdown positioning | OK |
| `repo-worktree-section.tsx` | 98 | `getBoundingClientRect` | Context menu positioning | OK |

## Phase 2: Fix search-input.tsx

The `checkExpansion()` function writes to a hidden measurement element then immediately reads its dimensions. Fix approach:

**Option A — Cache + RAF defer**: Read `containerWidth` once on mount and on resize (via ResizeObserver). Defer `offsetWidth` read to `requestAnimationFrame` so the browser can batch the layout pass after the textContent write.

```typescript
// Before: synchronous write-then-read
measure.textContent = lastLine || "\u00A0";
const textWidth = measure.offsetWidth;          // forces layout
const containerWidth = textarea.clientWidth - 32;  // forces layout

// After: defer to next frame
measure.textContent = lastLine || "\u00A0";
requestAnimationFrame(() => {
  const textWidth = measure.offsetWidth;
  const containerWidth = cachedContainerWidth;  // from ResizeObserver
  // ... expansion logic
});
```

**Option B — CSS-only**: Replace the JS measurement with CSS `field-sizing: content` (if browser support allows) or a `ch`-unit-based approach that doesn't require JS measurement at all.

**Recommendation**: Option A — straightforward, no browser compat concerns.

## Phase 3: Fix cursor-boundary.ts

Two sites create DOM elements then immediately read their layout positions.

**`createMirrorDiv` (line 95)**: Reads `element.clientWidth` to size a mirror. This read doesn't follow a DOM write in the same block — it reads the *source* element, not something just mutated. **Lower priority** — may not actually force layout if the element hasn't been mutated recently.

**`measureYPosition` (lines 123-151)**: Creates a mirror div, appends marker spans, then reads `marker.offsetTop`. This is a deliberate measurement utility — the forced layout is inherent to the approach (you can't measure position without triggering layout).

**Fix approach**: Cache the measurement results per-element and invalidate on resize. The cursor boundary detection doesn't need to re-measure on every call if the element dimensions haven't changed.

```typescript
// Add a simple cache keyed on element + content
const measurementCache = new WeakMap<HTMLElement, { content: string; result: number }>();
```

## Phase 4: Add CSS Containment

No CSS `contain` or `content-visibility` is used anywhere in the codebase. Adding containment to scroll containers limits the scope of layout recalculations.

**Targets** (all use `overflow-auto` and are natural containment boundaries):

| Container | File | Line | Suggestion |
|-----------|------|------|------------|
| Virtuoso message list wrapper | `message-list.tsx` | ~146 | `contain: strict` or `content-visibility: auto` on the scroller |
| Logs page scroller | `logs-page.tsx` | ~81 | `contain: strict` |
| Archive view scroller | `archive-view.tsx` | ~96 | `contain: content` |
| Search results scroller | `virtualized-results.tsx` | ~71 | `contain: content` |
| Virtualized file content | `virtualized-file-content.tsx` | ~71 | `contain: strict` |

**Impact**: Even if individual forced layouts still occur, containment prevents them from invalidating layout for the entire document tree. This directly addresses the "layout invalidations triple during streaming" problem.

**Note on Virtuoso**: Virtuoso's scroller may need `contain: layout paint` rather than `contain: strict` to avoid breaking its internal scroll measurement. Test carefully.

## Phase 5: Verify

Record a new Safari timeline during streaming and compare:
- Forced layout count should drop from 27 to <15 (search-input fix alone should help significantly during typing)
- Layout invalidation rate during streaming should stay closer to baseline (~55/sec) with containment
- No regression in scroll-to-bottom, search, or text input behavior
- CSS containment shouldn't cause visual clipping issues

## Notes

- The original suspects (`message-list.tsx` scroll logic, `thread-view.tsx` layout measurements) were **cleared** — Virtuoso abstracts these away cleanly.
- The `flushSync` in `thread-content.tsx` was also **cleared** — it's for optimistic UI, not layout measurement.
- The highest-impact fix is likely **search-input.tsx** since it fires on every keystroke, though it may not be the primary contributor during *streaming* (which is when the timeline showed peak forced layouts).
- CSS containment (Phase 4) is the broadest improvement — it reduces the *cost* of each layout invalidation even if the count doesn't drop.
- Previous perf phases (batching, debouncing, log removal) may have already reduced the DOM mutation frequency that was triggering these forced layouts, so the timeline numbers may already be lower than the original 27.
