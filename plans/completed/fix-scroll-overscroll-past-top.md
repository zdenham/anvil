# Fix: Scroll past top with transform-based correction

## Problem

Fast scroll-up shows a large blank gap at the top, then snaps back when scrolling stops.

## Root cause (from debug logs)

The correction is **negative** (-3232), not positive. Items are *shorter* than the 100px `estimateHeight`, so as items above the anchor get measured:

- `setItemHeights` returns a negative `changed` (anchor offset decreased)
- `correctionRef` accumulates to -3232
- Transform becomes `translateY(3232px)` — pushes content **down** by 3232px
- `effective = scrollTop + correction` goes deeply negative (e.g., scrollTop=500 → effective=-2732)
- The content wrapper is 3232px below its natural position — blank space fills the top

The idle absorption (150ms) then snaps: `scrollTop += -3232` clamps to 0, transform cleared, content jumps back into place.

## Solution

Two complementary changes:

1. **Absorb correction fully in onScroll** (`use-virtual-list.ts`): When `scrollTop + correction < 0`, write `scrollTop = max(0, scrollTop + correction)`, clear correction and transform. One-shot absorption settles in a single frame.

2. **`overscroll-behavior: contain`** (`message-list.tsx`): Prevents macOS elastic bounce at the scroll boundary, giving a hard stop when the correction is absorbed.

### Why absorb-all instead of per-frame capping

A per-frame cap (`correction = -scrollTop`) vibrates: each frame the ResizeObserver adds correction for newly-measured items, then the next onScroll caps it back, causing visible oscillation. A single full absorption settles in one frame.

## Phases

- [x] Add debug logs to diagnose actual correction direction and values
- [x] Absorb correction fully in onScroll when effective < 0 + add overscroll-behavior: contain
- [x] Remove debug logs
- [x] Add thorough inline documentation

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files

- `src/hooks/use-virtual-list.ts` — correction guard in onScroll + block comment on correctionRef
- `src/components/thread/message-list.tsx` — `overscrollBehavior: "contain"` on scroll container
