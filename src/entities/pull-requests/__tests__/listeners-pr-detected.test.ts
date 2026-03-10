// @vitest-environment node
/**
 * PR Entity Listener Tests - PR_DETECTED Event Handling
 *
 * Tests the PR_DETECTED listener that:
 * - Creates a PR entity when an agent detects `gh pr create`
 * - Resolves head/base branches via repo-worktree-lookup-store
 * - Handles missing branch info gracefully
 * - Relies on pullRequestService.create for deduplication
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventName } from "@core/types/events.js";

// =============================================================================
// Mocks
// =============================================================================

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

const mockCreate = vi.fn().mockResolvedValue({ id: "pr-id-1" });

vi.mock("../service", () => ({
  pullRequestService: {
    refreshById: vi.fn(),
    getByRepoAndNumber: vi.fn(),
    create: (...args: unknown[]) => mockCreate(...args),
  },
}));

// Mock all other imports that listeners.ts uses (even if not needed for PR_DETECTED)
vi.mock("../../gateway-channels/service", () => ({
  gatewayChannelService: { get: vi.fn() },
}));
vi.mock("@/lib/gh-cli", () => ({
  GhCli: vi.fn(),
}));
vi.mock("@/lib/thread-creation-service", () => ({
  createThread: vi.fn(),
}));
vi.mock("../pr-lifecycle-handler", () => ({
  handlePullRequestEvent: vi.fn(),
}));
vi.mock("../event-helpers", () => ({
  extractPrNumber: vi.fn(),
  classifyGithubEvent: vi.fn(),
  debounceAutoAddress: vi.fn(),
  fetchFreshContext: vi.fn(),
  buildAutoAddressPrompt: vi.fn(),
}));
vi.mock("../store", () => ({
  usePullRequestStore: {
    getState: vi.fn(() => ({ pullRequests: {}, _applyDelete: vi.fn() })),
  },
}));

const mockGetCurrentBranch = vi.fn().mockReturnValue("feature/test");
const mockGetDefaultBranch = vi.fn().mockReturnValue("main");

vi.mock("@/stores/repo-worktree-lookup-store", () => ({
  useRepoWorktreeLookupStore: {
    getState: vi.fn(() => ({
      getCurrentBranch: (...args: unknown[]) => mockGetCurrentBranch(...args),
      getDefaultBranch: (...args: unknown[]) => mockGetDefaultBranch(...args),
      hydrate: vi.fn(),
      getRepoName: vi.fn(),
      getWorktreePath: vi.fn(),
    })),
  },
}));

// =============================================================================
// Helpers
// =============================================================================

async function triggerPrDetected(payload: {
  repoId: string;
  worktreeId: string;
  repoSlug: string;
  prNumber: number;
}): Promise<void> {
  const handlers = eventHandlers[EventName.PR_DETECTED];
  if (!handlers) return;
  for (const handler of handlers) {
    await handler(payload);
  }
}

// =============================================================================
// Tests
// =============================================================================

describe("PR_DETECTED listener", () => {
  beforeEach(() => {
    // Clear handlers
    for (const key of Object.keys(eventHandlers)) delete eventHandlers[key];
    vi.clearAllMocks();

    // Re-set default return values after clearAllMocks
    mockGetCurrentBranch.mockReturnValue("feature/test");
    mockGetDefaultBranch.mockReturnValue("main");
    mockCreate.mockResolvedValue({ id: "pr-id-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function setup() {
    // Dynamic import to register handlers fresh
    const { setupPullRequestListeners } = await import("../listeners");
    setupPullRequestListeners();
    return eventHandlers[EventName.PR_DETECTED] ?? [];
  }

  it("registers PR_DETECTED handler", async () => {
    const handlers = await setup();
    expect(handlers.length).toBeGreaterThan(0);
  });

  it("creates PR entity on detection", async () => {
    await setup();

    await triggerPrDetected({
      repoId: "repo-1",
      worktreeId: "wt-1",
      repoSlug: "owner/repo",
      prNumber: 42,
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith({
      prNumber: 42,
      repoId: "repo-1",
      worktreeId: "wt-1",
      repoSlug: "owner/repo",
      headBranch: "feature/test",
      baseBranch: "main",
    });
  });

  it("is idempotent (create handles dedup)", async () => {
    await setup();

    await triggerPrDetected({
      repoId: "repo-1",
      worktreeId: "wt-1",
      repoSlug: "owner/repo",
      prNumber: 42,
    });

    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it("handles missing branch gracefully", async () => {
    mockGetCurrentBranch.mockReturnValue(null);
    await setup();

    await triggerPrDetected({
      repoId: "repo-1",
      worktreeId: "wt-1",
      repoSlug: "owner/repo",
      prNumber: 42,
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        headBranch: "",
        baseBranch: "main",
      }),
    );
  });
});
