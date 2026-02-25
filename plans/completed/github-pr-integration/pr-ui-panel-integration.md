# B.1: PR Side Panel Integration — Types, Tree Item, Plus Menu

Adds the `"pull-request"` item type to the side panel tree, renders PR items in worktree sections, wires the "Create pull request" action into the plus dropdown and context menus, and updates the tree data hook to include PR entities. This plan covers the entire side panel surface area for PRs.

**Depends on:** [pr-entity.md](./pr-entity.md) (Sub-Plan A) must be implemented first. This plan imports from `src/entities/pull-requests/store.ts`, `src/entities/pull-requests/service.ts`, and `core/types/pull-request.ts`.

**Paired with:** [pr-ui-content-pane.md](./pr-ui-content-pane.md) (Sub-Plan B.2) implements the content pane that opens when a PR item is clicked. The two plans can be implemented in parallel as long as Sub-Plan A is complete, though B.2 will need the `ContentPaneView` type extension from Phase 1 here.

## Phases

- [x] Phase 1: Extend TreeItemNode and ContentPaneView types
- [x] Phase 2: Create PullRequestItem side panel component
- [x] Phase 3: Update use-tree-data hook to include PR entities
- [x] Phase 4: Render PR items and wire plus menu in repo-worktree-section
- [x] Phase 5: Wire callbacks through tree-menu to parent components

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Extend TreeItemNode and ContentPaneView types

### 1a. `src/stores/tree-menu/types.ts` — Add `"pull-request"` to TreeItemNode

The `TreeItemNode` interface currently supports `"thread" | "plan" | "terminal"`. Add `"pull-request"` to the union and two new optional fields.

**Changes:**
- Line with `type: "thread" | "plan" | "terminal"` becomes `type: "thread" | "plan" | "terminal" | "pull-request"`
- Add `prNumber?: number` field (PR number for display, e.g. `PR #42`)
- Add `isViewed?: boolean` field (tracks whether user has clicked a webhook-detected PR; drives blue vs grey icon)

```typescript
export interface TreeItemNode {
  type: "thread" | "plan" | "terminal" | "pull-request";
  // ... existing fields unchanged ...
  /** PR number for pull-request items */
  prNumber?: number;
  /** Whether the PR has been viewed by the user (for new-PR indicator) */
  isViewed?: boolean;
}
```

Also update the `TreeNode` type comment to mention pull requests.

### 1b. `src/components/content-pane/types.ts` — Add `"pull-request"` variant

Add a new variant to the `ContentPaneView` discriminated union and a `PullRequestContentProps` interface.

**Add to the union:**
```typescript
| { type: "pull-request"; prId: string }
```

**Add new props interface** (follows `ThreadContentProps` / `PlanContentProps` pattern):
```typescript
export interface PullRequestContentProps {
  prId: string;
  onPopOut?: () => void;
}
```

### 1c. `src/stores/content-panes/types.ts` — Add Zod variant

Add to the `ContentPaneViewSchema` discriminated union array for disk persistence validation:

```typescript
z.object({ type: z.literal("pull-request"), prId: z.string() }),
```

### 1d. `src/components/content-pane/breadcrumb.tsx` — Add `"pull-requests"` category

The `Breadcrumb` component's `category` prop is typed as `"threads" | "plans" | "files"`. Add `"pull-requests"` to this union:

```typescript
category: "threads" | "plans" | "files" | "pull-requests";
```

### Verification

After making these type changes, run `pnpm tsc --noEmit` to confirm no type errors. The new `"pull-request"` variant in `ContentPaneView` will cause exhaustiveness warnings in `content-pane.tsx` and `content-pane-header.tsx` — these are expected and will be resolved by Sub-Plan B.2. For now, ensure no hard build errors.

---

## Phase 2: Create PullRequestItem side panel component

### New file: `src/components/tree-menu/pull-request-item.tsx`

A new tree item component for PR entries. Must stay under 250 lines. Follow the structure of `terminal-item.tsx` closely (same role, aria attributes, keyboard handlers, indent calculation, className patterns).

**Imports needed:**
```typescript
import { useState, useRef, useEffect, useCallback } from "react";
import { GitPullRequest, Archive, ExternalLink, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { TREE_INDENT_BASE } from "@/lib/tree-indent";
import { StatusDot } from "@/components/ui/status-dot";
import { pullRequestService } from "@/entities/pull-requests/service";
import type { TreeItemNode } from "@/stores/tree-menu/types";
```

**Props interface:**
```typescript
interface PullRequestItemProps {
  item: TreeItemNode;
  isSelected: boolean;
  onSelect: (itemId: string, itemType: "pull-request") => void;
  tabIndex?: number;
  itemIndex?: number;
}
```

