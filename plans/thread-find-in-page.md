# Thread Find-in-Page (Cmd+F)

Enable Cmd+F search within the virtualized thread view. The existing finder UI (`FindBar`) and search interface (`UseContentSearchReturn`) are reused, but the underlying search logic is replaced with a strategy that searches the **message data** (not the DOM), since virtualized content is not fully rendered.

## Problem

The thread view uses `react-virtuoso` to virtualize message rendering. The current `useContentSearch` hook walks the DOM with `TreeWalker` — this only finds matches in the ~200px overscan window of rendered items, missing everything off-screen. Thread views are explicitly excluded from Cmd+F today (`content-pane.tsx:81`).

## Approach

Create a new hook `useThreadSearch` that:

1. **Searches message data directly** — walks `MessageParam[]` content (text blocks, tool inputs/outputs, thinking blocks) to find matches, producing a list of `{ turnIndex, blockIndex, offset }` results
2. **Uses Virtuoso's `scrollToIndex`** to navigate to the turn containing the active match
3. **Applies CSS Highlight API** to the visible DOM after scrolling — same highlight classes (`search-results`, `search-current`) so existing CSS works
4. **Returns `UseContentSearchReturn`** — identical interface so `FindBar` works unchanged

## Phases

- [ ] Create `useThreadSearch` hook with data-layer search
- [ ] Integrate into thread view and wire up Cmd+F
- [ ] Add DOM highlighting after scroll

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Create `useThreadSearch` hook

**File:** `src/components/thread/use-thread-search.ts`

The hook searches the raw message data, not the DOM:

```ts
function useThreadSearch(
  messages: MessageParam[],
  virtuosoRef: RefObject<VirtuosoHandle | null>,
): UseContentSearchReturn
```

### Text extraction

Build a flat searchable index from `MessageParam[]`:

```ts
interface SearchableSegment {
  turnIndex: number;       // index into turns array (for scrollToIndex)
  text: string;            // the searchable text content
}
```

