import { useAgentModeStore } from "./store.js";
import type { AgentMode } from "./types.js";

/**
 * Hook to get the current mode for a specific thread.
 * Encapsulates the selector pattern for cleaner component usage.
 */
export function useThreadMode(threadId: string): AgentMode {
  return useAgentModeStore((s) => s.getMode(threadId));
}

/**
 * Hook to get the cycle function for mode changes.
 * Returns a stable function reference.
 */
export function useCycleMode(): (threadId: string) => AgentMode {
  return useAgentModeStore((s) => s.cycleMode);
}
