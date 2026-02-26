# Fix Search Result Click-to-Navigate

The global search panel and content pane local search currently have disconnected highlighting logic. Clicking a global search result either flashes a line for 2 seconds (files) or opens the FindBar without scrolling (threads). This plan introduces a `searchState` zustand store that unifies global→local search handoff, so the same CSS Highlight API logic used for local Cmd+F also drives global search navigation — with proper match-index targeting and re-click handling.

## Phases

- [ ] Create `searchState` zustand store with global→local search handoff
- [ ] Wire file navigation through `searchState` (replace ephemeral flash)
- [ ] Wire thread navigation through `searchState` with auto-scroll
- [ ] Pass per-match index from search panel for targeted navigation
- [ ] Handle re-navigation to same content with same query (nonce)

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Architecture: The `searchState` Store

**Core idea:** The global search panel doesn't plumb search data through `ContentPaneView` props and `navigationService`. Instead, it writes to a shared zustand store. The content pane reads from that store to activate its local search. This decouples global search from the navigation/view system and ensures both file and thread content use the same highlighting/scrolling logic.

### Store shape (`src/stores/search-state.ts`)

```ts
interface SearchState {
  /** Whether local content search is activated (by global search or Cmd+F) */
  isEnabled: boolean;
  /** The active search query */
  searchQuery: string;
  /** Target match index within the content (0-based, from global search click) */
  targetMatchIndex: number | null;
  /** Nonce to force re-navigation when query/target haven't changed */
  nonce: number;

  // Actions
  activateSearch: (query: string, targetMatchIndex?: number) => void;
  deactivateSearch: () => void;
}
```

**`activateSearch(query, targetMatchIndex?)`** — Called by global search on result click. Sets `isEnabled: true`, `searchQuery`, `targetMatchIndex`, and increments `nonce`. The nonce solves the re-click identity problem (Phase 5) — even if query and targetMatchIndex are identical, the nonce change triggers React effects.

**`deactivateSearch()`** — Called when the search panel closes. Resets everything. The `SearchPanel` component calls `deactivateSearch()` on unmount (or in its `onClose` handler) so stale search state doesn't persist after the user dismisses the search panel.

**Why a store instead of props:** Currently `searchQuery` flows through `ContentPaneView` → `content-pane.tsx` → `useEffect` → `search.setQuery()`. This requires: (1) threading the query through `onNavigateToFile`/`onNavigateToThread` callbacks, (2) adding it to `ContentPaneView` discriminated union variants, (3) persisting transient search state to disk via `contentPanesService`. A store avoids all of this — global search writes directly, content pane reads directly. It also makes the nonce/re-click pattern trivial (no need to add `searchNonce` to `ContentPaneView`).

**Coexistence with Cmd+F:** When the user presses Cmd+F (local search), the content pane's own FindBar opens and manages `query`/`setQuery` on the `useContentSearch` / `useThreadSearch` hook directly — it does NOT go through `searchState`. The store is only for global→local handoff. The FindBar can read `searchState.searchQuery` as an initial value if it was opened via global search, but once the user starts typing locally, the FindBar input owns the query.

### Data flow

```
SearchPanel (global)
  │
  ├─ click file match → navigationService.navigateToFile(path, { lineNumber })
  │                    + searchState.activateSearch(query, matchIndex)
  │
  └─ click thread match → navigationService.navigateToThread(threadId)
                         + searchState.activateSearch(query, matchIndex)

ContentPane
  │
  ├─ subscribes to searchState.isEnabled / searchQuery / targetMatchIndex / nonce
  │
  ├─ File view (content-pane.tsx):
  │    useEffect([isEnabled, searchQuery, nonce]) →
  │      if isEnabled: open FindBar, search.setQuery(searchQuery)
  │      once matches found: scroll to targetMatchIndex (or closest match to lineNumber)
  │
  └─ Thread view (thread-content.tsx):
       useEffect([isEnabled, searchQuery, nonce]) →
         if isEnabled: open FindBar, threadSearch.setQuery(searchQuery)
         once matches found: navigateToMatch(targetMatchIndex ?? 0)
```

---

## Current State & Problems

