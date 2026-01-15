/**
 * ModeIndicator UI Tests
 *
 * Validates rendering of mode indicator with different modes, variants, and states.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { ModeIndicator, ModeIndicatorWithShortcut } from "./mode-indicator";
import { AGENT_MODE_CONFIG } from "@/entities/agent-mode";
import type { AgentMode } from "@/entities/agent-mode";

describe("ModeIndicator UI", () => {
  describe("mode rendering", () => {
    it("renders normal mode with correct styling", () => {
      render(<ModeIndicator mode="normal" />);

      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator).toHaveTextContent("Normal");
      expect(indicator).toHaveAttribute("data-mode", "normal");
      expect(indicator).toHaveClass("text-surface-400", "bg-surface-700");
    });

    it("renders plan mode with correct styling", () => {
      render(<ModeIndicator mode="plan" />);

      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator).toHaveTextContent("Plan");
      expect(indicator).toHaveAttribute("data-mode", "plan");
      expect(indicator).toHaveClass("text-secondary-400", "bg-secondary-500/15");
    });

    it("renders auto-accept mode with correct styling", () => {
      render(<ModeIndicator mode="auto-accept" />);

      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator).toHaveTextContent("Auto");
      expect(indicator).toHaveAttribute("data-mode", "auto-accept");
      expect(indicator).toHaveClass("text-success-400", "bg-success-500/15");
    });
  });

  describe("variant rendering", () => {
    it("renders compact variant (default) with short label", () => {
      render(<ModeIndicator mode="normal" variant="compact" />);

      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator).toHaveTextContent("Normal");
      expect(indicator).not.toHaveTextContent("Normal Mode");
    });

    it("renders full variant with full label", () => {
      render(<ModeIndicator mode="normal" variant="full" />);

      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator).toHaveTextContent("Normal Mode");
    });

    it("renders full variant for all modes", () => {
      const modes: AgentMode[] = ["normal", "plan", "auto-accept"];

      for (const mode of modes) {
        const { unmount } = render(<ModeIndicator mode={mode} variant="full" />);
        const indicator = screen.getByTestId("mode-indicator");
        expect(indicator).toHaveTextContent(AGENT_MODE_CONFIG[mode].label);
        unmount();
      }
    });
  });

  describe("interactive behavior", () => {
    it("renders as span when no onClick provided", () => {
      render(<ModeIndicator mode="normal" />);

      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator.tagName).toBe("SPAN");
    });

    it("renders as button when onClick provided", () => {
      const onClick = vi.fn();
      render(<ModeIndicator mode="normal" onClick={onClick} />);

      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator.tagName).toBe("BUTTON");
      expect(indicator).toHaveAttribute("type", "button");
    });

    it("calls onClick when clicked", () => {
      const onClick = vi.fn();
      render(<ModeIndicator mode="normal" onClick={onClick} />);

      const indicator = screen.getByTestId("mode-indicator");
      fireEvent.click(indicator);

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("does not call onClick when disabled", () => {
      const onClick = vi.fn();
      render(<ModeIndicator mode="normal" onClick={onClick} disabled />);

      const indicator = screen.getByTestId("mode-indicator");
      fireEvent.click(indicator);

      expect(onClick).not.toHaveBeenCalled();
    });

    it("applies disabled styling when disabled", () => {
      const onClick = vi.fn();
      render(<ModeIndicator mode="normal" onClick={onClick} disabled />);

      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator).toHaveClass("opacity-50", "cursor-not-allowed");
      expect(indicator).toBeDisabled();
    });
  });

  describe("accessibility", () => {
    it("has role status", () => {
      render(<ModeIndicator mode="normal" />);

      expect(screen.getByRole("status")).toBeInTheDocument();
    });

    it("has correct aria-label without click handler", () => {
      render(<ModeIndicator mode="plan" />);

      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator).toHaveAttribute("aria-label", "Agent mode: Plan Mode");
    });

    it("has correct aria-label with click handler", () => {
      render(<ModeIndicator mode="plan" onClick={() => {}} />);

      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator).toHaveAttribute(
        "aria-label",
        "Agent mode: Plan Mode. Click to change."
      );
    });

    it("has title with description", () => {
      render(<ModeIndicator mode="auto-accept" />);

      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator).toHaveAttribute(
        "title",
        AGENT_MODE_CONFIG["auto-accept"].description
      );
    });
  });

  describe("custom className", () => {
    it("applies custom className", () => {
      render(<ModeIndicator mode="normal" className="custom-class" />);

      const indicator = screen.getByTestId("mode-indicator");
      expect(indicator).toHaveClass("custom-class");
    });
  });
});

describe("ModeIndicatorWithShortcut UI", () => {
  it("renders mode indicator with shortcut hint", () => {
    render(<ModeIndicatorWithShortcut mode="normal" />);

    expect(screen.getByTestId("mode-indicator")).toBeInTheDocument();
    expect(screen.getByText("Shift+Tab")).toBeInTheDocument();
  });

  it("hides shortcut hint when showShortcut is false", () => {
    render(<ModeIndicatorWithShortcut mode="normal" showShortcut={false} />);

    expect(screen.getByTestId("mode-indicator")).toBeInTheDocument();
    expect(screen.queryByText("Shift+Tab")).not.toBeInTheDocument();
  });

  it("passes props through to ModeIndicator", () => {
    const onClick = vi.fn();
    render(
      <ModeIndicatorWithShortcut
        mode="plan"
        variant="full"
        onClick={onClick}
        disabled
      />
    );

    const indicator = screen.getByTestId("mode-indicator");
    expect(indicator).toHaveTextContent("Plan Mode");
    expect(indicator).toBeDisabled();
  });
});
