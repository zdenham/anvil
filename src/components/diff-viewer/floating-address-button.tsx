import { memo, useCallback, useState } from "react";
import { ArrowRight } from "lucide-react";
import { useDiffCommentStore } from "@/contexts/diff-comment-context";
import { useCommentStore } from "@/entities/comments/store";
import {
  isAgentSocketConnected,
  sendQueuedMessage,
  resumeSimpleAgent,
} from "@/lib/agent-service";
import { createThread } from "@/lib/thread-creation-service";
import { logger } from "@/lib/logger-client";
import type { InlineComment } from "@core/types/comments.js";

/**
 * Floating "Address N comments" button fixed to the bottom-right of the viewport.
 * Shows the total unresolved comment count across the entire diff.
 * Returns null when there are no unresolved comments.
 */
export const FloatingAddressButton = memo(function FloatingAddressButton() {
  const worktreeId = useDiffCommentStore((s) => s.worktreeId);
  const repoId = useDiffCommentStore((s) => s.repoId);
  const worktreePath = useDiffCommentStore((s) => s.worktreePath);
  const threadId = useDiffCommentStore((s) => s.threadId);
  const [isSending, setIsSending] = useState(false);

  const unresolvedCount = useCommentStore(
    useCallback(
      (s) => s.getUnresolvedCount(worktreeId, threadId),
      [worktreeId, threadId],
    ),
  );

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isSending) return;

      if (!worktreePath) {
        logger.warn("[FloatingAddressButton] No worktreePath in context");
        return;
      }

      const unresolvedComments = useCommentStore.getState().getUnresolved(worktreeId, threadId);
      if (unresolvedComments.length === 0) return;

      setIsSending(true);
      try {
        const prompt = formatAddressPrompt(unresolvedComments);

        if (threadId) {
          const isConnected = await isAgentSocketConnected(threadId);
          if (isConnected) {
            await sendQueuedMessage(threadId, prompt);
          } else {
            await resumeSimpleAgent(threadId, prompt, worktreePath);
          }
        } else {
          await createThread({ prompt, repoId, worktreeId, worktreePath });
        }
      } catch (err) {
        logger.error("[FloatingAddressButton] Failed to send comments to agent", err);
      } finally {
        setIsSending(false);
      }
    },
    [threadId, worktreeId, repoId, worktreePath, isSending],
  );

  if (unresolvedCount === 0) return null;

  const label = isSending
    ? "Sending..."
    : `Address ${unresolvedCount} comment${unresolvedCount !== 1 ? "s" : ""}`;

  return (
    <button
      type="button"
      data-testid="floating-address-button"
      onClick={handleClick}
      disabled={isSending}
      className="
        fixed bottom-6 right-6 z-50
        inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg
        bg-accent-500 text-accent-900
        hover:bg-accent-400
        disabled:opacity-50 disabled:cursor-not-allowed
        shadow-lg
      "
      aria-label={label}
    >
      {label}
      <ArrowRight className="w-4 h-4" />
    </button>
  );
});

function formatAddressPrompt(comments: InlineComment[]): string {
  const commentIds = comments.map((c) => c.id);
  const sections = comments.map(
    (c) => `## ${c.filePath}:${c.lineNumber} (comment-id: ${c.id})\n> ${c.content}`,
  );

  return [
    "Please address the following code review comments on this branch:",
    "",
    ...sections,
    "",
    "For each comment, make the requested change. After addressing a comment, mark it resolved:",
    `mort-resolve-comment "${commentIds.join(",")}"`,
  ].join("\n");
}
