# 03 — Unified Tree Model

**Layer 2 — depends on all of Layer 1 (01, 02a, 02b, 02c, 02d).**

## Summary

The core architectural change: add `"worktree"` and `"folder"` to `TreeItemNode.type`, eliminate `RepoWorktreeSection` as a separate type, migrate pin state from section IDs to worktree node IDs, and rewrite the tree builder as a single unified recursion that reads only `visualSettings.parentId`.

This is the largest and most critical sub-plan — it replaces the two-tier model with the flat node model.

## Dependencies

- **01-visual-settings-foundation** — `visualSettings` on all entities, `VisualSettingsSchema` at `core/types/visual-settings.ts`
- **02a-terminal-persistence** — terminals are now persistable entities with visualSettings
- **02b-folder-entity** — `FolderMetadata` exists at `core/types/folders.ts`, hydrates into `useFolderStore` at `src/entities/folders/store.ts`
- **02c-creation-time-seeding** — entities have `visualSettings.parentId` set at creation time
- **02d-migration** — existing entities backfilled with `visualSettings`

## Key Files

| File | Change |
|------|--------|
| `src/stores/tree-menu/types.ts` | Add `"worktree"` + `"folder"` to `TreeItemNode.type`; remove `RepoWorktreeSection`; remove `TreeNode` union; update `EntityItemType`; update persisted schema |
| `src/hooks/use-tree-data.ts` | **Rewrite** — single `buildUnifiedTree()` replacing `buildTreeFromEntities()` + `buildSectionItems()` + `buildChangesItems()` |
| `src/stores/tree-menu/store.ts` | Rename `pinnedSectionId` to `pinnedWorktreeId`; remove `hiddenSectionIds` and related methods |
| `src/stores/tree-menu/service.ts` | Remove hide methods; rename pin methods; update `hydrate()` for pin format migration |
| `src/hooks/index.ts` | Update exports: remove `buildTreeFromEntities`, `useSectionItems`, `useTreeSections`; add `buildUnifiedTree` |
| `src/stores/commit-store.ts` | Re-key from `commitsBySection` to `commitsByWorktree` |
| `src/lib/fractional-indexing.ts` | **New** — ~50-line fractional indexing utility |

## Before / After: Type Changes

### File: `src/stores/tree-menu/types.ts`

**BEFORE** (current, 108 lines):

```typescript
import { z } from "zod";
import type { StatusDotVariant } from "@/components/ui/status-dot";
import type { PhaseInfo } from "@/entities/plans/types";

export const TreeMenuPersistedStateSchema = z.object({
  expandedSections: z.record(z.string(), z.boolean()),
  selectedItemId: z.string().nullable(),
  pinnedSectionId: z.string().nullable().optional(),
  hiddenSectionIds: z.array(z.string()).optional(),
});
export type TreeMenuPersistedState = z.infer<typeof TreeMenuPersistedStateSchema>;

export interface RepoWorktreeSection {
  type: "repo-worktree";
  id: string;
  repoName: string;
  worktreeName: string;
  repoId: string;
  worktreeId: string;
  worktreePath: string;
  items: TreeItemNode[];
  isExpanded: boolean;
  changesItems: TreeItemNode[];
}

export interface TreeItemNode {
  type: "thread" | "plan" | "terminal" | "pull-request" | "changes" | "uncommitted" | "commit";
  id: string;
  title: string;
  status: StatusDotVariant;
  updatedAt: number;
  createdAt: number;
  sectionId: string;
  depth: number;
  isFolder: boolean;
  isExpanded: boolean;
  parentId?: string;
  phaseInfo?: PhaseInfo;
  isSubAgent?: boolean;
  agentType?: string;
  prNumber?: number;
  isViewed?: boolean;
  reviewIcon?: "approved" | "changes-requested" | "review-required" | "draft" | "merged" | "closed";
  commitHash?: string;
  commitMessage?: string;
  commitAuthor?: string;
  commitRelativeDate?: string;
}

export type TreeItemType = TreeItemNode["type"];
export type EntityItemType = "thread" | "plan" | "terminal" | "pull-request";
export type TreeNode = RepoWorktreeSection | TreeItemNode;
```

