# PR Section Cards + Collapsible Sections

## Problem

1. The PR content pane sections (Description, Checks, Reviews, Comments) are hard to visually distinguish. They use only a thin `border-b` under each heading and `space-y-4` between them — no backgrounds or containers — so everything blends together.
2. The PR content pane is missing the `max-w-[900px] mx-auto` constraint and top padding that other content panes use (e.g. `PlanContent`, `FileContent`). On wide screens the content stretches edge-to-edge, which looks inconsistent.

## Approach

Wrap each section in a card container (`bg-surface-800/30 rounded-lg p-4`) matching the existing `SettingsSection` pattern, and make the four content sections collapsible using the existing `CollapsibleBlock` + `ExpandChevron` primitives from `src/components/ui/`.

**PrInfoSection** stays as-is (no card, no collapse) — it's the PR's "hero" area with title/state/branches and should always be visible at the top.

## Phases

- [x] Add collapsible card wrapper to PrDescriptionSection
- [x] Add collapsible card wrapper to PrChecksSection
- [x] Add collapsible card wrapper to PrReviewsSection
- [x] Add collapsible card wrapper to PrCommentsSection
- [x] Add max-width constraint and top padding to PullRequestContent
- [x] Update PrLoadingSkeleton to match new card layout

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Design

### Card wrapper styling

Each collapsible section gets the same container treatment:

```
bg-surface-800/30 rounded-lg
```

The `CollapsibleBlock` from `src/components/ui/collapsible-block.tsx` handles expand/collapse + keyboard/ARIA. The header slot gets an `ExpandChevron` plus the existing heading text and any inline badges (count, decision indicator, etc.).

### Section header pattern

Replace the current `border-b border-surface-700 pb-2 mb-3` divider heading with a clickable card header:

```tsx
<CollapsibleBlock
  isExpanded={isExpanded}
  onToggle={() => setIsExpanded(!isExpanded)}
  className="bg-surface-800/30 rounded-lg"
  headerClassName="flex items-center gap-2 px-4 py-3"
  header={
    <>
      <ExpandChevron isExpanded={isExpanded} size="sm" />
      <h3 className="text-sm font-medium text-surface-200">Section Title</h3>
      {/* inline badge/count if applicable */}
    </>
  }
>
  <div className="px-4 pb-3">
    {/* section content */}
  </div>
</CollapsibleBlock>
```

### Default expand/collapse state

- **Description**: expanded by default (primary content users want to see)
- **Checks**: expanded by default (users need to see CI status at a glance)
- **Reviews**: expanded by default (review decision is critical)
- **Comments**: expanded by default (matches current behavior where unresolved comments are visible)

All sections are collapsible so users can dismiss sections they don't need. State is local (per mount) — no persistence needed.

### Max-width and padding

The scrollable content area in `pull-request-content.tsx` currently uses `px-4 py-3`. Change the inner wrapper to match other content panes:

```tsx
<div className="flex-1 overflow-y-auto">
  <div className="max-w-[900px] mx-auto p-4 space-y-3">
    {/* sections */}
  </div>
</div>
```

This matches `PlanContent` (`max-w-[900px] mx-auto p-4`) and `FileContent` (same). The `p-4` gives consistent top/side/bottom padding, and `mx-auto` centers the content on wide screens.

### File changes

| File | Change |
|------|--------|
| `pull-request-content.tsx` | Add `max-w-[900px] mx-auto p-4` wrapper inside the scrollable area; update `PrLoadingSkeleton` to use card placeholders with same max-width |
| `pr-description-section.tsx` | Add `useState` for expand, wrap in `CollapsibleBlock` with card classes, remove old `border-b` heading |
| `pr-checks-section.tsx` | Same pattern; keep pass count badge in header |
| `pr-reviews-section.tsx` | Same pattern; keep `DecisionIndicator` in header |
| `pr-comments-section.tsx` | Same pattern; keep unresolved count in header. Per-comment expand/collapse stays as-is (nested within the section) |

### What stays the same

- `PrInfoSection` — no card, no collapse (always visible hero)
- `PrAutoAddressToggle` — pinned footer, already visually distinct with `border-t`
- `PullRequestHeader` — untouched
- Per-comment expand/collapse in `PrCommentsSection` — stays as nested toggles within the section card
