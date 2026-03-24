# B: PR Side Panel & Content Pane UI

Adds the `"pull-request"` item type to the side panel tree, a PR content pane view, and the "Create pull request" action in the plus dropdown menu. All GitHub data displayed in these components is fetched via the `gh` CLI (never direct API calls), leveraging the user's existing credentials. The PR entity stores minimal binding metadata; all display data (`PullRequestDetails`) is ephemeral and fetched on-demand.

## Phases

- [ ] Add "pull-request" to TreeItemNode and ContentPaneView types
- [ ] Implement PR side panel item component
- [ ] Implement PR content pane component
- [ ] Add "Create pull request" to plus dropdown menu
- [ ] Wire up PR data fetching and refresh

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Type Extensions

### TreeItemNode — Add "pull-request" type

The `TreeItemNode` interface in `src/stores/tree-menu/types.ts` currently supports `"thread" | "plan" | "terminal"`. Add `"pull-request"` to the union and a `prNumber` field for display.

```typescript
// src/stores/tree-menu/types.ts

export interface TreeItemNode {
  type: "thread" | "plan" | "terminal" | "pull-request";  // add "pull-request"
  /** UUID of the thread, plan, or PR entity */
  id: string;
  /** Display title */
  title: string;
  /** Status for the dot indicator */
  status: StatusDotVariant;
  /** Last update timestamp */
  updatedAt: number;
  /** Creation timestamp (for sorting) */
  createdAt: number;
  /** Parent section identifier */
  sectionId: string;
  /** Indentation level (0 = root) */
  depth: number;
  /** Has children */
  isFolder: boolean;
  /** If folder, is it expanded? */
  isExpanded: boolean;
  /** Parent plan ID - for nested plans */
  parentId?: string;
  /** Phase tracking info - only present for plans */
  phaseInfo?: PhaseInfo;
  /** Sub-agent indicator (for threads only) */
  isSubAgent?: boolean;
  /** Agent type (for threads only) */
  agentType?: string;
  /** PR number for pull-request items */
  prNumber?: number;
  /** Whether the PR has been viewed by the user (for new-PR indicator) */
  isViewed?: boolean;
}
```

