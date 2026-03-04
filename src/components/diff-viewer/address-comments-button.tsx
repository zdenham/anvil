import { memo, useCallback, useState } from "react";
import { MessageSquareWarning } from "lucide-react";
import { useDiffCommentStore } from "@/contexts/diff-comment-context";
import { useCommentStore } from "@/entities/comments/store";
import {
  isAgentSocketConnected,
  sendQueuedMessage,
  resumeSimpleAgent,
} from "@/lib/agent-service";
import { createThread } from "@/lib/thread-creation-service";
import { logger } from "@/lib/logger-client";
import { Tooltip } from "@/components/ui/tooltip";
import type { InlineComment } from "@core/types/comments.js";

/**
 * "Address Comments" button that sends unresolved comments to the agent.
 * Visible when there are unresolved comments. Works with or without a threadId:
 * - With threadId: sends to that specific thread's agent
 * - Without threadId: creates a new thread (changes tab case)
 */
export const AddressCommentsButton = memo(function AddressCommentsButton() {
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
        logger.warn("[AddressCommentsButton] No worktreePath in context");
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
        logger.error("[AddressCommentsButton] Failed to send comments to agent", err);
      } finally {
        setIsSending(false);
      }
    },
    [threadId, worktreeId, repoId, worktreePath, isSending],
  );

  if (unresolvedCount === 0) return null;

  return (
    <Tooltip content={`Send ${unresolvedCount} comment${unresolvedCount !== 1 ? "s" : ""} to agent`}>
      <button
        type="button"
        data-testid="address-comments-button"
        onClick={handleClick}
        disabled={isSending}
        className="
          inline-flex items-center gap-1 px-2 py-1 text-xs rounded
          bg-amber-500/20 text-amber-400 hover:bg-amber-500/30
          disabled:opacity-50 disabled:cursor-not-allowed
          flex-shrink-0
        "
        aria-label="Address comments"
      >
        <MessageSquareWarning className="w-3 h-3" />
        {isSending ? "Sending..." : "Address"}
      </button>
    </Tooltip>
  );
});

function formatLineRef(c: InlineComment): string {
  const tag = c.lineType === "addition" ? " [added line]"
            : c.lineType === "deletion" ? " [deleted line]"
            : "";
  return `${c.filePath}:${c.lineNumber}${tag}`;
}

/** Format unresolved comments into a prompt for the agent. */
function formatAddressPrompt(comments: InlineComment[]): string {
  const commentIds = comments.map((c) => c.id);
  const sections = comments.map(
    (c) => `## ${formatLineRef(c)} (comment-id: ${c.id})\n> ${c.content}`,
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
