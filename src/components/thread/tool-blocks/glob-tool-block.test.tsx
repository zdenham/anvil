import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GlobToolBlock } from "./glob-tool-block";

describe("GlobToolBlock", () => {
  const mockProps = {
    id: "toolu_01ABC123", // Realistic tool_use_id format
    name: "Glob",
    input: { pattern: "**/*.tsx" },
    result: "src/App.tsx\nsrc/Button.tsx", // Newline-separated format
    status: "complete" as const,
    threadId: "thread-1",
  };

  it("renders pattern and match count", () => {
    render(<GlobToolBlock {...mockProps} />);
    expect(screen.getByText("**/*.tsx")).toBeInTheDocument();
    expect(screen.getByText(/2 files/)).toBeInTheDocument();
  });

  it("expands to show formatted file list (not raw JSON)", async () => {
    const user = userEvent.setup();
    render(<GlobToolBlock {...mockProps} />);

    const expandButton = screen.getByRole("button", { expanded: false });
    await user.click(expandButton);

    // Should show formatted paths, not JSON
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/Button.tsx")).toBeInTheDocument();
    // Should NOT show raw JSON brackets
    expect(screen.queryByText(/\[/)).not.toBeInTheDocument();
  });

  it("shows shimmer text while running", () => {
    render(
      <GlobToolBlock {...mockProps} status="running" result={undefined} />
    );
    const findFilesText = screen.getByText("Find files");
    expect(findFilesText).toHaveClass("animate-shimmer");
  });

  it("shows error state with StatusIcon when failed", () => {
    render(
      <GlobToolBlock
        {...mockProps}
        isError={true}
        result="Invalid pattern syntax"
      />
    );
    // StatusIcon should be present (red X)
    expect(
      screen.getByRole("button").querySelector('[class*="text-red"]')
    ).toBeInTheDocument();
  });

  it("parses JSON array result format (legacy)", async () => {
    const user = userEvent.setup();
    render(
      <GlobToolBlock
        {...mockProps}
        result={JSON.stringify([
          "src/App.tsx",
          "src/Button.tsx",
          "src/utils.ts",
        ])}
      />
    );
    expect(screen.getByText(/3 files/)).toBeInTheDocument();

    // Expand and verify formatted display
    await user.click(screen.getByRole("button"));
    expect(screen.getByText("src/App.tsx")).toBeInTheDocument();
  });

  it("handles empty results gracefully", () => {
    render(<GlobToolBlock {...mockProps} result="" />);
    expect(screen.getByText(/0 files/)).toBeInTheDocument();
  });

  it("copy button copies individual file paths", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });

    render(<GlobToolBlock {...mockProps} />);

    await user.click(screen.getByRole("button"));
    const copyButtons = screen.getAllByLabelText(/Copy path/);
    await user.click(copyButtons[0]);

    expect(writeText).toHaveBeenCalledWith("src/App.tsx");
  });

  it("uses CollapsibleOutputBlock for long file lists", async () => {
    const manyFiles = Array.from(
      { length: 25 },
      (_, i) => `src/file${i}.tsx`
    ).join("\n");
    const user = userEvent.setup();

    render(<GlobToolBlock {...mockProps} result={manyFiles} />);
    await user.click(screen.getByRole("button"));

    // Should have expand/collapse button from CollapsibleOutputBlock
    expect(
      screen.getByLabelText(/Expand output|Collapse output/)
    ).toBeInTheDocument();
  });
});
