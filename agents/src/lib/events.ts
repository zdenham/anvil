/**
 * Strongly-typed event emitter for agents.
 * Outputs structured JSON events to stdout for Tauri frontend consumption.
 */
import {
  EventName,
  type EventPayloads,
  type AgentEventMessage,
  type EventNameType,
  type WorktreeStatePayload,
} from "@core/types/events.js";
import type { TaskStatus } from "@core/types/tasks.js";
import type { ThreadStatus } from "@core/types/threads.js";
import { stdout } from "./logger.js";

/**
 * Emit a strongly-typed event to stdout.
 * Tauri frontend parses these and dispatches to event bus.
 */
export function emitEvent<E extends EventNameType>(
  name: E,
  payload: EventPayloads[E]
): void {
  const message: AgentEventMessage<E> = {
    type: "event",
    name,
    payload,
  };
  stdout(message as unknown as Record<string, unknown>);
}

/**
 * Convenience helpers for common events.
 */
export const events = {
  emit: emitEvent,

  // Task events
  taskCreated: (taskId: string) =>
    emitEvent(EventName.TASK_CREATED, { taskId }),

  taskUpdated: (taskId: string) =>
    emitEvent(EventName.TASK_UPDATED, { taskId }),

  taskDeleted: (taskId: string) =>
    emitEvent(EventName.TASK_DELETED, { taskId }),

  taskStatusChanged: (taskId: string, status: TaskStatus) =>
    emitEvent(EventName.TASK_STATUS_CHANGED, { taskId, status }),

  // Thread events
  threadCreated: (threadId: string, taskId: string) =>
    emitEvent(EventName.THREAD_CREATED, { threadId, taskId }),

  threadUpdated: (threadId: string, taskId: string) =>
    emitEvent(EventName.THREAD_UPDATED, { threadId, taskId }),

  threadStatusChanged: (threadId: string, status: ThreadStatus) =>
    emitEvent(EventName.THREAD_STATUS_CHANGED, { threadId, status }),

  // Orchestration events
  worktreeAllocated: (worktree: WorktreeStatePayload, mergeBase: string) =>
    emitEvent(EventName.WORKTREE_ALLOCATED, { worktree, mergeBase }),

  worktreeReleased: (threadId: string) =>
    emitEvent(EventName.WORKTREE_RELEASED, { threadId }),

  // Action request
  actionRequested: (taskId: string, markdown: string, defaultResponse: string) =>
    emitEvent(EventName.ACTION_REQUESTED, { taskId, markdown, defaultResponse }),
};