**File results** — clicking scrolls to the line and flashes it amber for 2 seconds (`file-content.tsx:102-123`), then the highlight disappears. `searchQuery` IS on `ContentPaneView` and `content-pane.tsx:106-112` auto-opens the FindBar when set, but `handleSearchNavigateToFile` in `main-window-layout.tsx:608` only passes `{ lineNumber }` — never `searchQuery`. So the FindBar is never activated.

**Thread results** — clicking opens the thread and opens the FindBar with the query pre-filled (`thread-content.tsx:346-351`), showing "1 of N". But `runSearch()` in `use-thread-search.ts:250-274` calls `applyHighlights(0)` without `navigateToMatch(0)` — so the view stays at the bottom (where threads load). User must press Enter to scroll. Also: all match clicks pass only `threadId` (`virtualized-results.tsx:134`), so clicking different matches in the same thread does nothing different. Re-clicking the same thread with the same query also does nothing because `initialSearchQuery` hasn't changed.

---

## Phase 1: Create `searchState` zustand store

**New file:** `src/stores/search-state.ts`

Create the store as described in the Architecture section above. Simple zustand store with:
- `isEnabled`, `searchQuery`, `targetMatchIndex`, `nonce` state
- `activateSearch(query, targetMatchIndex?)` — sets enabled, query, target, bumps nonce
- `deactivateSearch()` — resets all fields

No persistence needed — this is ephemeral UI state.

**Clean up existing plumbing:**
- Remove `searchQuery` from `ContentPaneView` file type (`types.ts:23`)
- Remove `initialSearchQuery` from `ContentPaneView` thread type (`types.ts:17`)
- Remove `initialSearchQuery` from `ThreadContentProps` (`types.ts:73`)
- Remove `initialSearchQuery` from `navigationService.navigateToThread` options (`navigation-service.ts:19`)
- Remove `searchQuery` from `navigationService.navigateToFile` context (`navigation-service.ts:44`)
- Remove the `fileSearchQuery` auto-open `useEffect` in `content-pane.tsx:106-112` (will be replaced in Phase 2)
- Remove the `initialSearchQuery` auto-open `useEffect` in `thread-content.tsx:346-351` (will be replaced in Phase 3)

**Wire cleanup in `SearchPanel`:**
- In `search-panel.tsx`, call `deactivateSearch()` on unmount (via `useEffect` cleanup) and in the `onClose` handler. This ensures the store is cleared when the search panel is dismissed — the content pane should never be responsible for clearing it.

This phase gets the store created and removes the old prop-threading approach. The actual wiring happens in Phases 2-3.

---

## Phase 2: Wire file navigation through `searchState`

**Problem:** File result clicks flash a line for 2 seconds then lose the highlight. We want persistent CSS Highlight API highlighting via the same FindBar used by Cmd+F.

**Files:**
- `src/components/search-panel/search-panel.tsx`
- `src/components/main-window/main-window-layout.tsx`
- `src/components/content-pane/content-pane.tsx`
- `src/components/content-pane/file-content.tsx`

**Changes:**

1. **`search-panel.tsx`** — on file match click, call `searchState.activateSearch(query)` in addition to the existing `onNavigateToFile` callback:
   ```ts
   const handleFileMatchClick = useCallback((match: GrepMatch, filePath: string, isPlan: boolean) => {
     onNavigateToFile(filePath, match.lineNumber, worktreePath, isPlan);
     useSearchState.getState().activateSearch(search.query);
   }, [worktreePath, onNavigateToFile, search.query]);
   ```
   The `onNavigateToFile` callback still handles navigation (setting the view, scrolling to line). The store handles search activation.

2. **`main-window-layout.tsx`** — no changes needed for search. The handler already calls `navigationService.navigateToFile(path, { lineNumber })`. We keep `lineNumber` for scroll-to-line.

3. **`content-pane.tsx`** — subscribe to `searchState` and auto-open FindBar:
   ```ts
   const { isEnabled, searchQuery, nonce } = useSearchState();

   useEffect(() => {
     if (isEnabled && searchQuery && isSearchable) {
       setFindBarOpen(true);
       search.setQuery(searchQuery);
     }
   }, [isEnabled, searchQuery, nonce]);
   ```
   The content pane does NOT call `deactivateSearch()` — that's the search panel's responsibility (on close/unmount). This way if the user clicks multiple results in succession, the search state persists across view changes.

