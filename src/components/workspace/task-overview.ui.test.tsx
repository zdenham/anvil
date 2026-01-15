/**
 * TaskOverview UI Tests
 *
 * Validates store-connected component rendering.
 * This test validates that TestStores seeding works correctly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, TestStores } from "@/test/helpers";
import { createTask } from "@/test/factories";
import { TaskOverview } from "./task-overview";

// Mock the task service
vi.mock("@/entities/tasks/service", () => ({
  taskService: {
    refreshContent: vi.fn().mockResolvedValue("# Task Content\n\nThis is the task description."),
  },
}));

describe("TaskOverview UI", () => {
  beforeEach(() => {
    // TestStores.clear() is called automatically in setup-ui.ts
    vi.clearAllMocks();
  });

  it("shows 'Task not found' when task doesn't exist in store", async () => {
    render(<TaskOverview taskId="nonexistent-task" />);

    await waitFor(() => {
      expect(screen.getByText("Task not found")).toBeInTheDocument();
    });
  });

  it("renders task content when task exists in store", async () => {
    const task = createTask({ id: "task-123", title: "Test Task" });
    TestStores.seedTask(task);

    render(<TaskOverview taskId="task-123" />);

    // Should show loading skeleton initially, then content
    await waitFor(() => {
      expect(screen.getByText("Task Content")).toBeInTheDocument();
    });
  });

  it("renders task tags when they exist", async () => {
    const task = createTask({
      id: "task-with-tags",
      tags: ["frontend", "bug"],
    });
    TestStores.seedTask(task);

    render(<TaskOverview taskId="task-with-tags" />);

    await waitFor(() => {
      expect(screen.getByText("frontend")).toBeInTheDocument();
      expect(screen.getByText("bug")).toBeInTheDocument();
    });
  });

  it("shows 'No content yet' when task exists but has no content", async () => {
    // Mock refreshContent to return empty string
    const { taskService } = await import("@/entities/tasks/service");
    vi.mocked(taskService.refreshContent).mockResolvedValueOnce("");

    const task = createTask({ id: "empty-task" });
    TestStores.seedTask(task);

    render(<TaskOverview taskId="empty-task" />);

    await waitFor(() => {
      expect(screen.getByText("No content yet.")).toBeInTheDocument();
    });
  });

});

