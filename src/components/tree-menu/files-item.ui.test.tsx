import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@/test/helpers";
import { FilesItem } from "./files-item";

describe("FilesItem", () => {
  const defaultProps = {
    repoId: "repo-1",
    worktreeId: "wt-1",
    worktreePath: "/path/to/worktree",
    isActive: false,
    onOpenFiles: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Files label with folder icon", () => {
    render(<FilesItem {...defaultProps} />);

    expect(screen.getByText("Files")).toBeInTheDocument();
    expect(screen.getByRole("treeitem")).toBeInTheDocument();
  });

  it("calls onOpenFiles with correct args on click", () => {
    render(<FilesItem {...defaultProps} />);

    fireEvent.click(screen.getByRole("treeitem"));

    expect(defaultProps.onOpenFiles).toHaveBeenCalledWith(
      "repo-1",
      "wt-1",
      "/path/to/worktree"
    );
  });

  it("calls onOpenFiles on Enter key", () => {
    render(<FilesItem {...defaultProps} />);

    fireEvent.keyDown(screen.getByRole("treeitem"), { key: "Enter" });

    expect(defaultProps.onOpenFiles).toHaveBeenCalledWith(
      "repo-1",
      "wt-1",
      "/path/to/worktree"
    );
  });

  it("calls onOpenFiles on Space key", () => {
    render(<FilesItem {...defaultProps} />);

    fireEvent.keyDown(screen.getByRole("treeitem"), { key: " " });

    expect(defaultProps.onOpenFiles).toHaveBeenCalledWith(
      "repo-1",
      "wt-1",
      "/path/to/worktree"
    );
  });

  it("does not call onOpenFiles on other keys", () => {
    render(<FilesItem {...defaultProps} />);

    fireEvent.keyDown(screen.getByRole("treeitem"), { key: "ArrowDown" });

    expect(defaultProps.onOpenFiles).not.toHaveBeenCalled();
  });

  it("shows active styling when isActive is true", () => {
    render(<FilesItem {...defaultProps} isActive={true} />);

    const button = screen.getByRole("treeitem");
    expect(button.className).toContain("text-accent-400");
  });

  it("shows inactive styling when isActive is false", () => {
    render(<FilesItem {...defaultProps} isActive={false} />);

    const button = screen.getByRole("treeitem");
    expect(button.className).toContain("text-surface-400");
    expect(button.className).not.toContain("text-accent-400");
  });
});
