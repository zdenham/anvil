import { useEffect, useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTaskStore, taskService, threadService, eventBus, type TaskMetadata } from "../../entities";
import { useThreadStore } from "../../entities/threads/store";
import { logger } from "../../lib/logger-client";
import { useTaskNavigation } from "../../hooks/use-task-navigation";
import { useDeleteTask } from "../../hooks/use-delete-task";
import { DeleteTaskDialog } from "../tasks/delete-task-dialog";
import { getTaskDotColor } from "@/utils/task-colors";
import { DeleteButton } from "@/components/tasks/delete-button";
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
  const { taskToDelete, isDeleting, requestDelete, confirmDelete, cancelDelete } = useDeleteTask();

  // Handle task selection (from navigation or click)
  const handleTaskSelect = useCallback(async (task: TaskMetadata) => {
    logger.log("[tasks-panel] Task selected:", task.id, task.title);

    // Hide this panel
    await invoke("hide_tasks_panel");

    // Get threads for this task from the store
    const threads = threadService.getByTask(task.id);
    // Use the first thread if available, otherwise fall back to task ID
    const threadId = threads[0]?.id ?? task.id;

    logger.log("[tasks-panel] Opening task with threadId:", threadId);

    // Show simple task panel with this task
    await invoke("open_simple_task", {
      threadId,
      taskId: task.id,
      prompt: task.title,
    });
  }, []);

  // Use the new task navigation hook
  const { selectedIndex, isNavigating } = useTaskNavigation(tasks, handleTaskSelect);

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

  const handleTaskDelete = useCallback((task: TaskMetadata) => {
    requestDelete(task);
  }, [requestDelete]);


  return (
    <div className="h-screen w-full bg-surface-900/95 backdrop-blur-xl border border-surface-700/50 overflow-hidden flex flex-col">
      <header className="px-4 py-3 border-b border-surface-700/50 flex-shrink-0 flex items-center justify-between gap-4">
        <h1 className="text-sm font-medium text-surface-100">Tasks</h1>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-1.5 rounded hover:bg-surface-700/50 text-surface-400 hover:text-surface-200 transition-colors disabled:opacity-50"
          title="Refresh tasks"
        >
          <RefreshIcon className={isRefreshing ? "animate-spin" : ""} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <TaskListWithNavigation
          tasks={tasks}
          threads={allThreads}
          selectedIndex={selectedIndex}
          onTaskSelect={handleTaskSelect}
          onTaskDelete={handleTaskDelete}
        />
      </div>

      {/* Delete confirmation dialog */}
      <DeleteTaskDialog
        task={taskToDelete}
        isDeleting={isDeleting}
        onConfirm={confirmDelete}
        onCancel={cancelDelete}
      />
    </div>
  );
}

interface TaskListWithNavigationProps {
  tasks: TaskMetadata[];
  threads: ThreadMetadata[];
  selectedIndex: number;
  onTaskSelect: (task: TaskMetadata) => void;
  onTaskDelete: (task: TaskMetadata) => void;
}

function TaskListWithNavigation({
  tasks,
  threads,
  selectedIndex,
  onTaskSelect,
  onTaskDelete
}: TaskListWithNavigationProps) {
  if (tasks.length === 0) {
    return (
      <div className="p-4 px-6 text-center text-surface-500 text-sm">
        No tasks yet
      </div>
    );
  }

  // Handle Enter key for task selection
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && tasks[selectedIndex]) {
      e.preventDefault();
      onTaskSelect(tasks[selectedIndex]);
    }
  };

  return (
    <div
      className="outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <ul className="space-y-1 px-3 pt-3">
        {tasks.map((task, index) => (
          <TaskItem
            key={task.id}
            task={task}
            threads={threads}
            onClick={() => onTaskSelect(task)}
            isSelected={index === selectedIndex}
            onDelete={onTaskDelete}
          />
        ))}
      </ul>
    </div>
  );
}

interface TaskItemProps {
  task: TaskMetadata;
  threads: ThreadMetadata[];
  onClick: () => void;
  isSelected: boolean;
  onDelete?: (task: TaskMetadata) => void;
}

function TaskItem({ task, threads, onClick, isSelected, onDelete }: TaskItemProps) {
  return (
    <li
      onClick={onClick}
      className={`group flex items-center gap-3 px-3 py-2 bg-surface-800 rounded-lg border border-surface-700 hover:border-surface-600 cursor-pointer transition-colors ${
        isSelected ? "ring-1 ring-surface-600" : ""
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

