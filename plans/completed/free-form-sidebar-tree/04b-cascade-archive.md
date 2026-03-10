# 04b — Cascade Archive

**Layer 3 — parallel with 04a. Depends on 03.**

## Summary

Archiving a node archives all **visual descendants** recursively. "Visual descendants" means children determined by `visualSettings.parentId` (the visual tree), not domain relationships like `parentThreadId` or plan `parentId`. The tree builder from 03 produces a `childrenMap: Map<string, TreeItemNode[]>` which this plan uses to walk descendants.

This plan creates a single `cascadeArchive()` function that orchestrates archiving across entity types, plus a `cascadeUnarchive()` counterpart. Both are called by the existing per-type archive/unarchive methods when the visual tree is available.

## Dependencies

- **03-unified-tree-model** — tree builder produces `childrenMap` from `buildUnifiedTree()`

## Current State (What Exists Today)

### Archive Methods Per Entity

| Entity | Service | Archive Method | What It Does |
|--------|---------|---------------|--------------|
| Thread | `src/entities/threads/service.ts` | `threadService.archive(id, originInstanceId?)` | Moves folder from `threads/{id}/` to `archive/threads/{id}/`, cascades to **domain** children via `getDescendantThreadIds()` (uses `parentThreadId`), emits `THREAD_ARCHIVED` |
| Plan | `src/entities/plans/service.ts` | `planService.archive(id, originInstanceId?)` | Moves markdown to `plans/completed/`, moves metadata from `plans/{id}/` to `archive/plans/{id}/`, cascades to **domain** children via `getDescendants()` (uses plan `parentId`), emits `PLAN_ARCHIVED` |
| Terminal | `src/entities/terminal-sessions/service.ts` | `terminalSessionService.archive(id)` | Kills PTY via `invoke("kill_terminal")`, removes from store, emits `TERMINAL_ARCHIVED` |
| PR | `src/entities/pull-requests/pr-details.ts` | `archivePr(id)` (called via `pullRequestService.archive(id)`) | Moves from `pull-requests/{id}/` to `archive/pull-requests/{id}/`, disables auto-address, emits `PR_ARCHIVED` |
| Folder | `src/entities/folders/service.ts` | Does not exist yet (created in 02b) | Will need `folderService.archive(id)` and `folderService.delete(id)` |

### Archive Triggers (Call Sites)

- **Tree menu items**: `src/components/tree-menu/thread-item.tsx`, `plan-item.tsx`, `terminal-item.tsx`, `pull-request-item.tsx` — each calls its own service's `archive()`.
- **Content pane header**: `src/components/content-pane/content-pane-header.tsx` — archives terminal.
- **Control panel**: `src/components/control-panel/control-panel-window.tsx` (thread), `plan-view.tsx` (plan) — call service archive then navigate away.
- **Quick actions**: `src/lib/quick-action-executor.ts` — handles `thread:archive` and `plan:archive` SDK events.
- **SDK action**: `core/sdk/template/src/actions/archive.ts` — archive action for threads and plans.
- **Worktree removal**: `src/components/main-window/main-window-layout.tsx` — archives all threads, plans, terminals, PRs for a worktree.

### Unarchive

- **Thread**: `threadService.unarchive(threadId)` — moves from `archive/threads/{id}/` back to `threads/{id}/`, adds to store, emits `THREAD_CREATED`.
- **Plan/PR**: No unarchive methods exist today.
- **Archive View**: `src/components/content-pane/archive-view.tsx` — lists archived threads, calls `threadService.unarchive()`.

### Key Observation

Today's cascade logic is **domain-based**: `threadService.archive()` cascades via `parentThreadId`, `planService.archive()` cascades via plan `parentId`. After this plan, archiving also cascades via **visual parentage** (`visualSettings.parentId`), which is the tree the user sees and manipulates.

## Key Files