**AFTER** (complete replacement):

```typescript
import { z } from "zod";
import type { StatusDotVariant } from "@/components/ui/status-dot";
import type { PhaseInfo } from "@/entities/plans/types";

// ═══════════════════════════════════════════════════════════════════════════
// Persisted State - Zod schema for disk validation
// Location: ~/.anvil/ui/tree-menu.json
// ═══════════════════════════════════════════════════════════════════════════

export const TreeMenuPersistedStateSchema = z.object({
  expandedSections: z.record(z.string(), z.boolean()),
  selectedItemId: z.string().nullable(),
  /** UUID of pinned worktree node, or null if none pinned */
  pinnedWorktreeId: z.string().nullable().optional(),
});
export type TreeMenuPersistedState = z.infer<typeof TreeMenuPersistedStateSchema>;

// ═══════════════════════════════════════════════════════════════════════════
// Runtime Types - Plain TypeScript (not persisted, derived from entities)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Every node in the sidebar tree — worktrees, folders, threads, plans,
 * terminals, PRs, and synthetic items (changes/uncommitted/commit).
 */
export interface TreeItemNode {
  type: TreeItemType;
  /** UUID of the entity (worktree ID for worktrees, nanoid for folders, etc.) */
  id: string;
  /** Display title */
  title: string;
  /** Status for the dot indicator */
  status: StatusDotVariant;
  /** Last update timestamp */
  updatedAt: number;
  /** Creation timestamp (for sorting) */
  createdAt: number;
  /** Indentation level (0 = root) */
  depth: number;
  /** Has children in the current tree build */
  isFolder: boolean;
  /** If folder, is it expanded? */
  isExpanded: boolean;
  /** Worktree UUID this node belongs to — set on all worktree-scoped items.
   *  Used for boundary enforcement in DnD (05a). Undefined for root-level folders. */
  worktreeId?: string;

  // ── Worktree-specific fields ──────────────────────────────────────────
  /** Display name of the repository (worktree nodes only) */
  repoName?: string;
  /** Display name of the worktree branch (worktree nodes only) */
  worktreeName?: string;
  /** Absolute path to the worktree directory (worktree nodes only) */
  worktreePath?: string;
  /** UUID of the repository (worktree nodes only) */
  repoId?: string;

  // ── Folder-specific fields ────────────────────────────────────────────
  /** Lucide icon name for folder nodes (e.g., "folder", "bug", "zap") */
  icon?: string;

  // ── Thread-specific fields ────────────────────────────────────────────
  /** Visual parent ID (from visualSettings.parentId — used by DnD, context menus) */
  parentId?: string;
  /** Sub-agent indicator — true if thread has a domain parentThreadId */
  isSubAgent?: boolean;
  /** Agent type (for threads only) — e.g., "Explore", "Plan", etc. */
  agentType?: string;

  // ── Plan-specific fields ──────────────────────────────────────────────
  /** Phase tracking info — only present for plans with ## Phases section */
  phaseInfo?: PhaseInfo;

  // ── Pull-request-specific fields ──────────────────────────────────────
  /** PR number for pull-request items */
  prNumber?: number;
  /** Whether the PR has been viewed by the user */
  isViewed?: boolean;
  /** Review status icon hint */
  reviewIcon?: "approved" | "changes-requested" | "review-required" | "draft" | "merged" | "closed";

  // ── Commit-specific fields ────────────────────────────────────────────
  /** Full commit hash (for "commit" type items) */
  commitHash?: string;
  /** First line of commit message (for "commit" type items) */
  commitMessage?: string;
  /** Author name (for "commit" type items) */
  commitAuthor?: string;
  /** Relative date string like "3 days ago" (for "commit" type items) */
  commitRelativeDate?: string;
}

/** All possible node types in the unified tree */
export type TreeItemType =
  | "worktree"
  | "folder"
  | "thread"
  | "plan"
  | "terminal"
  | "pull-request"
  | "changes"
  | "uncommitted"
  | "commit";

/** Subset of item types backed by entity stores (used by onItemSelect callbacks) */
export type EntityItemType = "thread" | "plan" | "terminal" | "pull-request";
```

