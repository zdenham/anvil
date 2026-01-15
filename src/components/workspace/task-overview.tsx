import { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { useTaskStore } from "@/entities/tasks/store";
import { taskService } from "@/entities/tasks/service";
import { eventBus } from "@/entities/events";
import { FileText, Tag } from "lucide-react";
import { logger } from "@/lib/logger-client";

interface TaskOverviewProps {
  taskId: string;
}

/**
 * Task overview panel showing task markdown content.
 */
export function TaskOverview({ taskId }: TaskOverviewProps) {
  const [content, setContent] = useState<string>("");
  const [initialLoading, setInitialLoading] = useState(true);
  const task = useTaskStore((state) => state.tasks[taskId]);

  // Refresh content from disk
  const refreshContent = useCallback(async (isInitial = false) => {
    if (isInitial) {
      setInitialLoading(true);
    }
    try {
      // refreshContent handles slug resolution internally (including renames)
      const newContent = await taskService.refreshContent(taskId);
      // Only update state if content actually changed
      setContent((prev) => (prev === newContent ? prev : newContent));
    } finally {
      if (isInitial) {
        setInitialLoading(false);
      }
    }
  }, [taskId]);

  // Subscribe to tool completion events for this task
  useEffect(() => {
    const handleToolCompleted = ({ taskId: eventTaskId }: { taskId: string | null }) => {
      if (eventTaskId === taskId) {
        logger.log(`[TaskOverview] Tool completed for task ${taskId}, refreshing content`);
        refreshContent(false); // Not initial load - don't show skeleton
      }
    };

    // Initial load - show skeleton
    refreshContent(true);

    // Subscribe to tool completions
    eventBus.on("agent:tool-completed", handleToolCompleted);
    return () => {
      eventBus.off("agent:tool-completed", handleToolCompleted);
    };
  }, [taskId, refreshContent]);

  if (!task) {
    return <OverviewEmptyState message="Task not found" />;
  }

  return (
    <div className="overflow-auto h-full">
      <section className="p-6">
        {initialLoading ? (
          <ContentSkeleton />
        ) : (
          <>
            {/* Tags (if any) */}
            {task.tags.length > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <Tag size={14} className="text-surface-500" />
                {task.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 text-xs rounded bg-surface-700/50 text-surface-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Markdown content */}
            {content ? (
              <article className="prose prose-invert prose-surface max-w-none prose-headings:text-surface-200 prose-p:text-surface-300 prose-a:text-accent-400 prose-code:text-surface-300 prose-pre:bg-surface-800/50">
                <ReactMarkdown>{content}</ReactMarkdown>
              </article>
            ) : (
              <p className="text-surface-500 text-sm">No content yet.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function ContentSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-8 bg-surface-700/50 rounded w-2/3 mb-4" />
      <div className="h-4 bg-surface-700/30 rounded w-1/3 mb-6" />
      <div className="space-y-3">
        <div className="h-4 bg-surface-700/30 rounded w-full" />
        <div className="h-4 bg-surface-700/30 rounded w-5/6" />
        <div className="h-4 bg-surface-700/30 rounded w-4/5" />
      </div>
    </div>
  );
}

function OverviewEmptyState({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center text-surface-500">
      <div className="text-center">
        <FileText size={32} className="mx-auto mb-2 opacity-50" />
        <p className="text-sm">{message}</p>
      </div>
    </div>
  );
}