| File | Change |
|------|--------|
| `src/lib/cascade-archive.ts` | **New** — `getVisualDescendants()`, `buildCurrentChildrenMap()`, `cascadeArchive()`, `cascadeUnarchive()` |
| `src/hooks/use-tree-data.ts` | Export `buildChildrenMap()` as a standalone utility (extracted from `buildUnifiedTree()`) |
| `src/entities/folders/service.ts` | Add `archive(id)`, `unarchive(id)`, `listArchived()` (02b creates this file; this plan adds archive methods) |
| `src/entities/threads/service.ts` | Wire cascade into `archive()` — call `cascadeArchive()` before existing domain cascade |
| `src/entities/plans/service.ts` | Wire cascade into `archive()` — call `cascadeArchive()` before existing domain cascade |
| `src/entities/pull-requests/pr-details.ts` | Add `unarchivePr()` function |
| `src/entities/pull-requests/service.ts` | Add `unarchive(id)` method delegating to `unarchivePr()` |
| `core/types/events.ts` | Add `FOLDER_ARCHIVED` event |
| `src/entities/terminal-sessions/service.ts` | No change — terminals are leaf nodes |

## Implementation

### 1. Export `buildChildrenMap()` from tree data

The `buildUnifiedTree()` function from 03 internally builds a `childrenMap: Map<string, TreeItemNode[]>` where keys are parent IDs (or `"root"` for top-level items) and values are arrays of child `TreeItemNode` objects. This step extracts that logic into a reusable utility.

**File: `src/hooks/use-tree-data.ts`** (or the new location from 03)

Add a new exported function alongside `buildUnifiedTree()`:

```typescript
/**
 * Build a map of parentId -> child nodes from all entities.
 * Uses visualSettings.parentId for placement.
 * Keys: entity ID or "root" for top-level items.
 * This is the same mapping used internally by buildUnifiedTree().
 */
export function buildChildrenMap(
  allNodes: TreeItemNode[],
): Map<string, TreeItemNode[]> {
  const map = new Map<string, TreeItemNode[]>();
  for (const node of allNodes) {
    // parentId comes from visualSettings.parentId, set on TreeItemNode
    // during the pooling step of buildUnifiedTree
    const parentKey = node.parentId ?? "root";
    const siblings = map.get(parentKey) ?? [];
    siblings.push(node);
    map.set(parentKey, siblings);
  }
  return map;
}
```

Note: After 03 refactors `buildUnifiedTree()`, the internal pool of all `TreeItemNode[]` (before flattening) should be accessible. If the tree builder already exposes this map, re-export it. The key requirement is that we can call this function **outside of React** (from services, not just hooks).

### 2. Create `src/lib/cascade-archive.ts`

This is the core new file. It contains all cascade logic.

