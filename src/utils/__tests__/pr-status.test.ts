// @vitest-environment node
import { describe, it, expect } from "vitest";
import { derivePrStatusDot } from "../pr-status";
import type { PullRequestDetails } from "@/entities/pull-requests/types";

function makeDetails(overrides: Partial<PullRequestDetails> = {}): PullRequestDetails {
  return {
    title: "Test PR",
    body: "",
    state: "OPEN",
    author: "testuser",
    url: "https://github.com/org/repo/pull/1",
    isDraft: false,
    labels: [],
    reviewDecision: null,
    reviews: [],
    checks: [],
    reviewComments: [],
    ...overrides,
  };
}

describe("derivePrStatusDot", () => {
  it("returns 'read' when details is undefined", () => {
    expect(derivePrStatusDot(undefined)).toBe("read");
  });

  it("returns 'read' for merged PR", () => {
    expect(derivePrStatusDot(makeDetails({ state: "MERGED" }))).toBe("read");
  });

  it("returns 'read' for closed PR", () => {
    expect(derivePrStatusDot(makeDetails({ state: "CLOSED" }))).toBe("read");
  });

  it("returns 'unread' for draft PR", () => {
    expect(derivePrStatusDot(makeDetails({ isDraft: true }))).toBe("unread");
  });

  it("returns 'stale' when checks are failing", () => {
    const details = makeDetails({
      checks: [{ name: "ci", status: "fail", conclusion: "failure", url: null, startedAt: null, completedAt: null }],
    });
    expect(derivePrStatusDot(details)).toBe("stale");
  });

  it("returns 'stale' when changes are requested", () => {
    const details = makeDetails({ reviewDecision: "CHANGES_REQUESTED" });
    expect(derivePrStatusDot(details)).toBe("stale");
  });

  it("returns 'running' when checks are pending", () => {
    const details = makeDetails({
      checks: [{ name: "ci", status: "pending", conclusion: null, url: null, startedAt: null, completedAt: null }],
    });
    expect(derivePrStatusDot(details)).toBe("running");
  });

  it("returns 'read' for open PR with all checks passing", () => {
    const details = makeDetails({
      checks: [{ name: "ci", status: "pass", conclusion: "success", url: null, startedAt: null, completedAt: null }],
    });
    expect(derivePrStatusDot(details)).toBe("read");
  });

  it("returns 'read' for open PR with no checks", () => {
    expect(derivePrStatusDot(makeDetails())).toBe("read");
  });

  it("prioritizes 'stale' over 'running' when both fail and pending checks exist", () => {
    const details = makeDetails({
      checks: [
        { name: "ci-1", status: "fail", conclusion: "failure", url: null, startedAt: null, completedAt: null },
        { name: "ci-2", status: "pending", conclusion: null, url: null, startedAt: null, completedAt: null },
      ],
    });
    expect(derivePrStatusDot(details)).toBe("stale");
  });

  it("prioritizes draft over check status", () => {
    const details = makeDetails({
      isDraft: true,
      checks: [{ name: "ci", status: "fail", conclusion: "failure", url: null, startedAt: null, completedAt: null }],
    });
    expect(derivePrStatusDot(details)).toBe("unread");
  });

  it("prioritizes merged state over everything else", () => {
    const details = makeDetails({
      state: "MERGED",
      isDraft: true,
      checks: [{ name: "ci", status: "fail", conclusion: "failure", url: null, startedAt: null, completedAt: null }],
      reviewDecision: "CHANGES_REQUESTED",
    });
    expect(derivePrStatusDot(details)).toBe("read");
  });
});