The `isViewed` flag tracks whether the user has clicked on a webhook-detected PR. When a `pull_request.opened` webhook creates a PR entity, the content pane is NOT force-opened (to avoid interrupting the user's current work). Instead the PR item appears in the side panel with a blue icon that reverts to grey after the user clicks it.

### ContentPaneView — Add "pull-request" variant

The `ContentPaneView` type in `src/components/content-pane/types.ts` is the single source of truth for all pane view types. Add the `"pull-request"` variant and a props interface:

```typescript
// src/components/content-pane/types.ts

export type ContentPaneView =
  | { type: "empty" }
  | { type: "thread"; threadId: string; autoFocus?: boolean }
  | { type: "plan"; planId: string }
  | { type: "settings" }
  | { type: "logs" }
  | { type: "archive" }
  | { type: "terminal"; terminalId: string }
  | { type: "file"; filePath: string; repoId?: string; worktreeId?: string }
  | { type: "pull-request"; prId: string };  // NEW

// Add props type (follows existing ThreadContentProps / PlanContentProps pattern)
export interface PullRequestContentProps {
  prId: string;
  onPopOut?: () => void;
}
```

### ContentPaneViewSchema — Add Zod variant

In `src/stores/content-panes/types.ts`, add a Zod object to the `ContentPaneViewSchema` discriminated union for disk persistence validation:

```typescript
// src/stores/content-panes/types.ts — add to the discriminated union array:
z.object({ type: z.literal("pull-request"), prId: z.string() }),
```

---

## Phase 2: Side Panel Item Component

### File: `src/components/tree-menu/pull-request-item.tsx`

A new tree item component for PR entries, following the same structure as `terminal-item.tsx` and `thread-item.tsx`. Must stay under 250 lines per codebase guidelines.

**Icon behavior:**

- Uses `GitPullRequest` from lucide-react
- **Blue icon** when the PR is newly detected via webhook and the user has not yet clicked on it. This serves as a subtle "new PR" indicator without interrupting the user's current work.
- **Grey icon** (default) after the user has viewed the PR by clicking on it
- The icon color is driven by the `isViewed` field on the `TreeItemNode`

**Title:** `PR #{number}: {title}` where title comes from cached `PullRequestDetails` in the store.

**Loading skeleton:** When `PullRequestDetails` are being fetched (first load after entity creation or webhook detection), display a loading skeleton for the title area. This is rare — PR items only appear after explicit user creation via the plus menu or webhook detection.

**Status dot:** The status dot uses the existing `StatusDotVariant` type from `src/components/ui/status-dot.tsx`. However, PR status requires additional variants beyond what the current `StatusDotVariant` supports. The derivation logic maps PR state as follows:

| Condition | Variant |
|-----------|---------|
| Details not loaded yet | `"read"` (neutral grey) |
| PR is merged | `"read"` (completed state — grey) |
| PR is closed | `"read"` (grey) |
| PR is draft | `"unread"` (blue, matching draft semantics) |
| Checks failing OR changes requested | `"stale"` (amber/yellow — attention needed) |
| Checks pending | `"running"` (green glow) |
| Approved + all checks pass | `"read"` (grey, stable) |
| Default | `"read"` |

Status dots update automatically when gateway events arrive. Gateway events update `PullRequestDetails` for **all** PRs (not just auto-addressed ones), so the side panel status dots stay current in real time.

**Behavior:**

- Click: open PR content pane, mark PR as viewed (icon reverts from blue to grey)
- Right-click: context menu with "Open in browser", "Refresh", "Archive"
- Positioned at top of worktree section items, before threads and plans (similar to how terminals are pinned at top)

**Indentation:** Uses `TREE_INDENT_BASE` from `src/lib/tree-indent.ts` (always depth 0, same as terminals).

```typescript
// src/components/tree-menu/pull-request-item.tsx

import { GitPullRequest, Archive, ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { TREE_INDENT_BASE } from "@/lib/tree-indent";
import { StatusDot } from "@/components/ui/status-dot";
import type { TreeItemNode } from "@/stores/tree-menu/types";

interface PullRequestItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onSelect: (itemId: string, itemType: "pull-request") => void;
  tabIndex?: number;
  itemIndex?: number;
}

export function PullRequestItem({
  item,
  isSelected,
  onSelect,
  tabIndex = -1,
  itemIndex = 0,
}: PullRequestItemProps) {
  // ... click, context menu, keyboard handlers following terminal-item.tsx pattern
  // Click handler calls onSelect and marks PR as viewed
  // Context menu: "Open in browser" (opens item URL), "Refresh", "Archive"

  return (
    <div
      role="treeitem"
      aria-selected={isSelected}
      data-tree-item-index={itemIndex}
      tabIndex={tabIndex}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onContextMenu={handleContextMenu}
      style={{ paddingLeft: `${TREE_INDENT_BASE}px` }}
      className={cn(
        "group flex items-center gap-1.5 py-0.5 pr-1 cursor-pointer",
        "text-[13px] leading-[22px]",
        "transition-colors duration-75",
        "outline-none focus:bg-accent-500/10",
        isSelected
          ? "bg-accent-500/20 text-surface-100"
          : "text-surface-300 hover:bg-accent-500/10"
      )}
    >
      <StatusDot variant={item.status} />
      <span className="flex-shrink-0 w-3 flex items-center justify-center">
        <GitPullRequest
          size={10}
          className={cn(
            item.isViewed === false ? "text-blue-400" : "text-surface-400"
          )}
        />
      </span>
      <span className={cn("truncate flex-1")} title={item.title}>
        {item.title}
      </span>
      {/* Archive button on hover, same pattern as terminal-item.tsx */}
    </div>
  );
}
```

### Rendering in `repo-worktree-section.tsx`

In `src/components/tree-menu/repo-worktree-section.tsx`, import `PullRequestItem` and render PR items in the expanded children section. PR items are rendered **after Files and terminals**, before threads and plans, following the existing render order pattern in the component:

```tsx
// After the terminal items map:
{section.items.map((item, index) => {
  if (item.type !== "pull-request") return null;
  return (
    <PullRequestItem
      key={item.id}
      item={item}
      isSelected={selectedItemId === item.id}
      onSelect={onItemSelect}
      itemIndex={index}
    />
  );
})}
```

Update the `onItemSelect` callback type from `(itemId: string, itemType: "thread" | "plan" | "terminal") => void` to include `"pull-request"`.

### Sorting in `use-tree-data.ts`

PR items must appear at the top of their worktree section, pinned above all other item types. In `src/hooks/use-tree-data.ts`, the `buildSectionItems` function needs to handle PR entities. Each worktree can have at most one active PR (the branch's PR), though the data model supports multiple.

Add PR items to the `buildSectionItems` function. PRs are added first, before the unified top-level items sort:

```typescript
// In buildSectionItems(), add a PR parameter:
function buildSectionItems(
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  terminals: TerminalSession[],
  pullRequests: PullRequestMetadata[], // NEW
  sectionId: string,
  expandedSections: Record<string, boolean>,
  runningThreadIds: Set<string>,
  threadsWithPendingInput: Set<string>,
): TreeItemNode[] {
  const items: TreeItemNode[] = [];

  // 1. PR items pinned at top (sorted by prNumber desc, newest first)
  const sortedPrs = [...pullRequests].sort((a, b) => b.prNumber - a.prNumber);
  for (const pr of sortedPrs) {
    const details = usePullRequestStore.getState().getPrDetails(pr.id);
    items.push({
      type: "pull-request" as const,
      id: pr.id,
      title: details
        ? `PR #${pr.prNumber}: ${details.title}`
        : `PR #${pr.prNumber}`,
      status: derivePrStatusDot(details),
      updatedAt: new Date(pr.updatedAt).getTime(),
      createdAt: new Date(pr.createdAt).getTime(),
      sectionId,
      depth: 0,
      isFolder: false,
      isExpanded: false,
      prNumber: pr.prNumber,
      isViewed: pr.isViewed ?? true,
    });
  }

  // 2. Then threads, plans, terminals (existing logic)
  // ...
}
```

The `buildTreeFromEntities` function similarly needs a `pullRequests` parameter, grouped by `"repoId:worktreeId"` section using `pr.worktreeId`. The `useTreeData` hook subscribes to the pull request store to include PR data in the reactive tree.

---

## Phase 3: PR Content Pane

### File: `src/components/content-pane/pull-request-content.tsx`

Renders the full PR detail view when a `"pull-request"` content pane is active. This is where the user sees the PR description, CI checks, reviews, comments, and the auto-address toggle.

All data in this view is fetched via the `gh` CLI — `GhCli` is a proper typed client with strongly-typed return values, error handling with descriptive types, and parallelization of independent sub-queries (e.g., `getPrDetails` runs `gh pr view`, `gh pr checks`, and `gh api graphql` concurrently via `Promise.all`). The `GhCli` instance is created with a worktree path so `{owner}/{repo}` resolves automatically from git context.

There is no background polling. Since gateway channels are active for **all repos by default** (created during repo setup), real-time updates arrive via SSE. The content pane fetches fresh data on open and provides a manual refresh button for forced re-fetch.

**Layout (top to bottom):**

### 1. Header

Uses the existing `ContentPaneHeader` pattern from `src/components/content-pane/content-pane-header.tsx`. Add a `PullRequestHeader` sub-component following the same structure as `PlanHeader` and `ThreadHeader`:

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
        {/* Refresh button */}
        <button onClick={handleRefresh} className="..." aria-label="Refresh PR data">
          <RefreshCw size={12} />
        </button>
        {/* Open in browser */}
        <button onClick={handleOpenInBrowser} className="..." aria-label="Open in browser">
          <ExternalLink size={12} />
        </button>
        {/* Pop-out button (non-main windows only) */}
        {onPopOut && !isMainWindow && (
          <button onClick={onPopOut} className="..." aria-label="Pop out to window">
            <PictureInPicture2 size={12} />
          </button>
        )}
        <button onClick={onClose} className="..." aria-label="Close pane">
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
```