```typescript
import type { TreeItemNode } from "@/stores/tree-menu/types";
import { logger } from "@/lib/logger-client";

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Descendants grouped by entity type, for dispatching to the correct service.
 */
export interface DescendantGroup {
  threads: string[];
  plans: string[];
  terminals: string[];
  folders: string[];
  pullRequests: string[];
}

// Container types that can have visual children
const CONTAINER_TYPES = new Set(["worktree", "folder", "thread", "plan"]);

// ═══════════════════════════════════════════════════════════════════════════
// getVisualDescendants
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Walk the childrenMap recursively from nodeId, collecting all descendant IDs
 * grouped by entity type. Does NOT include the node itself.
 *
 * @param nodeId - The starting node ID (not included in results)
 * @param childrenMap - Map<parentId, TreeItemNode[]> from buildCurrentChildrenMap()
 * @returns DescendantGroup with IDs for each entity type
 */
export function getVisualDescendants(
  nodeId: string,
  childrenMap: Map<string, TreeItemNode[]>,
): DescendantGroup {
  const result: DescendantGroup = {
    threads: [],
    plans: [],
    terminals: [],
    folders: [],
    pullRequests: [],
  };

  function walk(parentId: string): void {
    const children = childrenMap.get(parentId);
    if (!children) return;

    for (const child of children) {
      // Skip synthetic items (changes, uncommitted, commit) — not archivable
      switch (child.type) {
        case "thread":
          result.threads.push(child.id);
          break;
        case "plan":
          result.plans.push(child.id);
          break;
        case "terminal":
          result.terminals.push(child.id);
          break;
        case "folder":
          result.folders.push(child.id);
          break;
        case "pull-request":
          result.pullRequests.push(child.id);
          break;
        // "changes", "uncommitted", "commit" are synthetic — skip
      }

      // Recurse into containers
      if (CONTAINER_TYPES.has(child.type)) {
        walk(child.id);
      }
    }
  }

  walk(nodeId);
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// buildCurrentChildrenMap
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a childrenMap from current Zustand store state.
 * This is the service-layer equivalent of the React hook's buildChildrenMap.
 * Reads visualSettings.parentId from each entity to determine parent-child.
 *
 * Returns Map<parentId, TreeItemNode[]> where parentId is entity ID or "root".
 * Only includes id and type on the TreeItemNode (minimal shape for cascade).
 */
export function buildCurrentChildrenMap(): Map<string, TreeItemNode[]> {
  // Lazy require to avoid circular dependency at module load time.
  // These are only needed when cascade is actually triggered.
  const { useThreadStore } = require("@/entities/threads/store");
  const { usePlanStore } = require("@/entities/plans/store");
  const { useTerminalSessionStore } = require("@/entities/terminal-sessions/store");
  const { usePullRequestStore } = require("@/entities/pull-requests/store");
  const { useFolderStore } = require("@/entities/folders/store");

  const map = new Map<string, TreeItemNode[]>();

  function addEntry(
    id: string,
    type: TreeItemNode["type"],
    parentId: string | undefined,
  ): void {
    const key = parentId ?? "root";
    const siblings = map.get(key) ?? [];
    siblings.push({ id, type } as TreeItemNode);
    map.set(key, siblings);
  }

  // Threads
  const threads = useThreadStore.getState().getAllThreads();
  for (const t of threads) {
    addEntry(t.id, "thread", t.visualSettings?.parentId);
  }

  // Plans
  const plans = usePlanStore.getState().getAll();
  for (const p of plans) {
    addEntry(p.id, "plan", p.visualSettings?.parentId);
  }

  // Terminals
  const terminals = useTerminalSessionStore.getState().getAllSessions();
  for (const t of terminals) {
    addEntry(t.id, "terminal", t.visualSettings?.parentId);
  }

  // Pull Requests
  const prs = Object.values(usePullRequestStore.getState().pullRequests);
  for (const pr of prs) {
    addEntry(pr.id, "pull-request", pr.visualSettings?.parentId);
  }

  // Folders
  const folders = useFolderStore.getState().getAll();
  for (const f of folders) {
    addEntry(f.id, "folder", f.visualSettings?.parentId);
  }

  return map;
}

// ═══════════════════════════════════════════════════════════════════════════
// cascadeArchive
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Archive all visual descendants of a node.
 * Does NOT archive the node itself — the caller handles that.
 *
 * Children are archived in this order:
 *   1. Terminals (leaf — kill PTY)
 *   2. Pull requests (leaf)
 *   3. Threads (may have domain children, handled by their own cascade)
 *   4. Plans (may have domain children, handled by their own cascade)
 *   5. Folders (deepest first)
 *
 * @param nodeId - The node whose visual descendants should be archived
 * @param nodeType - The entity type of the node being archived
 * @param childrenMap - Map<parentId, TreeItemNode[]> from buildCurrentChildrenMap()
 * @param originInstanceId - Optional window instance ID for cross-window close
 */
export async function cascadeArchive(
  nodeId: string,
  nodeType: TreeItemNode["type"],
  childrenMap: Map<string, TreeItemNode[]>,
  originInstanceId?: string | null,
): Promise<void> {
  const descendants = getVisualDescendants(nodeId, childrenMap);

  const totalCount =
    descendants.threads.length +
    descendants.plans.length +
    descendants.terminals.length +
    descendants.folders.length +
    descendants.pullRequests.length;

  if (totalCount === 0) return;

  logger.info(
    `[cascadeArchive] Archiving ${totalCount} visual descendants of ${nodeType}:${nodeId}`,
  );

  // Lazy-import services to avoid circular dependencies
  const { threadService } = await import("@/entities/threads/service");
  const { planService } = await import("@/entities/plans/service");
  const { terminalSessionService } = await import(
    "@/entities/terminal-sessions/service"
  );
  const { pullRequestService } = await import(
    "@/entities/pull-requests/service"
  );
  const { folderService } = await import("@/entities/folders/service");

  // 1. Terminals (leaf — kill PTY)
  for (const id of descendants.terminals) {
    try {
      await terminalSessionService.archive(id);
    } catch (err) {
      logger.warn(`[cascadeArchive] Failed to archive terminal ${id}:`, err);
    }
  }

  // 2. Pull requests (leaf)
  for (const id of descendants.pullRequests) {
    try {
      await pullRequestService.archive(id);
    } catch (err) {
      logger.warn(`[cascadeArchive] Failed to archive PR ${id}:`, err);
    }
  }

  // 3. Threads — pass skipVisualCascade to prevent infinite recursion
  for (const id of descendants.threads) {
    try {
      await threadService.archive(id, originInstanceId, {
        skipVisualCascade: true,
      });
    } catch (err) {
      logger.warn(`[cascadeArchive] Failed to archive thread ${id}:`, err);
    }
  }

  // 4. Plans — pass skipVisualCascade to prevent infinite recursion
  for (const id of descendants.plans) {
    try {
      await planService.archive(id, originInstanceId, {
        skipVisualCascade: true,
      });
    } catch (err) {
      logger.warn(`[cascadeArchive] Failed to archive plan ${id}:`, err);
    }
  }

  // 5. Folders (reverse order so deepest folders are archived first)
  for (const id of descendants.folders.reverse()) {
    try {
      await folderService.archive(id);
    } catch (err) {
      logger.warn(`[cascadeArchive] Failed to archive folder ${id}:`, err);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// cascadeUnarchive
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Unarchive all visual descendants of a node.
 * Does NOT unarchive the node itself — the caller handles that.
 *
 * Archived entities retain their visualSettings.parentId, so when unarchived
 * they reappear in the correct tree position.
 *
 * Strategy: scan all archived entities and find those whose
 * visualSettings.parentId chain leads back to the node being unarchived.
 *
 * @param nodeId - The node whose descendants to unarchive
 * @param nodeType - The entity type of the node
 */
export async function cascadeUnarchive(
  nodeId: string,
  nodeType: TreeItemNode["type"],
): Promise<void> {
  logger.info(
    `[cascadeUnarchive] Unarchiving descendants of ${nodeType}:${nodeId}`,
  );

  const { threadService } = await import("@/entities/threads/service");
  const { planService } = await import("@/entities/plans/service");
  const { folderService } = await import("@/entities/folders/service");
  const { pullRequestService } = await import(
    "@/entities/pull-requests/service"
  );

  // 1. Load all archived entities
  const [archivedThreads, archivedPlans, archivedFolders, archivedPrs] =
    await Promise.all([
      threadService.listArchived(),
      planService.listArchived(),
      folderService.listArchived(),
      pullRequestService.listArchived(),
    ]);

  // 2. Build a lookup: archived entity ID -> its visualSettings.parentId
  const parentMap = new Map<string, string | undefined>();
  for (const t of archivedThreads)
    parentMap.set(t.id, t.visualSettings?.parentId);
  for (const p of archivedPlans)
    parentMap.set(p.id, p.visualSettings?.parentId);
  for (const f of archivedFolders)
    parentMap.set(f.id, f.visualSettings?.parentId);
  for (const pr of archivedPrs)
    parentMap.set(pr.id, pr.visualSettings?.parentId);

  // 3. Find all archived entities whose parentId chain leads to nodeId
  const descendantIds = new Set<string>();

  function isDescendantOf(
    entityId: string,
    targetId: string,
    visited: Set<string>,
  ): boolean {
    if (visited.has(entityId)) return false; // cycle guard
    visited.add(entityId);
    const parentId = parentMap.get(entityId);
    if (!parentId) return false;
    if (parentId === targetId) return true;
    return isDescendantOf(parentId, targetId, visited);
  }

  for (const id of parentMap.keys()) {
    if (id === nodeId) continue;
    if (isDescendantOf(id, nodeId, new Set())) {
      descendantIds.add(id);
    }
  }

  if (descendantIds.size === 0) {
    logger.info(`[cascadeUnarchive] No archived descendants found`);
    return;
  }

  // 4. Unarchive: containers first (folders), then other entities
  const folderIds = archivedFolders
    .filter((f) => descendantIds.has(f.id))
    .map((f) => f.id);
  const threadIds = archivedThreads
    .filter((t) => descendantIds.has(t.id))
    .map((t) => t.id);
  const planIds = archivedPlans
    .filter((p) => descendantIds.has(p.id))
    .map((p) => p.id);
  const prIds = archivedPrs
    .filter((pr) => descendantIds.has(pr.id))
    .map((pr) => pr.id);

  // Folders first so parents exist before children are restored
  for (const id of folderIds) {
    try {
      await folderService.unarchive(id);
    } catch (err) {
      logger.warn(`[cascadeUnarchive] Failed to unarchive folder ${id}:`, err);
    }
  }

  for (const id of threadIds) {
    try {
      await threadService.unarchive(id);
    } catch (err) {
      logger.warn(
        `[cascadeUnarchive] Failed to unarchive thread ${id}:`,
        err,
      );
    }
  }

  for (const id of planIds) {
    try {
      await planService.unarchive(id);
    } catch (err) {
      logger.warn(`[cascadeUnarchive] Failed to unarchive plan ${id}:`, err);
    }
  }

  for (const id of prIds) {
    try {
      await pullRequestService.unarchive(id);
    } catch (err) {
      logger.warn(`[cascadeUnarchive] Failed to unarchive PR ${id}:`, err);
    }
  }

  logger.info(
    `[cascadeUnarchive] Restored ${descendantIds.size} descendants of ${nodeType}:${nodeId}`,
  );
}
```

