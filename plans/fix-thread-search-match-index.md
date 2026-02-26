# Fix Thread Search Match Index Navigation

## Problem

When clicking a thread match in the global search panel, the wrong match gets highlighted/scrolled-to in the thread view. File search works correctly.

### Root Cause

The match index systems are misaligned between the backend and frontend for threads:

1. **Backend** (`search.rs`): Greps raw `state.json` files (JSON with keys, structural elements, tool_result blocks, etc.) and assigns `matchIndex` as a sequential counter per thread
2. **`buildFlatItems`** (`virtualized-results.tsx:225`): Uses the array position within the thread group — same as the backend's sequential counter, so this part is fine
3. **`useThreadSearch.findMatches()`**: Walks parsed `MessageParam[]`, extracting only user text, assistant text/tool_use/thinking blocks — produces a **completely different match set** than the backend

So when `matchIndex=2` flows from the search panel → `searchState.activateSearch(query, 2)` → `thread-content.tsx` → `threadSearch.setQueryAndNavigate(query, 2)`, it navigates to the 3rd match in the **frontend's** match list, which is a different match than the 3rd one the backend found.

### Why It Works for Files

For file content panes, `useContentSearch` walks the DOM of the rendered file. The grep results and DOM text matches appear in the same sequential order (both traverse the same content linearly), so `matchIndex=2` from grep correctly corresponds to the 3rd DOM text match.

### Why It Fails for Threads

`useThreadSearch` exists because threads use react-virtuoso (virtualized rendering) — not all content is in the DOM, so `useContentSearch`'s DOM-walking approach can't find all matches. Instead it searches `MessageParam[]` data. But the raw JSON lines the backend greps don't correspond to the parsed message content blocks the frontend searches.

## Solution

Instead of changing the backend search (which would require parsing all matched `state.json` files as JSON — too expensive), use a **frontend heuristic** to map the clicked snippet to the correct match in the frontend's match list.

The backend already provides `lineContent` — a cleaned snippet of text around the match. When the user clicks a search result, pass this snippet along with the query to the frontend. The frontend then finds the best-matching entry in its own `findMatches()` results by comparing the snippet text against the text surrounding each frontend match.

This won't be 100% accurate (e.g., if the same snippet appears multiple times in a thread), but it will be correct the vast majority of the time and avoids any backend changes.

### Heuristic Design

When a thread match is clicked:

1. The search panel already has `match.lineContent` (the snippet) and the `query`
2. Pass the snippet to `activateSearch` alongside the query
3. In `useThreadSearch`, when a `targetSnippet` is provided:
   - Run `findMatches()` as normal to get the frontend match list
   - For each frontend match, extract a window of text around it from the segment
   - Score each frontend match by how well its surrounding text overlaps with the backend snippet
   - Navigate to the best-scoring match instead of using a raw index

### Scoring approach

The snippet from the backend is a ~200 char window around the match from the raw JSON line. After `clean_json_snippet` processing, it's mostly readable text. The frontend has the full text of each segment.

For each frontend match at `(segmentIndex, offsetInText)`:
- Extract a ~200 char window from `segments[segmentIndex].text` centered on `offsetInText`
- Compute overlap: count how many words from the backend snippet appear in the frontend window (or use longest common substring)
- The match with the highest overlap score wins

Simple word-overlap is likely sufficient — the snippets contain enough context that even a basic comparison will disambiguate in nearly all cases.

### Implementation

#### Changes to `search-state.ts`

Add `targetSnippet: string | null` to `SearchState`. Update `activateSearch` to accept an optional snippet parameter.

```typescript
interface SearchState {
  // ... existing fields
  targetSnippet: string | null;  // NEW
}

activateSearch: (query: string, matchIndex?: number, snippet?: string) => {
  set((state) => ({
    isEnabled: true,
    searchQuery: query,
    targetMatchIndex: matchIndex ?? null,
    targetSnippet: snippet ?? null,  // NEW
    nonce: state.nonce + 1,
  }));
},
```

#### Changes to `search-panel.tsx`

Pass `lineContent` when calling `activateSearch`:

```typescript
const handleThreadMatchClick = useCallback((threadId: string, matchIndex: number, snippet: string) => {
  onNavigateToThread(threadId);
  useSearchState.getState().activateSearch(search.query, matchIndex, snippet);
}, [search.query, onNavigateToThread]);
```

#### Changes to `virtualized-results.tsx`

Update `onThreadMatchClick` callback type to include the snippet:

```typescript
onThreadMatchClick: (threadId: string, matchIndex: number, snippet: string) => void;
```

Pass `match.lineContent` in the click handler.

#### Changes to `use-thread-search.ts`

Add a `resolveMatchIndex` function:

```typescript
function resolveMatchIndex(
  matches: SearchMatch[],
  segments: SearchableSegment[],
  snippet: string,
): number {
  if (matches.length === 0) return 0;

  // Normalize snippet for comparison
  const normSnippet = snippet.toLowerCase().replace(/\s+/g, ' ').trim();
  const snippetWords = new Set(normSnippet.split(' ').filter(w => w.length > 2));

  let bestIdx = 0;
  let bestScore = -1;

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const seg = segments[match.segmentIndex];
    // Extract ~200 char window around the match
    const start = Math.max(0, match.offsetInText - 100);
    const end = Math.min(seg.text.length, match.offsetInText + 100);
    const window = seg.text.slice(start, end).toLowerCase().replace(/\s+/g, ' ');
    const windowWords = new Set(window.split(' ').filter(w => w.length > 2));

    // Score = number of shared words
    let score = 0;
    for (const word of snippetWords) {
      if (windowWords.has(word)) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx;
}
```

Update `runSearch` to use `resolveMatchIndex` when a `targetSnippet` is provided (read from search state), falling back to raw `targetMatchIndex` when no snippet is available (e.g., Cmd+F in-thread search).

#### Changes to `thread-content.tsx`

Read `targetSnippet` from search state alongside `targetMatchIndex`, pass it through to `setQueryAndNavigate`.

Update `setQueryAndNavigate` signature:
```typescript
setQueryAndNavigate(query: string, matchIndex: number, snippet?: string)
```

Store snippet in a ref, use it in `runSearch` to call `resolveMatchIndex`.

## Phases

- [x] Add `targetSnippet` to search state store and `activateSearch` API
- [x] Thread snippet through click handler: `virtualized-results.tsx` → `search-panel.tsx` → search state
- [x] Implement `resolveMatchIndex` heuristic in `use-thread-search.ts`
- [x] Wire `targetSnippet` from search state through `thread-content.tsx` → `useThreadSearch` to use the heuristic
- [ ] Manual verification: click thread match in search panel → correct match highlighted

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Notes

- **No backend changes needed** — the existing grep + `clean_json_snippet` approach stays as-is
- **Fallback behavior**: if `targetSnippet` is not provided (e.g., Cmd+F in-thread), falls back to the existing `targetMatchIndex` behavior
- **Accuracy trade-off**: the word-overlap heuristic won't be 100% correct when identical text appears multiple times, but this is rare in practice and acceptable
- **Performance**: `resolveMatchIndex` is O(matches * snippet_words) — trivially fast since match counts are capped at ~100
