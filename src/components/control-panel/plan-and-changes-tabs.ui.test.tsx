/**
 * Plan Tab and Changes Tab UI Tests
 *
 * Tests that plans and file changes render correctly in the control panel view.
 * Uses test data based on a real thread that created plans/goodbye-world.md.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, TestStores, waitFor } from "@/test/helpers";
import { PlanTab } from "./plan-tab";
import { ChangesTab } from "./changes-tab";
import type { ThreadMetadata } from "@/entities/threads/types";
import type { ThreadState } from "@/lib/types/agent-messages";
import type { PlanMetadata } from "@/entities/plans/types";

// Mock logger
vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock filesystem client for reading plan content
vi.mock("@/lib/filesystem-client", () => ({
  FilesystemClient: class MockFilesystemClient {
    readFile = vi.fn().mockResolvedValue("# Goodbye World\n\nThis is the plan content.");
  },
}));

// Mock planService methods
vi.mock("@/entities/plans/service", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/entities/plans/service")>();
  return {
    ...original,
    planService: {
      ...original.planService,
      getPlanContent: vi.fn().mockResolvedValue("# Goodbye World\n\nThis is the plan content."),
      markAsRead: vi.fn().mockResolvedValue(undefined),
      refreshById: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock thread diff generator to avoid git commands
vi.mock("@/lib/utils/thread-diff-generator", () => ({
  generateThreadDiff: vi.fn().mockResolvedValue({
    initialCommit: "abc123",
    diff: {
      files: [
        {
          oldPath: null,
          newPath: "plans/goodbye-world.md",
          type: "added",
          stats: { additions: 3, deletions: 0 },
          hunks: [
            {
              oldStart: 0,
              oldLines: 0,
              newStart: 1,
              newLines: 3,
              sectionHeader: "",
              lines: [
                { type: "addition", content: "# Goodbye World" },
                { type: "addition", content: "" },
                { type: "addition", content: "" },
              ],
            },
          ],
        },
      ],
    },
  }),
  extractFileChanges: vi.fn().mockImplementation((fileChanges) => {
    if (!fileChanges) return [];
    return fileChanges.map((fc: { path: string; operation?: string; oldPath?: string }) => ({
      path: fc.path,
      operation: fc.operation ?? "modify",
      oldPath: fc.oldPath,
    }));
  }),
  extractChangedFilePaths: vi.fn().mockImplementation((fileChanges) => {
    if (!fileChanges) return [];
    return fileChanges.map((fc: { path: string }) => fc.path);
  }),
}));

// Real test data matching a thread at /Users/zac/.mort-dev/threads/
const THREAD_ID = "5863f47e-8573-468c-9694-5b72479c50a8";
const PLAN_ID = "f3a45523-4e7f-47a3-9895-fa8ca0a22d2f";

const TEST_PLAN: PlanMetadata = {
  id: PLAN_ID,
  absolutePath: "/Users/zac/Documents/juice/mort/mortician/plans/goodbye-world.md",
  isRead: false,
  createdAt: 1768975583077,
  updatedAt: 1768975583077,
};

const TEST_THREAD_METADATA: ThreadMetadata = {
  id: THREAD_ID,
  repoId: "550e8400-e29b-41d4-a716-446655440001",
  worktreeId: "550e8400-e29b-41d4-a716-446655440002",
  status: "completed",
  createdAt: 1768975578270,
  updatedAt: 1768975637145,
  git: {
    branch: "main",
    initialCommitHash: "4c3d03a3dedfccf6400a01a01a739f4d4652759b",
  },
  turns: [
    {
      index: 0,
      prompt: "can you add goodbye-world.md to the plans directory?",
      startedAt: 1768975578270,
      completedAt: 1768975585559,
    },
  ],
  isRead: true,
};

const TEST_THREAD_STATE: ThreadState = {
  messages: [
    {
      role: "user",
      content: "can you add goodbye-world.md to the plans directory?",
    },
    {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_01BcrgVm8hB6c6Pa8uwwpx7n",
          name: "Write",
          input: {
            file_path: "/Users/zac/Documents/juice/mort/mortician/plans/goodbye-world.md",
            content: "# Goodbye World\n\n",
          },
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Done. I've created `plans/goodbye-world.md` with a basic header.",
        },
      ],
    },
  ],
  fileChanges: [
    {
      path: "/Users/zac/Documents/juice/mort/mortician/plans/goodbye-world.md",
      operation: "create",
      diff: "",
    },
  ],
  workingDirectory: "/Users/zac/Documents/juice/mort/mortician",
  status: "complete",
  timestamp: 1768975585558,
  toolStates: {
    toolu_01BcrgVm8hB6c6Pa8uwwpx7n: {
      status: "complete",
      result: JSON.stringify({
        type: "create",
        filePath: "/Users/zac/Documents/juice/mort/mortician/plans/goodbye-world.md",
        content: "# Goodbye World\n\n",
        structuredPatch: [],
        originalFile: null,
      }),
      isError: false,
      toolName: "Write",
    },
  },
  sessionId: "4a8369e4-f786-436e-b3cc-1366905a709e",
  metrics: {
    durationApiMs: 8551,
    totalCostUsd: 0.054899250000000004,
    numTurns: 2,
  },
};

describe("PlanTab", () => {
  beforeEach(() => {
    TestStores.clear();
  });

  describe("when plan exists in store", () => {
    it("renders plan content when planId and plan are present", async () => {
      // Seed the plan store with the test plan
      TestStores.seedPlan(TEST_PLAN);

      render(<PlanTab planId={PLAN_ID} />);

      // Should show loading initially, then content
      await waitFor(() => {
        expect(screen.getByTestId("plan-content")).toBeInTheDocument();
      });

      // Should show the directory path (plans/) which comes from the relative path
      expect(screen.getByText("plans/")).toBeInTheDocument();
    });

    it("shows empty state when planId is null", () => {
      TestStores.seedPlan(TEST_PLAN);

      render(<PlanTab planId={null} />);

      expect(screen.getByTestId("plan-empty-state")).toBeInTheDocument();
      expect(screen.getByText("No plan yet")).toBeInTheDocument();
    });
  });

  describe("when plan does NOT exist in store", () => {
    it("shows loading state then empty state when plan refresh fails", async () => {
      // Don't seed the plan store - this simulates the plan not being hydrated yet
      render(<PlanTab planId={PLAN_ID} />);

      // Should show loading initially while refreshing
      expect(screen.getByTestId("plan-loading-state")).toBeInTheDocument();

      // After refresh fails (plan not found), should show empty state
      await waitFor(() => {
        expect(screen.getByTestId("plan-empty-state")).toBeInTheDocument();
      });
      expect(screen.getByText("No plan yet")).toBeInTheDocument();
    });

    it("shows content when plan is refreshed from disk successfully", async () => {
      // Mock refreshById to add the plan to the store
      const { planService } = await import("@/entities/plans/service");
      vi.mocked(planService.refreshById).mockImplementation(async (planId) => {
        // Simulate the plan being loaded from disk into the store
        TestStores.seedPlan({ ...TEST_PLAN, id: planId });
      });

      render(<PlanTab planId={PLAN_ID} />);

      // Should show loading initially
      expect(screen.getByTestId("plan-loading-state")).toBeInTheDocument();

      // After refresh succeeds, should show content
      await waitFor(() => {
        expect(screen.getByTestId("plan-content")).toBeInTheDocument();
      });
    });
  });
});

describe("ChangesTab", () => {
  beforeEach(() => {
    TestStores.clear();
  });

  describe("when file changes exist", () => {
    it("renders file changes when threadState has fileChanges", async () => {
      render(
        <ChangesTab
          threadMetadata={TEST_THREAD_METADATA}
          threadState={TEST_THREAD_STATE}
        />
      );

      // Should show the diff summary header
      await waitFor(() => {
        expect(screen.getByText(/1 file changed/)).toBeInTheDocument();
      });

      // Should show the initial commit hash (truncated)
      expect(screen.getByText("abc123")).toBeInTheDocument();
    });

    it("renders empty state when threadState is missing fileChanges", async () => {
      const stateWithoutChanges = {
        ...TEST_THREAD_STATE,
        fileChanges: [],
      };

      render(
        <ChangesTab
          threadMetadata={TEST_THREAD_METADATA}
          threadState={stateWithoutChanges}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("No file changes in this thread")).toBeInTheDocument();
      });
    });
  });

  describe("when threadState is undefined", () => {
    it("shows loading state when isLoadingThreadState is true", () => {
      const { container } = render(
        <ChangesTab
          threadMetadata={TEST_THREAD_METADATA}
          threadState={undefined}
          isLoadingThreadState={true}
        />
      );

      // LoadingState renders a blank div (per the component: "loading is fast enough that a spinner is jarring")
      const loadingDiv = container.querySelector(".h-full");
      expect(loadingDiv).toBeInTheDocument();
      // Should NOT show the empty state message
      expect(screen.queryByText("No file changes in this thread")).not.toBeInTheDocument();
    });

    it("shows loading state initially when threadState has not been received yet", () => {
      // Even when isLoadingThreadState is false, if we've never received threadState,
      // we should show loading (to handle the race condition on initial mount)
      const { container } = render(
        <ChangesTab
          threadMetadata={TEST_THREAD_METADATA}
          threadState={undefined}
          isLoadingThreadState={false}
        />
      );

      // LoadingState renders a blank div
      const loadingDiv = container.querySelector(".h-full");
      expect(loadingDiv).toBeInTheDocument();
      // Should NOT show the empty state message
      expect(screen.queryByText("No file changes in this thread")).not.toBeInTheDocument();
    });
  });

  describe("when git info is missing", () => {
    it("shows empty state when initialCommitHash is missing", async () => {
      const metadataWithoutGit = {
        ...TEST_THREAD_METADATA,
        git: undefined,
      };

      render(
        <ChangesTab
          threadMetadata={metadataWithoutGit}
          threadState={TEST_THREAD_STATE}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("No git information available for this thread")).toBeInTheDocument();
      });
    });
  });
});