**Key deletions:**
- `RepoWorktreeSection` interface — deleted entirely
- `TreeNode` union type — deleted entirely (everything is `TreeItemNode`)
- `sectionId` field on `TreeItemNode` — deleted (replaced by `worktreeId`)
- `hiddenSectionIds` from `TreeMenuPersistedStateSchema` — deleted
- `pinnedSectionId` from `TreeMenuPersistedStateSchema` — renamed to `pinnedWorktreeId`

**Key decisions:**
- `EntityItemType` does NOT include `"worktree"` or `"folder"` — those types are not backed by the same entity stores that `onItemSelect` routes through. Worktree and folder clicks are handled differently (toggle expand, open file browser, etc.).

### File: `src/stores/tree-menu/store.ts`

**BEFORE** (relevant state/actions):

```typescript
interface TreeMenuState {
  expandedSections: Record<string, boolean>;
  selectedItemId: string | null;
  pinnedSectionId: string | null;
  hiddenSectionIds: string[];
  _hydrated: boolean;
}

interface TreeMenuActions {
  hydrate: (state: TreeMenuPersistedState) => void;
  _applySetExpanded: (sectionId: string, expanded: boolean) => Rollback;
  _applySetSelectedItem: (itemId: string | null) => Rollback;
  _applySetPinned: (sectionId: string | null) => Rollback;
  _applySetHidden: (sectionId: string, hidden: boolean) => Rollback;
  _applyUnhideAll: () => Rollback;
}
```

**AFTER:**

```typescript
interface TreeMenuState {
  expandedSections: Record<string, boolean>;
  selectedItemId: string | null;
  /** UUID of pinned worktree node, or null if none pinned */
  pinnedWorktreeId: string | null;
  _hydrated: boolean;
}

interface TreeMenuActions {
  hydrate: (state: TreeMenuPersistedState) => void;
  _applySetExpanded: (nodeId: string, expanded: boolean) => Rollback;
  _applySetSelectedItem: (itemId: string | null) => Rollback;
  _applySetPinned: (worktreeId: string | null) => Rollback;
}
```

**Specific changes in the store body (`create<>((set, get) => ({...}))`):**

1. Initial state: Remove `hiddenSectionIds: []`. Rename `pinnedSectionId: null` to `pinnedWorktreeId: null`.
2. `hydrate` method: Read `state.pinnedWorktreeId` instead of `state.pinnedSectionId`. Remove `hiddenSectionIds` assignment.
3. `_applySetPinned`: Change field name from `pinnedSectionId` to `pinnedWorktreeId` in both set() and rollback.
4. Delete `_applySetHidden` method entirely (lines 87-98).
5. Delete `_applyUnhideAll` method entirely (lines 101-105).
6. Update `getTreeMenuState()` at bottom of file:

```typescript
// BEFORE:
export function getTreeMenuState() {
  const { expandedSections, selectedItemId, pinnedSectionId, hiddenSectionIds } = useTreeMenuStore.getState();
  return { expandedSections, selectedItemId, pinnedSectionId, hiddenSectionIds };
}

// AFTER:
export function getTreeMenuState() {
  const { expandedSections, selectedItemId, pinnedWorktreeId } = useTreeMenuStore.getState();
  return { expandedSections, selectedItemId, pinnedWorktreeId };
}
```

### File: `src/stores/tree-menu/service.ts`

**Methods to DELETE entirely:**
- `hideSection(sectionId)` (lines 194-219)
- `unhideSection(sectionId)` (lines 224-241)
- `unhideAll()` (lines 246-261)
- `getHiddenCount()` (lines 266-268)
- `hasHiddenOrPinned()` (lines 273-276)

**Methods to RENAME/UPDATE:**

