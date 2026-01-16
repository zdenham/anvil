import { useCallback, useState } from "react";
import { PanelLeft, RefreshCw, Search } from "lucide-react";
import { openTask, openSimpleTask } from "@/lib/hotkey-service";
import type { TaskMetadata } from "@/entities/tasks/types";
import { threadService } from "@/entities/threads/service";
import { useTaskStore } from "@/entities/tasks/store";
import { UnifiedTaskList } from "@/components/shared/unified-task-list";
import { useDeleteTask } from "@/hooks/use-delete-task";
import { taskService } from "@/entities/tasks/service";

interface TasksPageProps {
  onCloseSidebar?: () => void;
}

export function TasksPage({ onCloseSidebar }: TasksPageProps) {
  const allTasks = useTaskStore((s) => s.tasks);
  const allTasks_raw = Object.values(allTasks).filter((t) => !t.parentId);
  const { deleteTask } = useDeleteTask();
  const [searchQuery, setSearchQuery] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filter tasks based on search query
  const tasks = searchQuery
    ? allTasks_raw.filter((task) =>
        task.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : allTasks_raw;

  const handleTaskClick = useCallback((task: TaskMetadata) => {
    // Get threads for this task from the store
    const threads = threadService.getByTask(task.id);
    // Use the first thread if available, otherwise use the task ID as a fallback thread ID
    // Note: When a simple task first appears via thread:created event, the thread may exist
    // on disk but not yet be hydrated into the frontend store. The simple task window should
    // handle this gracefully by looking up the thread from disk if needed.
    const threadId = threads[0]?.id ?? task.id;

    if (task.type === "simple") {
      // Pass task.title as prompt for optimistic UI display while loading
      openSimpleTask(threadId, task.id, task.title);
    } else {
      openTask(threadId, task.id);
    }
  }, []);

  const handleTaskDelete = useCallback(async (task: TaskMetadata) => {
    await deleteTask(task);
  }, [deleteTask]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await taskService.refresh();
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface-900">
      <header className="px-4 py-3 border-b border-surface-700/50 flex items-center gap-4">
        {/* Sidebar toggle */}
        {onCloseSidebar && (
          <button
            onClick={onCloseSidebar}
            className="p-1.5 text-surface-400 hover:text-surface-300 hover:bg-surface-800/50 rounded transition-colors duration-150"
            title="Toggle sidebar"
          >
            <PanelLeft size={16} />
          </button>
        )}

        <h1 className="text-lg font-medium text-surface-100 font-mono">Tasks</h1>

        {/* Search */}
        <div className="relative flex-1 max-w-xs ml-2">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-500" />
          <input
            type="text"
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-7 pr-3 py-1 text-sm bg-surface-800/50 text-surface-100 placeholder:text-surface-500 focus:outline-none focus:bg-surface-800 transition-colors border-0 rounded"
          />
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Refresh button */}
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="p-1.5 text-surface-400 hover:text-surface-300 disabled:opacity-50"
          title="Force refresh tasks (updates happen automatically)"
        >
          <RefreshCw size={16} className={isRefreshing ? "animate-spin" : ""} />
        </button>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        <UnifiedTaskList
          tasks={tasks}
          onTaskSelect={handleTaskClick}
          onTaskDelete={handleTaskDelete}
        />
      </div>

    </div>
  );
}
