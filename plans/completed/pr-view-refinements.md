# PR View Refinements

Simplify the PR content pane and add review status indicators to the sidebar.

## Changes

### 1. Remove collapsibility from Comments section (`pr-comments-section.tsx`)

The section-level collapse (the outer `CollapsibleBlock` with chevron header) should be removed. Comments should always be visible as a flat list — no section toggle.

Individual comment expand/collapse (showing/hiding the body) stays as-is — that's useful per-comment UX, not section collapsibility.

**Concrete changes:**
- Remove `isSectionExpanded` state and the `CollapsibleBlock` wrapper
- Render the section with a static header ("Comments" + unresolved count) and the comment list directly beneath
- Keep the same card styling (`bg-surface-800/30 rounded-lg border border-dashed border-surface-700`)
- Remove `ExpandChevron` import (no longer needed)

### 2. Remove Reviews section collapsibility + replace with status display (`pr-reviews-section.tsx`)

Replace the collapsible reviews section with a non-collapsible section that just displays review status rather than individual review rows.

**Concrete changes:**
- Remove `isExpanded` state, `CollapsibleBlock` wrapper, and `ExpandChevron`
- Remove the `ReviewRow` component and the per-review list rendering
- Keep the `DecisionIndicator` — it becomes the primary content of this section
- Display the overall `reviewDecision` prominently: show the decision label with appropriate color badge (approved = green, changes requested = red, review required / pending = blue)
- Below the decision, show a compact summary line listing reviewers with their state badges (e.g. `@alice Approved · @bob Changes requested`), using the existing `ReviewStateBadge` component
- Remove `formatRelativeTime` (no longer displaying timestamps in review rows)

### 3. Show review status icon in sidebar PR item (`pull-request-item.tsx`, `pr-status.ts`, `use-tree-data.ts`, `tree-menu/types.ts`)

Replace the single `GitPullRequest` icon with different icons based on review state, so users can see at a glance whether a PR is approved, has changes requested, etc.

**Icon mapping** (all lucide-react, size 10):
- **Approved**: `GitPullRequest` in green (`text-green-400`)
- **Changes requested**: `GitPullRequestArrow` in red (`text-red-400`) — lucide's "changes needed" variant
- **Review required / pending**: `GitPullRequest` in blue (`text-blue-400`)
- **Draft**: `GitPullRequestDraft` in grey (`text-surface-500`)
- **Merged**: `GitMerge` in purple (`text-purple-400`)
- **Closed**: `GitPullRequestClosed` in red (`text-red-400`)
- **No details loaded / fallback**: `GitPullRequest` in grey (`text-surface-400`)

**Concrete changes:**

**`tree-menu/types.ts`**: Add an optional `reviewIcon` field to `TreeItemNode`:
```ts
/** Review status icon hint for pull-request items */
reviewIcon?: "approved" | "changes-requested" | "review-required" | "draft" | "merged" | "closed";
```

**`use-tree-data.ts`**: In `buildSectionItems`, when building PR items, derive the `reviewIcon` value from the loaded `PullRequestDetails`:
- `details.state === "MERGED"` → `"merged"`
- `details.state === "CLOSED"` → `"closed"`
- `details.isDraft` → `"draft"`
- `details.reviewDecision === "APPROVED"` → `"approved"`
- `details.reviewDecision === "CHANGES_REQUESTED"` → `"changes-requested"`
- `details.reviewDecision === "REVIEW_REQUIRED"` or null → `"review-required"`
- No details → undefined (falls through to default icon)

**`pull-request-item.tsx`**: Replace the single `GitPullRequest` icon with a function that picks the right icon + color based on `item.reviewIcon`:
- Import `GitPullRequestDraft`, `GitMerge`, `GitPullRequestClosed` from lucide-react (in addition to existing `GitPullRequest`)
- New helper `prIcon(reviewIcon)` that returns `{ Icon, colorClass }`
- Remove the `iconColorForStatus` function (no longer needed — icon choice supersedes status dot color)

## Phases

- [x] Remove section-level collapsibility from Comments section
- [x] Replace Reviews section with non-collapsible status display
- [x] Add review status icons to sidebar PR items

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
