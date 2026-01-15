import { useMemo } from "react";
import { useThreadStore } from "@/entities/threads/store";

export type ActionState =
  | { type: "streaming" }
  | { type: "awaiting-input"; placeholder: string }
  | { type: "review-pending"; reviewId: string }
  | { type: "idle" }
  | { type: "completed" };

/**
 * Determines the current action panel state based on task/thread status.
 * Used to display the appropriate UI in the action panel.
 */
export function useActionState(
  taskId: string | null,
  threadId: string | null
): ActionState {
  const thread = useThreadStore((state) =>
    threadId ? state.threads[threadId] : null
  );

  return useMemo(() => {
    // Check if streaming (agent running)
    // Thread status is updated by disk-first listeners when agent:state events arrive
    if (thread?.status === "running") {
      return { type: "streaming" };
    }

    // Check if thread is completed
    if (thread?.status === "completed") {
      return { type: "completed" };
    }

    // Check if thread is paused (awaiting input)
    if (thread?.status === "paused") {
      return { type: "awaiting-input", placeholder: "Continue the conversation..." };
    }

    // No active thread or task
    if (!taskId || !threadId) {
      return { type: "idle" };
    }

    // Default to idle if thread exists but state is unclear
    return { type: "idle" };
  }, [thread, taskId, threadId]);
}
