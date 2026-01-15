/**
 * TasksPanel UI Tests
 *
 * Tests for the tasks panel component, including:
 * - Basic rendering of tasks from store
 * - Refresh behavior when panel becomes visible
 * - Event-driven updates when tasks are created/updated
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, TestStores, waitFor, createTask, TestEvents } from "@/test/helpers";
import { TasksPanel } from "./tasks-panel";
import { taskService } from "@/entities/tasks/service";
import { listen } from "@tauri-apps/api/event";

// Mock Tauri APIs
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve()),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(() => Promise.resolve()),
}));

describe("TasksPanel UI", () => {
  beforeEach(() => {
    TestStores.clear();
    TestEvents.clearAllListeners();
    vi.clearAllMocks();
  });

  afterEach(() => {
    TestEvents.clearAllListeners();
  });

  describe("basic rendering", () => {
    it("renders tasks from store", () => {
      const task1 = createTask({ title: "Fix authentication bug" });
      const task2 = createTask({ title: "Add dark mode toggle" });

      TestStores.seedTasks([task1, task2]);

      render(<TasksPanel />);

      expect(screen.getByText("Fix authentication bug")).toBeInTheDocument();
      expect(screen.getByText("Add dark mode toggle")).toBeInTheDocument();
    });

    it("shows empty state when no tasks", () => {
      TestStores.seedTasks([]);

      render(<TasksPanel />);

      expect(screen.getByText("No tasks yet")).toBeInTheDocument();
    });

    it("filters out subtasks (tasks with parentId)", () => {
      const parentTask = createTask({ title: "Parent task" });
      const subtask = createTask({
        title: "Subtask",
        parentId: parentTask.id,
      });

      TestStores.seedTasks([parentTask, subtask]);

      render(<TasksPanel />);

      expect(screen.getByText("Parent task")).toBeInTheDocument();
      expect(screen.queryByText("Subtask")).not.toBeInTheDocument();
    });

    it("sorts tasks by updatedAt (most recent first)", () => {
      const oldTask = createTask({
        title: "Old task",
        updatedAt: Date.now() - 10000,
      });
      const newTask = createTask({
        title: "New task",
        updatedAt: Date.now(),
      });

      // Seed in wrong order
      TestStores.seedTasks([oldTask, newTask]);

      render(<TasksPanel />);

      const taskElements = screen.getAllByRole("listitem");
      expect(taskElements[0]).toHaveTextContent("New task");
      expect(taskElements[1]).toHaveTextContent("Old task");
    });
  });

  describe("status indicators", () => {
    it("renders status dot for todo task", () => {
      const task = createTask({ title: "Todo task", status: "todo" });
      TestStores.seedTasks([task]);

      render(<TasksPanel />);

      const statusDot = screen.getByTitle("todo");
      expect(statusDot).toHaveClass("bg-amber-500");
    });

    it("renders status dot for in-progress task", () => {
      const task = createTask({ title: "In progress task", status: "in-progress" });
      TestStores.seedTasks([task]);

      render(<TasksPanel />);

      const statusDot = screen.getByTitle("in-progress");
      expect(statusDot).toHaveClass("bg-green-500");
    });

    it("renders status dot for done task", () => {
      const task = createTask({ title: "Done task", status: "done" });
      TestStores.seedTasks([task]);

      render(<TasksPanel />);

      const statusDot = screen.getByTitle("done");
      expect(statusDot).toHaveClass("bg-emerald-500");
    });
  });

  describe("refresh on panel show", () => {
    it("registers listener for panel-shown event", () => {
      TestStores.seedTasks([]);

      render(<TasksPanel />);

      // Verify listen was called for panel-shown
      expect(listen).toHaveBeenCalledWith("panel-shown", expect.any(Function));
    });

    it("calls taskService.refresh when panel-shown event is received", async () => {
      const refreshSpy = vi.spyOn(taskService, "refresh").mockResolvedValue();

      // Capture callbacks for each event type
      const callbacks: Record<string, ((event: unknown) => void)> = {};
      vi.mocked(listen).mockImplementation(async (event, callback) => {
        callbacks[event as string] = callback as (event: unknown) => void;
        return () => {};
      });

      TestStores.seedTasks([]);
      render(<TasksPanel />);

      // Wait for listeners to be registered
      await waitFor(() => {
        expect(callbacks["panel-shown"]).toBeDefined();
      });

      // Simulate panel-shown event
      callbacks["panel-shown"]({ payload: {} });

      await waitFor(() => {
        expect(refreshSpy).toHaveBeenCalled();
      });

      refreshSpy.mockRestore();
    });
  });

  describe("manual refresh", () => {
    it("renders refresh button", () => {
      TestStores.seedTasks([]);

      render(<TasksPanel />);

      const refreshButton = screen.getByRole("button", { name: /refresh/i });
      expect(refreshButton).toBeInTheDocument();
    });

    it("calls taskService.refresh when refresh button is clicked", async () => {
      const refreshSpy = vi.spyOn(taskService, "refresh").mockResolvedValue();

      TestStores.seedTasks([]);
      render(<TasksPanel />);

      const refreshButton = screen.getByRole("button", { name: /refresh/i });
      refreshButton.click();

      await waitFor(() => {
        expect(refreshSpy).toHaveBeenCalled();
      });

      refreshSpy.mockRestore();
    });

    it("disables refresh button while refreshing", async () => {
      // Make refresh take some time
      vi.spyOn(taskService, "refresh").mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100))
      );

      TestStores.seedTasks([]);
      render(<TasksPanel />);

      const refreshButton = screen.getByRole("button", { name: /refresh/i });
      refreshButton.click();

      // Button should be disabled during refresh
      await waitFor(() => {
        expect(refreshButton).toBeDisabled();
      });
    });
  });

  describe("repository name display", () => {
    it("shows repository name when task has one", () => {
      const task = createTask({
        title: "Fix bug",
        repositoryName: "my-awesome-repo",
      });
      TestStores.seedTasks([task]);

      render(<TasksPanel />);

      expect(screen.getByText("my-awesome-repo")).toBeInTheDocument();
    });

    it("does not show repository section when task has no repository", () => {
      const task = createTask({
        title: "Fix bug",
        repositoryName: undefined,
      });
      TestStores.seedTasks([task]);

      render(<TasksPanel />);

      // Only the task title should be visible, no repo text
      expect(screen.getByText("Fix bug")).toBeInTheDocument();
      // The task should render without a repository name element
      const listItem = screen.getByRole("listitem");
      const repoElement = listItem.querySelector(".text-zinc-500.pl-4");
      expect(repoElement).not.toBeInTheDocument();
    });
  });
});