### 3. Add `skipVisualCascade` option to service archive methods

Both `threadService.archive()` and `planService.archive()` need a way to skip visual cascade when called _from_ the cascade function (to avoid infinite recursion).

**File: `src/entities/threads/service.ts`** — modify `archive()` (currently at line 719)

Change the signature from:

```typescript
async archive(threadId: string, originInstanceId?: string | null): Promise<void> {
```

To:

```typescript
async archive(
  threadId: string,
  originInstanceId?: string | null,
  options?: { skipVisualCascade?: boolean },
): Promise<void> {
```

Add visual cascade at the top of the method body, **before** the existing `getDescendantThreadIds()` call at line 724:

```typescript
const thread = this.get(threadId);
if (!thread) return;

// Visual cascade: archive visual children (from tree model, not domain)
if (!options?.skipVisualCascade) {
  try {
    const { cascadeArchive, buildCurrentChildrenMap } = await import("@/lib/cascade-archive");
    const childrenMap = buildCurrentChildrenMap();
    if (childrenMap.has(threadId)) {
      await cascadeArchive(threadId, "thread", childrenMap, originInstanceId);
    }
  } catch (err) {
    logger.warn(`[threadService.archive] Visual cascade failed, continuing:`, err);
  }
}

// Get all descendant threads for cascaded archival (existing domain logic)
const descendantIds = this.getDescendantThreadIds(threadId);
// ... rest of existing archive method unchanged ...
```

