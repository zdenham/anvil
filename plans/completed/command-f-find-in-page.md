# Cmd+F Find-in-Page

Add native-feeling find-in-page (Cmd+F) search to all content panes.

## Research Findings

### The Problem

Tauri v2 on macOS does **not** pass Cmd+F through to the webview's native find bar. On Windows (WebView2/Chromium) and Linux (WebKitGTK), it works out of the box. This is a known Tauri issue: [tauri-apps/tauri#9385](https://github.com/tauri-apps/tauri/issues/9385) — still open, no ETA.

The underlying library (wry) also lacks a find API. There's an open PR ([wry#593](https://github.com/tauri-apps/wry/pull/593)) that adds `findString` support for macOS/Linux but **not Windows**, and it hasn't been merged.

### Recommendation: Option B — CSS Custom Highlight API + Custom Overlay

- Single cross-platform implementation (no Rust changes needed)
- Standards-based (`CSS.highlights` supported in Safari 17.2+ / WKWebView, Chrome 105+)
- Full control over UI/UX — matches our design system
- Zero DOM mutation — highlights are rendered as browser overlay, no React re-renders
- Scoping is automatic: only text nodes inside the `containerRef` get highlighted

---

## Design

### UI: Search Bar Overlay

A floating search bar anchored to the top-right of the content pane:

```
┌─────────────────────────────────────────────────┐
│ Content Pane Header                             │
├─────────────────────────────────────────┬───────┤
│                                         │ 🔍    │
│  Content area                           │search │
│  with highlighted matches               │ 3/17  │
│                                         │ ▲ ▼ ✕ │
│                                         └───────┤
│                                                 │
└─────────────────────────────────────────────────┘
```

- Input field with real-time search-as-you-type
- Match counter ("3 of 17")
- Up/Down arrows to navigate between matches (Enter for next, Shift+Enter for previous)
- Escape or X button to close and clear highlights
- All matches: amber highlight. Current match: orange highlight (visually distinct).

### Scope: Searchable Pane Types

Search is available for: `thread`, `plan`, `file`, `logs`. Excluded: `terminal` (has xterm.js search), `settings`, `empty`.

The `contentRef` wraps the `flex-1 min-h-0` div inside `ContentPane` — this is the container below the header that holds all view content. The `TreeWalker` is scoped to this ref, so highlights never leak outside the pane.

### Keyboard Shortcuts

- **Cmd+F**: Open find bar (or focus if already open)
- **Escape**: Close find bar, clear highlights
- **Enter / Cmd+G**: Next match
- **Shift+Enter / Cmd+Shift+G**: Previous match

---

## Phases

- [x] Create `use-content-search.ts` hook and `find-bar.tsx` component
- [x] Integrate into `content-pane.tsx` — wire Cmd+F, scope search to content area
- [x] Add `::highlight()` CSS to `index.css`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Implementation Notes

### File Structure

```
src/components/content-pane/
  find-bar.tsx              — FindBar UI component
  use-content-search.ts     — Hook: search logic + Highlight API
```

### `useContentSearch` Hook

```ts
interface UseContentSearchReturn {
  query: string;
  setQuery: (q: string) => void;
  matchCount: number;
  currentMatch: number;       // 1-indexed
  goToNext: () => void;
  goToPrevious: () => void;
  clear: () => void;
}

function useContentSearch(containerRef: RefObject<HTMLElement>): UseContentSearchReturn
```

Core logic:
1. On `query` change (debounced ~150ms), walk `containerRef` DOM with `TreeWalker(SHOW_TEXT)`
2. For each text node, find all case-insensitive substring matches
3. Create `Range` objects for each match
4. Register highlights:
   - `CSS.highlights.set("search-results", new Highlight(...allRanges))` — all matches
   - `CSS.highlights.set("search-current", new Highlight(currentRange))` — active match
5. **Auto-scroll to first match** when results first appear (not just on next/prev)
6. On next/prev, update `currentMatch` index, update `search-current` highlight, and `scrollIntoView({ block: "center", behavior: "smooth" })` on the active range's parent element
7. On `clear()`, delete both highlight registrations and reset state
8. Use `MutationObserver` on `containerRef` to re-run search when DOM changes (handles streaming content)

### `FindBar` Component

Minimal, keyboard-first:
- Auto-focus input on open
- `onKeyDown`: Enter → next, Shift+Enter → previous, Escape → close
- Display: `"{current} of {total}"` or `"No results"` when total is 0
- Positioned absolutely top-right within the content pane wrapper (`absolute top-2 right-2`)
- Styled to match design system: `bg-surface-800 border border-surface-600 rounded-lg shadow-lg`

### Integration in `ContentPane`

```tsx
// In content-pane.tsx
const [findBarOpen, setFindBarOpen] = useState(false);
const contentRef = useRef<HTMLDivElement>(null);
const search = useContentSearch(contentRef);

// Cmd+F handler
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "f") {
      e.preventDefault();
      setFindBarOpen(true);
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, []);

// Only show for searchable view types
const isSearchable = view.type !== "empty" && view.type !== "terminal" && view.type !== "settings";

// Wrap content area with ref
<div ref={contentRef} className="flex-1 min-h-0 relative">
  {isSearchable && findBarOpen && (
    <FindBar search={search} onClose={() => { search.clear(); setFindBarOpen(false); }} />
  )}
  {/* existing view rendering */}
</div>
```

### CSS (in `index.css`)

```css
/* Find-in-page highlight styles (CSS Custom Highlight API) */
::highlight(search-results) {
  background-color: rgba(251, 191, 36, 0.4); /* amber-400 */
}

::highlight(search-current) {
  background-color: rgba(249, 115, 22, 0.6); /* orange-500 */
}
```

### Edge Cases

- **Streaming content**: `MutationObserver` on container re-runs search as DOM updates. Current match index is preserved if the range still exists.
- **Virtualized lists**: Thread `MessageList` uses react-virtuoso. Only rendered DOM nodes are searchable — acceptable for MVP. Scrolling reveals more content which the `MutationObserver` picks up.
- **Large threads**: Debounced input (150ms) + match limit of 1000 ranges prevents jank.
- **`user-select: none`**: Highlights won't render on those elements in Safari/WKWebView. The header has `user-select: none` but that's outside `contentRef` so it's fine.
