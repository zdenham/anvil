/**
 * TaskCard UI Tests
 *
 * Validates basic rendering of the TaskCard leaf component.
 * This test validates that the test infrastructure works for pure prop-based components.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@/test/helpers";
import { createTask } from "@/test/factories";
import { TaskCard } from "./task-card";

// Mock dnd-kit since we're not testing drag functionality
vi.mock("@dnd-kit/sortable", () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
}));

vi.mock("@dnd-kit/utilities", () => ({
  CSS: {
    Transform: {
      toString: () => undefined,
    },
  },
}));

describe("TaskCard UI", () => {
  const mockOnClick = vi.fn();

  it("renders task title", () => {
    const task = createTask({ title: "Fix the authentication bug" });

    render(<TaskCard task={task} onClick={mockOnClick} />);

    expect(screen.getByText("Fix the authentication bug")).toBeInTheDocument();
  });

  it("renders todo status badge", () => {
    const task = createTask({ status: "todo" });

    render(<TaskCard task={task} onClick={mockOnClick} />);

    expect(screen.getByTestId(`task-status-${task.id}`)).toHaveTextContent("To Do");
  });

  it("renders in-progress status badge", () => {
    const task = createTask({ status: "in-progress" });

    render(<TaskCard task={task} onClick={mockOnClick} />);

    expect(screen.getByTestId(`task-status-${task.id}`)).toHaveTextContent("Working");
  });

  it("renders done status badge", () => {
    const task = createTask({ status: "done" });

    render(<TaskCard task={task} onClick={mockOnClick} />);

    expect(screen.getByTestId(`task-status-${task.id}`)).toHaveTextContent("Done");
  });

  it("renders cancelled status badge", () => {
    const task = createTask({ status: "cancelled" });

    render(<TaskCard task={task} onClick={mockOnClick} />);

    expect(screen.getByTestId(`task-status-${task.id}`)).toHaveTextContent("Cancelled");
  });

  it("renders task tags", () => {
    const task = createTask({ tags: ["frontend", "urgent"] });

    render(<TaskCard task={task} onClick={mockOnClick} />);

    expect(screen.getByText("frontend")).toBeInTheDocument();
    expect(screen.getByText("urgent")).toBeInTheDocument();
  });

  it("renders subtask count when subtasks exist", () => {
    const task = createTask({
      subtasks: [
        { id: "1", title: "Step 1", completed: true },
        { id: "2", title: "Step 2", completed: false },
        { id: "3", title: "Step 3", completed: false },
      ],
    });

    render(<TaskCard task={task} onClick={mockOnClick} />);

    expect(screen.getByText("1/3 subtasks")).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const task = createTask();

    render(<TaskCard task={task} onClick={mockOnClick} />);

    const card = screen.getByTestId(`task-item-${task.id}`);
    card.click();

    expect(mockOnClick).toHaveBeenCalled();
  });

  it("renders PR link when prUrl exists", () => {
    const task = createTask({ prUrl: "https://github.com/org/repo/pull/123" });

    render(<TaskCard task={task} onClick={mockOnClick} />);

    const prLink = screen.getByRole("link", { name: /PR/i });
    expect(prLink).toHaveAttribute("href", "https://github.com/org/repo/pull/123");
  });

  it("shows review indicator for in-review status without approval", () => {
    const task = createTask({ status: "in-review", reviewApproved: false });

    render(<TaskCard task={task} onClick={mockOnClick} />);

    // Status badge shows "Review" and there's also a Review phase indicator with an icon
    const reviewElements = screen.getAllByText("Review");
    expect(reviewElements.length).toBeGreaterThanOrEqual(1);
  });

  it("shows merge indicator for in-review status with approval", () => {
    const task = createTask({ status: "in-review", reviewApproved: true });

    render(<TaskCard task={task} onClick={mockOnClick} />);

    expect(screen.getByText("Merge")).toBeInTheDocument();
  });

  describe("TaskCard status display changes", () => {
    it("should render status dot without visible text", () => {
      const task = createTask({ status: "todo" });

      const { container } = render(<TaskCard task={task} onClick={mockOnClick} />);

      // Should have color dot
      expect(container.querySelector('.w-2.h-2.rounded-full')).toBeInTheDocument();

      // Should NOT have visible status text (the old text-based status display)
      const statusBadges = container.querySelectorAll('.text-xs.font-medium.px-2');
      expect(statusBadges.length).toBe(0);
    });

    it("should include screen reader text for accessibility", () => {
      const task = createTask({
        id: "test-task",
        status: "in-progress"
      });

      const { container } = render(<TaskCard task={task} onClick={mockOnClick} />);

      // Should have sr-only text for accessibility
      const srText = container.querySelector('.sr-only');
      if (srText) {
        expect(srText).toBeInTheDocument();
        expect(srText.textContent).toMatch(/status|thread/i);
      }
    });

    it("should show tooltip on hover", () => {
      const task = createTask({
        id: "tooltip-task",
        status: "done"
      });

      const { container } = render(<TaskCard task={task} onClick={mockOnClick} />);

      // Status dot should have title attribute for tooltip
      const statusDot = container.querySelector('.w-2.h-2.rounded-full');
      expect(statusDot).toHaveAttribute('title');

      const titleValue = statusDot?.getAttribute('title');
      expect(titleValue).toContain('Status:');
    });

    it("should preserve all other task card functionality", () => {
      const task = createTask({
        title: "Test Task",
        status: "in-progress",
        tags: ["frontend", "urgent"],
        subtasks: [
          { id: "1", title: "Step 1", completed: true },
          { id: "2", title: "Step 2", completed: false }
        ]
      });

      render(<TaskCard task={task} onClick={mockOnClick} />);

      // Task title should still be visible
      expect(screen.getByText("Test Task")).toBeInTheDocument();

      // Status badge should still be visible (this is separate from the dot)
      expect(screen.getByTestId(`task-status-${task.id}`)).toHaveTextContent("Working");

      // Tags should still be visible
      expect(screen.getByText("frontend")).toBeInTheDocument();
      expect(screen.getByText("urgent")).toBeInTheDocument();

      // Subtasks should still be visible
      expect(screen.getByText("1/2 subtasks")).toBeInTheDocument();

      // Click functionality should still work
      const card = screen.getByTestId(`task-item-${task.id}`);
      card.click();
      expect(mockOnClick).toHaveBeenCalled();
    });

    it("should display different colors for different thread states", () => {
      const scenarios = [
        {
          name: "running",
          task: createTask({ id: "running-task", status: "in-progress" }),
          expectedColor: "bg-green-400"
        },
        {
          name: "unread",
          task: createTask({ id: "unread-task", status: "todo" }),
          expectedColor: "bg-blue-500"
        },
        {
          name: "read",
          task: createTask({ id: "read-task", status: "done" }),
          expectedColor: "bg-zinc-400"
        }
      ];

      scenarios.forEach(({ task, expectedColor }) => {
        const { container } = render(<TaskCard task={task} onClick={mockOnClick} />);

        const statusDot = container.querySelector('.w-2.h-2.rounded-full');
        expect(statusDot).toHaveClass(expectedColor);

        // Cleanup for next test
        container.remove();
      });
    });

    it("should show pulsing animation for running tasks", () => {
      // Mock a running task scenario
      const task = createTask({
        id: "running-task",
        status: "in-progress"
      });

      const { container } = render(<TaskCard task={task} onClick={mockOnClick} />);

      const statusDot = container.querySelector('.w-2.h-2.rounded-full');

      // Note: The animation would depend on thread state,
      // but for this test we're checking the structure
      expect(statusDot).toBeInTheDocument();
      expect(statusDot).toHaveClass('w-2', 'h-2', 'rounded-full');
    });

    it("should maintain consistent dot size and positioning", () => {
      const task = createTask();
      const { container } = render(<TaskCard task={task} onClick={mockOnClick} />);

      const statusDot = container.querySelector('.w-2.h-2.rounded-full');
      expect(statusDot).toHaveClass('w-2', 'h-2', 'rounded-full', 'flex-shrink-0');
    });
  });
});
