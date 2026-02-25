# B.2: PR Content Pane — Detail View, Header, Data Fetching

Implements the PR content pane that opens when a user clicks a PR item in the side panel. Displays PR description, CI checks, reviews, review comments, and the auto-address toggle. All GitHub data is fetched via the `gh` CLI on mount and on manual refresh — no polling. Gateway events trigger automatic refreshes via the PR entity listener (implemented in Sub-Plan A).

**Depends on:**
- [pr-entity.md](./pr-entity.md) (Sub-Plan A) — provides `usePullRequestStore`, `pullRequestService`, `PullRequestDetails`, `GhCli`
- [pr-ui-panel-integration.md](./pr-ui-panel-integration.md) (Sub-Plan B.1) Phase 1 — provides the `"pull-request"` variant in `ContentPaneView` and `PullRequestContentProps` in `src/components/content-pane/types.ts`

**Note:** If implementing in parallel with B.1, coordinate on the Phase 1 type changes. The `ContentPaneView` type and `ContentPaneViewSchema` must include the `"pull-request"` variant before this plan can compile.

## Phases

- [x] Phase 1: Create PullRequestHeader sub-component in content-pane-header
- [x] Phase 2: Create PR info and description sub-components
- [x] Phase 3: Create checks section sub-component
- [x] Phase 4: Create reviews and comments sub-components
- [x] Phase 5: Create auto-address toggle and assemble PullRequestContent
- [x] Phase 6: Wire into content-pane routing

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Create PullRequestHeader sub-component

### Modify: `src/components/content-pane/content-pane-header.tsx`

Add a `PullRequestHeader` sub-component following the existing `PlanHeader`, `ThreadHeader`, and `TerminalHeader` patterns. This file currently has `PlanHeader`, `ThreadHeader`, `FileHeader`, `TerminalHeader`, and `SimpleHeader` — adding one more sub-component.

**Add imports:**
```typescript
import { RefreshCw, GitPullRequest } from "lucide-react";
import { usePullRequestStore } from "@/entities/pull-requests/store";
import { pullRequestService } from "@/entities/pull-requests/service";
```

**Note:** The `PullRequestHeader` also uses `ExternalLink`, `PictureInPicture2`, and `X` from lucide-react. These are already imported at the top of `content-pane-header.tsx` for use by other header components, so no new imports are needed for these icons.

**Add the `derivePrStatusDot` helper** (or import from a shared utility if Sub-Plan B.1 extracted it to `src/utils/pr-status.ts`). If not extracted, define it locally:

```typescript
import type { PullRequestDetails } from "@core/types/pull-request.js";

function derivePrStatusDot(details: PullRequestDetails | undefined): StatusDotVariant {
  if (!details) return "read";
  if (details.state === "MERGED") return "read";
  if (details.state === "CLOSED") return "read";
  if (details.isDraft) return "unread";
  const hasFailingChecks = details.checks.some(c => c.status === "fail");
  const hasChangesRequested = details.reviewDecision === "CHANGES_REQUESTED";
  if (hasFailingChecks || hasChangesRequested) return "stale";
  const hasPendingChecks = details.checks.some(c => c.status === "pending");
  if (hasPendingChecks) return "running";
  return "read";
}
```

To avoid duplicating this function, extract it to `src/utils/pr-status.ts` and import from both `use-tree-data.ts` (Sub-Plan B.1) and here. The file is trivial:

```typescript
// src/utils/pr-status.ts
import type { StatusDotVariant } from "@/components/ui/status-dot";
import type { PullRequestDetails } from "@core/types/pull-request.js";

export function derivePrStatusDot(details: PullRequestDetails | undefined): StatusDotVariant {
  if (!details) return "read";
  if (details.state === "MERGED") return "read";
  if (details.state === "CLOSED") return "read";
  if (details.isDraft) return "unread";
  const hasFailingChecks = details.checks.some(c => c.status === "fail");
  const hasChangesRequested = details.reviewDecision === "CHANGES_REQUESTED";
  if (hasFailingChecks || hasChangesRequested) return "stale";
  const hasPendingChecks = details.checks.some(c => c.status === "pending");
  if (hasPendingChecks) return "running";
  return "read";
}
```

**PullRequestHeader sub-component:**

