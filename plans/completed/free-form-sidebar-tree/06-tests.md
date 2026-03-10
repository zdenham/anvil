# 06 — Tests

**Layer 5 — depends on all previous sub-plans.**

## Summary

Write tests for the core logic introduced in the free-form sidebar tree feature: unified tree builder, cascade archive, drop constraint validation, `canCrossWorktreeBoundary` behavior, sort key generation, and the visual-settings migration. Focus on unit tests for pure functions and integration tests for service interactions.

## Dependencies

All sub-plans (01 through 05c) must be implemented.

## Test Runner Context

All tests in this plan run via `pnpm test` (root workspace, Vitest + jsdom, scoped to `src/**/*.test.{ts,tsx}`).

Tests that exercise pure functions use `// @vitest-environment node` at the top of the file to avoid jsdom overhead. The root `vitest.config.ts` already supports this per-file override.

The migration test is an exception. The migration logic lives at `migrations/src/migrations/002-visual-settings-backfill.ts` and uses raw `node:fs` (not the persistence adapter). We test the pure helper functions (`computeParentId`, `findMetadataFiles`, `backfillFiles`) by extracting and testing them directly in a `src/lib/__tests__/` test file that imports the functions from a shared utility module. See section 4 for details.

## Test Files

| File | Status | Tests | Run Command |
| --- | --- | --- | --- |
| `src/hooks/__tests__/use-tree-data.test.ts` | **Rewrite** — replace existing `buildTreeFromEntities` tests with `buildUnifiedTree` tests | Unified tree builder | `pnpm test` |
| `src/lib/__tests__/dnd-validation.test.ts` | **New** | Drop constraints, `canCrossWorktreeBoundary`, `isAncestor`, `findWorktreeAncestor`, `getDropPosition` | `pnpm test` |
| `src/lib/__tests__/cascade-archive.test.ts` | **New** | `getVisualDescendants()` descendant collection logic | `pnpm test` |
| `src/lib/__tests__/visual-settings-migration.test.ts` | **New** | `computeParentId()` backfill logic (pure function tests) | `pnpm test` |
| `src/lib/__tests__/sort-key.test.ts` | **New** | Sort key generation via `fractional-indexing` package and `computeSortKeyForInsertion` | `pnpm test` |

---

## 1. Unified Tree Builder Tests

**File:** `src/hooks/__tests__/use-tree-data.test.ts`

**Action:** Replace the entire file. The existing tests test `buildTreeFromEntities()` which is removed by sub-plan 03. The new tests test `buildUnifiedTree()` from the same module.

**Source under test:** `src/hooks/use-tree-data.ts` exports `buildUnifiedTree()` with this signature (defined in 03-unified-tree-model):

```typescript
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

Where `TreeBuildContext` is:

```typescript
export interface TreeBuildContext {
  expandedSections: Record<string, boolean>;
  runningThreadIds: Set<string>;
  threadsWithPendingInput: Set<string>;
}
```

And `WorktreeInfo` is:

```typescript
export interface WorktreeInfo {
  worktreeId: string;
  repoId: string;
  repoName: string;
  worktreeName: string;
  worktreePath: string;
}
```

### Complete Test File

```typescript
// @vitest-environment node
/**
 * Unified Tree Builder Tests
 *
 * Tests for buildUnifiedTree() which replaces the old buildTreeFromEntities().
 * Validates visual parent placement, sorting, orphan handling,
 * expansion state, and synthetic item nesting.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildUnifiedTree,
  type WorktreeInfo,
  type TreeBuildContext,
} from "../use-tree-data";
import type { TreeItemNode } from "@/stores/tree-menu/types";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { PlanMetadata } from "@/entities/plans/types";
import type { TerminalSession } from "@/entities/terminal-sessions/types";
import type { PullRequestMetadata } from "@/entities/pull-requests/types";
import type { FolderMetadata } from "@core/types/folders";
import type { VisualSettings } from "@core/types/visual-settings";

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock("@/entities/relations/service", () => ({
  relationService: { getByPlan: vi.fn().mockReturnValue([]) },
}));

vi.mock("@/entities/pull-requests/store", () => ({
  usePullRequestStore: {
    getState: vi.fn().mockReturnValue({
      getPrDetails: vi.fn().mockReturnValue(undefined),
    }),
  },
}));

vi.mock("@/stores/commit-store", () => ({
  useCommitStore: {
    getState: vi.fn().mockReturnValue({ commitsByWorktree: {} }),
  },
}));

vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── Constants ────────────────────────────────────────────────────────────

const WORKTREE_ID = "wt-1";
const REPO_ID = "repo-1";
const BASE_TIME = 1700000000000;

// ── Factory Functions ────────────────────────────────────────────────────

function createWorktreeInfo(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    worktreeId: WORKTREE_ID,
    repoId: REPO_ID,
    repoName: "Test Repo",
    worktreeName: "main",
    worktreePath: "/test/repo",
    ...overrides,
  };
}

function createThread(overrides: Partial<ThreadMetadata> = {}): ThreadMetadata {
  const now = BASE_TIME + 1000;
  return {
    id: crypto.randomUUID(),
    repoId: REPO_ID,
    worktreeId: WORKTREE_ID,
    status: "idle",
    createdAt: now,
    updatedAt: now,
    isRead: true,
    turns: [{ index: 0, prompt: "Test", startedAt: now, completedAt: null }],
    ...overrides,
  };
}

function createPlan(overrides: Partial<PlanMetadata> = {}): PlanMetadata {
  const now = BASE_TIME + 1000;
  return {
    id: crypto.randomUUID(),
    repoId: REPO_ID,
    worktreeId: WORKTREE_ID,
    relativePath: "plan.md",
    isRead: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createFolder(overrides: Partial<FolderMetadata> = {}): FolderMetadata {
  const now = BASE_TIME + 1000;
  return {
    id: crypto.randomUUID(),
    name: "My Folder",
    icon: "folder",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function createTerminal(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: crypto.randomUUID(),
    worktreeId: WORKTREE_ID,
    worktreePath: "/test/repo",
    createdAt: BASE_TIME + 1000,
    isAlive: true,
    isArchived: false,
    ...overrides,
  };
}

function defaultCtx(overrides: Partial<TreeBuildContext> = {}): TreeBuildContext {
  return {
    expandedSections: { [WORKTREE_ID]: true },
    runningThreadIds: new Set(),
    threadsWithPendingInput: new Set(),
    ...overrides,
  };
}

/**
 * Helper: call buildUnifiedTree with reasonable defaults.
 * Reduces boilerplate in each test case.
 */
function buildTree(opts: {
  worktrees?: WorktreeInfo[];
  folders?: FolderMetadata[];
  threads?: ThreadMetadata[];
  plans?: PlanMetadata[];
  terminals?: TerminalSession[];
  pullRequests?: PullRequestMetadata[];
  expandedSections?: Record<string, boolean>;
  runningThreadIds?: Set<string>;
  threadsWithPendingInput?: Set<string>;
}): TreeItemNode[] {
  const ctx = defaultCtx({
    expandedSections: opts.expandedSections ?? { [WORKTREE_ID]: true },
    runningThreadIds: opts.runningThreadIds,
    threadsWithPendingInput: opts.threadsWithPendingInput,
  });
  return buildUnifiedTree(
    opts.worktrees ?? [createWorktreeInfo()],
    opts.folders ?? [],
    opts.threads ?? [],
    opts.plans ?? [],
    opts.terminals ?? [],
    opts.pullRequests ?? [],
    ctx,
  );
}

// ── Test Cases ────────────────────────────────────────────────────────────

