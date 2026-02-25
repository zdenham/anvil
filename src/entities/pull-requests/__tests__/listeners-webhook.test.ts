// @vitest-environment node
/**
 * PR Entity Listener Tests - Gateway Webhook Event Handling
 *
 * Tests the GITHUB_WEBHOOK_EVENT listener that:
 * - Resolves channel -> repo -> PR entity
 * - Classifies events and refreshes display data
 * - Spawns auto-address agents when enabled
 * - Skips pull_request events (handled by pr-lifecycle-handler)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { usePullRequestStore } from "../store";
import type { PullRequestMetadata } from "../types";
import { EventName } from "@core/types/events.js";

// ═══════════════════════════════════════════════════════════════════════════
// Mocks
// ═══════════════════════════════════════════════════════════════════════════

vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Track event handlers registered via eventBus.on
const eventHandlers: Record<string, ((...args: unknown[]) => void)[]> = {};

vi.mock("../../events", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
      if (!eventHandlers[name]) eventHandlers[name] = [];
      eventHandlers[name].push(handler);
    }),
    off: vi.fn(),
  },
}));

const mockRefreshById = vi.fn().mockResolvedValue(undefined);
const mockGetByRepoAndNumber = vi.fn();

vi.mock("../service", () => ({
  pullRequestService: {
    refreshById: (...args: unknown[]) => mockRefreshById(...args),
    getByRepoAndNumber: (...args: unknown[]) => mockGetByRepoAndNumber(...args),
  },
}));

const mockGetChannel = vi.fn();

vi.mock("../../gateway-channels/service", () => ({
  gatewayChannelService: {
    get: (...args: unknown[]) => mockGetChannel(...args),
  },
}));

const mockGetWorktreePath = vi.fn().mockReturnValue("/path/to/worktree");

vi.mock("@/stores/repo-worktree-lookup-store", () => ({
  useRepoWorktreeLookupStore: {
    getState: () => ({
      getWorktreePath: (...args: unknown[]) => mockGetWorktreePath(...args),
    }),
  },
}));

const mockGetPrDetails = vi.fn().mockResolvedValue({
  title: "Test PR",
  body: "",
  state: "OPEN",
  author: "test",
  url: "https://github.com/test",
  isDraft: false,
  labels: [],
  reviewDecision: null,
  reviews: [],
  checks: [],
  reviewComments: [],
});
const mockGetPrChecks = vi.fn().mockResolvedValue([]);
const mockGetPrComments = vi.fn().mockResolvedValue([]);

vi.mock("@/lib/gh-cli", () => {
  return {
    GhCli: class MockGhCli {
      constructor(_cwd: string) {}
      getPrDetails(...args: unknown[]) { return mockGetPrDetails(...args); }
      getPrChecks(...args: unknown[]) { return mockGetPrChecks(...args); }
      getPrComments(...args: unknown[]) { return mockGetPrComments(...args); }
    },
  };
});

const mockCreateThread = vi.fn().mockResolvedValue({ threadId: "t-1", taskId: "task-1" });

vi.mock("@/lib/thread-creation-service", () => ({
  createThread: (...args: unknown[]) => mockCreateThread(...args),
}));

vi.mock("../pr-lifecycle-handler", () => ({
  handlePullRequestEvent: vi.fn().mockResolvedValue(undefined),
}));

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

function createPr(overrides: Partial<PullRequestMetadata> = {}): PullRequestMetadata {
  const now = Date.now();
  return {
    id: "pr-1",
    prNumber: 42,
    repoId: "repo-1",
    worktreeId: "wt-1",
    repoSlug: "owner/repo",
    headBranch: "feature/test",
    baseBranch: "main",
    autoAddressEnabled: false,
    gatewayChannelId: null,
    isViewed: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function triggerWebhookEvent(payload: {
  channelId: string;
  githubEventType: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const handlers = eventHandlers[EventName.GITHUB_WEBHOOK_EVENT];
  if (!handlers) return;
  for (const handler of handlers) {
    await handler(payload);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("setupPullRequestListeners - GITHUB_WEBHOOK_EVENT", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const key of Object.keys(eventHandlers)) {
      delete eventHandlers[key];
    }

    usePullRequestStore.setState({
      pullRequests: {},
      _prsArray: [],
      prDetails: {},
      prDetailsLoading: {},
      _hydrated: false,
    });

    // Re-set default return values after clearAllMocks
    mockGetWorktreePath.mockReturnValue("/path/to/worktree");
    mockGetPrDetails.mockResolvedValue({
      title: "Test PR",
      body: "",
      state: "OPEN",
      author: "test",
      url: "https://github.com/test",
      isDraft: false,
      labels: [],
      reviewDecision: null,
      reviews: [],
      checks: [],
      reviewComments: [],
    });
    mockGetPrChecks.mockResolvedValue([]);
    mockGetPrComments.mockResolvedValue([]);
    mockCreateThread.mockResolvedValue({ threadId: "t-1", taskId: "task-1" });

    // Import to trigger listener registration
    const { setupPullRequestListeners } = await import("../listeners");
    setupPullRequestListeners();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registers handler for GITHUB_WEBHOOK_EVENT", () => {
    expect(eventHandlers[EventName.GITHUB_WEBHOOK_EVENT]).toBeDefined();
    expect(eventHandlers[EventName.GITHUB_WEBHOOK_EVENT].length).toBeGreaterThan(0);
  });

  it("skips pull_request events (delegated to pr-lifecycle-handler)", async () => {
    mockGetChannel.mockReturnValue({ id: "ch-1", repoId: "repo-1" });

    await triggerWebhookEvent({
      channelId: "ch-1",
      githubEventType: "pull_request",
      payload: { action: "opened", pull_request: { number: 42 } },
    });

    // pr-lifecycle-handler handles this, not the D2 classification path
    expect(mockGetPrDetails).not.toHaveBeenCalled();
  });

  it("skips events when channel has no repoId", async () => {
    mockGetChannel.mockReturnValue({ id: "ch-1", repoId: null });

    await triggerWebhookEvent({
      channelId: "ch-1",
      githubEventType: "pull_request_review",
      payload: { action: "submitted", pull_request: { number: 42 } },
    });

    expect(mockGetByRepoAndNumber).not.toHaveBeenCalled();
  });

  it("skips events when channel is not found", async () => {
    mockGetChannel.mockReturnValue(undefined);

    await triggerWebhookEvent({
      channelId: "ch-1",
      githubEventType: "pull_request_review",
      payload: { action: "submitted", pull_request: { number: 42 } },
    });

    expect(mockGetByRepoAndNumber).not.toHaveBeenCalled();
  });

  it("skips events when PR number cannot be extracted", async () => {
    mockGetChannel.mockReturnValue({ id: "ch-1", repoId: "repo-1" });

    await triggerWebhookEvent({
      channelId: "ch-1",
      githubEventType: "push",
      payload: { ref: "refs/heads/main" },
    });

    expect(mockGetByRepoAndNumber).not.toHaveBeenCalled();
  });

  it("skips events when PR entity is not found", async () => {
    mockGetChannel.mockReturnValue({ id: "ch-1", repoId: "repo-1" });
    mockGetByRepoAndNumber.mockReturnValue(undefined);

    await triggerWebhookEvent({
      channelId: "ch-1",
      githubEventType: "pull_request_review",
      payload: { action: "submitted", pull_request: { number: 99 } },
    });

    expect(mockGetPrDetails).not.toHaveBeenCalled();
  });

  it("refreshes display data on review submitted event", async () => {
    const pr = createPr();
    mockGetChannel.mockReturnValue({ id: "ch-1", repoId: "repo-1" });
    mockGetByRepoAndNumber.mockReturnValue(pr);

    await triggerWebhookEvent({
      channelId: "ch-1",
      githubEventType: "pull_request_review",
      payload: { action: "submitted", pull_request: { number: 42 } },
    });

    // Should fetch full PR details for review events
    expect(mockGetPrDetails).toHaveBeenCalledWith(42);
  });

  it("refreshes only checks on CI failure event", async () => {
    const pr = createPr();
    mockGetChannel.mockReturnValue({ id: "ch-1", repoId: "repo-1" });
    mockGetByRepoAndNumber.mockReturnValue(pr);

    // Pre-populate existing details in store
    usePullRequestStore.getState().setPrDetails(pr.id, {
      title: "Test",
      body: "",
      state: "OPEN",
      author: "test",
      url: "",
      isDraft: false,
      labels: [],
      reviewDecision: null,
      reviews: [],
      checks: [],
      reviewComments: [],
    });

    await triggerWebhookEvent({
      channelId: "ch-1",
      githubEventType: "check_run",
      payload: {
        action: "completed",
        check_run: {
          conclusion: "failure",
          pull_requests: [{ number: 42 }],
        },
      },
    });

    // Should only fetch checks, not full details
    expect(mockGetPrChecks).toHaveBeenCalledWith(42);
    expect(mockGetPrDetails).not.toHaveBeenCalled();
  });

  it("does not spawn agent when auto-address is disabled", async () => {
    const pr = createPr({ autoAddressEnabled: false });
    mockGetChannel.mockReturnValue({ id: "ch-1", repoId: "repo-1" });
    mockGetByRepoAndNumber.mockReturnValue(pr);

    await triggerWebhookEvent({
      channelId: "ch-1",
      githubEventType: "pull_request_review",
      payload: { action: "submitted", pull_request: { number: 42 } },
    });

    expect(mockCreateThread).not.toHaveBeenCalled();
  });

  it("debounces and spawns agent when auto-address is enabled", async () => {
    vi.useFakeTimers();

    const pr = createPr({
      autoAddressEnabled: true,
      gatewayChannelId: "ch-1",
    });
    mockGetChannel.mockReturnValue({ id: "ch-1", repoId: "repo-1" });
    mockGetByRepoAndNumber.mockReturnValue(pr);

    await triggerWebhookEvent({
      channelId: "ch-1",
      githubEventType: "pull_request_review",
      payload: { action: "submitted", pull_request: { number: 42 } },
    });

    // Agent not spawned immediately (debounced)
    expect(mockCreateThread).not.toHaveBeenCalled();

    // Advance past the 5s debounce window for review events
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mockCreateThread).toHaveBeenCalledOnce();
    expect(mockCreateThread).toHaveBeenCalledWith(
      expect.objectContaining({
        repoId: "repo-1",
        worktreeId: "wt-1",
        worktreePath: "/path/to/worktree",
        permissionMode: "approve",
      }),
    );

    // Verify prompt contains the address-pr-comment skill
    const callArgs = mockCreateThread.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("/mort:address-pr-comment");
    expect(callArgs.prompt).toContain("PR #42");

    vi.useRealTimers();
  });

  it("spawns fix-ci agent on CI failure with auto-address", async () => {
    vi.useFakeTimers();

    const pr = createPr({
      autoAddressEnabled: true,
      gatewayChannelId: "ch-1",
    });
    mockGetChannel.mockReturnValue({ id: "ch-1", repoId: "repo-1" });
    mockGetByRepoAndNumber.mockReturnValue(pr);

    // Provide existing details so CI refresh path works
    usePullRequestStore.getState().setPrDetails(pr.id, {
      title: "Test",
      body: "",
      state: "OPEN",
      author: "test",
      url: "",
      isDraft: false,
      labels: [],
      reviewDecision: null,
      reviews: [],
      checks: [],
      reviewComments: [],
    });

    await triggerWebhookEvent({
      channelId: "ch-1",
      githubEventType: "check_run",
      payload: {
        action: "completed",
        check_run: {
          conclusion: "failure",
          pull_requests: [{ number: 42 }],
        },
      },
    });

    // Advance past 30s debounce for CI events
    await vi.advanceTimersByTimeAsync(30_000);

    expect(mockCreateThread).toHaveBeenCalledOnce();
    const callArgs = mockCreateThread.mock.calls[0][0] as { prompt: string };
    expect(callArgs.prompt).toContain("/mort:fix-ci");

    vi.useRealTimers();
  });

  it("skips non-actionable events (e.g. check_run not completed)", async () => {
    const pr = createPr({ autoAddressEnabled: true });
    mockGetChannel.mockReturnValue({ id: "ch-1", repoId: "repo-1" });
    mockGetByRepoAndNumber.mockReturnValue(pr);

    await triggerWebhookEvent({
      channelId: "ch-1",
      githubEventType: "check_run",
      payload: {
        action: "created",
        check_run: {
          conclusion: "failure",
          pull_requests: [{ number: 42 }],
        },
      },
    });

    // Event should be classified as null (action is "created", not "completed")
    expect(mockGetPrDetails).not.toHaveBeenCalled();
    expect(mockGetPrChecks).not.toHaveBeenCalled();
  });
});
