/**
 * Strongly-typed event emitter for agents.
 * Outputs via socket (or fallback to stdout) for Tauri frontend consumption.
 */
import {
  EventName,
  type EventPayloads,
  type AgentEventMessage,
  type EventNameType,
  type WorktreeStatePayload,
} from "@core/types/events.js";
import type { ThreadStatus } from "@core/types/threads.js";
import { stdout } from "./logger.js";
import { getHubClient } from "../output.js";

/**
 * Emit a strongly-typed event via socket (or fallback to stdout).
 * Tauri frontend receives these and dispatches to event bus.
 */
export function emitEvent<E extends EventNameType>(
  name: E,
  payload: EventPayloads[E]
): void {
  const hub = getHubClient();
  if (hub?.isConnected) {
    hub.sendEvent(name, payload);
  } else {
    // Fallback to stdout for backwards compatibility
    const message: AgentEventMessage<E> = {
      type: "event",
      name,
      payload,
    };
    stdout(message as unknown as Record<string, unknown>);
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
};