```typescript
// BEFORE:
async pinSection(sectionId: string | null): Promise<void> {
  const newState: TreeMenuPersistedState = {
    ...getPersistedState(),
    pinnedSectionId: sectionId,
  };
  // ...
  useTreeMenuStore.getState()._applySetPinned(sectionId);
}

async togglePinSection(sectionId: string): Promise<void> {
  const current = useTreeMenuStore.getState().pinnedSectionId;
  const newPinned = current === sectionId ? null : sectionId;
  await this.pinSection(newPinned);
}

// AFTER:
async pinWorktree(worktreeId: string | null): Promise<void> {
  const newState: TreeMenuPersistedState = {
    ...getPersistedState(),
    pinnedWorktreeId: worktreeId,
  };
  // ... same disk write pattern ...
  useTreeMenuStore.getState()._applySetPinned(worktreeId);
}

async togglePinWorktree(worktreeId: string): Promise<void> {
  const current = useTreeMenuStore.getState().pinnedWorktreeId;
  const newPinned = current === worktreeId ? null : worktreeId;
  await this.pinWorktree(newPinned);
}
```

**Update `getPersistedState()` helper:**

```typescript
// BEFORE:
function getPersistedState(): TreeMenuPersistedState {
  const { expandedSections, selectedItemId, pinnedSectionId, hiddenSectionIds } = useTreeMenuStore.getState();
  return { expandedSections, selectedItemId, pinnedSectionId, hiddenSectionIds };
}

// AFTER:
function getPersistedState(): TreeMenuPersistedState {
  const { expandedSections, selectedItemId, pinnedWorktreeId } = useTreeMenuStore.getState();
  return { expandedSections, selectedItemId, pinnedWorktreeId };
}
```

**Update `hydrate()` — pin format migration:**

Old persisted JSON may have `pinnedSectionId: "repoId:worktreeId"`. Since this is a big-bang delivery, we clear old pins rather than migrating them:

```typescript
async hydrate(): Promise<void> {
  try {
    const raw = await appData.readJson(UI_STATE_PATH);
    if (raw) {
      const result = TreeMenuPersistedStateSchema.safeParse(raw);
      if (result.success) {
        useTreeMenuStore.getState().hydrate(result.data);
        return;
      }
      // Old format: clear pin, ignore hiddenSectionIds
      logger.info("[treeMenuService] Migrating old tree-menu.json format");
      const migrated: TreeMenuPersistedState = {
        expandedSections: (raw as Record<string, unknown>).expandedSections as Record<string, boolean> ?? {},
        selectedItemId: (raw as Record<string, unknown>).selectedItemId as string | null ?? null,
        pinnedWorktreeId: null, // Clear old pin — user re-pins in one click
      };
      await appData.ensureDir("ui");
      await appData.writeJson(UI_STATE_PATH, migrated);
      useTreeMenuStore.getState().hydrate(migrated);
      return;
    }
    // No data — defaults
    useTreeMenuStore.getState().hydrate({
      expandedSections: {},
      selectedItemId: null,
      pinnedWorktreeId: null,
    });
  } catch (err) {
    logger.error("[treeMenuService] Failed to hydrate:", err);
    useTreeMenuStore.getState().hydrate({
      expandedSections: {},
      selectedItemId: null,
      pinnedWorktreeId: null,
    });
  }
}
```

**Note on `expandedSections` keys:** Old keys for sections were `"repoId:worktreeId"`. New keys for worktree expand state use the bare `worktreeId` UUID. We do NOT migrate old expansion keys — worst case, sections that were collapsed will default to expanded (worktrees default expanded) or collapsed (folders/plans/threads default collapsed). Harmless UX impact.

## Implementation

### 1. Fractional Indexing Utility

**New file: `src/lib/fractional-indexing.ts`**

No external package needed. Implement a minimal ~50-line utility:

```typescript
/**
 * Fractional indexing for lexicographic sort keys.
 * Generates string keys that sort between any two adjacent keys.
 *
 * Used by the tree builder for sort ordering and by DnD (05a) for
 * key generation on drop.
 */

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = DIGITS.length; // 62

/**
 * Generate a sort key between `before` and `after`.
 * Pass null/undefined for unbounded ends.
 *
 * Examples:
 * - generateKeyBetween(null, null)     → "a0" (first item)
 * - generateKeyBetween(null, "a0")     → key < "a0"
 * - generateKeyBetween("a0", null)     → key > "a0"
 * - generateKeyBetween("a0", "a1")     → key between "a0" and "a1"
 */
export function generateKeyBetween(
  before: string | null | undefined,
  after: string | null | undefined,
): string {
  // Standard midpoint-string algorithm using base-62 digits.
  // See the fractional-indexing npm package for reference.
  // Implementation: find the lexicographic midpoint between the two strings.
  // ...implementation...
}

/**
 * Generate N keys evenly spaced between `before` and `after`.
 */
export function generateNKeysBetween(
  before: string | null | undefined,
  after: string | null | undefined,
  count: number,
): string[] {
  const keys: string[] = [];
  let lower = before ?? null;
  for (let i = 0; i < count; i++) {
    const upper = i === count - 1 ? (after ?? null) : null;
    const key = generateKeyBetween(lower, upper);
    keys.push(key);
    lower = key;
  }
  return keys;
}
```

