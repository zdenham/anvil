import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@/test/helpers";
import { EmptyInboxState } from "../empty-inbox-state";

// Mock the hotkey service
vi.mock("@/lib/hotkey-service", () => ({
  getSavedHotkey: vi.fn().mockResolvedValue("Cmd+Space"),
}));

describe("EmptyInboxState", () => {
  it("should render welcome message", async () => {
    render(<EmptyInboxState />);

    expect(screen.getByText("Welcome to Mission Control")).toBeInTheDocument();
  });

  it("should render getting started instructions", async () => {
    render(<EmptyInboxState />);

    expect(screen.getByText("To get started:")).toBeInTheDocument();
    // Check for the list items (Press appears twice, so use getAllByText)
    expect(screen.getAllByText(/Press/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Type/)).toBeInTheDocument();
  });

  it("should display the saved hotkey", async () => {
    render(<EmptyInboxState />);

    // Wait for the hotkey to be loaded
    await waitFor(() => {
      expect(screen.getByText("Cmd+Space")).toBeInTheDocument();
    });
  });

  it("should apply correct styling classes", async () => {
    const { container } = render(<EmptyInboxState />);

    // Check the main container has correct classes
    const mainDiv = container.firstChild as HTMLElement;
    expect(mainDiv).toHaveClass("flex");
    expect(mainDiv).toHaveClass("flex-col");
    expect(mainDiv).toHaveClass("items-center");
    expect(mainDiv).toHaveClass("text-surface-400");
  });
});
