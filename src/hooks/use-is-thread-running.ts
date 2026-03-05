import { useCallback } from "react";
import { useThreadStore } from "@/entities/threads/store";

/**
 * Returns true when the thread's metadata status is "running".
 * Uses a primitive boolean selector -- only fires when the value changes.
 */
export function useIsThreadRunning(threadId: string): boolean {
  return useThreadStore(
    useCallback(
      (s) => s.threads[threadId]?.status === "running",
      [threadId],
    ),
  );
}