Wire this into `ContentPaneHeader` with:
```typescript
if (view.type === "pull-request") {
  return <PullRequestHeader prId={view.prId} onClose={onClose} onPopOut={onPopOut} />;
}
```

### 2. PR Info Section

Displays at the top of the scrollable content area:
- PR title + number (large)
- State badge: Open / Closed / Merged / Draft (using appropriate colors)
- Author (e.g., `@zac`)
- Branch info: `base <- head`
- "Open in browser" link (using the `url` from `PullRequestDetails`)

### 3. Description Section

Rendered markdown of the PR body. Uses the existing markdown rendering infrastructure available in the codebase. If the body is empty, show a muted "No description provided" placeholder.

### 4. Checks Section

A list of CI check runs fetched via `gh pr checks --json`. Each check displays:
- Status icon: pass (green check), fail (red x), pending (spinner), skipping (skip), cancelled (circle slash)
- Check name
- Duration (derived from `startedAt` and `completedAt`)
- Link to the check details URL (external)

The "Refresh" button at the top of the content pane re-fetches checks. Gateway events also update checks automatically — the PR entity listener always refreshes cached `PullRequestDetails` for **all** PRs when CI events arrive, not just auto-addressed ones.

### 5. Reviews Section

A list of reviews with:
- Author avatar/name
- Review state: Approved, Changes Requested, Commented, Dismissed
- Body preview (truncated)