The actual midpoint algorithm follows the standard fractional-indexing approach: pad strings to equal length, find the midpoint character-by-character, appending a midpoint character when strings are adjacent. Reference: `fractional-indexing` npm package by @rocicorp.

### 2. Unified Tree Builder — Full Rewrite of `src/hooks/use-tree-data.ts`

This file is currently 625 lines. It will be rewritten entirely. The new version should be under 250 lines by extracting node-pooling helpers into a separate module if needed.

**New file structure (may split into two files if >250 lines):**

- `src/hooks/use-tree-data.ts` — the `useTreeData` hook, `useSelectedTreeItem`, `useExpandedSections`, and the `buildUnifiedTree` export
- `src/hooks/tree-node-builders.ts` — **New, optional** — helper functions that convert entities to `TreeItemNode` (one per entity type: `worktreeToNode`, `folderToNode`, `threadToNode`, `planToNode`, `terminalToNode`, `prToNode`, `buildChangesNodes`)

**Data sources consumed by the builder:**

| Data source | Store | Reactive selector |
|-------------|-------|-------------------|
| Threads | `useThreadStore` | `state._threadsArray` |
| Plans | `usePlanStore` | `state._plansArray` |
| Terminals | `useTerminalSessionStore` | `state._sessionsArray` |
| Pull requests | `usePullRequestStore` | `state._prsArray` + `state.prDetails` |
| Folders | `useFolderStore` | `state._foldersArray` |
| Worktree info | `useRepoWorktreeLookupStore` | `state.repos` (Map<repoId, RepoInfo>) |
| Expand state | `useTreeMenuStore` | `state.expandedSections` |
| Commits | `useCommitStore` | `state.commitsByWorktree` |
| Pin state | `useTreeMenuStore` | `state.pinnedWorktreeId` |
| Running threads | derived from `useThreadStore` | `Set<string>` of thread IDs with `status === "running"` |
| Pending input | `usePermissionStore` | `state.requests` filtered for `status === "pending"` |
| Plan-thread relations | `relationService.getByPlan()` | Called per plan (synchronous) |

**`buildUnifiedTree` function signature:**

```typescript
export interface WorktreeInfo {
  worktreeId: string;
  repoId: string;
  repoName: string;
  worktreeName: string;
  worktreePath: string;
}

export interface TreeBuildContext {
  expandedSections: Record<string, boolean>;
  runningThreadIds: Set<string>;
  threadsWithPendingInput: Set<string>;
}

export function buildUnifiedTree(
  worktrees: WorktreeInfo[],
  folders: FolderMetadata[],
  threads: ThreadMetadata[],
  plans: PlanMetadata[],
  terminals: TerminalSession[],
  pullRequests: PullRequestMetadata[],
  ctx: TreeBuildContext,
): TreeItemNode[]
```

**Algorithm (pseudocode):**

