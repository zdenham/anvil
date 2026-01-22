/**
 * PlanInputArea Component Tests
 *
 * Tests for the PlanInputArea component that creates new threads from a plan view.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PlanInputArea } from "../plan-input-area";

// Mock dependencies
vi.mock("@/entities/plans/store", () => ({
  usePlanStore: vi.fn((selector) =>
    selector({
      getPlan: (id: string) =>
        id === "valid-plan-id"
          ? {
              id: "valid-plan-id",
              name: "Test Plan",
              filePath: "/test/plan.md",
              repoId: "repo-123",
              worktreeId: "worktree-456",
            }
          : null,
    })
  ),
}));

vi.mock("../store", () => ({
  useControlPanelStore: vi.fn((selector) =>
    selector({
      setView: vi.fn(),
    })
  ),
}));

vi.mock("@/entities/threads/service", () => ({
  threadService: {
    create: vi.fn().mockResolvedValue({ id: "new-thread-id" }),
    sendMessage: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/entities/relations/service", () => ({
  relationService: {
    createOrUpgrade: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("PlanInputArea", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show placeholder "Start a new thread about this plan..."', () => {
    render(<PlanInputArea planId="valid-plan-id" />);

    const textarea = screen.getByPlaceholderText(
      "Start a new thread about this plan..."
    );
    expect(textarea).toBeDefined();
  });

  it("should enable send button when message is not empty", () => {
    render(<PlanInputArea planId="valid-plan-id" />);

    const textarea = screen.getByPlaceholderText(
      "Start a new thread about this plan..."
    );
    const button = screen.getByRole("button", { name: /Start Thread/i });

    // Initially disabled
    expect(button.hasAttribute("disabled")).toBe(true);

    // Type a message
    fireEvent.change(textarea, { target: { value: "Test message" } });

    // Now enabled
    expect(button.hasAttribute("disabled")).toBe(false);
  });

  it("should disable send button when message is empty", () => {
    render(<PlanInputArea planId="valid-plan-id" />);

    const button = screen.getByRole("button", { name: /Start Thread/i });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("should allow newlines with Shift+Enter", () => {
    render(<PlanInputArea planId="valid-plan-id" />);

    const textarea = screen.getByPlaceholderText(
      "Start a new thread about this plan..."
    ) as HTMLTextAreaElement;

    // Type initial text
    fireEvent.change(textarea, { target: { value: "Line 1" } });

    // Shift+Enter should not submit
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });

    // Button should still be enabled (not loading/submitted)
    const button = screen.getByRole("button", { name: /Start Thread/i });
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});
