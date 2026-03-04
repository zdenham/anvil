# Fix Jumpy Streaming Scroll

## Problem

Thread UI renders "jumpy" during agent streaming instead of smooth scroll. Got worse after implementing event syncing sequence. Each stream delta triggers a cascade of re-renders and layout recalculations that compound into visible jank.

## Root Cause: Re-render Amplification

A single `STREAM_DELTA` event triggers this cascade:

```
1 STREAM_DELTA (~3-5 chars)
  -> Streaming store update (RE-RENDER #1)
  -> TrickleBlock animation restarts (RE-RENDER #2, #3, #4... every 16ms)
  -> ResizeObserver fires on height change (LAYOUT CALC)
  -> VirtualList subscriber notifications (SCROLL CALCS)
  -> Auto-scroll to bottom (COMPETES WITH SCROLL ADJUSTMENTS)
```

With deltas arriving every ~50ms and trickle animation running at 60fps, this creates **4+ re-renders per delta** with compounding layout thrashing.

## Event Sync Made It Worse

The event syncing sequence added chain-based gap detection:
- `streaming-store.ts`: Tracks `lastStreamEventId`, clears stream on gap detection
- `threads/listeners.ts`: Tracks `lastAppliedEventId` per thread, falls back to full disk read on gap
- **Two independent stores** (streaming + thread) update from the same logical event
- Gap-triggered full syncs cause content to disappear/reappear (flash of empty state)
- `EventBroadcaster` in Tauri has 1024-event capacity — slow clients drop events silently, causing more gaps

## Specific Issues

### Critical (cause visible jank)

**1. Index-based keys on streaming blocks** — `streaming-content.tsx:32`
```tsx
{stream.blocks.map((block, index) => <div key={index}>...)}
```
React can't track which block is which. Every delta causes DOM reconciliation across all blocks.

**2. Uncoordinated multi-store updates** — `streaming-store.ts` + `threads/listeners.ts`
- `useStreamingStore.applyDelta()` fires RE-RENDER #1
- `useThreadStore.setThreadState()` fires RE-RENDER #2
- Both triggered by the same logical event, no batching

**3. AssistantMessage not memoized** — `assistant-message.tsx`
- Maps ALL content blocks on every render (thinking, tool_use, text)
- Even finished blocks get new component instances when last text block updates

**4. TrickleBlock not memoized** — `trickle-block.tsx`
- No `React.memo` wrapper
- Re-renders on every parent update even when its own props haven't changed
- Triggers expensive MarkdownRenderer re-parse

### High (amplify the problem)

**5. MarkdownRenderer components memo invalidated by `isStreaming`** — `markdown-renderer.tsx`
```tsx
const components = useMemo(() => ({...}), [resolvedWorkingDirectory, onFileClick, isStreaming]);
```
`isStreaming` changes invalidate the entire components object, forcing ReactMarkdown to re-parse all markdown on every streaming state change.

**6. Two competing auto-scroll effects** — `use-virtual-list.ts:302-346`
- Effect #1: Fires on count change (streaming slot added/removed)
- Effect #2: Fires on height change (subscriber notifications from ResizeObserver)
- Both can trigger `scrollTo()` in the same frame, causing competing scroll targets

**7. Streaming slot toggles virtual list count** — `message-list.tsx:80-82`
```tsx
const showStreamingSlot = hasStreamingContent || showWorkingIndicator;
const virtualCount = turns.length + (showStreamingSlot ? 1 : 0);
```
Count going N -> N+1 -> N causes full offset recalculation for all virtual items.

**8. ResizeObserver fires on every token** — `use-virtual-list.ts:220-240`
- Streaming content grows with each trickle frame
- ResizeObserver -> rAF -> `setItemHeights()` -> `_invalidate()` -> subscriber notifications
- Triggers virtual list recomputation 60 times/second during streaming

### Medium (polish)

**9. No `overflow-anchor` CSS** — `message-list.tsx:126`
Browser can't auto-maintain scroll position. Custom JS scroll management has to fight browser defaults.

**10. Scroll behavior "auto" (instant)** — throughout
`behavior: "auto"` causes instant jumps instead of smooth transitions. Technically fast but perceptually jarring.

**11. useTrickleText renders every animation frame** — `use-trickle-text.ts:215-264`
`setDisplayedLength()` at 60fps is by design for the trickle effect, but compounds all other issues.

## Phases

- [x] Quick memoization wins (memo TrickleBlock, AssistantMessage, fix streaming block keys, fix MarkdownRenderer isStreaming dep)
- [x] Consolidate streaming store updates (batch or deduplicate the two-store update pattern) — React 18 createRoot already batches synchronous Zustand set() calls within the same callback
- [x] Fix virtual list scroll coordination (unify the two auto-scroll effects, debounce ResizeObserver during streaming)
- [x] Stabilize streaming slot in virtual list (avoid count thrashing when streaming starts/stops)
- [x] Add overflow-anchor CSS and smooth scroll behavior

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Quick Wins Checklist

- [ ] `streaming-content.tsx` — Use stable block ID as key (e.g., `block.type + '-' + block.id` or content hash) instead of array index
- [ ] `trickle-block.tsx` — Wrap with `React.memo`
- [ ] `assistant-message.tsx` — Wrap with `React.memo` with shallow prop comparison
- [ ] `markdown-renderer.tsx` — Remove `isStreaming` from `components` useMemo dependency array (or split into streaming-sensitive and non-sensitive component sets)
- [ ] `message-list.tsx` scroller div — Add `style={{ overflowAnchor: 'auto' }}`

## Architectural Fixes

- [ ] **Batch store updates**: Use `unstable_batchedUpdates` or `ReactDOM.flushSync` to group streaming-store + thread-store updates into one React render pass
- [ ] **Debounce ResizeObserver during streaming**: When `isStreaming`, throttle `setItemHeights()` calls to ~100ms instead of every rAF
- [ ] **Unify scroll effects**: Merge count-change and height-change auto-scroll into a single coordinated mechanism
- [ ] **Stabilize virtual count**: Keep streaming slot always present (just empty/hidden) so count doesn't toggle
- [ ] **Consider `useTransition`**: Wrap non-critical streaming updates in `startTransition` to let React deprioritize them
