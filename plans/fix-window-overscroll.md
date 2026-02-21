# Fix Window Overscroll

## Problem

The entire Mort window can be overscrolled (elastic/rubber-band bounce effect on macOS). This is unexpected behavior for a desktop app — the window frame itself should never scroll or bounce.

## Root Cause

The `html`, `body`, and `#root` elements in `src/index.css` (lines 7–15) are missing `overscroll-behavior: none`. Without this property, WebKit (which Tauri uses) allows the default elastic overscroll on the viewport, even when `height: 100%` is set. This means any scroll that reaches the boundary of a child container propagates up to the viewport, triggering the bounce.

## Phases

- [ ] Add `overscroll-behavior: none` to root elements in `src/index.css`
- [ ] Add `overflow: hidden` to `html` and `body` to prevent any root-level scrolling

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Fix

In `src/index.css`, update the root element rule (lines 7–15):

```css
/* Ensure full viewport height for flex layouts */
html,
body,
#root {
  height: 100%;
  margin: 0;
  padding: 0;
  background-color: #141514; /* surface-900 */
  overscroll-behavior: none;
  overflow: hidden;
}
```

### Why both properties

| Property | Purpose |
|---|---|
| `overscroll-behavior: none` | Prevents elastic bounce / rubber-band effect when scroll reaches a boundary. Stops scroll chaining from child containers to the viewport. |
| `overflow: hidden` | Ensures the root elements themselves never become scrollable. All scrolling is handled by interior containers (`overflow-auto` / `overflow-y-auto` on specific components). |

### What this does NOT affect

- Individual scrollable panels (tree menu, settings, logs, plan content, thread content) all set their own `overflow-auto` / `overflow-y-auto` and will continue to scroll normally.
- The `ResizablePanel` layout and flex structure are unaffected.
- The transparent background overrides for spotlight/task panels are unaffected.

## Scope

**One file changed:** `src/index.css` — two CSS properties added to an existing rule.
