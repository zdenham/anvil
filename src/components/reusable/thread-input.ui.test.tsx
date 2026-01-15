/**
 * ThreadInput UI Tests
 *
 * Validates ThreadInput behavior including mode switching integration.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { ThreadInput } from "./thread-input";
import { useAgentModeStore } from "@/entities/agent-mode";

// Mock the TriggerSearchInput to simplify testing
vi.mock("./trigger-search-input", () => ({
  TriggerSearchInput: vi.fn(
    ({
      value,
      onChange,
      onKeyDown,
      disabled,
      placeholder,
      "aria-label": ariaLabel,
    }) => (
      <textarea
        data-testid="mock-trigger-input"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        aria-label={ariaLabel}
      />
    )
  ),
}));

describe("ThreadInput", () => {
  const threadId = "test-thread-123";
  const mockOnSubmit = vi.fn();

  const defaultProps = {
    threadId,
    onSubmit: mockOnSubmit,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state before each test
    useAgentModeStore.setState({
      threadModes: {},
      defaultMode: "normal",
    });
  });

  describe("mode indicator display", () => {
    it("shows mode indicator with current mode", () => {
      render(<ThreadInput {...defaultProps} />);
      expect(screen.getByRole("status")).toHaveTextContent("Normal");
    });

    it("shows shortcut hint", () => {
      render(<ThreadInput {...defaultProps} />);
      expect(screen.getByText("Shift+Tab")).toBeInTheDocument();
    });

    it("shows correct mode when thread has custom mode", () => {
      useAgentModeStore.getState().setMode(threadId, "plan");
      render(<ThreadInput {...defaultProps} />);
      expect(screen.getByRole("status")).toHaveTextContent("Plan");
    });
  });

  describe("keyboard interaction", () => {
    it("cycles through all modes with Shift+Tab", () => {
      render(<ThreadInput {...defaultProps} />);
      const textarea = screen.getByTestId("mock-trigger-input");
      const indicator = screen.getByRole("status");

      expect(indicator).toHaveTextContent("Normal");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
      expect(indicator).toHaveTextContent("Plan");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
      expect(indicator).toHaveTextContent("Auto");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
      expect(indicator).toHaveTextContent("Normal");
    });

    it("submits with Enter and clears input", () => {
      render(<ThreadInput {...defaultProps} />);
      const textarea = screen.getByTestId("mock-trigger-input");
      fireEvent.change(textarea, { target: { value: "hello world" } });
      fireEvent.keyDown(textarea, { key: "Enter" });

      expect(mockOnSubmit).toHaveBeenCalledWith("hello world");
      expect(textarea).toHaveValue("");
    });

    it("does not submit on Shift+Enter (allows newline)", () => {
      render(<ThreadInput {...defaultProps} />);
      const textarea = screen.getByTestId("mock-trigger-input");
      fireEvent.change(textarea, { target: { value: "hello world" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it("does not submit empty messages", () => {
      render(<ThreadInput {...defaultProps} />);
      const textarea = screen.getByTestId("mock-trigger-input");
      fireEvent.keyDown(textarea, { key: "Enter" });
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });

    it("does not submit whitespace-only messages", () => {
      render(<ThreadInput {...defaultProps} />);
      const textarea = screen.getByTestId("mock-trigger-input");
      fireEvent.change(textarea, { target: { value: "   " } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  describe("disabled state", () => {
    it("does not cycle modes when disabled", () => {
      render(<ThreadInput {...defaultProps} disabled />);
      const textarea = screen.getByTestId("mock-trigger-input");
      const indicator = screen.getByRole("status");

      expect(indicator).toHaveTextContent("Normal");
      fireEvent.keyDown(textarea, { key: "Tab", shiftKey: true });
      // Mode should remain unchanged when disabled
      expect(indicator).toHaveTextContent("Normal");
    });

    it("does not submit when disabled", () => {
      render(<ThreadInput {...defaultProps} disabled />);
      const textarea = screen.getByTestId("mock-trigger-input");
      fireEvent.change(textarea, { target: { value: "test message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      expect(mockOnSubmit).not.toHaveBeenCalled();
    });
  });

  describe("per-thread mode persistence", () => {
    it("maintains separate modes per thread", () => {
      // Set different modes for different threads
      useAgentModeStore.getState().setMode("thread-a", "plan");
      useAgentModeStore.getState().setMode("thread-b", "auto-accept");

      const { rerender } = render(
        <ThreadInput {...defaultProps} threadId="thread-a" />
      );
      expect(screen.getByRole("status")).toHaveTextContent("Plan");

      rerender(<ThreadInput {...defaultProps} threadId="thread-b" />);
      expect(screen.getByRole("status")).toHaveTextContent("Auto");
    });

    it("shows default mode for new thread", () => {
      useAgentModeStore.getState().setMode("existing-thread", "plan");
      render(<ThreadInput {...defaultProps} threadId="new-thread" />);
      expect(screen.getByRole("status")).toHaveTextContent("Normal");
    });
  });

  describe("placeholder", () => {
    it("shows custom placeholder", () => {
      render(<ThreadInput {...defaultProps} placeholder="Ask something..." />);
      expect(screen.getByTestId("mock-trigger-input")).toHaveAttribute(
        "placeholder",
        "Ask something..."
      );
    });

    it("shows disabled placeholder when disabled", () => {
      render(<ThreadInput {...defaultProps} disabled />);
      expect(screen.getByTestId("mock-trigger-input")).toHaveAttribute(
        "placeholder",
        "Agent is running..."
      );
    });
  });
});