### 6. Review Comments Section

Inline review comments grouped by thread. Each comment shows:
- Author, file path, line number
- Comment body (plain text for v1 — rich rendering with markdown, code snippets, and thread replies is future scope)
- Click to expand full comment

**Resolution state:** Comments are fetched via `gh api graphql` to get the `reviewThreads` with `isResolved` field. Unresolved comments display expanded; resolved comments display collapsed. This uses the `getPrComments` method on `GhCli`.

### 7. Auto-Address Toggle

A toggle switch at the bottom of the content pane:

```tsx
<div className="border-t border-surface-700 px-4 py-3 flex items-center justify-between">
  <div>
    <div className="text-sm text-surface-200">Auto-address comments & CI failures</div>
    <div className="text-xs text-surface-400 mt-0.5">
      Automatically spawn agents to address review feedback and fix CI failures
    </div>
  </div>
  <ToggleSwitch
    checked={pr.autoAddressEnabled}
    onChange={handleAutoAddressToggle}
  />
</div>
```

**Toggle ON behavior:**
1. Look up the existing gateway channel for this repo via `gatewayChannelService.getByRepoId(pr.repoId)` — the channel always exists because gateway channels are created for all repos by default during repo setup/hydration
2. Update PR metadata: `pullRequestService.update(prId, { autoAddressEnabled: true, gatewayChannelId: channelId })`
3. Auto-address state lives entirely on PR metadata (`autoAddressEnabled` + `gatewayChannelId`), not on the channel entity. The channel has no concept of which PRs are auto-addressed.

**Toggle OFF behavior:**
1. Update PR metadata: `pullRequestService.update(prId, { autoAddressEnabled: false, gatewayChannelId: null })`
2. Any running auto-address agents continue to completion — toggling off prevents new spawns but does not interrupt in-progress work

**No connection status indicator.** Since gateway channels are always active per-repo, the SSE connection is always on. The toggle is a simple on/off with no connection state to display.

**Permission mode:** Auto-address agents use a permission mode configured in user settings (default: `"approve"`, meaning agents wait for user approval on each tool call). Users who want hands-free automation can change this in Settings. The permission mode is global, not per-PR.

**Auto-disable on close/merge:** When a `pull_request.closed` event is received (including merged PRs), auto-address is automatically disabled — the PR metadata is updated to `autoAddressEnabled: false` and the PR is removed from active tracking. The PR stays visible in the side panel until the user explicitly archives it.

### Data Fetching