**File: `src/entities/plans/service.ts`** — modify `archive()` (currently at line 589)

Change the signature from:

```typescript
async archive(planId: string, originInstanceId?: string | null): Promise<void> {
```

To:

```typescript
async archive(
  planId: string,
  originInstanceId?: string | null,
  options?: { skipVisualCascade?: boolean },
): Promise<void> {
```

Add visual cascade at the top, **before** the existing children check at line 594:

```typescript
const plan = this.get(planId);
if (!plan) return;

// Visual cascade: archive visual children (from tree model, not domain)
if (!options?.skipVisualCascade) {
  try {
    const { cascadeArchive, buildCurrentChildrenMap } = await import("@/lib/cascade-archive");
    const childrenMap = buildCurrentChildrenMap();
    if (childrenMap.has(planId)) {
      await cascadeArchive(planId, "plan", childrenMap, originInstanceId);
    }
  } catch (err) {
    logger.warn(`[planService.archive] Visual cascade failed, continuing:`, err);
  }
}

// If this plan has children, use cascading archive (existing domain logic)
const children = usePlanStore.getState().getChildren(planId);
// ... rest of existing archive method unchanged ...
```

### 4. Add `archive()`/`unarchive()`/`listArchived()` to folder service

**File: `src/entities/folders/service.ts`** (created by 02b)

After 02b creates the folder service with CRUD methods, add these archive methods. The file will already have imports for `appData`, `useFolderStore`, `FolderMetadataSchema`, `eventBus`, `EventName`, and `logger`.

Add this constant near the top:

```typescript
const ARCHIVE_FOLDERS_DIR = "archive/folders";
```

Add these methods to the folder service class/object:

```typescript
async archive(id: string): Promise<void> {
  const folder = this.get(id);
  if (!folder) return;

  const rollback = useFolderStore.getState()._applyDelete(id);
  try {
    const sourcePath = `folders/${id}`;
    const archivePath = `${ARCHIVE_FOLDERS_DIR}/${id}`;
    const metadata = await appData.readJson(`${sourcePath}/metadata.json`);

    await appData.ensureDir(ARCHIVE_FOLDERS_DIR);
    await appData.ensureDir(archivePath);
    if (metadata) await appData.writeJson(`${archivePath}/metadata.json`, metadata);
    await appData.removeDir(sourcePath);

    eventBus.emit(EventName.FOLDER_ARCHIVED, { folderId: id });
    logger.info(`[folderService.archive] Archived folder ${id}`);
  } catch (error) {
    rollback();
    throw error;
  }
}

async unarchive(id: string): Promise<void> {
  const archivePath = `${ARCHIVE_FOLDERS_DIR}/${id}`;
  const metadataPath = `${archivePath}/metadata.json`;

  const raw = await appData.readJson(metadataPath);
  const result = raw ? FolderMetadataSchema.safeParse(raw) : null;
  if (!result?.success) {
    logger.warn(`[folderService.unarchive] Folder ${id} not found in archive`);
    return;
  }

  const metadata = result.data;
  const destPath = `folders/${id}`;

  await appData.ensureDir(destPath);
  await appData.writeJson(`${destPath}/metadata.json`, metadata);
  await appData.removeDir(archivePath);

  useFolderStore.getState()._applyCreate(metadata);
  logger.info(`[folderService.unarchive] Unarchived folder ${id}`);
}

async listArchived(): Promise<FolderMetadata[]> {
  const pattern = `${ARCHIVE_FOLDERS_DIR}/*/metadata.json`;
  const files = await appData.glob(pattern);
  const folders: FolderMetadata[] = [];

  for (const filePath of files) {
    const raw = await appData.readJson(filePath);
    const result = raw ? FolderMetadataSchema.safeParse(raw) : null;
    if (result?.success) folders.push(result.data);
  }

  return folders;
}
```

### 5. Add `FOLDER_ARCHIVED` event

**File: `core/types/events.ts`**

Add to the `EventName` enum (near line 98, after `TERMINAL_ARCHIVED`):

```typescript
FOLDER_ARCHIVED: "folder:archived",
```

Add to the `EventPayloads` type (near line 260, after `TERMINAL_ARCHIVED` payload):

```typescript
[EventName.FOLDER_ARCHIVED]: { folderId: string };
```

### 6. Add `unarchive()` to plan and PR services

These methods do not exist today and are needed for `cascadeUnarchive()`.

**File: `src/entities/plans/service.ts`** — add to the `PlanService` class:

```typescript
/**
 * Unarchives a plan.
 * Moves metadata from archive/plans/{id} back to plans/{id}.
 * Note: the markdown file is NOT moved back from plans/completed/ automatically.
 */
async unarchive(planId: string): Promise<void> {
  const archivePath = `${ARCHIVE_PLANS_DIR}/${planId}`;
  const metadataPath = `${archivePath}/metadata.json`;

  const raw = await appData.readJson(metadataPath);
  const result = raw ? PlanMetadataSchema.safeParse(raw) : null;
  if (!result?.success) {
    logger.warn(`[planService:unarchive] Plan ${planId} not found in archive`);
    return;
  }

  const metadata = result.data;
  const destPath = `${PLANS_DIRECTORY}/${planId}`;

  await appData.ensureDir(destPath);
  await appData.writeJson(`${destPath}/metadata.json`, metadata);
  await appData.removeDir(archivePath);

  usePlanStore.getState()._applyCreate(metadata);
  eventBus.emit(EventName.PLAN_CREATED, { planId, repoId: metadata.repoId });
  logger.info(`[planService:unarchive] Unarchived plan ${planId}`);
}
```

**File: `src/entities/pull-requests/pr-details.ts`** — add new exported function:

```typescript
/**
 * Unarchive a PR entity.
 * Moves from archive directory back to active directory.
 */
