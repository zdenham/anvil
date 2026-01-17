import { useEffect, useMemo, useState, useCallback, useRef, forwardRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTaskStore, taskService, threadService, eventBus, type TaskMetadata } from "../../entities";
import { useThreadStore } from "../../entities/threads/store";
import { logger } from "../../lib/logger-client";
import { useDeleteTask } from "../../hooks/use-delete-task";
import { useNavigationMode } from "../../hooks/use-navigation-mode";
import { getTaskDotColor } from "@/utils/task-colors";
import { DeleteButton } from "@/components/tasks/delete-button";
import { TaskLegend } from "@/components/shared/task-legend";
import { EmptyTaskState } from "@/components/tasks/empty-task-state";
import type { ThreadMetadata } from "@/entities/threads/types";

/**
 * TasksPanel - A lightweight NSPanel that displays a list of all tasks.
 *
 * This panel uses the new task navigation system that:
 * - Receives targeted events from Rust backend
 * - Uses simplified navigation state management
 * - Opens SimpleTaskPanel when a task is selected via navigation or click
 */
export function TasksPanel() {
  const allTasks = useTaskStore((s) => s.tasks);
  const allThreads = useThreadStore((s) => s.getAllThreads());
  const tasks = useMemo(
    () => Object.values(allTasks)
      .filter((t) => !t.parentId)
      .sort((a, b) => b.updatedAt - a.updatedAt),
    [allTasks]
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { deleteTask } = useDeleteTask();

  // Store tasks ref for navigation callback
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  // Handle task selection by index (from navigation)
  const handleTaskSelectByIndex = useCallback(async (index: number) => {
    const currentTasks = tasksRef.current;
    if (index < 0 || index >= currentTasks.length) {
      logger.warn("[tasks-panel] Invalid task index:", index);
      return;
    }
    const task = currentTasks[index];
    await handleTaskSelectInternal(task);
  }, []);

  // Navigation mode hook
  const { isNavigating, selectedIndex } = useNavigationMode({
    taskCount: tasks.length,
    onTaskSelect: handleTaskSelectByIndex,
  });

  // Internal task selection logic
  const handleTaskSelectInternal = useCallback(async (task: TaskMetadata) => {
    logger.log("[tasks-panel] Task selected:", task.id, task.title);

    // Hide this panel
    await invoke("hide_tasks_panel");

    // Refresh threads for this task from disk to ensure we have the latest data
    await threadService.refreshByTask(task.id);

    // Get threads for this task from the store (now should be up-to-date)
    const threads = threadService.getByTask(task.id);
    logger.log("[tasks-panel] Found threads for task:", threads.length);

    if (threads.length === 0) {
      logger.log("[tasks-panel] No threads found for task, not opening anything");
      // Show tasks panel again since we didn't open anything
      await invoke("show_tasks_panel");
      return;
    }

    // Use the first thread (most recent)
    const threadId = threads[0].id;

    logger.log("[tasks-panel] Opening task with threadId:", threadId);

    // Show simple task panel with this task
    await invoke("open_simple_task", {
      threadId,
      taskId: task.id,
    });
  }, []);

  // Handle task selection (from click)
  const handleTaskSelect = useCallback(async (task: TaskMetadata) => {
    await handleTaskSelectInternal(task);
  }, [handleTaskSelectInternal]);


  // Handle closing the panel
  const handleClose = useCallback(async () => {
    logger.log("[tasks-panel] Closing panel");
    await invoke("hide_tasks_panel");
  }, []);

  // Listen for Escape key to close panel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleClose]);

  // Listen for panel visibility events via eventBus (no async cleanup races)
  useEffect(() => {
    const handlePanelHidden = () => {
      logger.log("[tasks-panel] Panel hidden");
    };

    const handlePanelShown = async () => {
      logger.log("[tasks-panel] Panel shown, refreshing tasks");
      try {
        await taskService.refresh();
        logger.log("[tasks-panel] Tasks refreshed on panel show");
      } catch (error) {
        logger.error("[tasks-panel] Failed to refresh tasks on panel show:", error);
      }
    };

    eventBus.on("panel-hidden", handlePanelHidden);
    eventBus.on("panel-shown", handlePanelShown);

    return () => {
      eventBus.off("panel-hidden", handlePanelHidden);
      eventBus.off("panel-shown", handlePanelShown);
    };
  }, []);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await taskService.refresh();
      logger.log("[tasks-panel] Tasks refreshed");
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTaskDelete = useCallback(async (task: TaskMetadata) => {
    await deleteTask(task);
  }, [deleteTask]);


  return (
    <div className="tasks-list-container h-screen w-full bg-surface-900/95 backdrop-blur-xl border border-surface-700/50 overflow-hidden flex flex-col rounded-xl">
      <header className="px-4 py-3 border-b border-surface-700/50 flex-shrink-0 flex items-center justify-between gap-4">
        <h1 className="text-sm font-medium text-surface-100">Tasks</h1>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded hover:bg-surface-700/50 text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
            title="Refresh tasks"
          >
            <RefreshIcon className={isRefreshing ? "animate-spin" : ""} />
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded hover:bg-surface-700/50 text-surface-400 hover:text-surface-200 transition-colors"
            title="Close (Escape)"
          >
            <CloseIcon />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <TaskList
          tasks={tasks}
          threads={allThreads}
          onTaskSelect={handleTaskSelect}
          onTaskDelete={handleTaskDelete}
          isNavigating={isNavigating}
          selectedIndex={selectedIndex}
        />
      </div>

      <footer className="px-4 py-2 border-t border-surface-700/50 flex-shrink-0">
        <TaskLegend />
      </footer>
    </div>
  );
}

interface TaskListProps {
  tasks: TaskMetadata[];
  threads: ThreadMetadata[];
  onTaskSelect: (task: TaskMetadata) => void;
  onTaskDelete: (task: TaskMetadata) => void;
  /** Whether navigation mode is active */
  isNavigating?: boolean;
  /** Currently selected index during navigation */
  selectedIndex?: number;
}

function TaskList({
  tasks,
  threads,
  onTaskSelect,
  onTaskDelete,
  isNavigating = false,
  selectedIndex = 0,
}: TaskListProps) {
  // Ref for scrolling selected item into view
  const listRef = useRef<HTMLUListElement>(null);
  const selectedItemRef = useRef<HTMLLIElement>(null);

  // Scroll selected item into view when navigation index changes
  useEffect(() => {
    if (isNavigating && selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [isNavigating, selectedIndex]);

  if (tasks.length === 0) {
    return <EmptyTaskState />;
  }

  return (
    <ul ref={listRef} className="space-y-2 px-3 pt-3">
      {tasks.map((task, index) => (
        <TaskItem
          key={task.id}
          ref={isNavigating && index === selectedIndex ? selectedItemRef : null}
          task={task}
          threads={threads}
          onClick={() => onTaskSelect(task)}
          onDelete={onTaskDelete}
          isSelected={isNavigating && index === selectedIndex}
        />
      ))}
    </ul>
  );
}

interface TaskItemProps {
  task: TaskMetadata;
  threads: ThreadMetadata[];
  onClick: () => void;
  onDelete?: (task: TaskMetadata) => void;
  /** Whether this item is selected during navigation mode */
  isSelected?: boolean;
}

const TaskItem = forwardRef<HTMLLIElement, TaskItemProps>(
  function TaskItem({ task, threads, onClick, onDelete, isSelected = false }, ref) {
    return (
      <li
        ref={ref}
        onClick={onClick}
        className={`group flex items-center gap-3 px-3 py-2 bg-surface-800 rounded-lg border cursor-pointer transition-colors ${
          isSelected
            ? "border-blue-500 ring-2 ring-blue-500/50 bg-blue-500/10"
            : "border-surface-700 hover:border-surface-600"
        }`}
      >
        <StatusDot task={task} threads={threads} />
        <span className="flex-1 text-sm text-surface-100 truncate font-mono">
          {task.title}
        </span>

        {/* Tags */}
        {task.tags.length > 0 && (
          <div className="flex gap-1">
            {task.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 text-[10px] uppercase tracking-wide bg-surface-700 text-surface-400 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Subtask progress */}
        {task.subtasks.length > 0 && (
          <span className="text-xs text-surface-500">
            {task.subtasks.filter((s) => s.completed).length}/{task.subtasks.length}
          </span>
        )}

        {/* Delete button */}
        {onDelete && (
          <DeleteButton onDelete={() => onDelete(task)} />
        )}
      </li>
    );
  }
);

function StatusDot({ task, threads }: { task: TaskMetadata; threads: ThreadMetadata[] }) {
  const { color, animation } = getTaskDotColor(task, threads);

  // Create tooltip that shows thread status
  const taskThreads = threads.filter(t => t.taskId === task.id);
  const runningCount = taskThreads.filter(t => t.status === 'running').length;
  const unreadCount = taskThreads.filter(t => !t.isRead).length;

  const tooltipParts = [];
  if (runningCount > 0) {
    tooltipParts.push(`${runningCount} running`);
  }
  if (unreadCount > 0) {
    tooltipParts.push(`${unreadCount} unread`);
  }
  tooltipParts.push(`Status: ${task.status}`);

  const title = tooltipParts.join(' • ');

  return (
    <span
      className={`w-2 h-2 rounded-full flex-shrink-0 ${color} ${animation || ""}`}
      title={title}
    />
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg
      className={`w-4 h-4 ${className || ""}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      className="w-4 h-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

