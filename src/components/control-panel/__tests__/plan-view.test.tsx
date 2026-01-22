/**
 * PlanView Component Tests
 *
 * Tests for the PlanView component that displays plan content and metadata.
 * The component no longer has tabs - it shows a single view with markdown content.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanView } from "../plan-view";

// Mock Tauri core API for ControlPanelHeader
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Mock dependencies
vi.mock("@/entities/plans/store", () => ({
  usePlanStore: vi.fn((selector) =>
    selector({
      getPlan: (id: string) =>
        id === "valid-plan-id"
          ? {
              id: "valid-plan-id",
              repoId: "repo-1",
              worktreeId: "worktree-1",
              relativePath: "plans/test-plan.md",
              isRead: false,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }
          : null,
      plans: {},
    })
  ),
}));

vi.mock("@/hooks/use-plan-content", () => ({
  usePlanContent: vi.fn((planId: string) =>
    planId === "valid-plan-id" ? "# Test Plan\n\nSome content here." : null
  ),
}));

vi.mock("@/entities/relations", () => ({
  useRelatedThreads: vi.fn(() => []),
}));

vi.mock("@/components/thread/markdown-renderer", () => ({
  MarkdownRenderer: ({ content }: { content: string }) => (
    <div data-testid="markdown-renderer">{content}</div>
  ),
}));

describe("PlanView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("content display", () => {
    it("should render markdown content when loaded", () => {
      render(<PlanView planId="valid-plan-id" />);

      expect(screen.getByTestId("markdown-renderer")).toBeDefined();
      expect(screen.getByText(/Test Plan/)).toBeDefined();
    });

    it("should show 'Plan not found' for invalid plan", () => {
      render(<PlanView planId="invalid-plan-id" />);

      expect(screen.getByText("Plan not found")).toBeDefined();
    });
  });

  describe("metadata footer", () => {
    it("should show related threads count", () => {
      render(<PlanView planId="valid-plan-id" />);

      expect(screen.getByText(/0 related threads/)).toBeDefined();
    });
  });
});
