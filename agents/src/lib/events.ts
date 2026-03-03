/**
 * Strongly-typed event emitter for agents.
 * Outputs via socket for Tauri frontend consumption.
 */
import {
  EventName,
  type EventPayloads,
  type EventNameType,
  type WorktreeStatePayload,
} from "@core/types/events.js";
import type { ThreadStatus } from "@core/types/threads.js";
import { getHubClient } from "../output.js";
import { logger } from "./logger.js";

/**
 * Emit a strongly-typed event via socket.
 * Tauri frontend receives these and dispatches to event bus.
 * If hub is not connected, logs a warning and skips (events require socket connection).
 */
export function emitEvent<E extends EventNameType>(
  name: E,
  payload: EventPayloads[E]
): void {
  const hub = getHubClient();
  if (hub?.isConnected) {
    hub.sendEvent(name, payload);
  } else {
    logger.warn(`[events] Hub not connected, skipping event: ${name}`);
  }
}

/**
 * Convenience helpers for common events.
 */
export const events = {
  emit: emitEvent,

  // Thread events
  threadCreated: (threadId: string, repoId: string, worktreeId: string) =>
    emitEvent(EventName.THREAD_CREATED, { threadId, repoId, worktreeId }),

  threadUpdated: (threadId: string) =>
    emitEvent(EventName.THREAD_UPDATED, { threadId }),

  threadStatusChanged: (threadId: string, status: ThreadStatus) =>
    emitEvent(EventName.THREAD_STATUS_CHANGED, { threadId, status }),

  threadNameGenerated: (threadId: string, name: string) =>
    emitEvent(EventName.THREAD_NAME_GENERATED, { threadId, name }),

  // Orchestration events
  worktreeAllocated: (worktree: WorktreeStatePayload, mergeBase: string) =>
    emitEvent(EventName.WORKTREE_ALLOCATED, { worktree, mergeBase }),

  worktreeReleased: (threadId: string) =>
    emitEvent(EventName.WORKTREE_RELEASED, { threadId }),

  worktreeNameGenerated: (worktreeId: string, repoId: string, name: string) =>
    emitEvent(EventName.WORKTREE_NAME_GENERATED, { worktreeId, repoId, name }),

  // API health
  apiDegraded: (service: string, message: string) =>
    emitEvent(EventName.API_DEGRADED, { service, message }),
};
