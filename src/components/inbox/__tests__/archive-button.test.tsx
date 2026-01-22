import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@/test/helpers";
import { ArchiveButton } from "../archive-button";

describe("ArchiveButton", () => {
  it("should render trash icon by default", () => {
    render(<ArchiveButton onArchive={vi.fn()} />);

    const button = screen.getByTestId("archive-button");
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("data-confirming", "false");
  });

  it("should show 'Confirm' text on first click", () => {
    render(<ArchiveButton onArchive={vi.fn()} />);

    const button = screen.getByTestId("archive-button");
    fireEvent.click(button);

    expect(button).toHaveAttribute("data-confirming", "true");
    expect(button).toHaveTextContent("Confirm");
  });

  it("should call onArchive on second click", async () => {
    const onArchive = vi.fn().mockResolvedValue(undefined);
    render(<ArchiveButton onArchive={onArchive} />);

    const button = screen.getByTestId("archive-button");

    // First click - enter confirmation mode
    fireEvent.click(button);
    expect(button).toHaveAttribute("data-confirming", "true");

    // Second click - execute archive
    fireEvent.click(button);

    await waitFor(() => {
      expect(onArchive).toHaveBeenCalledTimes(1);
    });
  });

  it("should reset to initial state after archive completes", async () => {
    const onArchive = vi.fn().mockResolvedValue(undefined);
    render(<ArchiveButton onArchive={onArchive} />);

    const button = screen.getByTestId("archive-button");

    // First click
    fireEvent.click(button);
    // Second click
    fireEvent.click(button);

    await waitFor(() => {
      expect(onArchive).toHaveBeenCalled();
    });

    // Should reset to non-confirming state
    await waitFor(() => {
      expect(screen.getByTestId("archive-button")).toHaveAttribute("data-confirming", "false");
    });
  });

  it("should cancel confirmation when clicking outside", () => {
    render(
      <div>
        <ArchiveButton onArchive={vi.fn()} />
        <button data-testid="outside">Outside</button>
      </div>
    );

    const button = screen.getByTestId("archive-button");

    // Enter confirmation mode
    fireEvent.click(button);
    expect(button).toHaveAttribute("data-confirming", "true");

    // Click outside
    fireEvent.mouseDown(screen.getByTestId("outside"));

    // Should reset to non-confirming state
    expect(button).toHaveAttribute("data-confirming", "false");
  });

  it("should show loading spinner during archive", async () => {
    // Create a promise that won't resolve immediately
    let resolveArchive: () => void;
    const archivePromise = new Promise<void>((resolve) => {
      resolveArchive = resolve;
    });
    const onArchive = vi.fn().mockReturnValue(archivePromise);

    render(<ArchiveButton onArchive={onArchive} />);

    const button = screen.getByTestId("archive-button");

    // First click
    fireEvent.click(button);
    // Second click - starts archive
    fireEvent.click(button);

    // Should show loading state
    await waitFor(() => {
      expect(screen.getByTestId("archive-loading")).toBeInTheDocument();
    });

    // Resolve the promise and flush microtasks
    await act(async () => {
      resolveArchive!();
    });

    // Should return to button state
    await waitFor(() => {
      expect(screen.getByTestId("archive-button")).toBeInTheDocument();
    });
  });

  it("should stop event propagation on click", () => {
    const onParentClick = vi.fn();

    render(
      <div onClick={onParentClick}>
        <ArchiveButton onArchive={vi.fn()} />
      </div>
    );

    fireEvent.click(screen.getByTestId("archive-button"));

    expect(onParentClick).not.toHaveBeenCalled();
  });

  it("should have correct aria-label in each state", () => {
    render(<ArchiveButton onArchive={vi.fn()} />);

    const button = screen.getByTestId("archive-button");
    expect(button).toHaveAttribute("aria-label", "Archive");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-label", "Confirm archive");
  });
});