**Icon behavior:**
- Use `GitPullRequest` from lucide-react (size 10, matching Terminal icon size)
- Blue (`text-blue-400`) when `item.isViewed === false` — newly detected via webhook, user has not clicked
- Grey (`text-surface-400`) when `item.isViewed` is true or undefined — default state

**Title:** Display `item.title` which is set to `PR #N: title` by the tree data hook (Phase 3). If details are still loading, the hook sets title to `PR #N` (no colon, no subtitle).

**Status dot:** Renders `<StatusDot variant={item.status} />` — the variant is derived in the tree data hook using `derivePrStatusDot()`.

**Click handler:** Calls `onSelect(item.id, "pull-request")`. Also marks the PR as viewed if it was unviewed:
```typescript
const handleClick = useCallback(() => {
  onSelect(item.id, "pull-request");
  if (item.isViewed === false) {
    pullRequestService.update(item.id, { isViewed: true });
  }
}, [item.id, item.isViewed, onSelect]);
```

**Archive button:** Same confirm-then-archive pattern as `terminal-item.tsx`. On confirm, calls `pullRequestService.archive(item.id)`.

**Keyboard handler:** Enter/Space triggers click (same pattern as `terminal-item.tsx`).

**Indentation:** Always depth 0, so `paddingLeft: TREE_INDENT_BASE + "px"`.

**JSX structure** (same wrapper pattern as terminal-item):
```tsx
<div
  role="treeitem"
  aria-selected={isSelected}
  data-tree-item-index={itemIndex}
  tabIndex={tabIndex}
  onClick={handleClick}
  onKeyDown={handleKeyDown}
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
  {/* Archive button - same confirm pattern as terminal-item.tsx */}
</div>
```

### Verification

Confirm the file is under 250 lines. Confirm it renders without errors by importing it in a test or checking `pnpm tsc --noEmit`.

---

## Phase 3: Update use-tree-data hook to include PR entities

### Modify: `src/hooks/use-tree-data.ts`

**3a. Add imports:**
```typescript
import { usePullRequestStore } from "@/entities/pull-requests/store";
import type { PullRequestMetadata, PullRequestDetails } from "@core/types/pull-request.js";
import type { StatusDotVariant } from "@/components/ui/status-dot";
```

**3b. Add `derivePrStatusDot` helper function** (place near top of file, after existing helpers):

