import { useMemo, useCallback, useEffect } from "react";
import { useTaskStore } from "@/entities/tasks/store";
import { taskService } from "@/entities/tasks/service";
import type { TaskMetadata, TaskStatus } from "@/entities/tasks/types";
import { TASK_STATUSES } from "@/entities/tasks/types";
import { logger } from "@/lib/logger-client";

export interface GroupedTasks {
  draft: TaskMetadata[];
  backlog: TaskMetadata[];
  todo: TaskMetadata[];
  "in-progress": TaskMetadata[];
  "in-review": TaskMetadata[];
  done: TaskMetadata[];
}

export interface TaskBoardFilters {
  tags: string[];
  search: string;
}

export function useTaskBoard(filters: TaskBoardFilters) {
  const tasks = useTaskStore((s) => s.tasks);

  // Debug: Log when the tasks object reference changes
  useEffect(() => {
    const taskCount = Object.keys(tasks).length;
    const taskIds = Object.keys(tasks);
    logger.debug(`[useTaskBoard] Store subscription fired - ${taskCount} tasks: ${taskIds.join(', ')}`);

    // Log the status of each task for debugging
    Object.values(tasks).forEach(task => {
      logger.debug(`[useTaskBoard] Store task: ${task.id} "${task.title}" (status: ${task.status}, created: ${new Date(task.createdAt).toLocaleTimeString()})`);
    });
  }, [tasks]);

  const groupedTasks = useMemo(() => {
    const allTasksCount = Object.keys(tasks).length;
    logger.debug(`[useTaskBoard] Starting task grouping with ${allTasksCount} total tasks`);

    const groups: GroupedTasks = {
      draft: [],
      backlog: [],
      todo: [],
      "in-progress": [],
      "in-review": [],
      done: [],
    };

    let filteredCount = 0;
    let cancelledCount = 0;

    for (const task of Object.values(tasks)) {
      logger.debug(`[useTaskBoard] Processing task ${task.id}: "${task.title}" (status: ${task.status})`);

      // Filter by tags
      if (filters.tags.length > 0) {
        if (!filters.tags.some((tag) => task.tags.includes(tag))) {
          logger.debug(`[useTaskBoard] Task ${task.id} filtered out by tags`);
          continue;
        }
      }
      // Filter by search
      if (filters.search) {
        if (!task.title.toLowerCase().includes(filters.search.toLowerCase())) {
          logger.debug(`[useTaskBoard] Task ${task.id} filtered out by search`);
          continue;
        }
      }
      // Skip cancelled tasks from kanban view
      if (task.status === "cancelled") {
        cancelledCount++;
        logger.debug(`[useTaskBoard] Task ${task.id} skipped (cancelled)`);
        continue;
      }

      filteredCount++;

      // Group by task status
      if (task.status in groups) {
        groups[task.status as keyof GroupedTasks].push(task);
        logger.debug(`[useTaskBoard] Task ${task.id} added to ${task.status} group`);
      } else {
        logger.debug(`[useTaskBoard] Task ${task.id} has unknown status: ${task.status}`);
      }
    }

    // Sort each group by sortOrder
    for (const status of TASK_STATUSES) {
      if (status in groups) {
        groups[status as keyof GroupedTasks].sort((a, b) => a.sortOrder - b.sortOrder);
      }
    }

    // Log final group counts
    const groupCounts = Object.entries(groups).map(([status, tasks]) => `${status}: ${tasks.length}`).join(', ');
    logger.debug(`[useTaskBoard] Task grouping completed - Total: ${allTasksCount}, Filtered: ${filteredCount}, Cancelled: ${cancelledCount}`);
    logger.debug(`[useTaskBoard] Group counts: ${groupCounts}`);

    return groups;
  }, [tasks, filters.tags, filters.search]);

  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const task of Object.values(tasks)) {
      for (const tag of task.tags) tagSet.add(tag);
    }
    return Array.from(tagSet).sort();
  }, [tasks]);

  const reorderWithinColumn = useCallback(
    async (taskId: string, targetIndex: number, status: TaskStatus) => {
      // Get fresh column data from current tasks
      const column = Object.values(tasks)
        .filter((task) => task.status === status && task.status !== "cancelled")
        .sort((a, b) => a.sortOrder - b.sortOrder);

      const taskIndex = column.findIndex((t) => t.id === taskId);
      if (taskIndex === -1) return;

      // Calculate new order
      const newOrder = [...column];
      const [moved] = newOrder.splice(taskIndex, 1);
      newOrder.splice(targetIndex, 0, moved);

      // Assign new sort orders (use index * 1000 for spacing)
      const updates = newOrder.map((t, i) => ({
        id: t.id,
        sortOrder: i * 1000,
      }));

      // Update all affected tasks
      for (const { id, sortOrder } of updates) {
        await taskService.update(id, { sortOrder });
      }
    },
    [tasks]
  );

  const moveToColumn = useCallback(
    async (taskId: string, targetStatus: TaskStatus, targetIndex?: number) => {
      // Get fresh target column data from current tasks
      const targetColumn = Object.values(tasks)
        .filter((task) => task.status === targetStatus && task.status !== "cancelled")
        .sort((a, b) => a.sortOrder - b.sortOrder);

      // Calculate sort order based on target position
      let sortOrder: number;
      if (targetIndex === undefined || targetColumn.length === 0) {
        // Add to end of column
        sortOrder = targetColumn.length > 0
          ? targetColumn[targetColumn.length - 1].sortOrder + 1000
          : 0;
      } else if (targetIndex === 0) {
        // Add to beginning
        sortOrder = targetColumn[0].sortOrder - 1000;
      } else {
        // Insert between two tasks
        const prevOrder = targetColumn[targetIndex - 1].sortOrder;
        const nextOrder = targetColumn[targetIndex]?.sortOrder ?? prevOrder + 2000;
        sortOrder = Math.floor((prevOrder + nextOrder) / 2);
      }

      await taskService.update(taskId, { status: targetStatus, sortOrder });
    },
    [tasks]
  );

  // Find which column a task is in
  const findTaskColumn = useCallback(
    (taskId: string): TaskStatus | null => {
      const task = tasks[taskId];
      return task?.status ?? null;
    },
    [tasks]
  );

  return { groupedTasks, allTags, reorderWithinColumn, moveToColumn, findTaskColumn };
}