Extract text from each message:
- **User messages**: `string` content directly, or `text` blocks from content arrays
- **Assistant messages**: `text` blocks → `block.text`, `tool_use` blocks → `JSON.stringify(block.input)`, `thinking` blocks → `block.thinking`
- Skip `tool_result` blocks (they're rendered with the tool_use in the assistant turn)

Memoize the segment list with `useMemo` keyed on `messages` (reference equality — the store returns new arrays on change).

### Search execution

On query change (debounced 150ms, same as existing):
1. Walk segments, `text.toLowerCase().indexOf(query)` to find all matches (cap at 1000)
2. Store results as `{ segmentIndex, turnIndex, offsetInText }[]`
3. Set `matchCount` and `currentMatch`
4. Call `scrollToIndex` for the first match's `turnIndex`

### Navigation (`goToNext` / `goToPrevious`)

Cycle through matches. When the `turnIndex` changes from the current match, call:
```ts
virtuosoRef.current?.scrollToIndex({ index: turnIndex, align: "center", behavior: "smooth" });
```

If the next match is in the same already-visible turn, skip the scroll (it's already rendered).

### Return value

Same `UseContentSearchReturn` shape — `FindBar` doesn't need to know it's virtualized.

## Phase 2: Integrate into thread view and wire up Cmd+F

### Changes to `content-pane.tsx`

1. Remove `"thread"` from the `isSearchable` exclusion list (line 81) — but we need a separate code path for thread search vs. DOM search. Instead:
   - Add a `isThreadView` boolean: `const isThreadView = view.type === "thread";`
   - Change `isSearchable` to: `view.type !== "empty" && view.type !== "terminal" && view.type !== "settings"`
   - The Cmd+F handler already uses `isSearchable`, so it will now fire for threads too

2. Thread search needs `messages` and `virtuosoRef` — these live deep in `ThreadContent → ThreadView → MessageList`. Two options:

   **Option chosen: Lift FindBar into ThreadContent for thread views.**

   - When `view.type === "thread"`, `ContentPane` does NOT render `FindBar` (existing behavior preserved — `content-pane.tsx` still renders `FindBar` only for non-thread searchable views)
   - Instead, `ThreadContent` manages its own `findBarOpen` state and renders `FindBar` itself, backed by `useThreadSearch` which has direct access to `messages` and can receive the `virtuosoRef`

### Changes to `thread-content.tsx`

1. Add `findBarOpen` state and Cmd+F keydown listener (same pattern as `content-pane.tsx:86-98`)
2. Instantiate `useThreadSearch(messages, virtuosoRef)` — needs virtuosoRef from MessageList

### Changes to `message-list.tsx`

1. Expose `virtuosoRef` through the existing `MessageListRef` interface:
   ```ts
   export interface MessageListRef {
     scrollToBottom: () => void;
     scrollToIndex: (index: number) => void;
   }
   ```
2. Add `scrollToIndex` to `useImperativeHandle`:
   ```ts
   scrollToIndex: (index: number) => {
     virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" });
   }
   ```

### Changes to `thread-view.tsx`

Forward the ref through — it already does this (`ref` goes to `MessageList`). No changes needed.

### Integration in `thread-content.tsx`

```tsx
const threadSearch = useThreadSearch(messages, messageListRef);

// Render FindBar when open, positioned same as content-pane version
{findBarOpen && <FindBar search={threadSearch} onClose={closeFindBar} />}
```

### Cmd+F event flow

`ContentPane` handles Cmd+F for non-thread views (existing). For thread views, `ContentPane` won't handle it (thread is still not in content-pane's `isSearchable` for the FindBar rendering path). Instead, `ThreadContent` adds its own keydown listener for Cmd+F. This keeps the two paths cleanly separated.

**Simpler approach**: Keep thread excluded from `ContentPane`'s isSearchable. Add Cmd+F handling entirely in `ThreadContent`. This avoids any changes to `content-pane.tsx`.

## Phase 3: Add DOM highlighting after scroll

After `scrollToIndex`, the target turn is rendered in the DOM. Apply CSS Highlight API to show matches:

### Highlight strategy

1. After each scroll or query change, wait for Virtuoso to render (use `requestAnimationFrame` or a small timeout)
2. Walk the Virtuoso scroller DOM with `TreeWalker` (same technique as `useContentSearch`)
3. Find text nodes matching the query and create `Range` objects
4. Register highlights with `CSS.highlights.set("search-results", ...)` and `CSS.highlights.set("search-current", ...)`

The highlight pass only needs to cover **currently visible DOM** — that's the beauty of decoupling search (data) from highlighting (DOM).

### Re-highlighting on scroll

Use a `MutationObserver` on the Virtuoso scroll container (same pattern as existing `useContentSearch:146-157`). When items mount/unmount due to scrolling, re-run the highlight pass on visible content. This ensures highlights appear for any visible match, not just the current one.

### Current match highlighting

The "current" match needs special treatment:
- After navigating to a match, identify the specific text node + offset in the DOM
- Apply `search-current` highlight class to that single range
- This gives the orange highlight on the focused match vs. amber on all others

### Cleanup

On query clear or FindBar close, call `CSS.highlights.delete()` for both highlight names — same as existing `clearHighlights`.

## Key decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Search data vs. DOM | Data | Virtualized content isn't in DOM; data search is complete and fast |
| Where to put FindBar for threads | `ThreadContent` | Has access to messages and messageListRef; avoids prop drilling |
| Scroll API | `scrollToIndex` | Virtuoso's native API, handles variable-height items correctly |
| Highlight approach | CSS Highlight API on visible DOM | Same as existing finder — zero DOM mutation, same CSS classes |
| Re-highlight trigger | MutationObserver | Same pattern as existing, handles virtualization item swaps |

## Files to create

- `src/components/thread/use-thread-search.ts` — new hook (~120 lines)

## Files to modify

- `src/components/thread/thread-content.tsx` — add FindBar, Cmd+F handler, instantiate useThreadSearch
- `src/components/thread/message-list.tsx` — expose `scrollToIndex` on MessageListRef
