# Phase 5: ScrollCoordinator

Parent: [readme.md](./readme.md) | Full design: [streaming-architecture-v2.md](../streaming-architecture-v2.md#phase-5-scrollcoordinator)

## Goal

Replace the inline scroll machinery in `useVirtualList` (two competing effects, scattered rAF/sticky state, ~90 lines of scroll logic mixed into a 407-line hook) with a single `ScrollCoordinator` class. Pure class, trivially testable, no React effects competing.

## Dependencies

None — independent of all other phases.

## Current State (Investigation Results)

### File layout

| File | Lines | Role |
|------|-------|------|
| `src/hooks/use-virtual-list.ts` | 407 | React adapter — owns scroll listeners, ResizeObserver, sticky state, AND two auto-scroll effects |
| `src/lib/virtual-list.ts` | 310 | Pure math engine — heights, offsets, binary search. No DOM. |
| `src/components/thread/message-list.tsx` | 209 | Consumer — passes `followOutput`, `followCountChange`, `sticky: true` |
| `src/hooks/use-scrolling.ts` | 31 | Unrelated — sets `data-scrolling` attribute during scroll for CSS. Keep as-is. |
| `src/hooks/use-is-sticky.ts` | 27 | Unrelated — IntersectionObserver for CSS sticky position detection. Keep as-is. |

### The two competing auto-scroll effects in `use-virtual-list.ts`

**Effect 1: `followCountChange` (lines 355-370)** — fires when `opts.count` increases. Checks sticky/atBottom, calls `scheduleAutoScroll("smooth")`. Depends on: `[opts.count, followCountFn, opts.sticky, isSticky, snapshot.isAtBottom, scheduleAutoScroll]`.

**Effect 2: `followOutput` subscriber (lines 372-386)** — subscribes to `list.subscribe()` (fires on ANY VirtualList state change — height, scroll, count). Checks sticky via `isStickyRef.current`, calls `scheduleAutoScroll("auto")`. This fires on EVERY resize observation, so during streaming it fires at ~12Hz (80ms throttle from the ResizeObserver).

**The race**: Both effects can fire in the same frame. Effect 1 requests `"smooth"`, Effect 2 requests `"auto"`. They share a single rAF via `scheduleAutoScroll` (lines 327-343) which deduplicates — last-write-wins on `pendingScrollBehaviorRef`. In practice Effect 2 usually overwrites Effect 1's `"smooth"` with `"auto"`, making count-change smooth scrolls effectively dead code.

### Sticky state management (lines 121-128, 156-202)

- `isSticky` React state + `isStickyRef` ref (dual tracking for sync reads in subscriber)
- `setSticky` callback updates both
- Scroll listener (line 163-172): re-engages sticky when `gap <= 20`
- Wheel listener (line 182-185): `deltaY < 0` disengages sticky
- Pointerdown listener (line 188-192): clicking scrollbar track disengages sticky
- `onStickyChange` callback effect (lines 314-320): notifies consumer

### rAF dedup infrastructure (lines 322-352)

- `autoScrollRafRef` + `pendingScrollBehaviorRef` + `scheduleAutoScroll` callback
- Cleanup effect cancels rAF on unmount (lines 346-352)
- `scheduleAutoScroll` checks `gap > 1` before scrolling

### ResizeObserver setup (lines 205-290)

Two separate ResizeObservers:
1. **Viewport RO** (lines 206-215): observes the scroll element, calls `list.updateScroll()` on viewport resize
2. **Item RO** (lines 220-290): observes each item via `measureItem` ref callback, throttled at 80ms, batches height updates via `list.setItemHeights()`

The Item RO triggers `list.subscribe()` callbacks, which is how Effect 2 ("followOutput subscriber") hears about content growth. This is the **primary scroll-follow mechanism during streaming**.

### Consumer wiring in `message-list.tsx` (lines 72-104)

```ts
const followOutput = useCallback(
  (atBottom: boolean) => {
    if (isStreaming && atBottom) return "auto" as ScrollBehavior;
    return false as const;
  }, [isStreaming]);

const followCountChange = useCallback(
  (atBottom: boolean) => {
    if (isStreaming && atBottom) return "smooth" as ScrollBehavior;
    return false as const;
  }, [isStreaming]);

// ...
useVirtualList({
  // ...
  followOutput,
  followCountChange,
  sticky: true,
});
```

The consumer also calls `setSticky(true)` + `scrollTo({ index: "LAST" })` on the "scroll to bottom" button click (line 106-109).

---

## Phases

- [x] Create `ScrollCoordinator` class in `src/lib/scroll-coordinator.ts`
- [x] Write unit tests for `ScrollCoordinator` in `src/lib/__tests__/scroll-coordinator.test.ts`
- [x] Integrate `ScrollCoordinator` into `use-virtual-list.ts`, removing the two auto-scroll effects and inline sticky/rAF state
- [x] Update `message-list.tsx` to use the simplified hook API
- [x] Run tests and verify scroll behavior

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/scroll-coordinator.ts` | Pure scroll coordinator class |
| `src/lib/__tests__/scroll-coordinator.test.ts` | Unit tests |

## Files to Modify

| File | Change |
|------|--------|
| `src/hooks/use-virtual-list.ts` | Remove ~90 lines of scroll/sticky logic, wire ScrollCoordinator instead |
| `src/components/thread/message-list.tsx` | Simplify — remove `followOutput`/`followCountChange` callbacks |

---

## Phase 1: Create `ScrollCoordinator` class

**File**: `src/lib/scroll-coordinator.ts` (new, ~80 lines)

```ts
/**
 * ScrollCoordinator — single source of truth for auto-scroll decisions.
 *
 * Replaces the two competing effects in useVirtualList:
 * - followCountChange (count increase → smooth scroll)
 * - followOutput subscriber (height change → auto scroll)
 *
 * Key property: multiple signals in the same frame → single scrollTo call.
 * Last behavior wins (onItemAdded "smooth" vs onContentGrew "auto").
 */

export interface ScrollCoordinatorOptions {
  onStickyChange?: (sticky: boolean) => void;
  /** Distance from bottom to count as "near bottom" for re-engage */
  reengageThreshold?: number;
}

export class ScrollCoordinator {
  private _sticky = true;
  private _rafId: number | null = null;
  private _pendingBehavior: ScrollBehavior | null = null;
  private _scrollElement: HTMLElement | null = null;
  private _reengageThreshold: number;
  private _onStickyChange?: (sticky: boolean) => void;

  constructor(options: ScrollCoordinatorOptions = {}) {
    this._onStickyChange = options.onStickyChange;
    this._reengageThreshold = options.reengageThreshold ?? 20;
  }

  get isSticky(): boolean { return this._sticky; }

  attach(el: HTMLElement): void {
    this._scrollElement = el;
  }

  detach(): void {
    this._scrollElement = null;
    this._cancelPending();
  }

  /** Content height increased (ResizeObserver / height measurement).
   *  Use "auto" (instant) to avoid visible lag during streaming. */
  onContentGrew(): void {
    if (!this._sticky) return;
    this._schedule("auto");
  }

  /** New item added (count increased).
   *  Use "smooth" for a polished transition when new blocks appear. */
  onItemAdded(): void {
    if (!this._sticky) return;
    this._schedule("smooth");
  }

  /** User explicitly scrolled up (wheel or scrollbar drag). */
  onUserScrolledUp(): void {
    this._setSticky(false);
  }

  /** Called on every scroll event with the current gap from bottom. */
  onScrollPositionChanged(gap: number): void {
    if (!this._sticky && gap <= this._reengageThreshold) {
      this._setSticky(true);
    }
  }

  /** Programmatic re-engage (e.g., "scroll to bottom" button). */
  setSticky(value: boolean): void {
    this._setSticky(value);
  }

  // -- Private --

  private _setSticky(value: boolean): void {
    if (this._sticky === value) return;
    this._sticky = value;
    this._onStickyChange?.(value);
  }

  private _schedule(behavior: ScrollBehavior): void {
    this._pendingBehavior = behavior;
    if (this._rafId !== null) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      const b = this._pendingBehavior;
      this._pendingBehavior = null;
      if (!b || !this._scrollElement) return;
      const el = this._scrollElement;
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (gap > 1) {
        el.scrollTo({ top: el.scrollHeight, behavior: b });
      }
    });
  }

  private _cancelPending(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._pendingBehavior = null;
  }
}
```

**Design notes**:
- Private fields prefixed with `_` to match `VirtualList` conventions in the same directory
- `onContentGrew()` uses `"auto"` (instant snap) — matches current `followOutput` behavior
- `onItemAdded()` uses `"smooth"` — matches current `followCountChange` behavior
- The race is eliminated: if both fire in the same frame, last-write-wins on `_pendingBehavior`. During streaming, `onContentGrew` fires much more often (every 80ms resize flush), so it naturally dominates — which is correct (you want instant snap during streaming, smooth only on discrete block additions when no resize follows)
- `setSticky(value)` is public for the "scroll to bottom" button use case

---

## Phase 2: Unit tests

**File**: `src/lib/__tests__/scroll-coordinator.test.ts` (new, ~120 lines)

Test with a mock scroll element:

```ts
function createMockScrollElement(overrides?: Partial<HTMLElement>) {
  return {
    scrollHeight: 2000,
    scrollTop: 1500,
    clientHeight: 500,
    scrollTo: vi.fn(),
    ...overrides,
  } as unknown as HTMLElement;
}
```

Mock `requestAnimationFrame` to fire synchronously:

```ts
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());
```

**Test cases**:

1. `onContentGrew()` when sticky → calls `scrollTo({ top: 2000, behavior: "auto" })`
2. `onContentGrew()` when not sticky → no `scrollTo` call
3. `onItemAdded()` when sticky → calls `scrollTo({ top: ..., behavior: "smooth" })`
4. `onItemAdded()` when not sticky → no `scrollTo` call
5. `onUserScrolledUp()` → `isSticky` becomes false, `onStickyChange(false)` called
6. `onScrollPositionChanged(15)` when not sticky → re-engages, `onStickyChange(true)` called
7. `onScrollPositionChanged(100)` when not sticky → stays disengaged
8. Multiple signals same frame → single `scrollTo` call (last behavior wins)
   - Call `onItemAdded()` then `onContentGrew()` before rAF fires → behavior is `"auto"`
9. `detach()` cancels pending rAF (`cancelAnimationFrame` called)
10. `setSticky(true)` from disengaged → re-engages, callback fires
11. No scroll when gap <= 1 (already at bottom)

---

## Phase 3: Integrate into `use-virtual-list.ts`

### What to remove from `use-virtual-list.ts`

Remove these specific code blocks (referenced by current line numbers):

1. **Sticky state management** (lines 121-128): `isSticky` useState, `isStickyRef`, `setSticky` callback
   - Replace with: `ScrollCoordinator` owns sticky state

2. **Sticky engage/disengage in scroll listener** (lines 166-172 inside the scroll handler):
   ```ts
   // Re-engage sticky when user scrolls to near bottom
   if (opts.sticky && !isStickyRef.current) {
     const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
     if (gap <= 20) { setSticky(true); }
   }
   ```
   - Replace with: `coordinator.onScrollPositionChanged(gap)` in the scroll handler

3. **User-intent wheel/pointerdown listeners** (lines 177-202):
   ```ts
   const onWheel = (e: WheelEvent) => { ... };
   const onPointerDown = (e: PointerEvent) => { ... };
   ```
   - Replace with: `coordinator.onUserScrolledUp()` calls from the same event handlers

4. **stickyChange callback effect** (lines 314-320):
   ```ts
   useEffect(() => {
     if (prevStickyRef.current !== undefined && prevStickyRef.current !== isSticky) {
       opts.onStickyChange?.(isSticky);
     }
     prevStickyRef.current = isSticky;
   }, [isSticky, opts.onStickyChange]);
   ```
   - Replace with: `onStickyChange` wired through `ScrollCoordinator` constructor

5. **rAF dedup infrastructure** (lines 322-352): `autoScrollRafRef`, `pendingScrollBehaviorRef`, `scheduleAutoScroll`, cleanup effect
   - Replace with: `ScrollCoordinator._schedule()` handles this internally

6. **followCountChange effect** (lines 354-370):
   ```ts
   useEffect(() => {
     if (!followCountFn) return;
     if (opts.count <= prevFollowCountRef.current) { ... }
     ...
     scheduleAutoScroll(result);
   }, [opts.count, ...]);
   ```
   - Replace with: call `coordinator.onItemAdded()` when count increases (inline in the count-change detection block that already exists at lines 100-104)

7. **followOutput subscriber effect** (lines 372-386):
   ```ts
   useEffect(() => {
     if (!opts.followOutput) return;
     const unsub = list.subscribe(() => { ... scheduleAutoScroll(result); });
     return unsub;
   }, [list, opts.followOutput, opts.sticky, scheduleAutoScroll]);
   ```
   - Replace with: `list.subscribe()` that calls `coordinator.onContentGrew()`

### What to add to `use-virtual-list.ts`

1. **Create `ScrollCoordinator` once** (alongside the `VirtualList` creation):
   ```ts
   const coordinatorRef = useRef<ScrollCoordinator | null>(null);
   if (!coordinatorRef.current) {
     coordinatorRef.current = new ScrollCoordinator({
       onStickyChange: (sticky) => {
         // This fires during rAF/event handlers — safe to setState
         setIsStickyState(sticky);
         opts.onStickyChange?.(sticky);
       },
       reengageThreshold: 20,
     });
   }
   const coordinator = coordinatorRef.current;
   ```

2. **Keep a simple `isSticky` state** for the return value (the coordinator is the source of truth, but React needs a state variable to trigger re-renders):
   ```ts
   const [isStickyState, setIsStickyState] = useState(true);
   ```

3. **Attach/detach in the scroll-listener effect**:
   ```ts
   useEffect(() => {
     const el = opts.getScrollElement();
     if (!el) return;
     coordinator.attach(el);
     // ... scroll/wheel/pointer listeners call coordinator methods ...
     return () => {
       coordinator.detach();
       // ... remove listeners ...
     };
   }, [coordinator, opts.getScrollElement, opts.sticky]);
   ```

4. **Rewrite scroll listener** to delegate to coordinator:
   ```ts
   const onScroll = () => {
     list.updateScroll(el.scrollTop, el.clientHeight);
     if (opts.sticky) {
       const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
       coordinator.onScrollPositionChanged(gap);
     }
   };
   ```

5. **Rewrite wheel/pointer listeners**:
   ```ts
   const onWheel = (e: WheelEvent) => {
     if (e.deltaY < 0) coordinator.onUserScrolledUp();
   };
   const onPointerDown = (e: PointerEvent) => {
     if (e.target === el) coordinator.onUserScrolledUp();
   };
   ```

6. **Replace count-change effect with inline detection + coordinator call**:
   In the existing count-sync block (lines 100-104), after `list.setCount()`:
   ```ts
   if (opts.count !== prevCountRef.current) {
     const countIncreased = opts.count > prevCountRef.current;
     prevCountRef.current = opts.count;
     list.setCount(opts.count, false);
     if (countIncreased && opts.sticky) {
       coordinator.onItemAdded();
     }
   }
   ```
   This eliminates the `followCountChange` effect entirely.

7. **Replace followOutput subscriber with coordinator-based subscriber**:
   ```ts
   useEffect(() => {
     if (!opts.sticky) return;
     const unsub = list.subscribe(() => {
       coordinator.onContentGrew();
     });
     return unsub;
   }, [list, coordinator, opts.sticky]);
   ```
   This eliminates the `followOutput` callback and `followCountChange` callback from the options interface entirely.

8. **Update `setSticky` in return value** to call coordinator:
   ```ts
   const setSticky = useCallback((value: boolean) => {
     coordinator.setSticky(value);
   }, [coordinator]);
   ```

### Options interface changes

Remove from `UseVirtualListOptions`:
- `followOutput` — replaced by coordinator's `onContentGrew()`
- `followCountChange` — replaced by coordinator's `onItemAdded()`

Keep:
- `sticky` — still needed to opt-in to sticky behavior
- `onStickyChange` — still needed for consumer notification
- `onAtBottomChange` — unrelated to scroll coordination

### Net line count change

- Remove: ~90 lines (sticky state, rAF dedup, two effects, stickyChange effect)
- Add: ~25 lines (coordinator creation, simplified subscriber, simplified listeners)
- Net: ~65 lines removed from the hook

---

## Phase 4: Update `message-list.tsx`

### What to remove

1. The `followOutput` callback (lines 72-78):
   ```ts
   const followOutput = useCallback(
     (atBottom: boolean) => {
       if (isStreaming && atBottom) return "auto" as ScrollBehavior;
       return false as const;
     }, [isStreaming]);
   ```

2. The `followCountChange` callback (lines 81-87):
   ```ts
   const followCountChange = useCallback(
     (atBottom: boolean) => {
       if (isStreaming && atBottom) return "smooth" as ScrollBehavior;
       return false as const;
     }, [isStreaming]);
   ```

3. Remove `followOutput` and `followCountChange` from the `useVirtualList` call (lines 101-102).

### What stays the same

The `useVirtualList` call still passes `sticky: true`. The `setSticky(true)` + `scrollTo()` in `scrollToBottom` (line 106-109) stays the same — `setSticky` now delegates to `coordinator.setSticky()`.

No other consumers of `useVirtualList` use `followOutput` or `followCountChange` — confirmed by checking:
- `src/components/content-pane/archive-view.tsx` — no follow options
- `src/components/changes/changes-diff-content.tsx` — no follow options
- `src/components/search-panel/virtualized-results.tsx` — no follow options
- `src/components/main-window/logs-page.tsx` — no follow options

---

## Phase 5: Run tests and verify

1. Run `pnpm test` from `src/` (or wherever the Vitest config points)
2. Existing `src/lib/__tests__/virtual-list.test.ts` should still pass (no VirtualList changes)
3. New `src/lib/__tests__/scroll-coordinator.test.ts` should pass
4. Manual verification:
   - Sticky scroll follows during streaming
   - User can scroll up (wheel) to disengage
   - User can scroll down near bottom to re-engage
   - "Scroll to bottom" button re-engages
   - No competing scroll jumps (smooth vs instant fighting)
   - Non-streaming consumers (archive, search, changes) unaffected

---

## Key Design Decisions

1. **ScrollCoordinator is DOM-aware but not React-aware**: It holds a reference to the scroll element and calls `scrollTo` directly. This makes it testable with a mock element and avoids React effect scheduling issues.

2. **Coordinator does NOT replace VirtualList's subscriber system**: The `list.subscribe()` mechanism still fires on height/scroll changes. The coordinator simply becomes the only consumer of those signals for auto-scroll decisions, replacing the inline `scheduleAutoScroll` calls.

3. **Count-change detection stays in render path**: The existing pattern of comparing `prevCountRef.current` during render (lines 100-104) is kept. We add `coordinator.onItemAdded()` there instead of using a separate effect. This eliminates one effect and its dependency array.

4. **`followOutput`/`followCountChange` removed from options API**: These were "tell me how to scroll" callbacks that the consumer had to provide. Now the coordinator owns the scroll policy internally. If a future consumer needs different scroll behavior, they can opt out of `sticky` mode and use `scrollToIndex` manually.
