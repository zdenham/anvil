// @vitest-environment node
/**
 * Event Helpers Tests
 *
 * Tests for pure helper functions used by the PR entity listener:
 * - extractPrNumber: PR number extraction from various webhook payloads
 * - classifyGithubEvent: Event classification into actionable PrAction types
 * - debounceAutoAddress: Per-PR + action-type debouncing
 * - buildAutoAddressPrompt: Prompt generation for auto-address agents
 * - threadName: Thread name generation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractPrNumber,
  classifyGithubEvent,
  debounceAutoAddress,
  clearAllDebounceTimers,
  buildAutoAddressPrompt,
  threadName,
  type PrAction,
} from "../event-helpers";
import type { PullRequestMetadata } from "../types";

// ═══════════════════════════════════════════════════════════════════════════
// extractPrNumber
// ═══════════════════════════════════════════════════════════════════════════

describe("extractPrNumber", () => {
  it("extracts from pull_request_review event", () => {
    const result = extractPrNumber("pull_request_review", {
      pull_request: { number: 42 },
    });
    expect(result).toBe(42);
  });

  it("extracts from issue_comment on a PR", () => {
    const result = extractPrNumber("issue_comment", {
      issue: { number: 7, pull_request: {} },
    });
    expect(result).toBe(7);
  });

  it("returns null for issue_comment on a non-PR issue", () => {
    const result = extractPrNumber("issue_comment", {
      issue: { number: 7 },
    });
    expect(result).toBeNull();
  });

  it("extracts from check_run with pull_requests array", () => {
    const result = extractPrNumber("check_run", {
      check_run: { pull_requests: [{ number: 15 }] },
    });
    expect(result).toBe(15);
  });

  it("returns null for check_run with empty pull_requests array", () => {
    const result = extractPrNumber("check_run", {
      check_run: { pull_requests: [] },
    });
    expect(result).toBeNull();
  });

  it("returns null for check_run without pull_requests", () => {
    const result = extractPrNumber("check_run", {
      check_run: {},
    });
    expect(result).toBeNull();
  });

  it("extracts from check_suite with pull_requests array", () => {
    const result = extractPrNumber("check_suite", {
      check_suite: { pull_requests: [{ number: 33 }] },
    });
    expect(result).toBe(33);
  });

  it("returns null for check_suite with empty pull_requests array", () => {
    const result = extractPrNumber("check_suite", {
      check_suite: { pull_requests: [] },
    });
    expect(result).toBeNull();
  });

  it("returns null for unknown event type", () => {
    const result = extractPrNumber("push", { ref: "refs/heads/main" });
    expect(result).toBeNull();
  });

  it("returns null when pull_request field is missing", () => {
    const result = extractPrNumber("pull_request_review", {});
    expect(result).toBeNull();
  });

  it("returns null when number is not a number", () => {
    const result = extractPrNumber("pull_request_review", {
      pull_request: { number: "not-a-number" },
    });
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// classifyGithubEvent
// ═══════════════════════════════════════════════════════════════════════════

describe("classifyGithubEvent", () => {
  it("classifies check_run with failure conclusion", () => {
    const result = classifyGithubEvent("check_run", {
      action: "completed",
      check_run: { conclusion: "failure" },
    });
    expect(result).toEqual({ type: "ci-failure" });
  });

  it("classifies check_run with timed_out conclusion", () => {
    const result = classifyGithubEvent("check_run", {
      action: "completed",
      check_run: { conclusion: "timed_out" },
    });
    expect(result).toEqual({ type: "ci-failure" });
  });

  it("returns null for check_run with success conclusion", () => {
    const result = classifyGithubEvent("check_run", {
      action: "completed",
      check_run: { conclusion: "success" },
    });
    expect(result).toBeNull();
  });

  it("returns null for check_run with non-completed action", () => {
    const result = classifyGithubEvent("check_run", {
      action: "created",
      check_run: { conclusion: "failure" },
    });
    expect(result).toBeNull();
  });

  it("classifies check_suite with failure conclusion", () => {
    const result = classifyGithubEvent("check_suite", {
      action: "completed",
      check_suite: { conclusion: "failure" },
    });
    expect(result).toEqual({ type: "ci-failure" });
  });

  it("returns null for check_suite with success", () => {
    const result = classifyGithubEvent("check_suite", {
      action: "completed",
      check_suite: { conclusion: "success" },
    });
    expect(result).toBeNull();
  });

  it("classifies pull_request_review submitted", () => {
    const result = classifyGithubEvent("pull_request_review", {
      action: "submitted",
    });
    expect(result).toEqual({ type: "review-submitted" });
  });

  it("returns null for pull_request_review with non-submitted action", () => {
    const result = classifyGithubEvent("pull_request_review", {
      action: "edited",
    });
    expect(result).toBeNull();
  });

  it("classifies pull_request_review submitted with commented state (inline comments)", () => {
    const result = classifyGithubEvent("pull_request_review", {
      action: "submitted",
      review: { state: "commented", body: "" },
    });
    expect(result).toEqual({ type: "review-submitted" });
  });

  it("classifies issue_comment created", () => {
    const result = classifyGithubEvent("issue_comment", {
      action: "created",
    });
    expect(result).toEqual({ type: "pr-comment" });
  });

  it("returns null for issue_comment with non-created action", () => {
    const result = classifyGithubEvent("issue_comment", {
      action: "deleted",
    });
    expect(result).toBeNull();
  });

  it("returns null for unknown event type", () => {
    const result = classifyGithubEvent("push", { ref: "refs/heads/main" });
    expect(result).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// debounceAutoAddress
// ═══════════════════════════════════════════════════════════════════════════

describe("debounceAutoAddress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearAllDebounceTimers();
    vi.useRealTimers();
  });

  it("fires callback after debounce window for review events (5s)", () => {
    const fn = vi.fn();
    debounceAutoAddress("pr-1", { type: "review-submitted" }, fn);

    vi.advanceTimersByTime(4_999);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("fires callback after debounce window for CI events (30s)", () => {
    const fn = vi.fn();
    debounceAutoAddress("pr-1", { type: "ci-failure" }, fn);

    vi.advanceTimersByTime(29_999);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("resets debounce window on rapid-fire events", () => {
    const fn = vi.fn();
    debounceAutoAddress("pr-1", { type: "review-submitted" }, fn);

    vi.advanceTimersByTime(3_000);
    debounceAutoAddress("pr-1", { type: "review-submitted" }, fn);

    vi.advanceTimersByTime(3_000);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2_000);
    expect(fn).toHaveBeenCalledOnce();
  });

  it("debounces independently per PR", () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();
    debounceAutoAddress("pr-1", { type: "review-submitted" }, fn1);
    debounceAutoAddress("pr-2", { type: "review-submitted" }, fn2);

    vi.advanceTimersByTime(5_000);

    expect(fn1).toHaveBeenCalledOnce();
    expect(fn2).toHaveBeenCalledOnce();
  });

  it("debounces independently per action type", () => {
    const fnReview = vi.fn();
    const fnCi = vi.fn();
    debounceAutoAddress("pr-1", { type: "review-submitted" }, fnReview);
    debounceAutoAddress("pr-1", { type: "ci-failure" }, fnCi);

    vi.advanceTimersByTime(5_000);
    expect(fnReview).toHaveBeenCalledOnce();
    expect(fnCi).not.toHaveBeenCalled();

    vi.advanceTimersByTime(25_000);
    expect(fnCi).toHaveBeenCalledOnce();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildAutoAddressPrompt
// ═══════════════════════════════════════════════════════════════════════════

describe("buildAutoAddressPrompt", () => {
  const basePr: PullRequestMetadata = {
    id: "pr-id-1",
    prNumber: 42,
    repoId: "repo-1",
    worktreeId: "wt-1",
    repoSlug: "owner/repo",
    headBranch: "feature/test",
    baseBranch: "main",
    autoAddressEnabled: true,
    gatewayChannelId: "ch-1",
    isViewed: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  it("builds fix-ci prompt for ci-failure actions", () => {
    const prompt = buildAutoAddressPrompt(basePr, { type: "ci-failure" }, "- test: failure");
    expect(prompt).toContain("/mort:fix-ci");
    expect(prompt).toContain("PR #42");
    expect(prompt).toContain("owner/repo");
    expect(prompt).toContain("feature/test");
    expect(prompt).toContain("- test: failure");
  });

  it("builds address-pr-comment prompt for review-submitted actions", () => {
    const prompt = buildAutoAddressPrompt(basePr, { type: "review-submitted" }, "comments");
    expect(prompt).toContain("/mort:address-pr-comment");
  });

  it("builds address-pr-comment prompt for pr-comment actions", () => {
    const prompt = buildAutoAddressPrompt(basePr, { type: "pr-comment" }, "comments");
    expect(prompt).toContain("/mort:address-pr-comment");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// threadName
// ═══════════════════════════════════════════════════════════════════════════

describe("threadName", () => {
  it("returns CI fix name", () => {
    expect(threadName({ type: "ci-failure" }, 42)).toBe("Fix CI on PR #42");
  });

  it("returns review address name for review-submitted", () => {
    expect(threadName({ type: "review-submitted" }, 7)).toBe("Address review on PR #7");
  });

  it("returns comment response name", () => {
    expect(threadName({ type: "pr-comment" }, 99)).toBe("Respond to comment on PR #99");
  });
});
