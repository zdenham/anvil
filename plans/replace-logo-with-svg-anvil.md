# Replace ASCII Logo with SVG Anvil

Replace the ASCII art anvil logo in the top-left sidebar with the new high-contrast anvil SVG.

## Phases

- [x] Replace logo component with SVG inline
- [x] Verify usage sites still work

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Replace logo component with SVG inline

**File:** `src/components/ui/anvil-logo.tsx`

Replace the `<pre>` ASCII art with an inline SVG. The SVG source is `/Users/zac/Downloads/high-contrast-anvil (1).svg`.

Key changes:
- Convert the SVG to a React component (rename `class` → `className`, etc.)
- Remove the white background `<path>` (the full-rect white fill) so it's transparent
- Use `currentColor` instead of hardcoded colors so the component respects `className` color
- Keep the `size` prop but change semantics to pixel width/height (the ASCII version used font-size pixels, so `size={4}` was tiny — the SVG should default to something like `size={16}` or accept a pixel dimension)
- The SVG viewBox is `0 0 2613 2613` — keep that, size via `width`/`height` props

Proposed interface:
```tsx
interface AnvilLogoProps {
  /** Size in pixels. Default 16 */
  size?: number;
  /** CSS class for color etc. Default "text-surface-100" */
  className?: string;
}
```

The SVG paths use `fill="white"` and default black fill. For the sidebar (dark bg), we want:
- Remove the white background rectangle path
- Set the main anvil paths to `fill="currentColor"` so they inherit from the text color class

## Phase 2: Verify usage sites

**Files to check:**
- `src/components/tree-menu/tree-panel-header.tsx` — uses `<AnvilLogo size={4} />`, update to `<AnvilLogo size={16} />` or similar appropriate size
- `src/components/onboarding/steps/WelcomeStep.tsx` — uses `AnvilLogo`
- `src/components/spotlight/results-tray.tsx` — uses logo
- `src/components/ui/index.ts` — re-exports

The export name is already `AnvilLogo` (renamed from `AnvilLogo` in the ongoing rename). Callers importing `AnvilLogo` (like `tree-panel-header.tsx` line 4) need their import updated, or the old name kept as an alias.
