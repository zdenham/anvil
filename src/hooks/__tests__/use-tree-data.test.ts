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
import type { FolderMetadata } from "@/entities/folders/types";

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

function createPullRequest(overrides: Partial<PullRequestMetadata> = {}): PullRequestMetadata {
  return {
    id: crypto.randomUUID(),
    prNumber: 1,
    repoId: REPO_ID,
    worktreeId: WORKTREE_ID,
    repoSlug: "test/repo",
    headBranch: "feature",
    baseBranch: "main",
    autoAddressEnabled: false,
    gatewayChannelId: null,
    createdAt: BASE_TIME + 1000,
    updatedAt: BASE_TIME + 1000,
    isRead: true,
    isViewed: true,
    ...overrides,
  } as PullRequestMetadata;
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
  const ctx: TreeBuildContext = {
    expandedSections: opts.expandedSections ?? { [WORKTREE_ID]: true },
    runningThreadIds: opts.runningThreadIds ?? new Set(),
    threadsWithPendingInput: opts.threadsWithPendingInput ?? new Set(),
  };
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
    it("returns repo node at depth 0, worktree at depth 0 (flattened)", () => {
      const items = buildTree({});
      expect(items[0].type).toBe("repo");
      expect(items[0].depth).toBe(0);
      expect(items[0].id).toBe(REPO_ID);
      const wtItem = items.find(i => i.type === "worktree");
      expect(wtItem).toBeDefined();
      expect(wtItem!.depth).toBe(0);
      expect(wtItem!.id).toBe(WORKTREE_ID);
    });

    it("returns worktree with just worktreeName as title", () => {
      const items = buildTree({});
      const wtItem = items.find(i => i.type === "worktree")!;
      expect(wtItem.title).toBe("main");
    });

    it("returns empty worktree with only synthetic children when expanded", () => {
      const items = buildTree({ expandedSections: { [WORKTREE_ID]: true } });
      // Worktree children at depth 1 (repo=0, worktree=0, children=1)
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
      // repo + collapsed worktree = 2 items
      expect(items).toHaveLength(2);
      expect(items[0].type).toBe("repo");
      expect(items[1].type).toBe("worktree");
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
      expect(threadItem!.depth).toBe(1); // repo=0, worktree=0, thread=1
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
          "folder:folder-1": true,
        },
      });
      const threadItem = items.find(i => i.id === thread.id);
      expect(threadItem).toBeDefined();
      expect(threadItem!.depth).toBe(2); // repo=0, worktree=0, folder=1, thread=2
    });

    it("ensureVisualSettings defaults child thread parentId to parentThreadId", () => {
      const parentThread = createThread({
        id: "parent-thread",
        visualSettings: { parentId: WORKTREE_ID },
      });
      // Child thread has parentThreadId but no visualSettings —
      // ensureVisualSettings defaults parentId to parentThreadId
      const childThread = createThread({
        parentThreadId: "parent-thread",
      });
      const items = buildTree({
        threads: [parentThread, childThread],
        expandedSections: {
          [WORKTREE_ID]: true,
          "thread:parent-thread": true,
        },
      });
      const parentItem = items.find(i => i.id === "parent-thread");
      expect(parentItem!.depth).toBe(1); // repo=0, worktree=0, parent=1
      const childItem = items.find(i => i.id === childThread.id);
      expect(childItem).toBeDefined();
      expect(childItem!.depth).toBe(2); // repo=0, worktree=0, parent=1, child=2
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
      expect(planItem!.depth).toBe(2); // repo=0, worktree=0, thread=1, plan=2
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
      expect(folderItem!.depth).toBe(1); // repo=0, worktree=0, folder=1
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
      expect(inner!.depth).toBe(2); // repo=0, worktree=0, outer=1, inner=2
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
      const children = items.filter(i => i.depth === 2); // repo=0, worktree=0, folder=1, children=2
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

    it("keyed items appear before unkeyed items (mixed sort)", () => {
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
      // Per the actual sort: keyed items sort before unkeyed items (sortKey truthy => -1)
      expect(threadItems[0].id).toBe("keyed");
      expect(threadItems[1].id).toBe("unkeyed");
    });
  });

  describe("orphan handling", () => {
    it("item with missing parent falls back to worktree", () => {
      const orphan = createThread({
        id: "orphan",
        visualSettings: { parentId: "nonexistent-parent" },
      });
      const items = buildTree({
        threads: [orphan],
        expandedSections: { [WORKTREE_ID]: true },
      });
      // buildChildrenMap: if parentId is missing, falls back to worktreeId
      const orphanItem = items.find(i => i.id === "orphan");
      expect(orphanItem).toBeDefined();
      expect(orphanItem!.depth).toBe(1); // repo=0, worktree=0, orphan=1
    });
  });

  describe("synthetic items", () => {
    it("Changes item appears as child of worktree node", () => {
      const items = buildTree({
        expandedSections: { [WORKTREE_ID]: true },
      });
      const changesItem = items.find(i => i.type === "changes");
      expect(changesItem).toBeDefined();
      expect(changesItem!.depth).toBe(1); // repo=0, worktree=0, changes=1
      expect(changesItem!.parentId).toBe(WORKTREE_ID);
    });

    it("Uncommitted and Commit items appear as children of Changes when expanded", () => {
      const changesExpandKey = `changes:changes:${WORKTREE_ID}`;
      const items = buildTree({
        expandedSections: {
          [WORKTREE_ID]: true,
          [changesExpandKey]: true,
        },
      });
      const uncommitted = items.find(i => i.type === "uncommitted");
      expect(uncommitted).toBeDefined();
      expect(uncommitted!.depth).toBe(2); // repo=0, worktree=0, changes=1, uncommitted=2
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

    it("worktree and repo default to expanded when not in expandedSections", () => {
      const thread = createThread({
        visualSettings: { parentId: WORKTREE_ID },
      });
      const items = buildTree({
        threads: [thread],
        expandedSections: {}, // No explicit expansion state
      });
      // Both repo and worktree default to expanded
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
        visualSettings: { parentId: WORKTREE_ID },
      });
      const items = buildTree({
        threads: [thread],
        expandedSections: { [WORKTREE_ID]: true },
      });
      const threadItem = items.find(i => i.id === thread.id);
      expect(threadItem!.isSubAgent).toBe(true);
    });
  });

  describe("files node", () => {
    it("files node appears as child of worktree", () => {
      const items = buildTree({
        expandedSections: { [WORKTREE_ID]: true },
      });
      const filesItem = items.find(i => i.type === "files");
      expect(filesItem).toBeDefined();
      expect(filesItem!.id).toBe(`files:${WORKTREE_ID}`);
      expect(filesItem!.depth).toBe(1); // repo=0, worktree=0, files=1
      expect(filesItem!.repoId).toBe(REPO_ID);
    });
  });

  describe("type-priority sorting", () => {
    it("sorts: Files → PR → Changes → terminal → thread", () => {
      const thread = createThread({
        id: "thread-1",
        createdAt: BASE_TIME + 5000,
        updatedAt: BASE_TIME + 5000,
        visualSettings: { parentId: WORKTREE_ID },
      });
      const pr = createPullRequest({
        id: "pr-1",
        createdAt: BASE_TIME + 4000,
        updatedAt: BASE_TIME + 4000,
        visualSettings: { parentId: WORKTREE_ID },
      });
      const terminal = createTerminal({
        id: "term-1",
        createdAt: BASE_TIME + 3000,
        visualSettings: { parentId: WORKTREE_ID },
      });
      const items = buildTree({
        threads: [thread],
        pullRequests: [pr],
        terminals: [terminal],
        expandedSections: { [WORKTREE_ID]: true },
      });
      // Get direct children of worktree (depth 1: repo=0, worktree=0, children=1)
      const children = items.filter(i => i.depth === 1);
      const types = children.map(i => i.type);
      expect(types).toEqual(["files", "pull-request", "changes", "terminal", "thread"]);
    });

    it("DnD-positioned thread (with sortKey) stays below operational items", () => {
      const thread = createThread({
        id: "dnd-thread",
        visualSettings: { parentId: WORKTREE_ID, sortKey: "a0" },
      });
      const items = buildTree({
        threads: [thread],
        expandedSections: { [WORKTREE_ID]: true },
      });
      const children = items.filter(i => i.depth === 1);
      const types = children.map(i => i.type);
      // Files and Changes (operational) must appear before thread regardless of sortKey
      expect(types.indexOf("files")).toBeLessThan(types.indexOf("thread"));
      expect(types.indexOf("changes")).toBeLessThan(types.indexOf("thread"));
    });

    it("DnD sortKey orders within same tier", () => {
      const keyedThread = createThread({
        id: "keyed-thread",
        createdAt: BASE_TIME + 1000,
        visualSettings: { parentId: WORKTREE_ID, sortKey: "a0" },
      });
      const unkeyedThread = createThread({
        id: "unkeyed-thread",
        createdAt: BASE_TIME + 5000,
        visualSettings: { parentId: WORKTREE_ID },
      });
      const items = buildTree({
        threads: [keyedThread, unkeyedThread],
        expandedSections: { [WORKTREE_ID]: true },
      });
      const threadItems = items.filter(i => i.type === "thread");
      // Keyed items sort before unkeyed within the same tier
      expect(threadItems[0].id).toBe("keyed-thread");
      expect(threadItems[1].id).toBe("unkeyed-thread");
    });

    it("terminal sorts below threads/folders (both fallback tier 99 vs tier 3)", () => {
      const thread = createThread({
        id: "thread-1",
        createdAt: BASE_TIME + 1000,
        visualSettings: { parentId: WORKTREE_ID },
      });
      const terminal = createTerminal({
        id: "term-1",
        createdAt: BASE_TIME + 5000, // newer, but lower priority tier
        visualSettings: { parentId: WORKTREE_ID },
      });
      const items = buildTree({
        threads: [thread],
        terminals: [terminal],
        expandedSections: { [WORKTREE_ID]: true },
      });
      const children = items.filter(i => i.depth === 1);
      const types = children.map(i => i.type);
      expect(types.indexOf("terminal")).toBeLessThan(types.indexOf("thread"));
    });

    it("within same tier, items sort by createdAt descending", () => {
      const olderPr = createPullRequest({
        id: "pr-old",
        prNumber: 1,
        createdAt: BASE_TIME + 1000,
        updatedAt: BASE_TIME + 1000,
        visualSettings: { parentId: WORKTREE_ID },
      });
      const newerPr = createPullRequest({
        id: "pr-new",
        prNumber: 2,
        createdAt: BASE_TIME + 2000,
        updatedAt: BASE_TIME + 2000,
        visualSettings: { parentId: WORKTREE_ID },
      });
      const items = buildTree({
        pullRequests: [olderPr, newerPr],
        expandedSections: { [WORKTREE_ID]: true },
      });
      const prItems = items.filter(i => i.type === "pull-request");
      expect(prItems[0].id).toBe("pr-new");
      expect(prItems[1].id).toBe("pr-old");
    });
  });

  describe("root-level folders", () => {
    it("folder without worktreeId appears at depth 0", () => {
      const folder = createFolder({ id: "root-folder" });
      const items = buildTree({
        folders: [folder],
        expandedSections: {},
      });
      const folderItem = items.find(i => i.id === "root-folder");
      expect(folderItem).toBeDefined();
      expect(folderItem!.type).toBe("folder");
      expect(folderItem!.depth).toBe(0);
      expect(folderItem!.worktreeId).toBeUndefined();
    });

    it("root-level folder with children is expandable", () => {
      const folder = createFolder({
        id: "root-folder",
        visualSettings: undefined,
      });
      const childFolder = createFolder({
        id: "child-folder",
        visualSettings: { parentId: "root-folder" },
      });
      const items = buildTree({
        folders: [folder, childFolder],
        expandedSections: { "folder:root-folder": true },
      });
      const child = items.find(i => i.id === "child-folder");
      expect(child).toBeDefined();
      expect(child!.depth).toBe(1);
    });

    it("worktree with visualSettings.parentId nests inside root-level folder", () => {
      const folder = createFolder({ id: "root-folder" });
      const wt = createWorktreeInfo({
        worktreeId: "wt-nested",
        visualSettings: { parentId: "root-folder" },
      });
      const items = buildTree({
        worktrees: [wt],
        folders: [folder],
        expandedSections: { "folder:root-folder": true, "wt-nested": true },
      });
      const wtItem = items.find(i => i.id === "wt-nested");
      expect(wtItem).toBeDefined();
      expect(wtItem!.depth).toBe(1);
      expect(wtItem!.parentId).toBe("root-folder");
    });

    it("folder without worktreeId is NOT filtered out", () => {
      const rootFolder = createFolder({ id: "root-f" });
      const worktreeFolder = createFolder({
        id: "wt-f",
        worktreeId: WORKTREE_ID,
        visualSettings: { parentId: WORKTREE_ID },
      });
      const items = buildTree({
        folders: [rootFolder, worktreeFolder],
        expandedSections: { [WORKTREE_ID]: true },
      });
      expect(items.find(i => i.id === "root-f")).toBeDefined();
      expect(items.find(i => i.id === "wt-f")).toBeDefined();
    });

    it("folder with unknown worktreeId IS filtered out", () => {
      const orphanFolder = createFolder({
        id: "orphan-f",
        worktreeId: "nonexistent-wt",
        visualSettings: { parentId: "nonexistent-wt" },
      });
      const items = buildTree({
        folders: [orphanFolder],
        expandedSections: {},
      });
      expect(items.find(i => i.id === "orphan-f")).toBeUndefined();
    });
  });
});
