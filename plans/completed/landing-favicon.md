# Add Favicon to Landing Page

## Summary
Add the Anvil logo as the favicon for the landing page at `landing/index.html`.

## Phases

- [ ] Create SVG favicon and add to landing page

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Approach

1. **Create `landing/public/favicon.svg`** — Extract the SVG from `src/components/ui/anvil-logo.tsx` into a standalone SVG file. Use a dark fill so it's visible in browser tabs.

2. **Add `<link rel="icon">` to `landing/index.html`** — Add in the `<head>`:
   ```html
   <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
   ```

Vite serves files from `public/` at the root, so `/favicon.svg` will resolve correctly in both dev and production builds.

### Why SVG
- Already have the vector paths in `anvil-logo.tsx`
- SVG favicons are supported by all modern browsers
- No need to generate multiple PNG sizes
- Smaller file size

### Alternative
If we also want PNG fallback for older browsers, we could copy `src-tauri/icons/32x32.png` to `landing/public/favicon.png` and add a second link tag. But SVG-only should be sufficient for a landing page audience.
