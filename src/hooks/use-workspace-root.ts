import { useThreadStore } from "@/entities/threads";
import { useWorkingDirectory } from "./use-working-directory";

/**
 * Hook to get the workspace root for path display.
 * Uses existing useWorkingDirectory which handles async fetch and caching.
 *
 * @param threadId - The thread ID
 * @returns Workspace root path, or empty string if not yet resolved
 */
export function useWorkspaceRoot(threadId: string): string {
  // threads is Record<string, ThreadMetadata> in the store
  const thread = useThreadStore((state) => state.threads[threadId]);
  return useWorkingDirectory(thread);
}