export async function unarchivePr(id: string): Promise<void> {
  const archivePath = `${ARCHIVE_PR_DIR}/${id}`;
  const metadataPath = `${archivePath}/metadata.json`;

  const raw = await appData.readJson(metadataPath);
  const result = raw ? PullRequestMetadataSchema.safeParse(raw) : null;
  if (!result?.success) {
    logger.warn(`[pullRequestService.unarchive] PR ${id} not found in archive`);
    return;
  }

  const metadata = result.data;
  const destPath = `${PR_DIR}/${id}`;

  await appData.ensureDir(destPath);
  await appData.writeJson(`${destPath}/metadata.json`, metadata);
  await appData.removeDir(archivePath);

  usePullRequestStore.getState()._applyCreate(metadata);
  eventBus.emit(EventName.PR_CREATED, {
    prId: id,
    repoId: metadata.repoId,
    worktreeId: metadata.worktreeId,
  });
}
```

**File: `src/entities/pull-requests/pr-details.ts`** — update the import at top to include `unarchivePr` in exports.

**File: `src/entities/pull-requests/service.ts`** — add to the service object:

```typescript
/** Unarchive a PR entity. */
async unarchive(id: string): Promise<void> {
  const { unarchivePr } = await import("./pr-details");
  await unarchivePr(id);
},
```

## Scope — What Gets Cascade-Archived

| Archived node type | What visual descendants get archived |
|---|---|
| **Folder** | Everything inside: threads, plans, sub-folders, terminals, PRs whose `visualSettings.parentId` chains back to this folder |
| **Thread** | Visual children only (items user dragged/placed under thread in the tree). Domain children (sub-agents via `parentThreadId`) are already handled by existing `getDescendantThreadIds()`. |
| **Worktree** | Everything inside it (threads, plans, terminals, PRs, folders). Note: worktree archive is already handled by `main-window-layout.tsx` iterating all entities by `worktreeId` — the visual cascade supplements this. |
| **Plan** | Visual children only (items placed under plan in tree). Domain children (sub-plans via plan `parentId`) are already handled by existing `getDescendants()`. |
| **Terminal / PR** | These are leaf nodes — no visual children possible. No cascade needed. |

### Key Edge Case: Moved Items

If a sub-agent thread was moved out of its parent thread (i.e., its `visualSettings.parentId` was changed to something else), it will **not** be cascade-archived when the parent is archived. This is correct behavior — the user explicitly moved it, so it should be treated independently. `getVisualDescendants()` only walks `visualSettings.parentId`, so a moved item is excluded.

### Deduplication: Domain vs Visual Cascade

A thread might be both a domain child (via `parentThreadId`) and a visual child (via `visualSettings.parentId`). Both cascades might try to archive it. This is safe because:
1. `threadService.archive()` starts with `if (!thread) return;` / `this.get(threadId)` — if the store entry was already removed by the first cascade, the second is a no-op.
2. `_applyDelete()` is idempotent — calling it on a non-existent ID returns a no-op rollback.

## Acceptance Criteria

- [x] Archiving a folder archives all visual descendants (threads, plans, sub-folders, terminals, PRs inside it)
- [x] Archiving a worktree archives all items inside (via existing worktree archive flow + visual cascade)
- [x] Archiving a thread with sub-agents archives the sub-agents (both domain and visual descendants)
- [x] A sub-agent that was moved out of its parent (different `visualSettings.parentId`) is NOT archived when the parent is archived
- [x] Unarchive restores all descendants in correct positions (visualSettings.parentId preserved)
- [x] No infinite recursion between visual cascade and domain cascade (skipVisualCascade flag)

## Phases

- [x] Create `src/lib/cascade-archive.ts` with `getVisualDescendants()`, `buildCurrentChildrenMap()`, `cascadeArchive()`, `cascadeUnarchive()`
- [x] Add `archive()`/`unarchive()`/`listArchived()` to folder service (`src/entities/folders/service.ts`) and add `FOLDER_ARCHIVED` event to `core/types/events.ts`
- [x] Add `unarchive()` to plan service (`src/entities/plans/service.ts`) and PR service (`src/entities/pull-requests/service.ts` + `pr-details.ts`)
- [x] Wire cascade into `threadService.archive()` and `planService.archive()` with `skipVisualCascade` option
- [x] Test edge cases: moved items excluded, nested folders, empty folders, deduplication between domain and visual cascade

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---