```
function buildUnifiedTree(worktrees, folders, threads, plans, terminals, pullRequests, ctx):
  allNodes = []

  // Step 1: Pool all entity nodes
  for wt in worktrees:
    allNodes.push(worktreeToNode(wt))
  for folder in folders:
    allNodes.push(folderToNode(folder))
  for thread in threads:
    allNodes.push(threadToNode(thread, ctx))
  for plan in plans:
    allNodes.push(planToNode(plan, ctx.runningThreadIds))
  for terminal in terminals:
    allNodes.push(terminalToNode(terminal))
  for pr in pullRequests:
    allNodes.push(prToNode(pr))

  // Step 1b: Add synthetic Changes/Uncommitted/Commit per worktree
  for wt in worktrees:
    allNodes.push(...buildChangesNodes(wt.worktreeId, ctx.expandedSections))

  // Step 2: Build children map
  ROOT = "__ROOT__"
  childrenMap = new Map<string, TreeItemNode[]>()
  nodeById = new Map<string, TreeItemNode>()

  for node in allNodes:
    nodeById.set(node.id, node)

  for node in allNodes:
    parentKey = node.parentId ?? ROOT
    // If parentId references a non-existent node, fall back to ROOT
    if parentKey != ROOT and !nodeById.has(parentKey):
      parentKey = ROOT
    childrenMap[parentKey].push(node)

  // Step 3: Sort children per parent
  for (parent, children) in childrenMap:
    sortChildren(children)  // createdAt desc (sortKey ordering added in 05a)

  // Step 3b: Set isFolder dynamically
  for node in allNodes:
    if childrenMap[node.id] has entries:
      node.isFolder = true

  // Step 3c: Apply expansion state
  for node in allNodes where node.isFolder:
    expandKey = node.type == "worktree" ? node.id : "${node.type}:${node.id}"
    defaultExpanded = node.type == "worktree"  // worktrees default expanded
    node.isExpanded = ctx.expandedSections[expandKey] ?? defaultExpanded

  // Step 4: Recursive flatten
  result = []
  function addNodeAndChildren(node, depth):
    node.depth = depth
    result.push(node)
    if !node.isFolder or !node.isExpanded: return
    for child in childrenMap[node.id]:
      addNodeAndChildren(child, depth + 1)

  for root in childrenMap[ROOT]:
    addNodeAndChildren(root, 0)

  return result
```

**Expand key convention** (preserves existing behavior for plans/threads):
- Worktree nodes: bare `worktreeId` UUID (e.g., `"abc-123-def"`)
- Folder nodes: `"folder:folderId"` (e.g., `"folder:xyz-789"`)
- Thread nodes: `"thread:threadId"` (matches current `expandedSections` key format)
- Plan nodes: `"plan:planId"` (matches current `expandedSections` key format)
- Changes nodes: `"changes:worktreeId"` (adapted from old `"changes:repoId:worktreeId"`)

**Node-to-TreeItemNode conversion functions** (one per entity type):

Each function maps an entity's fields to `TreeItemNode` fields. The `parentId` field is always read from `entity.visualSettings?.parentId`. The `worktreeId` field is read from the entity's own `worktreeId`. Key conversions:

| Entity | `parentId` source | `worktreeId` source |
|--------|-------------------|---------------------|
| WorktreeInfo | `undefined` (worktrees are roots by default; overridden if `visualSettings?.parentId` set on `WorktreeState`) | self (`wt.worktreeId`) |
| FolderMetadata | `folder.visualSettings?.parentId` | `folder.worktreeId` |
| ThreadMetadata | `thread.visualSettings?.parentId` | `thread.worktreeId` |
| PlanMetadata | `plan.visualSettings?.parentId` | `plan.worktreeId` |
| TerminalSession | `terminal.visualSettings?.parentId` | `terminal.worktreeId` |
| PullRequestMetadata | `pr.visualSettings?.parentId` | `pr.worktreeId` |
| Synthetic changes | hardcoded to `worktreeId` | `worktreeId` |
| Synthetic uncommitted | hardcoded to `changesItemId` | `worktreeId` |
| Synthetic commit | hardcoded to `changesItemId` | `worktreeId` |

**`useTreeData` hook (complete):**