4. **`file-content.tsx`** — remove the ephemeral flash `useEffect` (lines 102-123). The FindBar's `useContentSearch` hook already scrolls to the first match via `scrollToMatch(0)` when matches are found. The CSS Highlight API gives persistent highlighting on all matches.

**Behavior after this phase:**
- Click file match in search panel → file opens, scrolls to `lineNumber`, FindBar opens with query, all instances highlighted persistently
- The "first match scroll" from `useContentSearch` may not land exactly on the clicked line — it scrolls to the first match in the file. This is acceptable: all matches are visible, and the user clicked to find this text in the file. (If needed later, we can pass `targetMatchIndex` to navigate to the match closest to the clicked line.)

---

## Phase 3: Wire thread navigation through `searchState` with auto-scroll

**Problem:** Thread search opens the FindBar but doesn't scroll to any match. The user has to press Enter/Next.

**Files:**
- `src/components/search-panel/search-panel.tsx`
- `src/components/content-pane/thread-content.tsx`
- `src/components/thread/use-thread-search.ts`

**Changes:**

1. **`search-panel.tsx`** — on thread match click, call `searchState.activateSearch(query)`:
   ```ts
   const handleThreadMatchClick = useCallback((threadId: string) => {
     onNavigateToThread(threadId, search.query);
     useSearchState.getState().activateSearch(search.query);
   }, [search.query, onNavigateToThread]);
   ```
   Note: `onNavigateToThread` still receives the query for navigation purposes (opening the right thread). But search activation goes through the store.

   **Update:** Since we removed `initialSearchQuery` from `navigateToThread` in Phase 1, update `onNavigateToThread` to just take `threadId`:
   ```ts
   onNavigateToThread: (threadId: string) => void;
   ```
   The query now flows entirely through `searchState`.

2. **`thread-content.tsx`** — subscribe to `searchState` and auto-open FindBar with scroll:
   ```ts
   const { isEnabled, searchQuery, targetMatchIndex, nonce } = useSearchState();

   useEffect(() => {
     if (isEnabled && searchQuery) {
       setFindBarOpen(true);
       threadSearch.setQueryAndNavigate(searchQuery, targetMatchIndex ?? 0);
     }
   }, [isEnabled, searchQuery, nonce]);
   ```

