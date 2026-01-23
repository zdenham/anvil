import type { ThreadMetadata } from "@/entities/threads/types";
import type { StatusDotVariant } from "@/components/ui/status-dot";

export interface DotColorResult {
  color: string;
  animation?: string;
}

/**
 * Get the status variant for a thread based on its status and read state.
 */
export function getThreadStatusVariant(thread: ThreadMetadata): StatusDotVariant {
  if (thread.status === "running") {
    return "running";
  }
  if (!thread.isRead) {
    return "unread";
  }
  return "read";
}

/**
 * Get the status variant for a plan based on read state, stale state, and associated threads.
 */
export function getPlanStatusVariant(
  isRead: boolean,
  hasRunningThread: boolean,
  isStale?: boolean
): StatusDotVariant {
  // Stale plans show warning status (file not found)
  if (isStale) {
    return "stale";
  }
  if (hasRunningThread) {
    return "running";
  }
  if (!isRead) {
    return "unread";
  }
  return "read";
}

/**
 * Get the dot color and animation for a thread based on its status and read state.
 *
 * - Running threads: green with glow animation (CSS class)
 * - Unread non-running threads: blue (no animation)
 * - Read non-running threads: grey (no animation)
 */
export function getThreadDotColor(thread: ThreadMetadata): DotColorResult {
  if (thread.status === "running") {
    return { color: "status-dot-running" }; // CSS class handles animation
  }
  if (!thread.isRead) {
    return { color: "bg-blue-500" };
  }
  return { color: "bg-zinc-400" };
}

/**
 * Get the dot color and animation for a plan based on read state and associated threads.
 *
 * Plan status is derived from associated threads (per decision #10):
 * - Has running thread: green with glow animation (CSS class)
 * - Unread with no running thread: blue (no animation)
 * - Read with no running thread: grey (no animation)
 */
export function getPlanDotColor(
  isRead: boolean,
  hasRunningThread: boolean
): DotColorResult {
  if (hasRunningThread) {
    return { color: "status-dot-running" };
  }
  if (!isRead) {
    return { color: "bg-blue-500" };
  }
  return { color: "bg-zinc-400" };
}