```typescript
export function useTreeData(): TreeItemNode[] {
  // Reactive subscriptions to all entity stores
  const threads = useThreadStore((state) => state._threadsArray);
  const plans = usePlanStore((state) => state._plansArray);
  const terminals = useTerminalSessionStore((state) => state._sessionsArray);
  const pullRequests = usePullRequestStore((state) => state._prsArray);
  const prDetails = usePullRequestStore((state) => state.prDetails);
  const folders = useFolderStore((state) => state._foldersArray);
  const expandedSections = useTreeMenuStore((state) => state.expandedSections);
  const commitsByWorktree = useCommitStore((state) => state.commitsByWorktree);
  const pinnedWorktreeId = useTreeMenuStore((state) => state.pinnedWorktreeId);
  const repos = useRepoWorktreeLookupStore((state) => state.repos);

  // Derived: worktree info list
  const worktrees = useMemo((): WorktreeInfo[] => {
    const result: WorktreeInfo[] = [];
    for (const [repoId, repoInfo] of repos) {
      for (const [worktreeId, wtInfo] of repoInfo.worktrees) {
        result.push({
          worktreeId, repoId,
          repoName: repoInfo.name,
          worktreeName: wtInfo.name,
          worktreePath: wtInfo.path,
        });
      }
    }
    return result;
  }, [repos]);

  // Derived: running thread IDs
  const runningThreadIds = useMemo(
    () => new Set(threads.filter((t) => t.status === "running").map((t) => t.id)),
    [threads],
  );

  // Derived: threads with pending permission input
  const permissionRequests = usePermissionStore((state) => state.requests);
  const threadsWithPendingInput = useMemo(() => {
    const ids = new Set<string>();
    for (const req of Object.values(permissionRequests)) {
      if (req.status === "pending") ids.add(req.threadId);
    }
    return ids;
  }, [permissionRequests]);

  return useMemo(() => {
    const ctx: TreeBuildContext = {
      expandedSections, runningThreadIds, threadsWithPendingInput,
    };

    const allNodes = buildUnifiedTree(
      worktrees, folders, threads, plans, terminals, pullRequests, ctx,
    );

    // Pin filtering: show only the pinned worktree's subtree
    if (pinnedWorktreeId) {
      return allNodes.filter(
        (node) => node.id === pinnedWorktreeId || node.worktreeId === pinnedWorktreeId,
      );
    }

    return allNodes;
  }, [
    threads, plans, terminals, pullRequests, prDetails, folders,
    expandedSections, commitsByWorktree, runningThreadIds, worktrees,
    pinnedWorktreeId, threadsWithPendingInput,
  ]);
}
```

**Functions/hooks to REMOVE from the file:**
- `buildSectionItems()` — replaced by node pooling in `buildUnifiedTree`
- `buildChangesItems()` — replaced by `buildChangesNodes`
- `buildTreeFromEntities()` — replaced by `buildUnifiedTree`
- `useTreeSections()` — was an alias; no longer needed
- `useSectionItems(sectionId)` — no longer applicable

**Functions/hooks to KEEP (updated):**
- `useSelectedTreeItem()` — simplified: searches flat `items` array instead of iterating sections
- `useExpandedSections()` — unchanged

### 3. Commit Store Re-Keying

**File: `src/stores/commit-store.ts`**

Change the key from `sectionId` ("repoId:worktreeId" composite string) to `worktreeId` (bare UUID).

**Changes:**
1. Rename `commitsBySection` to `commitsByWorktree` in state interface and store body
2. Rename `loadingBySection` to `loadingByWorktree`
3. Rename `fetchCommits` parameter from `sectionId` to `worktreeId`
4. Replace all internal references (debounce map keys, set() calls, error logging)

This is a mechanical find-and-replace within the file. The callers (the tree builder's `buildChangesNodes` and the `RepoWorktreeSection` component's `useEffect`) both need updating — the component update is handled in 04a-rendering.

### 4. Hooks Index Update

**File: `src/hooks/index.ts`**

```typescript
// BEFORE (lines 49-56):
export {
  useTreeData,
  useTreeSections,
  useSelectedTreeItem,
  useSectionItems,
  useExpandedSections,
  buildTreeFromEntities,
} from "./use-tree-data";

// AFTER:
export {
  useTreeData,
  useSelectedTreeItem,
  useExpandedSections,
  buildUnifiedTree,
} from "./use-tree-data";
```

## Consumer Impact (handled in 04a-rendering, NOT this sub-plan)

The following files consume `RepoWorktreeSection` or removed exports and will have compile errors after this sub-plan. They are fixed in **04a-rendering-components**:

| File | Impact |
|------|--------|
| `src/components/tree-menu/tree-menu.tsx` | Line 7: imports `RepoWorktreeSection` component. Line 52: `sections = useTreeData()` returns `TreeItemNode[]` not sections. Lines 62-80: `focusableItems` iterates sections. Lines 236-258: renders `<RepoWorktreeSection>` per section. |
| `src/components/tree-menu/repo-worktree-section.tsx` | Line 8: imports `RepoWorktreeSection` type. Entire component (808 lines) renders the old section model. Will be replaced by type-specific row renderers. |
| `src/components/main-window/main-window-layout.tsx` | Line 459: constructs `sectionId = "repoId:worktreeId"`. Lines 553-576: pin/hide callbacks use old section IDs. |
| `src/components/tree-menu/index.ts` | Line 3: exports `RepoWorktreeSection` component |
| `src/hooks/__tests__/use-tree-data.test.ts` | Line 19: imports `buildTreeFromEntities`. Entire test file uses old function signature. |

**This sub-plan focuses on the data layer only.** Compile errors in rendering components are expected and resolved by 04a-rendering.

## Acceptance Criteria

- [x] `TreeItemNode.type` includes `"worktree"` and `"folder"`
- [x] `RepoWorktreeSection` interface is deleted from `src/stores/tree-menu/types.ts`
- [x] `TreeNode` union type is deleted from `src/stores/tree-menu/types.ts`
- [x] `sectionId` field is removed from `TreeItemNode`
- [x] `buildUnifiedTree()` exists in `src/hooks/use-tree-data.ts` and returns a flat `TreeItemNode[]` with correct depth
- [x] Tree builder reads only `visualSettings.parentId` for placement (no fallback to domain relationships)
- [x] Worktree nodes appear with `type: "worktree"` and `title: "repoName / worktreeName"`
- [x] Sort order: createdAt descending (current behavior preserved; sortKey ordering structure ready for 05a)
- [x] Synthetic items (Changes, Uncommitted, Commits) are children of worktree nodes via `parentId`
- [x] Pin state uses bare worktree UUID (`pinnedWorktreeId`) in store, service, and persisted schema
- [x] `hiddenSectionIds` removed from store, service, and persisted schema
- [x] `useTreeData()` returns `TreeItemNode[]` (not `RepoWorktreeSection[]`)
- [x] Commit store re-keyed from `commitsBySection` to `commitsByWorktree`
- [x] Fractional indexing utility exists at `src/lib/fractional-indexing.ts`
- [x] `src/hooks/index.ts` exports updated (old exports removed, new exports added)
- [x] `hydrate()` in service handles old persisted format gracefully (clears old pin, preserves expand state)

## Phases

- [x] Add `"worktree"` and `"folder"` to `TreeItemNode.type` union; add new fields (`worktreeId`, `repoName`, `worktreeName`, `worktreePath`, `repoId`, `icon`); remove `sectionId` field; remove `RepoWorktreeSection` interface and `TreeNode` union; update `TreeMenuPersistedStateSchema` (rename `pinnedSectionId` to `pinnedWorktreeId`, remove `hiddenSectionIds`)
- [x] Create fractional-indexing utility at `src/lib/fractional-indexing.ts`
- [x] Rewrite `src/hooks/use-tree-data.ts`: replace `buildTreeFromEntities` + `buildSectionItems` + `buildChangesItems` with single `buildUnifiedTree` function and node-builder helpers; update `useTreeData` hook to return `TreeItemNode[]`; remove `useTreeSections`, `useSectionItems`; update `src/hooks/index.ts` exports
- [x] Re-key commit store from `commitsBySection` to `commitsByWorktree` in `src/stores/commit-store.ts`
- [x] Update `src/stores/tree-menu/store.ts`: rename `pinnedSectionId` to `pinnedWorktreeId`; remove `hiddenSectionIds`, `_applySetHidden`, `_applyUnhideAll`; update `getTreeMenuState()`
- [x] Update `src/stores/tree-menu/service.ts`: remove `hideSection`, `unhideSection`, `unhideAll`, `getHiddenCount`, `hasHiddenOrPinned`; rename `pinSection`/`togglePinSection` to `pinWorktree`/`togglePinWorktree`; update `hydrate()` with old-format migration; update `getPersistedState()`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