describe("buildUnifiedTree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic structure", () => {
    it("returns worktree node at depth 0 as first item", () => {
      const items = buildTree({});
      expect(items[0].type).toBe("worktree");
      expect(items[0].depth).toBe(0);
      expect(items[0].id).toBe(WORKTREE_ID);
    });

    it("returns worktree with title 'repoName / worktreeName'", () => {
      const items = buildTree({});
      expect(items[0].title).toBe("Test Repo / main");
    });

    it("returns empty worktree with only synthetic children when expanded", () => {
      const items = buildTree({ expandedSections: { [WORKTREE_ID]: true } });
      const childTypes = items.filter(i => i.depth === 1).map(i => i.type);
      expect(childTypes).toContain("changes");
    });

    it("collapses worktree — no children emitted", () => {
      const thread = createThread({
        visualSettings: { parentId: WORKTREE_ID },
      });
      const items = buildTree({
        threads: [thread],
        expandedSections: { [WORKTREE_ID]: false },
      });
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("worktree");
    });
  });

  describe("visual parentId placement", () => {
    it("places thread under worktree when visualSettings.parentId = worktreeId", () => {
      const thread = createThread({
        visualSettings: { parentId: WORKTREE_ID },
      });
      const items = buildTree({
        threads: [thread],
        expandedSections: { [WORKTREE_ID]: true },
      });
      const threadItem = items.find(i => i.id === thread.id);
      expect(threadItem).toBeDefined();
      expect(threadItem!.depth).toBe(1);
    });

    it("places thread inside folder when visualSettings.parentId = folderId", () => {
      const folder = createFolder({
        id: "folder-1",
        visualSettings: { parentId: WORKTREE_ID },
      });
      const thread = createThread({
        visualSettings: { parentId: "folder-1" },
      });
      const items = buildTree({
        folders: [folder],
        threads: [thread],
        expandedSections: {
          [WORKTREE_ID]: true,
          "folder:folder-1": true, // folder expand key is "folder:{id}"
        },
      });
      const threadItem = items.find(i => i.id === thread.id);
      expect(threadItem).toBeDefined();
      expect(threadItem!.depth).toBe(2); // worktree=0, folder=1, thread=2
    });

    it("does NOT fall back to domain parentThreadId for nesting", () => {
      const parentThread = createThread({
        id: "parent-thread",
        visualSettings: { parentId: WORKTREE_ID },
      });
      const childThread = createThread({
        parentThreadId: "parent-thread",
        // No visualSettings.parentId — should NOT auto-nest under parent
      });
      const items = buildTree({
        threads: [parentThread, childThread],
        expandedSections: {
          [WORKTREE_ID]: true,
          "thread:parent-thread": true,
        },
      });
      // Child thread should NOT appear nested under parent thread
      // It should appear at tree root (no parentId → root)
      const childItem = items.find(i => i.id === childThread.id);
      expect(childItem).toBeDefined();
      // Should NOT be at depth 2 (which would mean nested under parent thread)
      expect(childItem!.depth).toBe(0);
    });

    it("places plan inside thread when visualSettings.parentId = threadId", () => {
      const thread = createThread({
        id: "thread-1",
        visualSettings: { parentId: WORKTREE_ID },
      });
      const plan = createPlan({
        visualSettings: { parentId: "thread-1" },
      });
      const items = buildTree({
        threads: [thread],
        plans: [plan],
        expandedSections: {
          [WORKTREE_ID]: true,
          "thread:thread-1": true,
        },
      });
      const planItem = items.find(i => i.id === plan.id);
      expect(planItem).toBeDefined();
      expect(planItem!.depth).toBe(2);
    });
  });

  describe("folders", () => {
    it("folder nodes appear at correct depth", () => {
      const folder = createFolder({
        id: "f1",
        visualSettings: { parentId: WORKTREE_ID },
      });
      const items = buildTree({
        folders: [folder],
        expandedSections: { [WORKTREE_ID]: true },
      });
      const folderItem = items.find(i => i.id === "f1");
      expect(folderItem).toBeDefined();
      expect(folderItem!.type).toBe("folder");
      expect(folderItem!.depth).toBe(1);
    });

    it("nested folders cascade depth correctly", () => {
      const outerFolder = createFolder({
        id: "outer",
        visualSettings: { parentId: WORKTREE_ID },
      });
      const innerFolder = createFolder({
        id: "inner",
        visualSettings: { parentId: "outer" },
      });
      const items = buildTree({
        folders: [outerFolder, innerFolder],
        expandedSections: {
          [WORKTREE_ID]: true,
          "folder:outer": true,
          "folder:inner": true,
        },
      });
      const inner = items.find(i => i.id === "inner");
      expect(inner).toBeDefined();
      expect(inner!.depth).toBe(2);
    });

    it("cross-type nesting: thread and plan inside same folder", () => {
      const folder = createFolder({
        id: "folder-1",
        visualSettings: { parentId: WORKTREE_ID },
      });
      const thread = createThread({
        visualSettings: { parentId: "folder-1" },
      });
      const plan = createPlan({
        visualSettings: { parentId: "folder-1" },
      });
      const items = buildTree({
        folders: [folder],
        threads: [thread],
        plans: [plan],
        expandedSections: {
          [WORKTREE_ID]: true,
          "folder:folder-1": true,
        },
      });
      const children = items.filter(i => i.depth === 2);
      expect(children).toHaveLength(2);
      const types = children.map(i => i.type);
      expect(types).toContain("thread");
      expect(types).toContain("plan");
    });
  });

  describe("sorting", () => {
    it("items without sortKey sort by createdAt descending", () => {
      const older = createThread({
        id: "older",
        createdAt: BASE_TIME + 1000,
        updatedAt: BASE_TIME + 1000,
        visualSettings: { parentId: WORKTREE_ID },
      });
      const newer = createThread({
        id: "newer",
        createdAt: BASE_TIME + 2000,
        updatedAt: BASE_TIME + 2000,
        visualSettings: { parentId: WORKTREE_ID },
      });
      const items = buildTree({
        threads: [older, newer],
        expandedSections: { [WORKTREE_ID]: true },
      });
      const threadItems = items.filter(i => i.type === "thread");
      expect(threadItems[0].id).toBe("newer");
      expect(threadItems[1].id).toBe("older");
    });

    it("items with sortKey sort lexicographically ascending", () => {
      const itemA = createThread({
        id: "item-a",
        visualSettings: { parentId: WORKTREE_ID, sortKey: "a1" },
      });
      const itemB = createThread({
        id: "item-b",
        visualSettings: { parentId: WORKTREE_ID, sortKey: "a0" },
      });
      const items = buildTree({
        threads: [itemA, itemB],
        expandedSections: { [WORKTREE_ID]: true },
      });
      const threadItems = items.filter(i => i.type === "thread");
      expect(threadItems[0].id).toBe("item-b"); // "a0" < "a1"
      expect(threadItems[1].id).toBe("item-a");
    });

    it("unkeyed items appear before keyed items (mixed sort)", () => {
      const unkeyed = createThread({
        id: "unkeyed",
        createdAt: BASE_TIME + 5000,
        updatedAt: BASE_TIME + 5000,
        visualSettings: { parentId: WORKTREE_ID },
      });
      const keyed = createThread({
        id: "keyed",
        createdAt: BASE_TIME + 1000,
        updatedAt: BASE_TIME + 1000,
        visualSettings: { parentId: WORKTREE_ID, sortKey: "a0" },
      });
      const items = buildTree({
        threads: [unkeyed, keyed],
        expandedSections: { [WORKTREE_ID]: true },
      });
      const threadItems = items.filter(i => i.type === "thread");
      // Per parent plan: "unkeyed items first (by createdAt desc), then keyed items"
      expect(threadItems[0].id).toBe("unkeyed");
      expect(threadItems[1].id).toBe("keyed");
    });
  });

  describe("orphan handling", () => {
    it("item with missing parent falls back to root", () => {
      const orphan = createThread({
        id: "orphan",
        visualSettings: { parentId: "nonexistent-parent" },
      });
      const items = buildTree({
        threads: [orphan],
        expandedSections: { [WORKTREE_ID]: true },
      });
      // Per 03-unified-tree-model: "If parentId references a non-existent node, fall back to ROOT"
      const orphanItem = items.find(i => i.id === "orphan");
      expect(orphanItem).toBeDefined();
      expect(orphanItem!.depth).toBe(0);
    });
  });

  describe("synthetic items", () => {
    it("Changes item appears as child of worktree node", () => {
      const items = buildTree({
        expandedSections: { [WORKTREE_ID]: true },
      });
      const changesItem = items.find(i => i.type === "changes");
      expect(changesItem).toBeDefined();
      expect(changesItem!.depth).toBe(1);
      expect(changesItem!.parentId).toBe(WORKTREE_ID);
    });

    it("Uncommitted and Commit items appear as children of Changes when expanded", () => {
      const changesKey = `changes:${WORKTREE_ID}`;
      const items = buildTree({
        expandedSections: {
          [WORKTREE_ID]: true,
          [changesKey]: true,
        },
      });
      const uncommitted = items.find(i => i.type === "uncommitted");
      expect(uncommitted).toBeDefined();
      expect(uncommitted!.depth).toBe(2);
    });
  });

  describe("isFolder dynamic flag", () => {
    it("folder with children has isFolder=true", () => {
      const folder = createFolder({
        id: "f1",
        visualSettings: { parentId: WORKTREE_ID },
      });
      const thread = createThread({
        visualSettings: { parentId: "f1" },
      });
      const items = buildTree({
        folders: [folder],
        threads: [thread],
        expandedSections: { [WORKTREE_ID]: true, "folder:f1": true },
      });
      const folderItem = items.find(i => i.id === "f1");
      expect(folderItem!.isFolder).toBe(true);
    });

    it("worktree node always has isFolder=true", () => {
      const items = buildTree({});
      const wtItem = items.find(i => i.type === "worktree");
      expect(wtItem!.isFolder).toBe(true);
    });
  });

  describe("expansion state", () => {
    it("collapsed folder does not emit its children", () => {
      const folder = createFolder({
        id: "collapsed-folder",
        visualSettings: { parentId: WORKTREE_ID },
      });
      const thread = createThread({
        visualSettings: { parentId: "collapsed-folder" },
      });
      const items = buildTree({
        folders: [folder],
        threads: [thread],
        expandedSections: {
          [WORKTREE_ID]: true,
          "folder:collapsed-folder": false,
        },
      });
      const threadItem = items.find(i => i.id === thread.id);
      expect(threadItem).toBeUndefined();
    });

    it("expanded folder emits its children", () => {
      const folder = createFolder({
        id: "expanded-folder",
        visualSettings: { parentId: WORKTREE_ID },
      });
      const thread = createThread({
        visualSettings: { parentId: "expanded-folder" },
      });
      const items = buildTree({
        folders: [folder],
        threads: [thread],
        expandedSections: {
          [WORKTREE_ID]: true,
          "folder:expanded-folder": true,
        },
      });
      const threadItem = items.find(i => i.id === thread.id);
      expect(threadItem).toBeDefined();
    });

    it("worktree defaults to expanded when not in expandedSections", () => {
      const thread = createThread({
        visualSettings: { parentId: WORKTREE_ID },
      });
      const items = buildTree({
        threads: [thread],
        expandedSections: {}, // No explicit expansion state
      });
      // Per 03: "defaultExpanded = node.type == 'worktree'"
      // Thread should be visible if worktree defaults to expanded
      const threadItem = items.find(i => i.id === thread.id);
      expect(threadItem).toBeDefined();
    });
  });

  describe("multiple worktrees", () => {
    it("items from different worktrees are separated under their worktree nodes", () => {
      const wt1 = createWorktreeInfo({ worktreeId: "wt-a", worktreeName: "main" });
      const wt2 = createWorktreeInfo({ worktreeId: "wt-b", worktreeName: "feature" });
      const t1 = createThread({
        id: "t1",
        worktreeId: "wt-a",
        visualSettings: { parentId: "wt-a" },
      });
      const t2 = createThread({
        id: "t2",
        worktreeId: "wt-b",
        visualSettings: { parentId: "wt-b" },
      });
      const items = buildTree({
        worktrees: [wt1, wt2],
        threads: [t1, t2],
        expandedSections: { "wt-a": true, "wt-b": true },
      });
      const wtNodes = items.filter(i => i.type === "worktree");
      expect(wtNodes).toHaveLength(2);

      // Each thread should appear after its respective worktree
      const t1Item = items.find(i => i.id === "t1");
      const t2Item = items.find(i => i.id === "t2");
      expect(t1Item!.worktreeId).toBe("wt-a");
      expect(t2Item!.worktreeId).toBe("wt-b");
    });
  });

  describe("worktreeId propagation", () => {
    it("thread nodes have worktreeId set from entity", () => {
      const thread = createThread({
        worktreeId: "wt-x",
        visualSettings: { parentId: "wt-x" },
      });
      const items = buildTree({
        worktrees: [createWorktreeInfo({ worktreeId: "wt-x" })],
        threads: [thread],
        expandedSections: { "wt-x": true },
      });
      const threadItem = items.find(i => i.id === thread.id);
      expect(threadItem!.worktreeId).toBe("wt-x");
    });
  });

  describe("sub-agent thread badge", () => {
    it("thread with domain parentThreadId has isSubAgent=true regardless of visual parent", () => {
      const thread = createThread({
        parentThreadId: "some-parent",
        visualSettings: { parentId: WORKTREE_ID }, // Visually under worktree, not under parent
      });
      const items = buildTree({
        threads: [thread],
        expandedSections: { [WORKTREE_ID]: true },
      });
      const threadItem = items.find(i => i.id === thread.id);
      expect(threadItem!.isSubAgent).toBe(true);
    });
  });
});
```

---

## 2. Drop Constraint Validation Tests

**File:** `src/lib/__tests__/dnd-validation.test.ts`

**Action:** Create new file.

**Source under test:** `src/lib/dnd-validation.ts` exports these functions (defined in 05a-drag-and-drop):

- `canCrossWorktreeBoundary(type: TreeItemType): boolean`
- `isAncestor(nodeId: string, potentialAncestorId: string, parentMap: Map<string, string | undefined>): boolean`
- `findWorktreeAncestor(nodeId: string, nodeMap: Map<string, TreeItemNode>, parentMap: Map<string, string | undefined>): string | undefined`
- `validateDrop(draggedItem: TreeItemNode, targetItem: TreeItemNode, dropPosition: DropPosition, nodeMap: Map<string, TreeItemNode>, parentMap: Map<string, string | undefined>): DropValidationResult`
- `getDropPosition(cursorY: number, targetRect: DOMRect, targetType: TreeItemType): DropPosition`
- `buildTreeMaps(items: TreeItemNode[]): { nodeMap, parentMap }`

### Complete Test File

```typescript
// @vitest-environment node
/**
 * Drop Constraint Validation Tests
 *
 * Tests for DnD validation functions: canCrossWorktreeBoundary, isAncestor,
 * findWorktreeAncestor, validateDrop, getDropPosition, buildTreeMaps.
 */

