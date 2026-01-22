/**
 * ControlPanelHeader UI Tests
 *
 * Validates the header component including status display, view toggle,
 * and navigation functionality.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { ControlPanelHeader } from "./control-panel-header";

// Mock the tauri core API
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

// Mock the agent service
vi.mock("@/lib/agent-service", () => ({
  cancelAgent: vi.fn().mockResolvedValue(true),
}));

describe("ControlPanelHeader", () => {
  const defaultThreadView = {
    view: { type: "thread" as const, threadId: "thread-12345678" },
    threadTab: "conversation" as const,
    isStreaming: false,
  };

  const defaultPlanView = {
    view: { type: "plan" as const, planId: "plan-12345678" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("thread mode header display", () => {
    it("displays truncated thread id", () => {
      render(<ControlPanelHeader {...defaultThreadView} />);
      expect(screen.getByText("thread-1...")).toBeInTheDocument();
    });

    it("displays threads breadcrumb button", () => {
      render(<ControlPanelHeader {...defaultThreadView} />);
      expect(screen.getByText("threads")).toBeInTheDocument();
    });

    it("displays close button", () => {
      render(<ControlPanelHeader {...defaultThreadView} />);
      expect(screen.getByRole("button", { name: /close panel/i })).toBeInTheDocument();
    });
  });

  describe("plan mode header display", () => {
    it("displays truncated plan id when no plan name", () => {
      render(<ControlPanelHeader {...defaultPlanView} />);
      expect(screen.getByText("plan-123...")).toBeInTheDocument();
    });

    it("displays plans breadcrumb button", () => {
      render(<ControlPanelHeader {...defaultPlanView} />);
      expect(screen.getByText("plans")).toBeInTheDocument();
    });

    it("displays close button", () => {
      render(<ControlPanelHeader {...defaultPlanView} />);
      expect(screen.getByRole("button", { name: /close panel/i })).toBeInTheDocument();
    });
  });

  describe("thread mode status indicator", () => {
    it("shows running class dot when streaming", () => {
      const { container } = render(<ControlPanelHeader {...defaultThreadView} isStreaming={true} />);
      const dot = container.querySelector(".status-dot-running");
      expect(dot).toBeInTheDocument();
    });

    it("shows grey dot when not streaming (read state)", () => {
      const { container } = render(<ControlPanelHeader {...defaultThreadView} isStreaming={false} />);
      const dot = container.querySelector(".bg-zinc-400");
      expect(dot).toBeInTheDocument();
    });
  });

  describe("cancel button", () => {
    it("displays cancel button when streaming", () => {
      render(<ControlPanelHeader {...defaultThreadView} isStreaming={true} />);
      expect(screen.getByRole("button", { name: /cancel agent/i })).toBeInTheDocument();
    });

    it("does not display cancel button when not streaming", () => {
      render(<ControlPanelHeader {...defaultThreadView} isStreaming={false} />);
      expect(screen.queryByRole("button", { name: /cancel agent/i })).not.toBeInTheDocument();
    });
  });

  describe("thread tab toggle", () => {
    it("does not display tab toggle when onThreadTabChange is not provided", () => {
      render(<ControlPanelHeader {...defaultThreadView} />);
      expect(screen.queryByRole("button", { name: /view changes/i })).not.toBeInTheDocument();
    });

    it("displays tab toggle when onThreadTabChange is provided", () => {
      const onThreadTabChange = vi.fn();
      render(<ControlPanelHeader {...defaultThreadView} onThreadTabChange={onThreadTabChange} />);
      expect(screen.getByRole("button", { name: /view changes/i })).toBeInTheDocument();
    });

    it("calls onThreadTabChange when clicked", () => {
      const onThreadTabChange = vi.fn();
      render(<ControlPanelHeader {...defaultThreadView} onThreadTabChange={onThreadTabChange} />);
      fireEvent.click(screen.getByRole("button", { name: /view changes/i }));
      expect(onThreadTabChange).toHaveBeenCalledWith("changes");
    });

    it("shows correct label when on changes tab", () => {
      const onThreadTabChange = vi.fn();
      render(
        <ControlPanelHeader
          {...defaultThreadView}
          threadTab="changes"
          onThreadTabChange={onThreadTabChange}
        />
      );
      expect(screen.getByRole("button", { name: /view conversation/i })).toBeInTheDocument();
    });
  });

  describe("plan mode has no status or tabs", () => {
    it("does not show status dot in plan mode", () => {
      const { container } = render(<ControlPanelHeader {...defaultPlanView} />);
      const dot = container.querySelector(".w-2.h-2.rounded-full");
      expect(dot).not.toBeInTheDocument();
    });

    it("does not show cancel button in plan mode", () => {
      render(<ControlPanelHeader {...defaultPlanView} />);
      expect(screen.queryByRole("button", { name: /cancel agent/i })).not.toBeInTheDocument();
    });

    it("does not show tab toggle in plan mode", () => {
      render(<ControlPanelHeader {...defaultPlanView} />);
      expect(screen.queryByRole("button", { name: /view changes/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /view conversation/i })).not.toBeInTheDocument();
    });
  });
});