```typescript
function PullRequestHeader({
  prId,
  onClose,
  onPopOut,
}: {
  prId: string;
  onClose: () => void;
  onPopOut?: () => void;
}) {
  const pr = usePullRequestStore(useCallback((s) => s.getPr(prId), [prId]));
  const details = usePullRequestStore(useCallback((s) => s.getPrDetails(prId), [prId]));
  const isMainWindow = useIsMainWindow();
  const { repoName, worktreeName } = useBreadcrumbContext(pr?.repoId, pr?.worktreeId);

  const prLabel = details
    ? `PR #${pr?.prNumber}: ${details.title}`
    : `PR #${pr?.prNumber ?? "..."}`;

  const handleRefresh = useCallback(async () => {
    if (pr) {
      await pullRequestService.fetchDetails(pr.id);
    }
  }, [pr]);

  const handleOpenInBrowser = useCallback(() => {
    if (details?.url) {
      window.open(details.url, "_blank");
    }
  }, [details?.url]);

  return (
    <div className="@container flex items-center gap-2.5 px-3 py-2 border-b border-surface-700">
      <StatusDot variant={derivePrStatusDot(details)} />
      <Breadcrumb
        repoName={repoName}
        worktreeName={worktreeName}
        category="pull-requests"
        itemLabel={prLabel}
        onCategoryClick={onClose}
      />
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={handleRefresh}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Refresh PR data"
          title="Refresh PR data"
        >
          <RefreshCw size={12} />
        </button>
        <button
          onClick={handleOpenInBrowser}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Open in browser"
          title="Open in browser"
        >
          <ExternalLink size={12} />
        </button>
        {onPopOut && !isMainWindow && (
          <button
            onClick={onPopOut}
            className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
            aria-label="Pop out to window"
            title="Pop out to window"
          >
            <PictureInPicture2 size={12} />
          </button>
        )}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-surface-700 text-surface-400 hover:text-surface-200 transition-colors"
          aria-label="Close pane"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
```

**Wire into `ContentPaneHeader`** — add a new branch in the main function before the settings/logs fallback:

```typescript
if (view.type === "pull-request") {
  return (
    <PullRequestHeader prId={view.prId} onClose={onClose} onPopOut={onPopOut} />
  );
}
```

### Note on file size

`content-pane-header.tsx` is currently ~430 lines. Adding `PullRequestHeader` adds ~50 lines. If the file exceeds comfort, extract `PullRequestHeader` to its own file `src/components/content-pane/pull-request-header.tsx` and import it. But given existing precedent (all headers live in this file), keeping it inline is acceptable.

### Verification

Run `pnpm tsc --noEmit`. Visually confirm the header renders with status dot, breadcrumb, refresh/external/close buttons.

---

## Phase 2: Create PR info and description sub-components

### New file: `src/components/content-pane/pr-info-section.tsx`

Displays the PR metadata at the top of the scrollable content area. Must stay under 250 lines.

**Content:**
- PR title (large, `text-lg font-semibold`)
- PR number (`#42`, muted)
- State badge: Open (green), Closed (red), Merged (purple), Draft (grey). Use a small inline badge with colored background:
  ```tsx
  function StateBadge({ state, isDraft }: { state: string; isDraft: boolean }) {
    if (isDraft) return <span className="px-1.5 py-0.5 text-xs rounded bg-surface-700 text-surface-300">Draft</span>;
    if (state === "MERGED") return <span className="px-1.5 py-0.5 text-xs rounded bg-purple-600/20 text-purple-400">Merged</span>;
    if (state === "CLOSED") return <span className="px-1.5 py-0.5 text-xs rounded bg-red-600/20 text-red-400">Closed</span>;
    return <span className="px-1.5 py-0.5 text-xs rounded bg-green-600/20 text-green-400">Open</span>;
  }
  ```
- Author: `@{author}`
- Branch info: `{baseBranch} <- {headBranch}` (use `GitBranch` icon from lucide-react)
- Labels (if any): rendered as small pills

**Props:**
```typescript
interface PrInfoSectionProps {
  details: PullRequestDetails;
  headBranch: string;
  baseBranch: string;
}
```

### New file: `src/components/content-pane/pr-description-section.tsx`

Renders the PR body as markdown. Must stay under 250 lines.

**Content:**
- If body is empty/null, show muted placeholder: `"No description provided."`
- If body exists, render as markdown. Use whatever markdown rendering infrastructure exists in the codebase (check for existing markdown components in `src/components/`). If none exists, render in a `<pre>` with `whitespace-pre-wrap` as a simple fallback — rich markdown rendering can be improved later.

**Props:**
```typescript
interface PrDescriptionSectionProps {
  body: string;
}
```

### Verification

Run `pnpm tsc --noEmit`. Each file should be well under 250 lines.

---

## Phase 3: Create checks section sub-component

### New file: `src/components/content-pane/pr-checks-section.tsx`

Displays CI check runs. Must stay under 250 lines.

**Props:**
```typescript
interface PrChecksSectionProps {
  checks: PullRequestDetails["checks"];
}
```

**Layout:** A collapsible section with a header showing check summary (e.g., "3/5 checks passed") and individual check rows.

**Each check row displays:**
- Status icon:
  - `pass`: green `CheckCircle2` from lucide-react
  - `fail`: red `XCircle` from lucide-react
  - `pending`: amber `Loader2` with `animate-spin`
  - `skipping`: grey `SkipForward` or `MinusCircle`
  - `cancelled`: grey `CircleSlash` (or `Ban`)
- Check name (truncated)
- Duration: if both `startedAt` and `completedAt` are present, compute and display (e.g., "2m 34s"). Use a small helper:
  ```typescript
  function formatDuration(startedAt: string | null, completedAt: string | null): string | null {
    if (!startedAt || !completedAt) return null;
    const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
    if (ms < 1000) return "<1s";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  ```
- External link icon (clickable, opens check URL in browser)

**Empty state:** If `checks` array is empty, show "No CI checks" in muted text.

**Section header pattern:**
```tsx
<div className="border-b border-surface-700 pb-2 mb-3">
  <h3 className="text-sm font-medium text-surface-200">
    Checks
    <span className="ml-2 text-xs text-surface-400">
      {passCount}/{checks.length} passed
    </span>
  </h3>
</div>
```

### Verification

Run `pnpm tsc --noEmit`. File should be well under 250 lines.

---

## Phase 4: Create reviews and comments sub-components

### New file: `src/components/content-pane/pr-reviews-section.tsx`

Displays reviews. Must stay under 250 lines.

**Props:**
```typescript
interface PrReviewsSectionProps {
  reviews: PullRequestDetails["reviews"];
  reviewDecision: PullRequestDetails["reviewDecision"];
}
```

**Each review displays:**
- Author name
- Review state badge (same inline badge pattern as StateBadge):
  - `APPROVED`: green
  - `CHANGES_REQUESTED`: amber/red
  - `COMMENTED`: grey
  - `DISMISSED`: muted grey with strikethrough
  - `PENDING`: blue
- Body preview (first 200 characters, truncated with ellipsis)
- Submitted timestamp (relative, e.g., "2 hours ago")

**Section header:** "Reviews" with an overall decision indicator (if `reviewDecision` is set).

**Empty state:** "No reviews yet" in muted text.

### New file: `src/components/content-pane/pr-comments-section.tsx`

Displays inline review comments. Must stay under 250 lines.

**Props:**
```typescript
interface PrCommentsSectionProps {
  comments: PullRequestDetails["reviewComments"];
}
```

**Each comment displays:**
- Author name
- File path and line number (e.g., `src/lib/foo.ts:42`)
- Comment body (plain text for v1 — rich markdown rendering is future scope)
- Resolution state: unresolved comments display expanded, resolved comments display collapsed with a "Resolved" label

**Collapsible behavior:**
- Unresolved comments: expanded by default, with a subtle left border accent (amber or red)
- Resolved comments: collapsed by default, with a muted "Resolved" label. Click to expand.

Use local `useState` to track expanded state per comment:
```typescript
const [expandedComments, setExpandedComments] = useState<Set<string>>(() => {
  // Default: all unresolved comments expanded
  return new Set(comments.filter(c => !c.isResolved).map(c => c.id));
});
```

**Section header:** "Comments" with count of unresolved (e.g., "Comments (3 unresolved)")

**Empty state:** "No review comments" in muted text.

### Verification

Run `pnpm tsc --noEmit`. Each file under 250 lines.

---

## Phase 5: Create auto-address toggle and assemble PullRequestContent

### New file: `src/components/content-pane/pr-auto-address-toggle.tsx`

The auto-address toggle at the bottom of the content pane. Must stay under 250 lines.

**Imports:**
```typescript
import { gatewayChannelService } from "@/entities/gateway-channels";
import { pullRequestService } from "@/entities/pull-requests/service";
```

**Props:**
```typescript
interface PrAutoAddressToggleProps {
  prId: string;
  autoAddressEnabled: boolean;
  repoId: string;
}
```

**Toggle behavior on enable:**
1. Look up the existing gateway channel for this repo: `gatewayChannelService.getByRepoId(repoId)`
2. If channel exists, call `pullRequestService.enableAutoAddress(prId, channelId)`
3. If channel does not exist, show an error (this should not happen since channels are created for all repos by default, but handle defensively)

**Toggle behavior on disable:**
1. Call `pullRequestService.disableAutoAddress(prId)`

**Toggle UI:** Use a simple toggle switch. If a `ToggleSwitch` component exists in `src/components/ui/`, use it. Otherwise implement a minimal one inline:

```tsx
<button
  role="switch"
  aria-checked={autoAddressEnabled}
  onClick={handleToggle}
  className={cn(
    "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
    autoAddressEnabled ? "bg-accent-500" : "bg-surface-600"
  )}
>
  <span
    className={cn(
      "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
      autoAddressEnabled ? "translate-x-4.5" : "translate-x-0.5"
    )}
  />
</button>
```

**Layout:**
```tsx
<div className="border-t border-surface-700 px-4 py-3 flex items-center justify-between">
  <div>
    <div className="text-sm text-surface-200">Auto-address comments & CI failures</div>
    <div className="text-xs text-surface-400 mt-0.5">
      Automatically spawn agents to address review feedback and fix CI failures
    </div>
  </div>
  {/* toggle switch */}
</div>
```

### New file: `src/components/content-pane/pull-request-content.tsx`

The main PR content pane component. Assembles all sub-components. Must stay under 250 lines.

**Imports:**
```typescript
import { useCallback, useEffect } from "react";
import { usePullRequestStore } from "@/entities/pull-requests/store";
import { pullRequestService } from "@/entities/pull-requests/service";
import { PrInfoSection } from "./pr-info-section";
import { PrDescriptionSection } from "./pr-description-section";
import { PrChecksSection } from "./pr-checks-section";
import { PrReviewsSection } from "./pr-reviews-section";
import { PrCommentsSection } from "./pr-comments-section";
import { PrAutoAddressToggle } from "./pr-auto-address-toggle";
import { logger } from "@/lib/logger-client";
import type { PullRequestContentProps } from "./types";
```

**Data fetching on mount:**
```typescript
export function PullRequestContent({ prId, onPopOut }: PullRequestContentProps) {
  const pr = usePullRequestStore(useCallback((s) => s.getPr(prId), [prId]));
  const details = usePullRequestStore(useCallback((s) => s.getPrDetails(prId), [prId]));
  const isLoading = usePullRequestStore(useCallback((s) => s.prDetailsLoading[prId] ?? false, [prId]));

  // Fetch details on mount
  useEffect(() => {
    pullRequestService.fetchDetails(prId);
  }, [prId]);
```

**gh CLI error states:**
- If `GhCliNotInstalledError`: show an error banner with "Install GitHub CLI" button
- If `GhCliNotAuthenticatedError`: show an "Authenticate" button
- These are surfaced inline in the content pane. Use a simple error state component:

```tsx
function GhCliErrorBanner({ error }: { error: "not-installed" | "not-authenticated" }) {
  if (error === "not-installed") {
    return (
      <div className="mx-4 my-3 p-3 rounded bg-red-600/10 border border-red-600/20 text-sm">
        <p className="text-red-400">GitHub CLI not found</p>
        <p className="text-surface-400 text-xs mt-1">
          Install the GitHub CLI to view pull request details.
        </p>
      </div>
    );
  }
  return (
    <div className="mx-4 my-3 p-3 rounded bg-amber-600/10 border border-amber-600/20 text-sm">
      <p className="text-amber-400">Not authenticated with GitHub</p>
      <p className="text-surface-400 text-xs mt-1">
        Run `gh auth login` to authenticate.
      </p>
    </div>
  );
}
```

**Loading state:** Show a skeleton when `isLoading` is true and `details` is null (first load only). For subsequent refreshes, show stale data while loading (stale-while-revalidate).

```tsx
if (isLoading && !details) {
  return <PrLoadingSkeleton />;
}
```

The skeleton component shows placeholder bars for title, description, checks — standard skeleton pattern.

**Assembled layout:**
```tsx
return (
  <div className="flex flex-col h-full">
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      {details && pr && (
        <>
          <PrInfoSection
            details={details}
            headBranch={pr.headBranch}
            baseBranch={pr.baseBranch}
          />
          <PrDescriptionSection body={details.body} />
          <PrChecksSection checks={details.checks} />
          <PrReviewsSection
            reviews={details.reviews}
            reviewDecision={details.reviewDecision}
          />
          <PrCommentsSection comments={details.reviewComments} />
        </>
      )}
      {!details && !isLoading && (
        <div className="text-surface-500 text-sm text-center py-8">
          Failed to load PR details
        </div>
      )}
    </div>
    {/* Auto-address toggle pinned at bottom */}
    {pr && (
      <PrAutoAddressToggle
        prId={pr.id}
        autoAddressEnabled={pr.autoAddressEnabled}
        repoId={pr.repoId}
      />
    )}
  </div>
);
```

### Verification

Run `pnpm tsc --noEmit`. Each new file under 250 lines. Verify `pull-request-content.tsx` renders all sections in the correct order.

---

## Phase 6: Wire into content-pane routing

### Modify: `src/components/content-pane/content-pane.tsx`

**Add import:**
```typescript
import { PullRequestContent } from "./pull-request-content";
```

**Add render branch** for the `"pull-request"` view type. Insert alongside the existing view type branches (after the `file` branch is a natural spot):

```tsx
{view.type === "pull-request" && (
  <PullRequestContent prId={view.prId} onPopOut={onPopOut} />
)}
```

This goes inside the `<div ref={contentRef}>` container, alongside the other view type renderers.

**Update `isSearchable`** to include pull-request views (PR content is text-heavy and benefits from find-in-page):
```typescript
const isSearchable =
  view.type !== "empty" && view.type !== "terminal" && view.type !== "settings" && view.type !== "thread";
```
This already covers `"pull-request"` (it is searchable by default since it is not in the exclusion list). No change needed unless the current logic differs.

### Verification

Run `pnpm tsc --noEmit`. Run `pnpm test`. Open a PR content pane in the app and verify:
1. Header shows with status dot, breadcrumb, refresh/external/close buttons
2. Scrollable content shows info, description, checks, reviews, comments sections
3. Auto-address toggle is pinned at the bottom
4. Refresh button triggers a re-fetch
5. "Open in browser" opens the PR URL

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `src/utils/pr-status.ts` | CREATE | Shared `derivePrStatusDot` helper (used by both B.1 and B.2) |
| `src/components/content-pane/content-pane-header.tsx` | MODIFY | Add PullRequestHeader sub-component, wire into ContentPaneHeader |
| `src/components/content-pane/pr-info-section.tsx` | CREATE | PR title, state badge, author, branch info, labels |
| `src/components/content-pane/pr-description-section.tsx` | CREATE | PR body rendered as markdown (or plaintext fallback) |
| `src/components/content-pane/pr-checks-section.tsx` | CREATE | CI check runs list with status icons and duration |
| `src/components/content-pane/pr-reviews-section.tsx` | CREATE | Reviews list with state badges and body preview |
| `src/components/content-pane/pr-comments-section.tsx` | CREATE | Inline review comments with resolution state (expand/collapse) |
| `src/components/content-pane/pr-auto-address-toggle.tsx` | CREATE | Auto-address on/off toggle with gateway channel wiring |
| `src/components/content-pane/pull-request-content.tsx` | CREATE | Main PR content pane assembling all sub-components |
| `src/components/content-pane/content-pane.tsx` | MODIFY | Add `"pull-request"` render branch for routing |

**Total: 2 modified files, 8 new files (10 file changes)**

## Dependencies

- **Required before starting:** Sub-Plan A ([pr-entity.md](./pr-entity.md)) — provides `usePullRequestStore`, `pullRequestService`, `PullRequestDetails`, `PullRequestMetadata`, `GhCli`
- **Required before starting:** Sub-Plan B.1 ([pr-ui-panel-integration.md](./pr-ui-panel-integration.md)) Phase 1 — provides the `"pull-request"` variant in `ContentPaneView`, `PullRequestContentProps`, and `"pull-requests"` in the Breadcrumb category union
- **Required for Phase 5 (auto-address toggle):** Sub-Plan D1 ([pr-gateway-channels.md](./pr-gateway-channels.md)) — provides `gatewayChannelService.getByRepoId()` used by the toggle to find the repo's gateway channel. If D1 is not yet implemented when B.2 is started, the toggle can be stubbed with a disabled state and "Coming soon" label.
- **No dependency on:** Sub-Plan C ([pr-creation.md](./pr-creation.md)) — the content pane displays existing PRs, creation flow is independent