```typescript
/**
 * Derive StatusDotVariant from cached PullRequestDetails.
 * Maps PR state to existing status dot variants.
 */
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

**3c. Update `buildSectionItems` signature** to accept `pullRequests` parameter:

```typescript
function buildSectionItems(
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  terminals: TerminalSession[],
  pullRequests: PullRequestMetadata[], // NEW parameter
  sectionId: string,
  expandedSections: Record<string, boolean>,
  runningThreadIds: Set<string>,
  threadsWithPendingInput: Set<string>,
): TreeItemNode[] {
```

**3d. Add PR item construction** at the beginning of `buildSectionItems`, before the existing thread/plan/terminal logic. PR items are pinned at the top, sorted by prNumber descending (newest first):

```typescript
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
    updatedAt: pr.updatedAt,
    createdAt: pr.createdAt,
    sectionId,
    depth: 0,
    isFolder: false,
    isExpanded: false,
    prNumber: pr.prNumber,
    isViewed: pr.isViewed ?? true,
  });
}
```

PR items are NOT included in the `topLevel` array that sorts threads/plans/terminals by createdAt. They are always at the top, before everything else.

**3e. Update `buildTreeFromEntities` signature and body:**

Add a `pullRequests: PullRequestMetadata[]` parameter. Add a `prsBySection` grouping map (same pattern as `threadsBySection`):

```typescript
export function buildTreeFromEntities(
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  terminals: TerminalSession[],
  pullRequests: PullRequestMetadata[], // NEW
  expandedSections: Record<string, boolean>,
  // ... rest unchanged
```

Group PRs by section using `pr.repoId` and `pr.worktreeId`:
```typescript
const prsBySection = new Map<string, PullRequestMetadata[]>();

// In the ensureSection helper, initialize:
prsBySection.set(sectionId, []);

// Group PRs:
for (const pr of pullRequests) {
  const sectionId = ensureSection(pr.repoId, pr.worktreeId);
  prsBySection.get(sectionId)!.push(pr);
}
```

Pass PRs to `buildSectionItems`:
```typescript
const sectionPrs = prsBySection.get(sectionId) || [];
const items = buildSectionItems(
  sectionThreads,
  sectionPlans,
  sectionTerminals,
  sectionPrs, // NEW
  sectionId,
  expandedSections,
  runningThreadIds,
  threadsWithPendingInput,
);
```

**3f. Update `useTreeData` hook** to subscribe to PR store:

```typescript
// Add near existing entity store subscriptions:
const pullRequests = usePullRequestStore((state) => state._prsArray);
// Also subscribe to prDetails so tree re-renders when details load:
const prDetails = usePullRequestStore((state) => state.prDetails);
```

Pass `pullRequests` to `buildTreeFromEntities` and add both to the `useMemo` dependency array:

```typescript
return useMemo(() => {
  const allSections = buildTreeFromEntities(
    threads,
    plans,
    terminals,
    pullRequests, // NEW
    expandedSections,
    runningThreadIds,
    allRepos,
    getRepoName,
    getWorktreeName,
    getWorktreePath,
    threadsWithPendingInput,
  );
  // ... rest unchanged
}, [threads, plans, terminals, pullRequests, prDetails, expandedSections, ...]);
```

### Verification

Run `pnpm tsc --noEmit`. Verify the tree data hook produces PR items when mock data is provided. The file may approach 250 lines — if it exceeds, extract `derivePrStatusDot` to a small utility file `src/utils/pr-status.ts`.

---

## Phase 4: Render PR items and wire plus menu in repo-worktree-section

### Modify: `src/components/tree-menu/repo-worktree-section.tsx`

**4a. Add imports:**
```typescript
import { GitPullRequest } from "lucide-react";
import { PullRequestItem } from "./pull-request-item";
```

**4b. Update `onItemSelect` prop type** to include `"pull-request"`:

```typescript
onItemSelect: (itemId: string, itemType: "thread" | "plan" | "terminal" | "pull-request") => void;
```

**4c. Add `onCreatePr` callback prop** to `RepoWorktreeSectionProps`:
```typescript
/** Called when user wants to create a PR for this worktree */
onCreatePr?: (repoId: string, worktreeId: string, worktreePath: string) => void;
```

**4d. Add handler function** in the component body (alongside `handleNewThread`, `handleNewTerminal`, etc.):
```typescript
const handleCreatePr = () => {
  setShowMenu(false);
  onCreatePr?.(section.repoId, section.worktreeId, section.worktreePath);
};

const handleContextCreatePr = () => {
  setShowContextMenu(false);
  onCreatePr?.(section.repoId, section.worktreeId, section.worktreePath);
};
```

**4e. Add "Create pull request" button to the plus dropdown menu.** Insert between the "New terminal" button and the "New worktree" button:

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

**4f. Add "Create pull request" to the context menu.** Insert after the "New terminal" entry in the context menu:

```tsx
{onCreatePr && (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation();
      handleContextCreatePr();
    }}
    className="w-full px-2.5 py-1 text-left text-xs text-surface-200 hover:bg-surface-800 rounded flex items-center gap-2 whitespace-nowrap"
  >
    <GitPullRequest size={11} className="flex-shrink-0" />
    Create pull request
  </button>
)}
```

**4g. Render PullRequestItem components** in the expanded children section. Add a new render block **after the terminal items map** and **before the threads/plans map** (lines ~615-626 in current file):

```tsx
{/* PR items pinned after terminals */}
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

### Note on file size

`repo-worktree-section.tsx` is currently 658 lines — already well above the 250-line guideline. Adding ~30 lines for PR support is acceptable since the file is already an outlier and the additions follow existing patterns exactly. Do not refactor the file in this plan; that is separate scope.

### Verification

Run `pnpm tsc --noEmit`. Visually verify in the app that PR items appear in the correct position (after terminals, before threads/plans) and that the plus menu shows the new button.

---

## Phase 5: Wire callbacks through tree-menu to parent components

### Modify: `src/components/tree-menu/tree-menu.tsx`

**5a. Update `TreeMenuProps` interface:**

Add `"pull-request"` to the `onItemSelect` callback type:
```typescript
onItemSelect: (itemId: string, itemType: "thread" | "plan" | "terminal" | "pull-request") => void;
```

Add the `onCreatePr` callback:
```typescript
/** Called when user wants to create a PR for this worktree */
onCreatePr?: (repoId: string, worktreeId: string, worktreePath: string) => void;
```

**5b. Update `handleItemSelect`** to accept `"pull-request"`:
```typescript
const handleItemSelect = useCallback(
  async (itemId: string, itemType: "thread" | "plan" | "terminal" | "pull-request") => {
    await treeMenuService.setSelectedItem(itemId);
    onItemSelect(itemId, itemType);
  },
  [onItemSelect]
);
```

