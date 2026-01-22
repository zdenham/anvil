/**
 * ThreadInput UI Tests
 *
 * Validates ThreadInput behavior including keyboard interaction and message submission.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { ThreadInput } from "./thread-input";

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
  const mockOnSubmit = vi.fn();

  const defaultProps = {
    onSubmit: mockOnSubmit,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("keyboard interaction", () => {
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
    it("does not submit when disabled", () => {
      render(<ThreadInput {...defaultProps} disabled />);
      const textarea = screen.getByTestId("mock-trigger-input");
      fireEvent.change(textarea, { target: { value: "test message" } });
      fireEvent.keyDown(textarea, { key: "Enter" });
      expect(mockOnSubmit).not.toHaveBeenCalled();
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