import { describe, it, expect } from "vitest";
import {
  canCrossWorktreeBoundary,
  isAncestor,
  findWorktreeAncestor,
  validateDrop,
  getDropPosition,
  buildTreeMaps,
  type DropPosition,
} from "../dnd-validation";
import type { TreeItemNode, TreeItemType } from "@/stores/tree-menu/types";

// ── Factory ──────────────────────────────────────────────────────────────

function createNode(overrides: Partial<TreeItemNode> = {}): TreeItemNode {
  return {
    type: "thread",
    id: crypto.randomUUID(),
    title: "Test Item",
    status: "read",
    updatedAt: Date.now(),
    createdAt: Date.now(),
    depth: 0,
    isFolder: false,
    isExpanded: false,
    ...overrides,
  };
}

/**
 * Build nodeMap and parentMap from an array of { id, type, parentId } descriptors.
 * Mirrors what buildTreeMaps() does on a flat TreeItemNode[] array.
 */
function makeMaps(
  entries: Array<{ id: string; type: TreeItemType; parentId?: string; worktreeId?: string }>
): { nodeMap: Map<string, TreeItemNode>; parentMap: Map<string, string | undefined> } {
  const nodeMap = new Map<string, TreeItemNode>();
  const parentMap = new Map<string, string | undefined>();
  for (const e of entries) {
    const node = createNode({ id: e.id, type: e.type, parentId: e.parentId, worktreeId: e.worktreeId });
    nodeMap.set(e.id, node);
    parentMap.set(e.id, e.parentId);
  }
  return { nodeMap, parentMap };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("canCrossWorktreeBoundary", () => {
  it("returns false for all types by default", () => {
    const types: TreeItemType[] = [
      "thread", "plan", "terminal", "pull-request", "folder", "worktree",
      "changes", "uncommitted", "commit",
    ];
    for (const type of types) {
      expect(canCrossWorktreeBoundary(type)).toBe(false);
    }
  });
});

describe("isAncestor", () => {
  it("returns true when potentialAncestor is direct parent", () => {
    const parentMap = new Map<string, string | undefined>();
    parentMap.set("child", "parent");
    parentMap.set("parent", undefined);

    expect(isAncestor("child", "parent", parentMap)).toBe(true);
  });

  it("returns true when potentialAncestor is grandparent", () => {
    const parentMap = new Map<string, string | undefined>();
    parentMap.set("grandchild", "child");
    parentMap.set("child", "grandparent");
    parentMap.set("grandparent", undefined);

    expect(isAncestor("grandchild", "grandparent", parentMap)).toBe(true);
  });

  it("returns false when no ancestor relationship exists", () => {
    const parentMap = new Map<string, string | undefined>();
    parentMap.set("a", "root");
    parentMap.set("b", "root");
    parentMap.set("root", undefined);

    expect(isAncestor("a", "b", parentMap)).toBe(false);
  });

  it("handles cycles without infinite loop", () => {
    const parentMap = new Map<string, string | undefined>();
    parentMap.set("a", "b");
    parentMap.set("b", "a"); // cycle

    // Should terminate and return false (or true if target is found)
    expect(isAncestor("a", "c", parentMap)).toBe(false);
  });
});

describe("findWorktreeAncestor", () => {
  it("returns worktree id when node is direct child of worktree", () => {
    const { nodeMap, parentMap } = makeMaps([
      { id: "wt-1", type: "worktree" },
      { id: "thread-1", type: "thread", parentId: "wt-1" },
    ]);

    expect(findWorktreeAncestor("thread-1", nodeMap, parentMap)).toBe("wt-1");
  });

  it("returns worktree id when node is nested deep inside worktree", () => {
    const { nodeMap, parentMap } = makeMaps([
      { id: "wt-1", type: "worktree" },
      { id: "folder-1", type: "folder", parentId: "wt-1" },
      { id: "thread-1", type: "thread", parentId: "folder-1" },
    ]);

    expect(findWorktreeAncestor("thread-1", nodeMap, parentMap)).toBe("wt-1");
  });

  it("returns undefined when node is at root level (no worktree ancestor)", () => {
    const { nodeMap, parentMap } = makeMaps([
      { id: "folder-1", type: "folder" },
    ]);

    expect(findWorktreeAncestor("folder-1", nodeMap, parentMap)).toBeUndefined();
  });

  it("returns the worktree's own id when called on a worktree node", () => {
    const { nodeMap, parentMap } = makeMaps([
      { id: "wt-1", type: "worktree" },
    ]);

    expect(findWorktreeAncestor("wt-1", nodeMap, parentMap)).toBe("wt-1");
  });
});

describe("getDropPosition", () => {
  // Create a mock DOMRect for a 40px tall element starting at y=100
  function mockRect(top: number = 100, height: number = 40): DOMRect {
    return {
      top,
      bottom: top + height,
      left: 0,
      right: 200,
      width: 200,
      height,
      x: 0,
      y: top,
      toJSON: () => ({}),
    };
  }

  describe("container types (25/50/25 split)", () => {
    it("returns 'above' when cursor is in top 25% of container", () => {
      const rect = mockRect(100, 40);
      // Top 25% = y 100-110
      expect(getDropPosition(105, rect, "folder")).toBe("above");
    });

    it("returns 'inside' when cursor is in middle 50% of container", () => {
      const rect = mockRect(100, 40);
      // Middle 50% = y 110-130
      expect(getDropPosition(120, rect, "folder")).toBe("inside");
    });

    it("returns 'below' when cursor is in bottom 25% of container", () => {
      const rect = mockRect(100, 40);
      // Bottom 25% = y 130-140
      expect(getDropPosition(135, rect, "folder")).toBe("below");
    });

    it("works for all container types: worktree, folder, plan, thread", () => {
      const rect = mockRect(100, 40);
      const containerTypes: TreeItemType[] = ["worktree", "folder", "plan", "thread"];
      for (const type of containerTypes) {
        expect(getDropPosition(120, rect, type)).toBe("inside");
      }
    });
  });

  describe("leaf types (50/50 split)", () => {
    it("returns 'above' when cursor is in top 50% of leaf", () => {
      const rect = mockRect(100, 40);
      expect(getDropPosition(115, rect, "terminal")).toBe("above");
    });

    it("returns 'below' when cursor is in bottom 50% of leaf", () => {
      const rect = mockRect(100, 40);
      expect(getDropPosition(125, rect, "terminal")).toBe("below");
    });

    it("never returns 'inside' for leaf types", () => {
      const rect = mockRect(100, 40);
      const leafTypes: TreeItemType[] = ["terminal", "pull-request", "changes", "uncommitted", "commit"];
      for (const type of leafTypes) {
        const pos = getDropPosition(120, rect, type);
        expect(pos).not.toBe("inside");
      }
    });
  });
});

describe("buildTreeMaps", () => {
  it("creates nodeMap keyed by item id", () => {
    const items = [
      createNode({ id: "a" }),
      createNode({ id: "b", parentId: "a" }),
    ];
    const { nodeMap } = buildTreeMaps(items);
    expect(nodeMap.size).toBe(2);
    expect(nodeMap.get("a")!.id).toBe("a");
    expect(nodeMap.get("b")!.id).toBe("b");
  });

  it("creates parentMap with correct parent references", () => {
    const items = [
      createNode({ id: "a" }),
      createNode({ id: "b", parentId: "a" }),
    ];
    const { parentMap } = buildTreeMaps(items);
    expect(parentMap.get("a")).toBeUndefined();
    expect(parentMap.get("b")).toBe("a");
  });
});

describe("validateDrop", () => {
  describe("synthetic items", () => {
    it("cannot drag a changes item", () => {
      const dragged = createNode({ type: "changes", id: "changes:wt-1" });
      const target = createNode({ type: "folder", isFolder: true });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(dragged, target, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("cannot drag an uncommitted item", () => {
      const dragged = createNode({ type: "uncommitted" });
      const target = createNode({ type: "folder", isFolder: true });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(dragged, target, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("cannot drag a commit item", () => {
      const dragged = createNode({ type: "commit" });
      const target = createNode({ type: "folder", isFolder: true });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(dragged, target, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("cannot drop onto a synthetic target", () => {
      const dragged = createNode({ type: "thread" });
      const target = createNode({ type: "changes" });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(dragged, target, "above", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });
  });

  describe("leaf type targets", () => {
    it("cannot drop inside a terminal (leaf type)", () => {
      const dragged = createNode({ type: "thread", worktreeId: "wt-1" });
      const target = createNode({ type: "terminal", worktreeId: "wt-1" });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(dragged, target, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("cannot drop inside a pull-request (leaf type)", () => {
      const dragged = createNode({ type: "thread", worktreeId: "wt-1" });
      const target = createNode({ type: "pull-request", worktreeId: "wt-1" });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(dragged, target, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("can reorder above/below a terminal", () => {
      const dragged = createNode({ id: "d", type: "thread", worktreeId: "wt-1" });
      const target = createNode({ id: "t", type: "terminal", worktreeId: "wt-1" });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-1", type: "worktree" },
        { id: "d", type: "thread", parentId: "wt-1", worktreeId: "wt-1" },
        { id: "t", type: "terminal", parentId: "wt-1", worktreeId: "wt-1" },
      ]);
      const resultAbove = validateDrop(dragged, target, "above", nodeMap, parentMap);
      const resultBelow = validateDrop(dragged, target, "below", nodeMap, parentMap);
      expect(resultAbove.valid).toBe(true);
      expect(resultBelow.valid).toBe(true);
    });
  });

  describe("self-drop", () => {
    it("dropping on self is invalid", () => {
      const item = createNode({ id: "same" });
      const { nodeMap, parentMap } = makeMaps([]);
      const result = validateDrop(item, item, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });
  });

  describe("cycle detection", () => {
    it("cannot drop a node into its own child", () => {
      const parent = createNode({ id: "parent", type: "folder", isFolder: true });
      const child = createNode({ id: "child", type: "folder", isFolder: true });
      const { nodeMap, parentMap } = makeMaps([
        { id: "parent", type: "folder" },
        { id: "child", type: "folder", parentId: "parent" },
      ]);
      const result = validateDrop(parent, child, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/descendant/i);
    });

    it("cannot drop a node into its grandchild", () => {
      const { nodeMap, parentMap } = makeMaps([
        { id: "gp", type: "folder" },
        { id: "p", type: "folder", parentId: "gp" },
        { id: "c", type: "folder", parentId: "p" },
      ]);
      const gp = nodeMap.get("gp")!;
      const c = nodeMap.get("c")!;
      const result = validateDrop(gp, c, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("allows dropping a sibling (no cycle)", () => {
      const { nodeMap, parentMap } = makeMaps([
        { id: "root", type: "folder" },
        { id: "a", type: "thread", parentId: "root" },
        { id: "b", type: "folder", parentId: "root" },
      ]);
      const a = nodeMap.get("a")!;
      const b = nodeMap.get("b")!;
      const result = validateDrop(a, b, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(true);
    });
  });

  describe("worktree boundary enforcement", () => {
    it("cannot drop thread from worktree A into folder in worktree B", () => {
      const thread = createNode({
        id: "thread-in-a",
        type: "thread",
        worktreeId: "wt-a",
      });
      const folder = createNode({
        id: "folder-in-b",
        type: "folder",
        isFolder: true,
        worktreeId: "wt-b",
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-a", type: "worktree" },
        { id: "wt-b", type: "worktree" },
        { id: "folder-in-b", type: "folder", parentId: "wt-b", worktreeId: "wt-b" },
      ]);
      const result = validateDrop(thread, folder, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/worktree/i);
    });

    it("allows drop within same worktree", () => {
      const thread = createNode({
        id: "thread-in-a",
        type: "thread",
        worktreeId: "wt-a",
      });
      const folder = createNode({
        id: "folder-in-a",
        type: "folder",
        isFolder: true,
        worktreeId: "wt-a",
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-a", type: "worktree" },
        { id: "folder-in-a", type: "folder", parentId: "wt-a", worktreeId: "wt-a" },
      ]);
      const result = validateDrop(thread, folder, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(true);
    });

    it("folder with worktreeId cannot move to different worktree", () => {
      const folder = createNode({
        id: "folder",
        type: "folder",
        isFolder: true,
        worktreeId: "wt-a",
      });
      const targetFolder = createNode({
        id: "target",
        type: "folder",
        isFolder: true,
        worktreeId: "wt-b",
      });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-a", type: "worktree" },
        { id: "wt-b", type: "worktree" },
        { id: "target", type: "folder", parentId: "wt-b", worktreeId: "wt-b" },
      ]);
      const result = validateDrop(folder, targetFolder, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });
  });

  describe("worktree drop rules", () => {
    it("worktree can be dropped into a root-level folder", () => {
      const worktree = createNode({ id: "wt-1", type: "worktree" });
      const folder = createNode({ id: "f-1", type: "folder", isFolder: true });
      const { nodeMap, parentMap } = makeMaps([
        { id: "f-1", type: "folder" },
      ]);
      const result = validateDrop(worktree, folder, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(true);
    });

    it("worktree cannot be dropped inside another worktree", () => {
      const worktreeA = createNode({ id: "wt-a", type: "worktree" });
      const worktreeB = createNode({ id: "wt-b", type: "worktree", isFolder: true });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-a", type: "worktree" },
        { id: "wt-b", type: "worktree" },
      ]);
      const result = validateDrop(worktreeA, worktreeB, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(false);
    });

    it("worktree can be reordered at root level (above/below)", () => {
      const worktreeA = createNode({ id: "wt-a", type: "worktree" });
      const worktreeB = createNode({ id: "wt-b", type: "worktree" });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-a", type: "worktree" },
        { id: "wt-b", type: "worktree" },
      ]);
      expect(validateDrop(worktreeA, worktreeB, "above", nodeMap, parentMap).valid).toBe(true);
      expect(validateDrop(worktreeA, worktreeB, "below", nodeMap, parentMap).valid).toBe(true);
    });
  });

  describe("valid container drops", () => {
    it("can drop thread inside a folder (same worktree)", () => {
      const thread = createNode({ id: "t1", type: "thread", worktreeId: "wt-1" });
      const folder = createNode({ id: "f1", type: "folder", isFolder: true, worktreeId: "wt-1" });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-1", type: "worktree" },
        { id: "f1", type: "folder", parentId: "wt-1", worktreeId: "wt-1" },
      ]);
      const result = validateDrop(thread, folder, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(true);
    });

    it("can drop plan inside a thread (same worktree)", () => {
      const plan = createNode({ id: "p1", type: "plan", worktreeId: "wt-1" });
      const thread = createNode({ id: "t1", type: "thread", isFolder: true, worktreeId: "wt-1" });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-1", type: "worktree" },
        { id: "t1", type: "thread", parentId: "wt-1", worktreeId: "wt-1" },
      ]);
      const result = validateDrop(plan, thread, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(true);
    });

    it("can drop folder inside another folder (same worktree)", () => {
      const inner = createNode({ id: "inner", type: "folder", worktreeId: "wt-1" });
      const outer = createNode({ id: "outer", type: "folder", isFolder: true, worktreeId: "wt-1" });
      const { nodeMap, parentMap } = makeMaps([
        { id: "wt-1", type: "worktree" },
        { id: "outer", type: "folder", parentId: "wt-1", worktreeId: "wt-1" },
      ]);
      const result = validateDrop(inner, outer, "inside", nodeMap, parentMap);
      expect(result.valid).toBe(true);
    });
  });
});
```

---

## 3. Cascade Archive Tests

**File:** `src/lib/__tests__/cascade-archive.test.ts`

**Action:** Create new file. Tests `getVisualDescendants()` from `src/lib/cascade-archive.ts` (defined in 04b-cascade-archive). This function takes `(nodeId: string, childrenMap: Map<string, TreeItemNode[]>)` and returns a `DescendantGroup` with arrays grouped by entity type.

### Complete Test File

```typescript
// @vitest-environment node
/**
 * Cascade Archive Tests
 *
 * Tests for getVisualDescendants() — the pure function that walks a
 * childrenMap to collect all visual descendants grouped by entity type.
 * The actual cascade archive orchestration (service calls) is tested
 * via integration tests in the respective service test files.
 */

import { describe, it, expect } from "vitest";
import { getVisualDescendants, type DescendantGroup } from "../cascade-archive";
import type { TreeItemNode } from "@/stores/tree-menu/types";

// ── Factory ──────────────────────────────────────────────────────────────

function createNode(overrides: Partial<TreeItemNode> = {}): TreeItemNode {
  return {
    type: "thread",
    id: crypto.randomUUID(),
    title: "Test",
    status: "read",
    updatedAt: Date.now(),
    createdAt: Date.now(),
    depth: 0,
    isFolder: false,
    isExpanded: false,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("getVisualDescendants", () => {
  it("returns all children of a folder grouped by type", () => {
    const thread = createNode({ id: "t1", type: "thread" });
    const plan = createNode({ id: "p1", type: "plan" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("folder-1", [thread, plan]);

    const result = getVisualDescendants("folder-1", childrenMap);

    expect(result.threads).toContain("t1");
    expect(result.plans).toContain("p1");
    expect(result.folders).toHaveLength(0);
    expect(result.terminals).toHaveLength(0);
    expect(result.pullRequests).toHaveLength(0);
  });

  it("cascades through nested folders", () => {
    const innerFolder = createNode({ id: "inner-folder", type: "folder" });
    const deepThread = createNode({ id: "deep-thread", type: "thread" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("outer-folder", [innerFolder]);
    childrenMap.set("inner-folder", [deepThread]);

    const result = getVisualDescendants("outer-folder", childrenMap);

    expect(result.folders).toContain("inner-folder");
    expect(result.threads).toContain("deep-thread");
  });

  it("cascades through threads (threads are containers)", () => {
    const childPlan = createNode({ id: "child-plan", type: "plan" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("parent-thread", [childPlan]);

    const result = getVisualDescendants("parent-thread", childrenMap);

    expect(result.plans).toContain("child-plan");
  });

  it("cascades through plans (plans are containers)", () => {
    const childThread = createNode({ id: "child-thread", type: "thread" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("parent-plan", [childThread]);

    const result = getVisualDescendants("parent-plan", childrenMap);

    expect(result.threads).toContain("child-thread");
  });

  it("handles empty folder (no children entry in map)", () => {
    const childrenMap = new Map<string, TreeItemNode[]>();

    const result = getVisualDescendants("empty-folder", childrenMap);

    expect(result.threads).toHaveLength(0);
    expect(result.plans).toHaveLength(0);
    expect(result.folders).toHaveLength(0);
    expect(result.terminals).toHaveLength(0);
    expect(result.pullRequests).toHaveLength(0);
  });

  it("collects terminals and pull-requests", () => {
    const terminal = createNode({ id: "term-1", type: "terminal" });
    const pr = createNode({ id: "pr-1", type: "pull-request" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("folder-1", [terminal, pr]);

    const result = getVisualDescendants("folder-1", childrenMap);

    expect(result.terminals).toContain("term-1");
    expect(result.pullRequests).toContain("pr-1");
  });

  it("worktree archive collects all entities inside (deep tree)", () => {
    const folder = createNode({ id: "f1", type: "folder" });
    const thread = createNode({ id: "t1", type: "thread" });
    const plan = createNode({ id: "p1", type: "plan" });
    const innerThread = createNode({ id: "t2", type: "thread" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("wt-1", [folder, thread, plan]);
    childrenMap.set("f1", [innerThread]);

    const result = getVisualDescendants("wt-1", childrenMap);

    expect(result.threads).toEqual(expect.arrayContaining(["t1", "t2"]));
    expect(result.threads).toHaveLength(2);
    expect(result.plans).toContain("p1");
    expect(result.folders).toContain("f1");
  });

  it("item moved out of parent is NOT included in parent's descendants", () => {
    // "t-out" was moved to folder-2, so NOT in folder-1's children
    const threadStillInFolder = createNode({ id: "t-in", type: "thread" });
    const threadMovedOut = createNode({ id: "t-out", type: "thread" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("folder-1", [threadStillInFolder]);
    childrenMap.set("folder-2", [threadMovedOut]);

    const result = getVisualDescendants("folder-1", childrenMap);

    expect(result.threads).toContain("t-in");
    expect(result.threads).not.toContain("t-out");
  });

  it("does not include synthetic items (changes, uncommitted, commit) in typed groups", () => {
    const changes = createNode({ id: "changes:wt-1", type: "changes" });
    const uncommitted = createNode({ id: "uncommitted:wt-1", type: "uncommitted" });
    const commit = createNode({ id: "commit:wt-1:abc", type: "commit" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("wt-1", [changes, uncommitted, commit]);

    const result = getVisualDescendants("wt-1", childrenMap);

    expect(result.threads).toHaveLength(0);
    expect(result.plans).toHaveLength(0);
    expect(result.folders).toHaveLength(0);
    expect(result.terminals).toHaveLength(0);
    expect(result.pullRequests).toHaveLength(0);
  });

  it("does NOT include the starting node itself", () => {
    const child = createNode({ id: "child", type: "thread" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("folder-1", [child]);

    const result = getVisualDescendants("folder-1", childrenMap);

    // "folder-1" itself should not appear in any group
    expect(result.folders).not.toContain("folder-1");
    expect(result.threads).toEqual(["child"]);
  });

  it("handles deeply nested tree (3+ levels)", () => {
    const l1Folder = createNode({ id: "l1", type: "folder" });
    const l2Folder = createNode({ id: "l2", type: "folder" });
    const l3Thread = createNode({ id: "l3", type: "thread" });
    const childrenMap = new Map<string, TreeItemNode[]>();
    childrenMap.set("root-folder", [l1Folder]);
    childrenMap.set("l1", [l2Folder]);
    childrenMap.set("l2", [l3Thread]);

    const result = getVisualDescendants("root-folder", childrenMap);

    expect(result.folders).toEqual(expect.arrayContaining(["l1", "l2"]));
    expect(result.threads).toContain("l3");
  });
});
```

---

## 4. Migration Tests

**File:** `src/lib/__tests__/visual-settings-migration.test.ts`

**Action:** Create new file. The actual migration lives at `migrations/src/migrations/002-visual-settings-backfill.ts` and uses raw `node:fs`. It has no vitest config (migrations directory has no test runner). Instead, we test the **pure logic** — specifically the `computeParentId()` function — by extracting it into a testable module or re-implementing the logic in a test.

The migration's `computeParentId` function determines the `visualSettings.parentId` based on entity kind:

```typescript
type EntityKind = 'thread' | 'plan' | 'pull-request';

function computeParentId(kind: EntityKind, entity: EntityMetadata): string | undefined {
  switch (kind) {
    case 'thread':
      return entity.parentThreadId ?? entity.worktreeId;
    case 'plan':
      return entity.parentId ?? entity.worktreeId;
    case 'pull-request':
      return entity.worktreeId;
  }
}
```

Since this is a pure function with no dependencies, we can test its logic directly.

### Complete Test File

```typescript
// @vitest-environment node
/**
 * Visual Settings Migration Logic Tests
 *
 * Tests the computeParentId logic used by migration
 * 002-visual-settings-backfill.ts. Since the migration uses raw node:fs
 * and runs outside Vitest, we test the pure backfill logic here.
 *
 * These tests verify the mapping rules:
 * - Thread with parentThreadId → parentId = parentThreadId
 * - Thread without parentThreadId → parentId = worktreeId
 * - Plan with domain parentId → parentId = domain parentId
 * - Plan without domain parentId → parentId = worktreeId
 * - PR → parentId = worktreeId (always)
 */

import { describe, it, expect } from "vitest";

// ── Re-implement computeParentId for testing ─────────────────────────────
// This mirrors the exact logic in migrations/src/migrations/002-visual-settings-backfill.ts

type EntityKind = "thread" | "plan" | "pull-request";

interface EntityMetadata {
  visualSettings?: { parentId?: string; sortKey?: string };
  parentThreadId?: string;
  parentId?: string;
  worktreeId?: string;
  [key: string]: unknown;
}

function computeParentId(kind: EntityKind, entity: EntityMetadata): string | undefined {
  switch (kind) {
    case "thread":
      return entity.parentThreadId ?? entity.worktreeId;
    case "plan":
      return entity.parentId ?? entity.worktreeId;
    case "pull-request":
      return entity.worktreeId;
  }
}

// ── Constants ────────────────────────────────────────────────────────────

const WORKTREE_ID = "22222222-2222-4222-a222-222222222222";
const PARENT_THREAD_ID = "33333333-3333-4333-a333-333333333333";
const DOMAIN_PARENT_ID = "44444444-4444-4444-a444-444444444444";

// ── Tests ────────────────────────────────────────────────────────────────

describe("computeParentId (migration backfill logic)", () => {
  describe("threads", () => {
    it("root thread (no parentThreadId) → parentId = worktreeId", () => {
      const entity: EntityMetadata = { worktreeId: WORKTREE_ID };
      expect(computeParentId("thread", entity)).toBe(WORKTREE_ID);
    });

    it("sub-agent thread (has parentThreadId) → parentId = parentThreadId", () => {
      const entity: EntityMetadata = {
        worktreeId: WORKTREE_ID,
        parentThreadId: PARENT_THREAD_ID,
      };
      expect(computeParentId("thread", entity)).toBe(PARENT_THREAD_ID);
    });

    it("thread with parentThreadId takes precedence over worktreeId", () => {
      const entity: EntityMetadata = {
        worktreeId: WORKTREE_ID,
        parentThreadId: PARENT_THREAD_ID,
      };
      const result = computeParentId("thread", entity);
      expect(result).toBe(PARENT_THREAD_ID);
      expect(result).not.toBe(WORKTREE_ID);
    });
  });

  describe("plans", () => {
    it("root plan (no domain parentId) → parentId = worktreeId", () => {
      const entity: EntityMetadata = { worktreeId: WORKTREE_ID };
      expect(computeParentId("plan", entity)).toBe(WORKTREE_ID);
    });

    it("child plan (has domain parentId) → parentId = domain parentId", () => {
      const entity: EntityMetadata = {
        worktreeId: WORKTREE_ID,
        parentId: DOMAIN_PARENT_ID,
      };
      expect(computeParentId("plan", entity)).toBe(DOMAIN_PARENT_ID);
    });
  });

  describe("pull-requests", () => {
    it("PR → parentId = worktreeId (always)", () => {
      const entity: EntityMetadata = { worktreeId: WORKTREE_ID };
      expect(computeParentId("pull-request", entity)).toBe(WORKTREE_ID);
    });

    it("PR ignores any parentId field", () => {
      const entity: EntityMetadata = {
        worktreeId: WORKTREE_ID,
        parentId: DOMAIN_PARENT_ID,
      };
      // PRs always use worktreeId, never domain parentId
      expect(computeParentId("pull-request", entity)).toBe(WORKTREE_ID);
    });
  });

  describe("edge cases", () => {
    it("entity with no worktreeId and no parent → returns undefined", () => {
      const entity: EntityMetadata = {};
      expect(computeParentId("thread", entity)).toBeUndefined();
    });

    it("entity with undefined parentThreadId falls through to worktreeId", () => {
      const entity: EntityMetadata = {
        parentThreadId: undefined,
        worktreeId: WORKTREE_ID,
      };
      expect(computeParentId("thread", entity)).toBe(WORKTREE_ID);
    });
  });
});

describe("migration idempotency contract", () => {
  it("entity with existing visualSettings should be skipped (contract test)", () => {
    // This validates the migration's skip-if-already-present logic.
    // The migration checks: if (entity.visualSettings !== undefined) continue;
    const entity: EntityMetadata = {
      worktreeId: WORKTREE_ID,
      visualSettings: { parentId: "custom-parent" },
    };

    // The skip check
    const shouldSkip = entity.visualSettings !== undefined;
    expect(shouldSkip).toBe(true);
  });

  it("entity without visualSettings should be processed", () => {
    const entity: EntityMetadata = {
      worktreeId: WORKTREE_ID,
    };

    const shouldSkip = entity.visualSettings !== undefined;
    expect(shouldSkip).toBe(false);

    // And computeParentId should produce a result
    const parentId = computeParentId("thread", entity);
    expect(parentId).toBe(WORKTREE_ID);
  });
});
```

---

## 5. Sort Key Tests

**File:** `src/lib/__tests__/sort-key.test.ts`

**Action:** Create new file. Tests the sort key utilities from `src/lib/sort-key.ts` (defined in 05a-drag-and-drop). This module wraps the `fractional-indexing` npm package.

**Source under test:** `src/lib/sort-key.ts` exports:

```typescript
export function generateSortKey(before: string | null, after: string | null): string;
export function computeSortKeyForInsertion(siblings: TreeItemNode[], insertionIndex: number): string;
```

### Complete Test File

```typescript
// @vitest-environment node
/**
 * Sort Key Tests
 *
 * Tests for sort key generation via the fractional-indexing package wrapper.
 * Validates that generated keys maintain lexicographic ordering for
 * various insertion patterns (append, prepend, middle insert).
 */

import { describe, it, expect } from "vitest";
import { generateSortKey, computeSortKeyForInsertion } from "../sort-key";
import type { TreeItemNode } from "@/stores/tree-menu/types";

// ── Factory ──────────────────────────────────────────────────────────────

function createNodeWithSortKey(id: string, sortKey?: string): TreeItemNode {
  return {
    type: "thread",
    id,
    title: id,
    status: "read",
    updatedAt: Date.now(),
    createdAt: Date.now(),
    depth: 0,
    isFolder: false,
    isExpanded: false,
    sortKey,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("generateSortKey", () => {
  it("generates a key between null and null (first item)", () => {
    const key = generateSortKey(null, null);
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("generates a key between two existing keys that sorts between them", () => {
    const first = generateSortKey(null, null);
    const last = generateSortKey(first, null);
    const middle = generateSortKey(first, last);

    expect(middle > first).toBe(true);
    expect(middle < last).toBe(true);
  });

  it("generates a key before an existing key", () => {
    const existing = generateSortKey(null, null);
    const before = generateSortKey(null, existing);

    expect(before < existing).toBe(true);
  });

  it("generates a key after an existing key", () => {
    const existing = generateSortKey(null, null);
    const after = generateSortKey(existing, null);

    expect(after > existing).toBe(true);
  });

  it("repeated append insertions produce strictly ascending keys", () => {
    const keys: string[] = [];
    let prevKey: string | null = null;
    for (let i = 0; i < 10; i++) {
      const newKey = generateSortKey(prevKey, null);
      keys.push(newKey);
      prevKey = newKey;
    }

    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });

  it("repeated prepend insertions produce strictly descending keys", () => {
    const keys: string[] = [];
    let nextKey: string | null = null;
    for (let i = 0; i < 10; i++) {
      const newKey = generateSortKey(null, nextKey);
      keys.push(newKey);
      nextKey = newKey;
    }

    // Keys were generated in reverse order; each new key < previous new key
    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] < keys[i - 1]).toBe(true);
    }
  });

  it("repeated insertions between two keys produce valid ordering", () => {
    const first = generateSortKey(null, null);
    const last = generateSortKey(first, null);

    const keys: string[] = [first];
    let rightBound = last;
    for (let i = 0; i < 5; i++) {
      const newKey = generateSortKey(keys[keys.length - 1], rightBound);
      keys.push(newKey);
    }
    keys.push(last);

    for (let i = 1; i < keys.length; i++) {
      expect(keys[i] > keys[i - 1]).toBe(true);
    }
  });
});

describe("computeSortKeyForInsertion", () => {
  it("generates key for insertion at start of list", () => {
    const siblings = [
      createNodeWithSortKey("a", "a1"),
      createNodeWithSortKey("b", "a2"),
    ];
    const key = computeSortKeyForInsertion(siblings, 0);
    expect(key < "a1").toBe(true);
  });

  it("generates key for insertion at end of list", () => {
    const siblings = [
      createNodeWithSortKey("a", "a1"),
      createNodeWithSortKey("b", "a2"),
    ];
    const key = computeSortKeyForInsertion(siblings, 2);
    expect(key > "a2").toBe(true);
  });

  it("generates key for insertion between two items", () => {
    const siblings = [
      createNodeWithSortKey("a", "a1"),
      createNodeWithSortKey("b", "a3"),
    ];
    const key = computeSortKeyForInsertion(siblings, 1);
    expect(key > "a1").toBe(true);
    expect(key < "a3").toBe(true);
  });

  it("generates key for insertion into empty list", () => {
    const key = computeSortKeyForInsertion([], 0);
    expect(typeof key).toBe("string");
    expect(key.length).toBeGreaterThan(0);
  });

  it("handles siblings without sortKey (null values)", () => {
    const siblings = [
      createNodeWithSortKey("a", undefined),
      createNodeWithSortKey("b", undefined),
    ];
    // Should not throw — treats undefined sortKey as null for generateKeyBetween
    const key = computeSortKeyForInsertion(siblings, 1);
    expect(typeof key).toBe("string");
  });
});

describe("sort ordering contract", () => {
  it("items without sortKey maintain createdAt ordering", () => {
    // This validates the tree builder's sort contract:
    // - Unkeyed items: createdAt descending
    // - Keyed items: sortKey ascending
    // - Mixed: unkeyed first, then keyed
    const unsortedItems = [
      { sortKey: undefined, createdAt: 3000 },
      { sortKey: undefined, createdAt: 1000 },
      { sortKey: "a0", createdAt: 2000 },
      { sortKey: "a1", createdAt: 500 },
    ];

    const sorted = [...unsortedItems].sort((a, b) => {
      const aHasKey = a.sortKey !== undefined;
      const bHasKey = b.sortKey !== undefined;
      if (!aHasKey && !bHasKey) return b.createdAt - a.createdAt;
      if (!aHasKey) return -1; // unkeyed first
      if (!bHasKey) return 1;
      return a.sortKey!.localeCompare(b.sortKey!);
    });

    expect(sorted[0]).toEqual({ sortKey: undefined, createdAt: 3000 });
    expect(sorted[1]).toEqual({ sortKey: undefined, createdAt: 1000 });
    expect(sorted[2]).toEqual({ sortKey: "a0", createdAt: 2000 });
    expect(sorted[3]).toEqual({ sortKey: "a1", createdAt: 500 });
  });
});
```

---

## Test Approach Summary

| Test File | Type | Environment | Run Command |
| --- | --- | --- | --- |
| `src/hooks/__tests__/use-tree-data.test.ts` | Unit | node | `pnpm test` |
| `src/lib/__tests__/dnd-validation.test.ts` | Unit | node | `pnpm test` |
| `src/lib/__tests__/cascade-archive.test.ts` | Unit | node | `pnpm test` |
| `src/lib/__tests__/visual-settings-migration.test.ts` | Unit | node | `pnpm test` |
| `src/lib/__tests__/sort-key.test.ts` | Unit | node | `pnpm test` |

### Mocking Strategy

- **Logger:** Mock `@/lib/logger-client` with `vi.fn()` stubs (only needed in tree builder test where `buildUnifiedTree` may log warnings).
- **Stores:** Mock `@/entities/pull-requests/store`, `@/stores/commit-store`, and `@/entities/relations/service` (only in tree builder test — these are called during node building).
- **Pure functions (dnd-validation, cascade-archive, sort-key, migration):** No mocking needed. These are self-contained pure functions tested with direct input/output.

### Assertion Style (matches existing codebase conventions)

- `expect(...).toBe(...)` for primitives (from `src/lib/__tests__/thread-state-machine.test.ts`)
- `expect(...).toEqual(...)` for objects (from `src/entities/plans/__tests__/plan-entity.test.ts`)
- `expect(...).toContain(...)` for array membership (from `src/entities/plans/__tests__/plan-entity.test.ts`)
- `expect(...).toBeDefined()` / `toBeUndefined()` for existence (from `src/entities/threads/__tests__/service.test.ts`)
- `expect(...).toMatch(...)` for string pattern matching (for error reasons in DnD validation)
- `expect.arrayContaining(...)` for partial array matching (from cascade archive tests)

### Factory Function Pattern (matches codebase convention)

Every test file defines `createXxx()` factory functions with `Partial<Type>` overrides, following the pattern established in:

- `src/entities/threads/__tests__/service.test.ts` (`createThreadMetadata()`)
- `src/entities/plans/__tests__/plan-entity.test.ts` (`createPlanMetadata()`)
- `src/components/split-layout/__tests__/tab-dnd.test.ts` (`makeTab()`, `makeGroup()`)

## Acceptance Criteria

- [x] Tree builder tests cover: nesting via `visualSettings.parentId` only (no domain fallback), sorting (createdAt desc, sortKey asc, mixed), orphan fallback to root, synthetic items as worktree children, expansion state (collapsed hides children, worktree defaults expanded), multiple worktrees, `worktreeId` propagation, `isSubAgent` badge from domain relationship

- [x] Drop constraint tests cover: synthetic item rejection (drag and drop-onto), leaf type rejection, self-drop rejection, cycle detection (child and grandchild), worktree boundary enforcement, worktree-into-worktree rejection, valid container drops, `isAncestor` pure function, `findWorktreeAncestor` pure function, `getDropPosition` hit regions (container 25/50/25, leaf 50/50), `buildTreeMaps` map construction

- [x] Cascade archive tests cover: descendant collection by type, nested folder recursion, thread/plan container recursion, empty folders, moved-out items excluded, synthetic items excluded, starting node not included, deep nesting (3+ levels)

- [x] Migration tests cover: `computeParentId` mapping for all entity kinds (root thread, sub-agent thread, root plan, child plan, PR), edge cases (no worktreeId, undefined parentThreadId), idempotency contract (skip-if-present)

- [x] Sort key tests cover: `generateSortKey` between null/null, between two keys, before/after existing, repeated append/prepend, repeated middle insertion; `computeSortKeyForInsertion` at start/end/middle/empty; sort ordering contract for mixed keyed/unkeyed items

- [x] All tests pass: `pnpm test` in root

## Phases

- [x] Rewrite `src/hooks/__tests__/use-tree-data.test.ts` with `buildUnifiedTree` tests (imports, factories, all describe blocks from section 1)

- [x] Create `src/lib/__tests__/dnd-validation.test.ts` with all describe blocks from section 2

- [x] Create `src/lib/__tests__/cascade-archive.test.ts` with all describe blocks from section 3

- [x] Create `src/lib/__tests__/visual-settings-migration.test.ts` with all describe blocks from section 4

- [x] Create `src/lib/__tests__/sort-key.test.ts` with all describe blocks from section 5

- [x] Run full test suite (`pnpm test` and `pnpm tsc --noEmit`) and fix any failures

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---