On mount and on manual refresh:
1. Check store for cached `PullRequestDetails` via `usePullRequestStore.getPrDetails(prId)`
2. If missing or forced refresh, call `ghCli.getPrDetails(prNumber)` from the worktree path
3. `getPrDetails` runs three sub-queries concurrently via `Promise.all`: `gh pr view --json ...`, `gh pr checks --json ...`, and `gh api graphql` for review comments with resolution state
4. Update store with fresh data
5. Show loading skeleton while fetching

### gh CLI Error States

If the `gh` CLI is not installed, show an error banner with an "Install GitHub CLI" button that runs `brew install gh`. If `gh` is installed but not authenticated, show an "Authenticate" button that opens `gh auth login` in a terminal. These errors are surfaced inline in the content pane, following the pattern from `pr-entity.md`.

### Routing in `content-pane.tsx`

In `src/components/content-pane/content-pane.tsx`, add a render branch for the `"pull-request"` view type alongside the existing view types:

```tsx
{view.type === "pull-request" && (
  <PullRequestContent prId={view.prId} onPopOut={onPopOut} />
)}
```

---

## Phase 4: Plus Menu — "Create Pull Request"

### Modification: `src/components/tree-menu/repo-worktree-section.tsx`

Add a new menu item to the plus dropdown between "New terminal" and "New worktree". Import `GitPullRequest` from lucide-react.

```tsx
{onCreatePr && (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      handleCreatePr();
    }}
    className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
  >
    <GitPullRequest size={11} className="flex-shrink-0" />
    <span className="flex-1">Create pull request</span>
  </button>
)}
```

**Button label:** Always shows "Create pull request" — the label is constant. If a PR already exists for the current branch, clicking it opens the existing PR content pane. Multi-PR per worktree is out of scope.

### Callback Prop

Add to `RepoWorktreeSectionProps`:
```typescript
/** Called when user wants to create a PR for this worktree */
onCreatePr?: (repoId: string, worktreeId: string, worktreePath: string) => void;
```

Wire this up from the parent `tree-menu.tsx` component.

### Behavior on Click

The `handleCreatePr` function (implemented in `src/lib/pr-actions.ts`, defined in [pr-creation.md](./pr-creation.md)):

1. **Check for existing PR on current branch:**
   ```typescript
   const ghCli = new GhCli(worktreePath);
   const existingPrNumber = await ghCli.getCurrentBranchPr();
   // Uses: gh pr view --json number --jq '.number'
   ```

2. **If PR exists:**
   - Look up or create PR entity via `pullRequestService.getByRepoAndNumber(repoId, prNumber)` or `pullRequestService.create(...)`. The entity key is `{repoId}:{prNumber}` — PR number is the stable identifier within a repo.
   - Open PR content pane: `contentPaneService.setView({ type: "pull-request", prId: pr.id })`
   - Fetch fresh details immediately

3. **If no PR exists:**
   - Spawn a new thread with the `/create-pr` skill. The `create-pr` skill lives in `plugins/anvil/skills/create-pr/` and is synced to `~/.anvil/skills/` via `syncManagedSkills()` on startup. Users can override it with their own version in `<repo>/.claude/skills/create-pr/`.
   - The skill has `bash,read,grep,glob` tools (it needs to read code to write good PR descriptions, but should not modify code — no `edit`/`write`).
   - Skill invocation is handled by the agent SDK — when a thread is spawned with `prompt: "/create-pr"`, the SDK resolves the skill from the slash command. No special wiring needed.
   - Open thread content pane so the user watches the agent work
   - Gateway webhook detects the created PR via `pull_request.opened` event — the channel already exists because channels are created for all repos by default during repo setup
   - PR entity is auto-created by the PR entity listener, and the PR item appears in the side panel with a blue `GitPullRequest` icon (new/unviewed state)

### Also add to context menu

Add "Create pull request" to the right-click context menu on the section header (in the same area as "New thread", "New terminal", etc.), following the existing context menu pattern.

---

## Phase 5: Data Fetching & Refresh

### Refresh Strategy

PR display data (`PullRequestDetails`) is refreshed on-demand only — no polling:

