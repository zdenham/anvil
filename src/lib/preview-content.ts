import type { ThreadMetadata } from "@/entities/threads/types";

const MAX_THREAD_PREVIEW_LENGTH = 500;
const MAX_PLAN_PREVIEW_LENGTH = 200;

/**
 * Gets preview content for a thread from its metadata.
 * Returns the last turn's prompt, truncated if necessary.
 */
export function getThreadPreviewContent(thread: ThreadMetadata): string | null {
  if (!thread?.turns?.length) return null;

  const lastTurn = thread.turns[thread.turns.length - 1];
  const prompt = lastTurn?.prompt;

  if (!prompt) return null;

  if (prompt.length > MAX_THREAD_PREVIEW_LENGTH) {
    return prompt.slice(0, MAX_THREAD_PREVIEW_LENGTH) + "...";
  }

  return prompt;
}

/**
 * Gets preview content for a plan.
 * Since plan content is loaded async, this returns the content truncated.
 */
export function getPlanPreviewContent(content: string | null): string | null {
  if (!content) return null;

  if (content.length > MAX_PLAN_PREVIEW_LENGTH) {
    return content.slice(0, MAX_PLAN_PREVIEW_LENGTH) + "...";
  }

  return content;
}

/**
 * Represents an item that can be previewed in the command palette.
 */
export interface PreviewableItem {
  type: "thread" | "plan";
  id: string;
  name: string;
  preview: string | null;
  updatedAt: number;
  repoId: string;
  worktreeId: string;
}
