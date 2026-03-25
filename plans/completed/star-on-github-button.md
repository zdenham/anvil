# Add "Star on GitHub" Button to Landing Page

## Summary

Add a "Star on GitHub" button to the landing page that links to <https://github.com/zdenham/anvil>. Place it prominently below the tagline section, before the feature grid.

## Phases

- [x] Add GitHub star button to landing page

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Implementation

**File:** `landing/src/App.tsx`

Add a new section between the tagline and feature grid sections containing a link styled as a button:

```tsx
{/* GitHub CTA */}
<section className="w-full max-w-2xl px-6 pb-8 flex justify-center">
  <a
    href="https://github.com/zdenham/anvil"
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-2 px-5 py-2.5 border border-surface-600 rounded-md text-surface-200 hover:text-surface-50 hover:border-surface-400 transition-colors text-sm"
  >
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
      <path d="M8 .2a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38l-.01-1.49c-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48l-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 8 .2Z" />
    </svg>
    Star on GitHub
  </a>
</section>
```

### Design notes

- Monospace font inherited from page styles
- Ghost button style (border, no fill) to match the dark terminal aesthetic
- GitHub octocat SVG icon inline (no extra dependency)
- `target="_blank"` since the repo isn't public yet — this is forward-looking
- Uses existing `surface-*` color tokens for consistency