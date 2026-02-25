// @vitest-environment node
/**
 * Gateway Handler Tests
 *
 * Tests for handlePrGatewayEvent including:
 * - PR number extraction from various event types
 * - Display data refresh on events
 * - Auto-address disable on PR closed
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { usePullRequestStore } from "../store";
import type { PullRequestMetadata } from "../types";
import type { GatewayEvent } from "@core/types/gateway-events.js";

// Mock dependencies
vi.mock("@/lib/logger-client", () => ({
  logger: {
    log: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../events", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

const mockFetchDetails = vi.fn().mockResolvedValue(null);
const mockDisableAutoAddress = vi.fn().mockResolvedValue(undefined);

vi.mock("../service", () => ({
  pullRequestService: {
    fetchDetails: (...args: unknown[]) => mockFetchDetails(...args),
    disableAutoAddress: (...args: unknown[]) => mockDisableAutoAddress(...args),
  },
}));

function createPrMetadata(
  overrides: Partial<PullRequestMetadata> = {},
): PullRequestMetadata {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    prNumber: 42,
    repoId: "repo-1",
    worktreeId: crypto.randomUUID(),
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

function createGatewayEvent(
  overrides: Partial<GatewayEvent> = {},
): GatewayEvent {
  return {
    id: crypto.randomUUID(),
    type: "github.pull_request",
    channelId: "channel-1",
    payload: {},
    receivedAt: Date.now(),
    ...overrides,
  };
}

describe("handlePrGatewayEvent", () => {
  let handlePrGatewayEvent: typeof import("../gateway-handler").handlePrGatewayEvent;

  beforeEach(async () => {
    usePullRequestStore.setState({
      pullRequests: {},
      _prsArray: [],
      prDetails: {},
      prDetailsLoading: {},
      _hydrated: false,
    });
    vi.clearAllMocks();

    const mod = await import("../gateway-handler");
    handlePrGatewayEvent = mod.handlePrGatewayEvent;
  });

  it("ignores events without a PR number", async () => {
    const event = createGatewayEvent({
      type: "github.push",
      payload: {},
    });

    await handlePrGatewayEvent(event, "repo-1");

    expect(mockFetchDetails).not.toHaveBeenCalled();
  });

  it("extracts PR number from pull_request events", async () => {
    const pr = createPrMetadata({ id: "pr-1", prNumber: 42, repoId: "repo-1" });
    usePullRequestStore.getState()._applyCreate(pr);

    const event = createGatewayEvent({
      type: "github.pull_request",
      payload: { pull_request: { number: 42 }, action: "synchronize" },
    });

    await handlePrGatewayEvent(event, "repo-1");

    expect(mockFetchDetails).toHaveBeenCalledWith("pr-1");
  });

  it("extracts PR number from issue_comment events on PRs", async () => {
    const pr = createPrMetadata({ id: "pr-1", prNumber: 42, repoId: "repo-1" });
    usePullRequestStore.getState()._applyCreate(pr);

    const event = createGatewayEvent({
      type: "github.issue_comment",
      payload: {
        issue: { number: 42, pull_request: {} },
        action: "created",
      },
    });

    await handlePrGatewayEvent(event, "repo-1");

    expect(mockFetchDetails).toHaveBeenCalledWith("pr-1");
  });

  it("extracts PR number from check_run events", async () => {
    const pr = createPrMetadata({ id: "pr-1", prNumber: 42, repoId: "repo-1" });
    usePullRequestStore.getState()._applyCreate(pr);

    const event = createGatewayEvent({
      type: "github.check_run",
      payload: {
        check_run: { pull_requests: [{ number: 42 }] },
      },
    });

    await handlePrGatewayEvent(event, "repo-1");

    expect(mockFetchDetails).toHaveBeenCalledWith("pr-1");
  });

  it("ignores check_run events with empty pull_requests", async () => {
    const event = createGatewayEvent({
      type: "github.check_run",
      payload: {
        check_run: { pull_requests: [] },
      },
    });

    await handlePrGatewayEvent(event, "repo-1");

    expect(mockFetchDetails).not.toHaveBeenCalled();
  });

  it("disables auto-address on PR closed event", async () => {
    const pr = createPrMetadata({
      id: "pr-1",
      prNumber: 42,
      repoId: "repo-1",
      autoAddressEnabled: true,
    });
    usePullRequestStore.getState()._applyCreate(pr);

    const event = createGatewayEvent({
      type: "github.pull_request",
      payload: {
        pull_request: { number: 42 },
        action: "closed",
      },
    });

    await handlePrGatewayEvent(event, "repo-1");

    expect(mockDisableAutoAddress).toHaveBeenCalledWith("pr-1");
  });

  it("does not disable auto-address on closed event if already disabled", async () => {
    const pr = createPrMetadata({
      id: "pr-1",
      prNumber: 42,
      repoId: "repo-1",
      autoAddressEnabled: false,
    });
    usePullRequestStore.getState()._applyCreate(pr);

    const event = createGatewayEvent({
      type: "github.pull_request",
      payload: {
        pull_request: { number: 42 },
        action: "closed",
      },
    });

    await handlePrGatewayEvent(event, "repo-1");

    expect(mockDisableAutoAddress).not.toHaveBeenCalled();
  });

  it("does not fetch details for unknown PR", async () => {
    const event = createGatewayEvent({
      type: "github.pull_request",
      payload: { pull_request: { number: 999 }, action: "opened" },
    });

    await handlePrGatewayEvent(event, "repo-1");

    // No PR entity exists for #999, so fetchDetails should not be called
    expect(mockFetchDetails).not.toHaveBeenCalled();
  });
});
