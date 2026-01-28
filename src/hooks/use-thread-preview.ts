import { useThreadStore } from "@/entities/threads/store";
import { getThreadPreviewContent } from "@/lib/preview-content";

/**
 * Hook to get the most recent user message from a thread for preview.
 * Returns the last turn's prompt, truncated if necessary.
 */
export function useThreadPreview(threadId: string): string | null {
  const thread = useThreadStore((s) => s.getThread(threadId));
  if (!thread) return null;
  return getThreadPreviewContent(thread);
}
