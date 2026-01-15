/**
 * SimpleTaskHeader UI Tests
 *
 * Validates the header component including ModeIndicator integration,
 * status display, and delete functionality.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { SimpleTaskHeader } from "./simple-task-header";
import { useAgentModeStore } from "@/entities/agent-mode";

// Mock the tauri window API
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Mock the task service
vi.mock("@/entities/tasks/service", () => ({
  taskService: {
    delete: vi.fn().mockResolvedValue(undefined),
  },
}));

describe("SimpleTaskHeader", () => {
  const defaultProps = {
    taskId: "task-12345678",
    threadId: "thread-456",
    status: "idle" as const,
  };

  beforeEach(() => {
    // Reset store state before each test
    useAgentModeStore.setState({
      threadModes: {},
      defaultMode: "normal",
    });
  });

  describe("mode indicator", () => {
    it("displays the mode indicator", () => {
      render(<SimpleTaskHeader {...defaultProps} />);
      expect(screen.getByTestId("mode-indicator")).toBeInTheDocument();
    });

    it("displays normal mode by default", () => {
      render(<SimpleTaskHeader {...defaultProps} />);
      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator).toHaveAttribute("data-mode", "normal");
    });

    it("toggles mode through all states", () => {
      render(<SimpleTaskHeader {...defaultProps} />);
      const indicator = screen.getByTestId("mode-indicator");

      expect(indicator).toHaveAttribute("data-mode", "normal");
      fireEvent.click(indicator);
      expect(indicator).toHaveAttribute("data-mode", "plan");
      fireEvent.click(indicator);
      expect(indicator).toHaveAttribute("data-mode", "auto-accept");
      fireEvent.click(indicator);
      expect(indicator).toHaveAttribute("data-mode", "normal");
    });

    it("disables indicator when status is running", () => {
      render(<SimpleTaskHeader {...defaultProps} status="running" />);
      expect(screen.getByTestId("mode-indicator")).toBeDisabled();
    });

    it("enables indicator when status is idle", () => {
      render(<SimpleTaskHeader {...defaultProps} status="idle" />);
      expect(screen.getByTestId("mode-indicator")).not.toBeDisabled();
    });

    it("enables indicator when status is completed", () => {
      render(<SimpleTaskHeader {...defaultProps} status="completed" />);
      expect(screen.getByTestId("mode-indicator")).not.toBeDisabled();
    });

    it("enables indicator when status is error", () => {
      render(<SimpleTaskHeader {...defaultProps} status="error" />);
      expect(screen.getByTestId("mode-indicator")).not.toBeDisabled();
    });
  });

  describe("mode persistence per thread", () => {
    it("mode persists per thread", () => {
      // Set mode for thread-456
      useAgentModeStore.getState().setMode("thread-456", "plan");

      render(<SimpleTaskHeader {...defaultProps} />);
      const indicator = screen.getByTestId("mode-indicator");

      expect(indicator).toHaveAttribute("data-mode", "plan");
    });

    it("different threads have independent modes", () => {
      // Set different modes for different threads
      useAgentModeStore.getState().setMode("thread-1", "plan");
      useAgentModeStore.getState().setMode("thread-2", "auto-accept");

      const { rerender } = render(
        <SimpleTaskHeader {...defaultProps} threadId="thread-1" />
      );
      expect(screen.getByTestId("mode-indicator")).toHaveAttribute(
        "data-mode",
        "plan"
      );

      rerender(<SimpleTaskHeader {...defaultProps} threadId="thread-2" />);
      expect(screen.getByTestId("mode-indicator")).toHaveAttribute(
        "data-mode",
        "auto-accept"
      );
    });
  });

  describe("header display", () => {
    it("displays truncated task id", () => {
      render(<SimpleTaskHeader {...defaultProps} />);
      expect(screen.getByText("task-123...")).toBeInTheDocument();
    });

    it("displays status badge", () => {
      render(<SimpleTaskHeader {...defaultProps} status="running" />);
      expect(screen.getByText("running")).toBeInTheDocument();
    });

    it("displays delete button", () => {
      render(<SimpleTaskHeader {...defaultProps} />);
      // DeleteButton renders an icon button without accessible name
      // ModeIndicator has role="status" so only DeleteButton matches role="button"
      const deleteButton = screen.getByRole("button");
      expect(deleteButton).toBeInTheDocument();
    });
  });
});
