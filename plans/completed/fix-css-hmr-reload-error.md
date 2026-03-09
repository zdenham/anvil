# Fix: Vite CSS HMR Reload Error in Spotlight Window

## Problem

Spotlight window logs repeated errors during development:

```
[vite] TypeError: Importing a module script failed.
[vite] Failed to reload /src/index.css. This could be due to syntax errors or importing non-existent modules.
```

## Root Cause Analysis

**Primary suspect:** `@apply status-dot-running` **on** `src/index.css:289`

The `.working-dot` class uses `@apply status-dot-running` to inherit styles from a custom CSS class. In Tailwind v3's PostCSS pipeline, `@apply` is designed for Tailwind utility classes. When used with custom classes that contain complex properties (`animation`, `box-shadow`, `@keyframes` references), it can intermittently fail during HMR re-processing.

During HMR:

1. A `.tsx` file is saved → Tailwind re-scans content files → PostCSS re-processes `index.css`
2. The `@apply status-dot-running` resolution encounters a race condition with the `@keyframes statusDotPulse` definition
3. PostCSS emits an invalid or incomplete CSS module
4. The spotlight webview's dynamic `import()` of the new CSS module fails with `TypeError: Importing a module script failed`

**Why spotlight specifically?** All 5 windows (main, spotlight, clipboard, error, control-panel) import `index.css`. The spotlight window may be more susceptible due to its transparent background setup or WebSocket HMR timing with the Tauri webview.

**Contributing factor: Google Fonts** `@import url()` — Line 1 imports Google Fonts via external URL. During HMR, this re-triggers a network fetch which can timeout in the Tauri webview, compounding the module import failure.

## Fix

### Phase 1: Inline the `@apply status-dot-running` (primary fix)

Replace the problematic `@apply` with the actual CSS properties it resolves to.

`src/index.css:288-293` — Change:

```css
.working-dot {
  @apply status-dot-running;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
```

To:

```css
.working-dot {
  background-color: #22c55e;
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
  animation: statusDotPulse 2.5s ease-in-out infinite;
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
```

This eliminates the only `@apply` of a custom (non-Tailwind) class in the file.

### Phase 2: Verify

Run the dev server and confirm the error no longer appears in spotlight window logs during HMR.

## Phases

- [x] Inline `@apply status-dot-running` into `.working-dot`

- [ ] Verify HMR works without errors

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Notes

- If the error persists after Phase 1, the Google Fonts `@import url()` may need to be moved to the HTML `<link>` tag in each entry HTML file instead (removes the external URL from PostCSS processing entirely).
- All other `@apply` usages in the file use standard Tailwind utilities and should not cause issues.