**5c. Update `focusableItems` builder** to include `"pull-request"` in the `itemType`:
```typescript
const focusableItems = useMemo(() => {
  const items: Array<{
    type: "section" | "item";
    id: string;
    sectionId?: string;
    itemType?: "thread" | "plan" | "terminal" | "pull-request";
  }> = [];
  // ... rest unchanged
```

**5d. Pass `onCreatePr` to `RepoWorktreeSection`:**
```tsx
<RepoWorktreeSection
  // ... existing props
  onCreatePr={onCreatePr}
/>
```

**5e. Wire `onCreatePr` from the parent component** that renders `TreeMenu`. This is typically in `src/components/main-window/` or wherever the `TreeMenu` is used. Find the parent that provides `onNewThread` and add a corresponding `onCreatePr` that calls `handleCreatePr` from `src/lib/pr-actions.ts` (which is defined in [pr-creation.md](./pr-creation.md)):

```typescript
import { handleCreatePr } from "@/lib/pr-actions";

// In the parent component:
const handleCreatePrCallback = useCallback(
  (repoId: string, worktreeId: string, worktreePath: string) => {
    handleCreatePr(repoId, worktreeId, worktreePath);
  },
  []
);
```

Note: If `src/lib/pr-actions.ts` does not yet exist (depends on [pr-creation.md](./pr-creation.md)), create a stub that logs a warning and opens a toast:

```typescript
// src/lib/pr-actions.ts (stub — replaced by pr-creation.md implementation)
import { logger } from "./logger-client";

export async function handleCreatePr(
  repoId: string,
  worktreeId: string,
  worktreePath: string,
): Promise<void> {
  logger.warn("[pr-actions] handleCreatePr not yet implemented", {
    repoId,
    worktreeId,
    worktreePath,
  });
}
```

**5f. Update `handleItemSelect` in the parent component** that renders `TreeMenu` (check `src/components/main-window/main-window-layout.tsx` or wherever `onItemSelect` is provided to `TreeMenu`). The current handler routes `"thread"` → thread pane, `"plan"` → plan pane, `"terminal"` → terminal pane. Add the `"pull-request"` case:

```typescript
case "pull-request":
  contentPanesService.setActivePaneView({ type: "pull-request", prId: itemId });
  break;
```

Without this, clicking a PR item in the side panel will do nothing — the navigation from side panel click to content pane open will be broken.

### Verification

Run `pnpm tsc --noEmit`. Run `pnpm test` to ensure no regressions. Verify the full callback chain works: clicking "Create pull request" in the plus menu triggers the callback all the way up to the parent component.

---

## File Summary

| File | Action | Description |
|------|--------|-------------|
| `src/stores/tree-menu/types.ts` | MODIFY | Add `"pull-request"` to TreeItemNode type, add `prNumber` and `isViewed` fields |
| `src/components/content-pane/types.ts` | MODIFY | Add `"pull-request"` variant to ContentPaneView, add PullRequestContentProps |
| `src/stores/content-panes/types.ts` | MODIFY | Add `"pull-request"` Zod variant to ContentPaneViewSchema |
| `src/components/content-pane/breadcrumb.tsx` | MODIFY | Add `"pull-requests"` to category union type |
| `src/components/tree-menu/pull-request-item.tsx` | CREATE | Side panel PR item component (icon, status dot, click/archive handlers) |
| `src/hooks/use-tree-data.ts` | MODIFY | Subscribe to PR store, add `derivePrStatusDot`, include PRs in tree sections |
| `src/components/tree-menu/repo-worktree-section.tsx` | MODIFY | Render PullRequestItem, add "Create pull request" to plus menu and context menu |
| `src/components/tree-menu/tree-menu.tsx` | MODIFY | Wire `onCreatePr` callback, update type unions for `"pull-request"` |
| `src/lib/pr-actions.ts` | CREATE (stub) | Stub for handleCreatePr if pr-creation.md not yet implemented |

**Total: 7 modified files, 1-2 new files (under 10 file changes)**

## Dependencies

- **Required before starting:** Sub-Plan A ([pr-entity.md](./pr-entity.md)) — provides `usePullRequestStore`, `pullRequestService`, `PullRequestMetadata`, `PullRequestDetails`
- **Can be parallel with:** Sub-Plan B.2 ([pr-ui-content-pane.md](./pr-ui-content-pane.md)) — but B.2 needs the ContentPaneView type extension from Phase 1 here
- **Required after:** Sub-Plan C ([pr-creation.md](./pr-creation.md)) — replaces the `pr-actions.ts` stub with the real implementation
