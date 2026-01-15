import { create } from "zustand";
import type { Rollback } from "@/lib/optimistic";
import type { TaskMetadata, TaskStatus } from "./types";
import { logger } from "@/lib/logger-client";

interface TaskState {
  tasks: Record<string, TaskMetadata>;
  taskContent: Record<string, string>;
  _hydrated: boolean;
}

interface TaskActions {
  /** Hydration (called once at app start) */
  hydrate: (tasks: Record<string, TaskMetadata>) => void;

  /** Selectors */
  getRootTasks: () => TaskMetadata[];
  getSubtasks: (parentId: string) => TaskMetadata[];
  getTasksByStatus: (status: TaskStatus) => TaskMetadata[];
  getTask: (id: string) => TaskMetadata | undefined;
  getTaskContent: (id: string) => string | undefined;

  /** Optimistic apply methods - return rollback functions for use with optimistic() */
  _applyCreate: (task: TaskMetadata) => Rollback;
  _applyUpdate: (id: string, task: TaskMetadata) => Rollback;
  _applyDelete: (id: string) => Rollback;
  _applyContentLoaded: (id: string, content: string) => Rollback;
}

export const useTaskStore = create<TaskState & TaskActions>((set, get) => ({
  // ═══════════════════════════════════════════════════════════════════════════
  // State
  // ═══════════════════════════════════════════════════════════════════════════
  tasks: {},
  taskContent: {},
  _hydrated: false,

  // ═══════════════════════════════════════════════════════════════════════════
  // Hydration
  // ═══════════════════════════════════════════════════════════════════════════
  hydrate: (tasks) => {
    logger.debug(`[useTaskStore.hydrate] Hydrating store with ${Object.keys(tasks).length} tasks`);
    set({ tasks, _hydrated: true });
    logger.debug(`[useTaskStore.hydrate] Store hydration completed`);
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Selectors
  // ═══════════════════════════════════════════════════════════════════════════
  getRootTasks: () => Object.values(get().tasks).filter((t) => !t.parentId),
  getSubtasks: (parentId) =>
    Object.values(get().tasks).filter((t) => t.parentId === parentId),
  getTasksByStatus: (status) =>
    Object.values(get().tasks).filter((t) => t.status === status),
  getTask: (id) => get().tasks[id],
  getTaskContent: (id) => get().taskContent[id],

  // ═══════════════════════════════════════════════════════════════════════════
  // Optimistic Apply Methods
  // ═══════════════════════════════════════════════════════════════════════════
  _applyCreate: (task: TaskMetadata): Rollback => {
    logger.debug(`[useTaskStore._applyCreate] Creating task in store: ${task.id} (${task.title})`);
    const beforeCount = Object.keys(get().tasks).length;

    set((state) => ({ tasks: { ...state.tasks, [task.id]: task } }));

    const afterCount = Object.keys(get().tasks).length;
    logger.debug(`[useTaskStore._applyCreate] Store updated - task count: ${beforeCount} → ${afterCount}`);

    return () => {
      logger.debug(`[useTaskStore._applyCreate] Rolling back creation of task: ${task.id}`);
      set((state) => {
        const { [task.id]: _, ...rest } = state.tasks;
        return { tasks: rest };
      });
    };
  },

  _applyUpdate: (id: string, task: TaskMetadata): Rollback => {
    const prev = get().tasks[id];
    logger.debug(`[useTaskStore._applyUpdate] Updating task in store: ${id} (${task.title})`);

    set((state) => ({ tasks: { ...state.tasks, [id]: task } }));
    logger.debug(`[useTaskStore._applyUpdate] Store update completed for task: ${id}`);

    return () => {
      logger.debug(`[useTaskStore._applyUpdate] Rolling back update of task: ${id}`);
      set((state) => ({
        tasks: prev ? { ...state.tasks, [id]: prev } : state.tasks,
      }));
    };
  },

  _applyDelete: (id: string): Rollback => {
    const prev = get().tasks[id];
    const prevContent = get().taskContent[id];
    logger.debug(`[useTaskStore._applyDelete] Deleting task from store: ${id}`);
    const beforeCount = Object.keys(get().tasks).length;

    set((state) => {
      const { [id]: _, ...rest } = state.tasks;
      const { [id]: __, ...restContent } = state.taskContent;
      return { tasks: rest, taskContent: restContent };
    });

    const afterCount = Object.keys(get().tasks).length;
    logger.debug(`[useTaskStore._applyDelete] Store deletion completed - task count: ${beforeCount} → ${afterCount}`);

    return () => {
      logger.debug(`[useTaskStore._applyDelete] Rolling back deletion of task: ${id}`);
      set((state) => ({
        tasks: prev ? { ...state.tasks, [id]: prev } : state.tasks,
        taskContent: prevContent
          ? { ...state.taskContent, [id]: prevContent }
          : state.taskContent,
      }));
    };
  },

  _applyContentLoaded: (id: string, content: string): Rollback => {
    const prev = get().taskContent[id];
    set((state) => ({ taskContent: { ...state.taskContent, [id]: content } }));
    return () =>
      set((state) => ({
        taskContent: prev !== undefined
          ? { ...state.taskContent, [id]: prev }
          : (() => {
              const { [id]: _, ...rest } = state.taskContent;
              return rest;
            })(),
      }));
  },
}));
