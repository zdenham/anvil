import { useEffect, useMemo, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTaskStore, taskService, threadService, eventBus, type TaskMetadata } from "../../entities";
import { logger } from "../../lib/logger-client";
import { UnifiedTaskList } from "../shared/unified-task-list";
import { useDeleteTask } from "../../hooks/use-delete-task";
import { DeleteTaskDialog } from "../tasks/delete-task-dialog";

interface NavigationTrigger {
  count: number;
  direction: 'forward' | 'backward';
}

/**
 * TasksPanel - A lightweight NSPanel that displays a list of all tasks.
 *
 * This panel is a read-only view that:
 * - Displays tasks from the store
 * - Opens SimpleTaskPanel when a task is clicked
 * - Does NOT spawn agents or emit state-changing events
 *
 * It uses only setupIncomingBridge() to receive events, preventing echo loops.
 */
export function TasksPanel() {
  const allTasks = useTaskStore((s) => s.tasks);
  const tasks = useMemo(
    () => Object.values(allTasks).filter((t) => !t.parentId),
    [allTasks]
  );
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [navigateTrigger, setNavigateTrigger] = useState<NavigationTrigger>({
    count: 0,
    direction: 'forward'
  });
  const [currentHotkey, setCurrentHotkey] = useState<string>("");
  const { taskToDelete, isDeleting, requestDelete, confirmDelete, cancelDelete } = useDeleteTask();

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

  // Fetch the current hotkey configuration
  useEffect(() => {
    const fetchHotkey = async () => {
      try {
        const hotkey = await invoke("get_saved_task_panel_hotkey") as string;
        setCurrentHotkey(hotkey);
      } catch (error) {
        logger.error("[tasks-panel] Failed to fetch hotkey:", error);
      }
    };
    fetchHotkey();
  }, []);

  // Listen for navigation events from backend
  useEffect(() => {
    let unlistenNavigate: (() => void) | undefined;
    let unlistenHidden: (() => void) | undefined;

    const setupListeners = async () => {
      // Listen for new navigate events with direction support
      unlistenNavigate = await listen("navigate", (event) => {
        const payload = event.payload as { direction: 'Forward' | 'Backward' };
        const direction = payload.direction === 'Forward' ? 'forward' : 'backward';
        setNavigateTrigger(prev => ({ count: prev.count + 1, direction }));
      });

      // Reset navigation state when panel is hidden to ensure clean state for next open
      unlistenHidden = await listen("panel-hidden", () => {
        setNavigateTrigger({ count: 0, direction: 'forward' });
        logger.log("[tasks-panel] Panel hidden, navigation state reset");
      });
    };

    setupListeners();

    return () => {
      if (unlistenNavigate) {
        unlistenNavigate();
      }
      if (unlistenHidden) {
        unlistenHidden();
      }
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

  const handleTaskClick = async (task: TaskMetadata) => {
    logger.log("[tasks-panel] Task clicked:", task.id, task.title);

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
  };

  const handleMetaKeyRelease = async (task: TaskMetadata) => {
    logger.log("[tasks-panel] Meta key released, opening task:", task.id, task.title);

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
        <UnifiedTaskList
          tasks={tasks}
          onTaskSelect={handleTaskClick}
          onTaskDelete={handleTaskDelete}
          onMetaKeyRelease={handleMetaKeyRelease}
          externalNavigateTrigger={navigateTrigger}
          currentHotkey={currentHotkey}
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
