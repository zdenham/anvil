# Fix Cmd+Shift+F Global Search Shortcut Conflict

## Problem

Pressing **Cmd+Shift+F** (global file search) also triggers the content pane's **Cmd+F** handler, causing two things to happen simultaneously:

1. The global search panel opens (correct)
2. The content pane's local FindBar toggles (incorrect — steals focus)

This means the search input in the global search panel doesn't reliably get focus.

## Root Cause

In `src/components/content-pane/content-pane.tsx:94`, the Cmd+F handler doesn't exclude the Shift modifier:

```typescript
// content-pane.tsx:94 — BUG: catches Cmd+Shift+F too
if ((e.metaKey || e.ctrlKey) && e.key === "f" && isSearchable)
```

Meanwhile, `thread-content.tsx:335` already handles this correctly:

```typescript
// thread-content.tsx:335 — correctly excludes Shift
if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f")
```

Both handlers are registered on `window` (bubble phase). The `main-window-layout.tsx:119` global search handler is on `document` (also bubble phase). Since `window` listeners fire after `document` listeners in the bubble phase, the sequence when pressing Cmd+Shift+F is:

1. `document` handler fires → opens search panel (correct)
2. `window` handler fires → toggles FindBar (wrong — no `!e.shiftKey` guard)

There's also a secondary issue: when the search panel is **already open**, pressing Cmd+Shift+F again should re-focus the search input. Currently `openSearch()` returns early (`if (prev.type === "search") return prev`), and no re-focus happens because the comment says "re-focus handled by component" — but no component actually handles this case.

## Phases

- [x] Add `!e.shiftKey` guard to content-pane.tsx Cmd+F handler
- [x] Add re-focus on repeated Cmd+Shift+F when search panel is already open

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Add `!e.shiftKey` guard to content-pane.tsx

**File:** `src/components/content-pane/content-pane.tsx` line 94

Change:
```typescript
if ((e.metaKey || e.ctrlKey) && e.key === "f" && isSearchable) {
```
To:
```typescript
if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f" && isSearchable) {
```

This matches the pattern already used in `thread-content.tsx:335`.

## Phase 2: Re-focus search input on repeated Cmd+Shift+F

When the search panel is already open and the user presses Cmd+Shift+F again, the input should re-focus. Two approaches, pick the simpler one:

**Option A — Listen inside SearchPanel for Cmd+Shift+F:**

Add a `keydown` listener in `search-panel.tsx` that re-focuses `inputRef` when Cmd+Shift+F is pressed while the panel is already mounted:

```typescript
// In SearchPanel, after the existing Escape listener
useEffect(() => {
  const handleFocus = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "f") {
      inputRef.current?.focus();
    }
  };
  document.addEventListener("keydown", handleFocus);
  return () => document.removeEventListener("keydown", handleFocus);
}, []);
```

This is self-contained within SearchPanel and doesn't require changing the state management layer.