3. **`use-thread-search.ts`** — add `setQueryAndNavigate(query, matchIndex)` method:
   - Sets the query (triggering the debounced search)
   - Sets an `initialNavigationRef` flag with the target match index
   - In `runSearch`, after finding matches: if `initialNavigationRef.current !== null`, call `navigateToMatch(targetIdx)` and clear the flag
   - This distinguishes "navigate from global search" (scroll to match) from "user typing in FindBar" (don't force-scroll)

   Concretely in the hook:
   ```ts
   const initialNavRef = useRef<number | null>(null);

   const setQueryAndNavigate = useCallback((q: string, matchIdx: number) => {
     initialNavRef.current = matchIdx;
     setQuery(q);
   }, []);

   // In runSearch, after finding results:
   if (results.length > 0 && initialNavRef.current !== null) {
     const targetIdx = Math.min(initialNavRef.current, results.length - 1);
     navigateToMatch(targetIdx);
     initialNavRef.current = null;
   }
   ```

   Expose `setQueryAndNavigate` in the return value (extend `UseContentSearchReturn` or return a superset type).

**Behavior after this phase:**
- Click thread match → thread opens, FindBar opens, view scrolls to first match
- All matches highlighted with CSS Highlight API

---

## Phase 4: Pass per-match index for targeted navigation

**Problem:** All matches in the same file/thread navigate identically. Clicking match 5 vs match 1 in the search panel gives the same result because no per-match index is passed.

**Files:**
- `src/components/search-panel/virtualized-results.tsx`
- `src/components/search-panel/search-panel.tsx`
- `src/components/content-pane/content-pane.tsx` (file search targeting)
- `src/components/thread/use-thread-search.ts` (thread search targeting)

**Changes:**

### Thread matches

The `ThreadContentMatch` from Rust has `matchIndex` (sequential, 0-based per-thread). The `useThreadSearch` hook's `findMatches()` also produces matches in sequential order. These indices should align because both the Rust backend and JS frontend search the same thread content file in the same order.

1. **`virtualized-results.tsx`** — pass `match.matchIndex` on thread match click:
   ```ts
   onClick={() => onThreadMatchClick(item.group.threadId, item.match.matchIndex)
   ```
   Update `onThreadMatchClick` type: `(threadId: string, matchIndex: number) => void`

2. **`search-panel.tsx`** — accept and forward `matchIndex`:
   ```ts
   const handleThreadMatchClick = useCallback((threadId: string, matchIndex: number) => {
     onNavigateToThread(threadId);
     useSearchState.getState().activateSearch(search.query, matchIndex);
   }, [search.query, onNavigateToThread]);
   ```

3. **`thread-content.tsx` / `use-thread-search.ts`** — already handled in Phase 3. The `targetMatchIndex` from `searchState` flows through `setQueryAndNavigate(query, targetMatchIndex)` and `navigateToMatch(targetIdx)` scrolls to that specific match.

### File matches

File match targeting is trickier because `useContentSearch` operates on DOM ranges (CSS Highlight API), not indexed data. The Rust `GrepMatch` has `lineNumber` but no global match index.

**Approach:** Don't pass a match index for files. Instead, after the FindBar's `useContentSearch` finds all DOM ranges, find the range closest to `lineNumber` and navigate to it.

1. **`content-pane.tsx`** — when activated by `searchState` for a file view, after `search.setQuery(q)` completes (match count > 0), use `lineNumber` from the view to find the closest match:
   - Read the file view's `lineNumber` from the current view
   - After matches are found, iterate `rangesRef.current` to find the range whose `startContainer.parentElement` has the closest `data-line-number` to the target
   - Call `scrollToMatch(closestIdx)` and `setCurrentMatch(closestIdx + 1)`

   This can be a small helper in `useContentSearch` — `navigateToMatchNearLine(lineNumber: number)` — or done in the `content-pane.tsx` effect.

2. Alternatively (simpler): just scroll to match 0 (first in file). The FindBar already does this. The user sees all matches highlighted and can navigate with Enter. This is the MVP — per-line targeting for files can be a follow-up.

**Recommendation:** Start with match 0 for files (already works from Phase 2). Only implement line-based targeting if it feels wrong in practice.

---

## Phase 5: Handle re-navigation to same content with same query

**Problem:** If a thread/file is already open with the FindBar active and the user clicks a different match in the same file/thread from the search panel, nothing happens. The `useEffect` doesn't re-fire because `isEnabled`, `searchQuery`, and `targetMatchIndex` may all be the same.

**Solution:** Already handled by the `nonce` field in `searchState`. Every call to `activateSearch()` bumps the nonce. The `useEffect` in `content-pane.tsx` and `thread-content.tsx` includes `nonce` in the dependency array, so it re-fires even when query and target haven't changed.

**Files:** No additional changes needed — the nonce is part of the store from Phase 1 and included in effects from Phases 2-3.

**Verification:** Click the same match twice in the search panel → `activateSearch` fires → nonce increments → effect re-fires → `setQueryAndNavigate` called with (possibly same) query and new target → `navigateToMatch` scrolls. For threads with a new `targetMatchIndex`, this scrolls to a different position. For files, it refreshes to match 0 (or closest to lineNumber if implemented in Phase 4).

---

## Summary of files changed

| File | Phase | Change |
|------|-------|--------|
| `src/stores/search-state.ts` | 1 | **New** — zustand store |
| `src/components/content-pane/types.ts` | 1 | Remove `searchQuery`, `initialSearchQuery` from view types |
| `src/stores/navigation-service.ts` | 1 | Remove search-related options from navigate methods |
| `src/components/content-pane/content-pane.tsx` | 1,2 | Remove old auto-open effect; add `searchState` subscription |
| `src/components/content-pane/thread-content.tsx` | 1,3 | Remove old auto-open effect; add `searchState` subscription |
| `src/components/content-pane/file-content.tsx` | 2 | Remove ephemeral flash `useEffect` |
| `src/components/search-panel/search-panel.tsx` | 2,3,4 | Call `searchState.activateSearch()` on match clicks |
| `src/components/search-panel/virtualized-results.tsx` | 4 | Pass `matchIndex` on thread match click |
| `src/components/main-window/main-window-layout.tsx` | 3 | Simplify `onNavigateToThread` (remove query param) |
| `src/components/thread/use-thread-search.ts` | 3 | Add `setQueryAndNavigate` with initial navigation flag |
