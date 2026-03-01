# Fix Sticky Scroll Behavior

## Problem

During streaming, once auto-scroll engages it's impossible to escape with mouse wheel because:
1. Three auto-scroll mechanisms all use the same `isAtBottom` position check (300px threshold)
2. User scrolls up → still within threshold → programmatic scroll snaps back → cycle repeats
3. Scrollbar dragging jitters because drag input competes with programmatic `scrollTo` every frame

## Solution: Intent-Based Sticky Flag

Replace the position-based `isAtBottom` auto-scroll trigger with an explicit `isSticky` boolean that tracks **user intent**, not scroll position.

### Core Concept

- `isSticky` = "should we auto-scroll?" — a latching flag
- `isAtBottom` = "is the viewport near the bottom?" — kept for the scroll-to-bottom button only
- User scrolls up → `isSticky = false` → auto-scroll stops
- User clicks "scroll to bottom" or scrolls to very bottom → `isSticky = true`

## Phases

- [ ] Add sticky state tracking to `useVirtualList` hook
- [ ] Update `followOutput` subscribers to use sticky flag instead of `isAtBottom`
- [ ] Update `MessageList` streaming ResizeObserver to use sticky flag
- [ ] Ensure re-engagement works (scroll-to-bottom button, manual scroll to bottom)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add sticky state tracking to `useVirtualList`

In `src/hooks/use-virtual-list.ts`:

1. Add new option: `sticky?: boolean` — enables sticky mode (opt-in, so other consumers like diff view are unaffected)
2. Track a `isStickyRef` inside the hook, initialized to `true` (start stuck at bottom)
3. **Detect user-initiated scrolls** by listening to `wheel` and `pointerdown` (on the scrollbar track) events on the scroll element:
   - On `wheel` with `deltaY < 0` (scroll up): set `isSticky = false`
   - On `pointerdown` on the scroll element (but not on content): set `isSticky = false` — user is grabbing the scrollbar
4. **Re-engage sticky** when user scrolls to within a small threshold (10-20px) of the bottom — detected in the existing scroll event handler
5. Expose `isSticky` in the snapshot/return value
6. Add `onStickyChange` callback option (like `onAtBottomChange`)

The scroll listener already exists at line 130. Add the user-intent detection alongside it.

## Phase 2: Update `followOutput` subscribers to use sticky flag

In `src/hooks/use-virtual-list.ts`:

1. The count-based `followOutput` effect (line 238): change `opts.followOutput(snapshot.isAtBottom)` → `opts.followOutput(snapshot.isSticky)` — only pass `true` when sticky
2. The height-based subscriber (line 258): change `if (!list.isAtBottom)` → check sticky ref instead
3. The `followOutput` callback signature stays the same (`(atBottom: boolean) => ...`) but now receives sticky state

Also: wrap programmatic `scrollTo` calls with a flag so the scroll listener doesn't treat them as user scrolls and accidentally re-engage or disengage sticky.

## Phase 3: Update MessageList streaming ResizeObserver

In `src/components/thread/message-list.tsx`:

1. Get `isSticky` from `useVirtualList` return value
2. The streaming content ResizeObserver (line 128): change `isAtBottomRef.current` → `isStickyRef.current`
3. Keep `isAtBottom` for the scroll-to-bottom button visibility (line 210) — this stays position-based
4. The `scrollToBottom` function (line 80): should re-engage sticky when called

## Phase 4: Ensure re-engagement

1. Clicking the "scroll to bottom" button → set `isSticky = true` (via a method on the hook or a callback)
2. User manually scrolling to the very bottom (within ~20px) → `isSticky = true` (from the scroll listener in Phase 1)
3. When streaming starts and user is already at bottom → `isSticky = true`
4. When streaming stops → sticky state doesn't matter (followOutput returns false anyway since `isStreaming` is false)

## Technical Notes

- The `atBottomThreshold` (300px) stays for `isAtBottom` — it controls when the button appears
- Sticky re-engagement threshold should be small (10-20px) so the user has to intentionally reach the bottom
- `wheel` events with `{ passive: true }` for performance
- For scrollbar drag detection: listen for `pointerdown` on the scroll container where the target is the container itself (not a child element), which indicates the scrollbar track was clicked
