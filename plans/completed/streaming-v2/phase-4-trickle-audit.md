# Phase 4: Trickle Scoping Audit — Results

Parent: [readme.md](./readme.md) | Full design: [streaming-architecture-v2.md](../streaming-architecture-v2.md#phase-4-verify-trickle-scoping)

## Goal

Verify that only the final streaming block re-renders during streaming. Code changes only if scoping is broken.

## Dependencies

None — independent of all other phases.

## Audit Status: 2 issues found, 1 requires a fix

---

## Audit Results

### 1. TrickleBlock memo boundaries

**Verdict: CORRECT — no changes needed.**

`src/components/thread/trickle-block.tsx` is wrapped with `memo()` at line 20:

```tsx
export const TrickleBlock = memo(function TrickleBlock({ block, isLast, workingDirectory }: TrickleBlockProps) {
```

Props are all primitives or stable objects:
- `block`: `{ type: "text" | "thinking"; content: string }` — object, but see issue #6 below
- `isLast`: boolean — stable for non-last blocks (always `false`)
- `workingDirectory`: string | undefined — stable across renders

The `memo()` boundary will prevent re-renders when props are referentially equal. The downstream `MarkdownRenderer` (`src/components/thread/markdown-renderer.tsx` line 39) is also `memo()`'d, providing a second layer of defense.

### 2. StreamingContent prop passing

**Verdict: ISSUE FOUND — non-last blocks receive new object references on every delta.**

`src/components/thread/streaming-content.tsx` subscribes to the streaming store:

```tsx
const stream = useStreamingStore((s) => s.activeStreams[threadId]);
```

In the streaming store's `applyDelta` method (`src/stores/streaming-store.ts` lines 62-76), **every delta creates a new `blocks` array via spread**:

```tsx
const blocks = [...existing.blocks];
for (const delta of deltas) {
  if (blocks[delta.index]) {
    blocks[delta.index] = {
      ...blocks[delta.index],
      content: blocks[delta.index].content + delta.append,
    };
  }
  // ...
}
return { activeStreams: { ...state.activeStreams, [threadId]: { blocks } } };
```

The spread `[...existing.blocks]` creates a shallow copy. For the block being appended to (typically the last), a new object is created with the spread `{ ...blocks[delta.index], content: ... }`. However, **the non-mutated blocks in the array are the same references** from the previous array — the spread only copies the reference, not the object.

This means `blocks[0]` in the new array `===` `blocks[0]` in the old array (referential equality), as long as only the last block had content appended. Since `TrickleBlock` is `memo()`'d and receives the same `block` object reference for non-last blocks, **those blocks will NOT re-render**.

However, `StreamingContent` itself is NOT `memo()`'d, and it re-renders on every delta because the `stream` object reference changes. This is fine — it only needs to re-compute the `map()` and pass props down. The `memo()` on `TrickleBlock` catches the re-render before it propagates.

**One edge case**: when a NEW block appears (the `else` branch at line 70), all existing blocks keep their references but the array grows. The `isLast` prop will flip from `true` to `false` for the previously-last block, causing it to re-render once. This is correct behavior — it needs to snap to full content and stop its rAF loop.

**No fix needed.** The architecture is sound.

### 3. useTrickleText with isLast=false

**Verdict: CORRECT — no changes needed.**

`src/hooks/use-trickle-text.ts` lines 266-268:

```tsx
if (!enabled) return targetContent;
if (!isStreaming) return targetContent;
return targetContent.slice(0, displayedLength);
```

When `isLast=false` (which maps to `isStreaming=false` in the hook), the hook returns `targetContent` directly — no rAF loop, no state updates.

Additionally, the rAF loop effect (line 215) has guards:
```tsx
if (!enabled || !isStreaming) return;
```

And the interpolation setup effect (line 172) also guards:
```tsx
if (!enabled || !isStreaming) return;
```

When `isStreaming` transitions from `true` to `false`, the cleanup effect at line 200-212 cancels any running animation and snaps to full content:
```tsx
if (!isStreaming) {
  if (rafRef.current !== null) {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }
  // ...snaps to full...
}
```

**No fix needed.** Non-last blocks get full content immediately with zero animation overhead.

### 4. Virtual list ResizeObserver

**Verdict: CORRECT — no changes needed.**

The ResizeObserver in `src/hooks/use-virtual-list.ts` is NOT scoped to only the last item — it observes ALL visible virtual items. However, this is **correct behavior** for a virtual list. Here's why:

1. The ResizeObserver fires for any item whose size changes (lines 230-257).
2. It's **throttled** at 80ms intervals (line 225: `RESIZE_THROTTLE_MS = 80`), batching all pending height changes into a single `list.setItemHeights()` call.
3. For non-last streaming blocks whose content is stable (not changing), the rendered height doesn't change, so the ResizeObserver callback doesn't fire for them.
4. During streaming, only the last TrickleBlock's height changes (because only it has content being revealed via the trickle animation). The ResizeObserver fires for this element, but the 80ms throttle prevents layout thrash.

The ResizeObserver on the scroll element itself (lines 206-215) only updates viewport dimensions — this is correct and lightweight.

**No fix needed.** The throttled batching approach is appropriate.

### 5. findSafeBoundary() preventing layout thrash

**Verdict: CORRECT — no changes needed.**

`findSafeBoundary()` is co-located in `src/hooks/use-trickle-text.ts` (lines 17-80) and has comprehensive test coverage in `src/hooks/__tests__/use-trickle-text.test.ts` (119 lines covering: plain text, bold markers, inline code, fenced code blocks, links, strikethrough, and edge cases).

The function correctly prevents the trickle animation from stopping inside unclosed markdown delimiters (backticks, bold, italic, strikethrough, links, code fences), which would cause the markdown parser to produce different DOM structures frame-to-frame (layout thrash).

The word-boundary snapping (lines 68-79) is a nice touch — it avoids stopping mid-word when within 3 characters of a boundary.

**No fix needed.**

### 6. Inline object props defeating memo()

**Verdict: ISSUE FOUND — `block` prop is an inline object literal in the streaming store, but it is NOT reconstructed on non-mutated blocks.**

As analyzed in item #2, the streaming store's `applyDelta` only creates new block objects for the block being appended to. Non-mutated blocks keep the same reference. The `memo()` on `TrickleBlock` works correctly because of this.

However, there is a **subtle issue**: the `block` prop type is `{ type: "text" | "thinking"; content: string }`, which is a plain object. If anything upstream were to reconstruct this object (e.g., a selector that maps blocks), it would defeat `memo()`. Currently nothing does this — `StreamingContent` passes `block` directly from the array — so this is safe.

**No fix needed**, but worth noting for future changes.

### 7. Key prop stability

**Verdict: MINOR ISSUE — keys use index, which can cause unnecessary remounts when blocks are removed.**

`src/components/thread/streaming-content.tsx` line 32:

```tsx
<div key={`${block.type}-${index}`} className="relative">
```

The key is `${block.type}-${index}`. This is adequate for the current use case because:
- Blocks are append-only during streaming (new blocks are added at the end)
- A block's type doesn't change after creation
- Blocks are never reordered

However, if a stream is cleared and restarted (e.g., chain gap recovery), ALL blocks get new references and the component tree unmounts/remounts entirely — this is correct behavior for a reset.

**No fix needed.** The index-based key is acceptable for append-only lists.

### 8. blocks array stable references

**Verdict: CORRECT — analyzed in detail in item #2.**

The shallow spread in `applyDelta` preserves references for non-mutated blocks. Only the block receiving the delta append gets a new object reference. This is the optimal pattern for immutable updates.

---

## Summary

| Check | Result |
|-------|--------|
| `TrickleBlock` is `memo()`'d | PASS |
| `MarkdownRenderer` is `memo()`'d (secondary boundary) | PASS |
| Non-last blocks receive stable `block` references | PASS |
| `useTrickleText` with `isLast=false` returns full content, no rAF | PASS |
| Virtual list ResizeObserver is throttled (80ms), only fires for height changes | PASS |
| `findSafeBoundary()` prevents markdown layout thrash | PASS (tested) |
| No inline object/array props defeating `memo()` | PASS |
| Stable `key` props (append-only, no reorder) | PASS |
| `blocks` array preserves references for non-mutated blocks | PASS |

## Implementation Steps

**None required.** All audit checks pass. The trickle scoping architecture is correctly implemented:

1. `TrickleBlock` is `memo()`'d, so non-last blocks skip re-renders when their props haven't changed.
2. The streaming store preserves object references for non-mutated blocks via shallow spread.
3. `useTrickleText` short-circuits for non-streaming blocks — no rAF, no state updates.
4. The ResizeObserver is globally scoped but throttled at 80ms, and only fires for elements whose height actually changes.
5. `findSafeBoundary()` is well-tested and prevents markdown parse instability.

## Verification

To confirm via React DevTools Profiler (manual, not automated):
- During streaming, only the last `TrickleBlock` and its children (`MarkdownRenderer`) should appear as re-rendered in the flamegraph.
- Non-last `TrickleBlock` instances should show "Did not render" in the profiler.
- This is expected based on the code analysis, but can be confirmed visually if desired.
