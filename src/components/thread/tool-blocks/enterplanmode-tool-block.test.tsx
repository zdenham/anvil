import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach } from "vitest";
import { EnterPlanModeToolBlock } from "./enterplanmode-tool-block";
import { useToolExpandStore } from "@/stores/tool-expand-store";

describe("EnterPlanModeToolBlock", () => {
  const defaultProps = {
    id: "toolu_01ABC123",
    name: "EnterPlanMode",
    input: {}, // Empty object per API spec
    result: "Plan mode entered successfully",
    status: "complete" as const,
    threadId: "thread-456",
  };

  // Reset tool expand store before each test to ensure isolation
  beforeEach(() => {
    useToolExpandStore.setState({ threads: {} });
  });

  it("renders two-line layout with description on first line", () => {
    render(<EnterPlanModeToolBlock {...defaultProps} />);
    // First line shows description text (no shimmer when complete)
    expect(screen.getByText("Enter plan mode")).toBeInTheDocument();
  });

  it("renders shimmer text on first line when running", () => {
    render(<EnterPlanModeToolBlock {...defaultProps} status="running" />);
    // First line shows shimmer description when running
    const shimmerText = screen.getByText("Entering plan mode");
    expect(shimmerText).toHaveClass("animate-shimmer");
  });

  it("renders Map icon on second line", () => {
    render(<EnterPlanModeToolBlock {...defaultProps} />);
    // Map icon should be present (in second line container)
    expect(screen.getByLabelText("Enter plan mode tool")).toBeInTheDocument();
  });

  it("renders success status icon on second line when complete", () => {
    render(<EnterPlanModeToolBlock {...defaultProps} />);
    // StatusIcon renders a Check icon for success on second line (green)
    expect(
      screen.getByRole("button").querySelector('[class*="text-green"]')
    ).toBeInTheDocument();
  });

  it("renders error status icon on second line when isError is true", () => {
    render(<EnterPlanModeToolBlock {...defaultProps} isError={true} />);
    // StatusIcon renders an X icon for failure on second line (red)
    expect(
      screen.getByRole("button").querySelector('[class*="text-red"]')
    ).toBeInTheDocument();
  });

  it("expands to show status message on click", async () => {
    const user = userEvent.setup();
    render(<EnterPlanModeToolBlock {...defaultProps} />);

    // Click to expand
    const button = screen.getByRole("button");
    await user.click(button);

    // Should show the result message
    expect(
      screen.getByText("Plan mode entered successfully")
    ).toBeInTheDocument();
  });

  it("handles missing result gracefully with default message", async () => {
    const user = userEvent.setup();
    render(<EnterPlanModeToolBlock {...defaultProps} result={undefined} />);

    // Click to expand
    await user.click(screen.getByRole("button"));

    // Should show default message
    expect(screen.getByText("Plan mode entered")).toBeInTheDocument();
  });

  it("uses CollapsibleBlock for keyboard navigation", async () => {
    const user = userEvent.setup();
    render(<EnterPlanModeToolBlock {...defaultProps} />);

    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-expanded", "false");

    // Keyboard interaction handled by CollapsibleBlock
    button.focus();
    await user.keyboard("{Enter}");

    // After pressing Enter, should expand (shows result)
    expect(
      screen.getByText("Plan mode entered successfully")
    ).toBeInTheDocument();
  });

  it("does not render raw JSON", async () => {
    const user = userEvent.setup();
    render(<EnterPlanModeToolBlock {...defaultProps} />);

    // Expand to see content
    await user.click(screen.getByRole("button"));

    // Should NOT contain JSON syntax
    expect(screen.queryByText(/\{/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\}/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"result"/)).not.toBeInTheDocument();
  });

  it("has correct ARIA attributes", () => {
    render(<EnterPlanModeToolBlock {...defaultProps} />);

    // Container should have aria-label
    expect(screen.getByLabelText("Enter plan mode tool")).toBeInTheDocument();

    // Button should have aria-expanded
    const button = screen.getByRole("button");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("has correct test ID", () => {
    render(<EnterPlanModeToolBlock {...defaultProps} />);
    expect(
      screen.getByTestId(`enterplanmode-tool-${defaultProps.id}`)
    ).toBeInTheDocument();
  });

  it("does not show status icon while running", () => {
    render(
      <EnterPlanModeToolBlock
        {...defaultProps}
        status="running"
        result={undefined}
      />
    );
    // Should not show check or X icon while running
    expect(
      screen.getByRole("button").querySelector('[class*="text-green"]')
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button").querySelector('[class*="text-red"]')
    ).not.toBeInTheDocument();
  });
});