| Trigger | What refreshes | Notes |
|---------|---------------|-------|
| PR content pane opens | Full details (title, body, checks, reviews, comments) | `ghCli.getPrDetails(prNumber)` — runs 3 sub-queries in parallel |
| Manual "Refresh" button | Full details | Same as above |
| Gateway CI event (`check_run` / `check_suite`) | Checks only | `ghCli.getPrChecks(prNumber)` — targeted refresh |
| Gateway review/comment event | Full details | `ghCli.getPrDetails(prNumber)` |

No polling fallback. Since gateway channels are active for all repos by default, real-time updates via SSE are always available. The manual refresh button covers edge cases where the user wants to force a fresh fetch.

Events are **signals, not data** — gateway events trigger a fresh `gh` CLI query rather than using the webhook payload. This ensures data is always current and avoids stale payload issues.

### Display Data Updates from Gateway Events

The PR entity listener in `src/entities/pull-requests/listeners.ts` has two stages:
1. **Stage 1 (always):** Refresh cached `PullRequestDetails` in the store so the side panel status dots and content pane stay current — this runs for **all** PRs, not just auto-addressed ones
2. **Stage 2 (conditional):** Only spawn agents if `autoAddressEnabled` is true on the PR metadata

This means even PRs with auto-address disabled get live status dot updates from gateway events.

### Status Dot Derivation

The status dot variant for PR side panel items is derived from cached `PullRequestDetails`:

```typescript
import type { StatusDotVariant } from "@/components/ui/status-dot";

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

  if (details.reviewDecision === "APPROVED") return "read";
  return "read";
}
```

This uses the existing `StatusDotVariant` values:
- `"running"` (green glow) for pending checks
- `"stale"` (amber) for failing checks or changes requested
- `"unread"` (blue) for draft PRs
- `"read"` (grey) for stable/default states

### PR Lifecycle in the Side Panel

**Closed/merged PRs stay visible until archived.** When a PR is closed or merged, the state updates in the side panel (status dot changes). The PR is archived when:
1. The user explicitly archives it (right-click context menu "Archive", or archive button in content pane)
2. The user archives the parent worktree — all PRs bound to that worktree are archived with it

Archiving a PR disables auto-address if it was active. However, any running auto-address agents continue to completion — archiving does not interrupt in-progress threads.

---

## File Structure

```
src/components/tree-menu/
  pull-request-item.tsx        <- NEW: side panel PR item
  repo-worktree-section.tsx    <- MODIFIED: add "Create pull request" to plus menu + context menu,
                                  render PullRequestItem, update onItemSelect type

src/components/content-pane/
  types.ts                     <- MODIFIED: add "pull-request" variant to ContentPaneView,
                                  add PullRequestContentProps
  pull-request-content.tsx     <- NEW: PR content pane (description, checks, reviews, comments,
                                  auto-address toggle)
  content-pane.tsx             <- MODIFIED: route "pull-request" view type to PullRequestContent
  content-pane-header.tsx      <- MODIFIED: add PullRequestHeader sub-component

src/stores/tree-menu/
  types.ts                     <- MODIFIED: add "pull-request" to TreeItemNode type union,
                                  add prNumber and isViewed fields

src/stores/content-panes/
  types.ts                     <- MODIFIED: add "pull-request" to ContentPaneViewSchema

src/hooks/
  use-tree-data.ts             <- MODIFIED: import PullRequestMetadata, subscribe to PR store,
                                  include PR items in buildSectionItems pinned at top
```

### Dependencies from Sub-Plan A (pr-entity.md)

This plan depends on these artifacts from Sub-Plan A being implemented first:

- `core/types/pull-request.ts` — `PullRequestMetadata`, `PullRequestDetails`, `PullRequestMetadataSchema`
- `src/entities/pull-requests/store.ts` — `usePullRequestStore` with `getPr()`, `getPrDetails()`, `getPrsByWorktree()`, `setPrDetails()`, `setPrDetailsLoading()`
- `src/entities/pull-requests/service.ts` — `pullRequestService` with `getByRepoAndNumber()`, `create()`, `update()`, `archive()`
- `src/lib/gh-cli.ts` — `GhCli` class with `isAvailable()`, `getCurrentBranchPr()`, `getPrDetails()`, `getPrChecks()`, `getPrComments()`
