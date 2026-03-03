import { memo, useCallback, useState } from "react";
import { MessageSquareWarning } from "lucide-react";
import { useDiffCommentStore } from "@/contexts/diff-comment-context";
import { useCommentStore } from "@/entities/comments/store";
import {
  isAgentSocketConnected,
  sendQueuedMessage,
  resumeSimpleAgent,
} from "@/lib/agent-service";
import { useThreadStore } from "@/entities/threads/store";
import { useWorkingDirectory } from "@/hooks/use-working-directory";
import { logger } from "@/lib/logger-client";
import { Tooltip } from "@/components/ui/tooltip";
import type { InlineComment } from "@core/types/comments.js";

/**
 * "Address Comments" button that sends unresolved comments to the agent.
 * Only visible when there are unresolved comments and a threadId is set.
 */
export const AddressCommentsButton = memo(function AddressCommentsButton() {
  const worktreeId = useDiffCommentStore((s) => s.worktreeId);
  const threadId = useDiffCommentStore((s) => s.threadId);
  const [isSending, setIsSending] = useState(false);

  const unresolvedCount = useCommentStore(
    useCallback(
      (s) => s.getUnresolvedCount(worktreeId, threadId),
      [worktreeId, threadId],
    ),
  );

  const unresolvedComments = useCommentStore(
    useCallback(
      (s) => s.getUnresolved(worktreeId, threadId),
      [worktreeId, threadId],
    ),
  );

  const thread = useThreadStore(
    useCallback(
      (s) => (threadId ? s.threads[threadId] : undefined),
      [threadId],
    ),
  );

  const workingDirectory = useWorkingDirectory(thread);

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!threadId || unresolvedComments.length === 0 || isSending) return;

      setIsSending(true);
      try {
        const prompt = formatAddressPrompt(unresolvedComments);
        const isConnected = await isAgentSocketConnected(threadId);

        if (isConnected) {
          await sendQueuedMessage(threadId, prompt);
        } else if (workingDirectory) {
          await resumeSimpleAgent(threadId, prompt, workingDirectory);
        } else {
          logger.warn("[AddressCommentsButton] No working directory for thread", { threadId });
        }
      } catch (err) {
        logger.error("[AddressCommentsButton] Failed to send comments to agent", err);
      } finally {
        setIsSending(false);
      }
    },
    [threadId, unresolvedComments, isSending, workingDirectory],
  );

  // Only show when there are unresolved comments and a thread context
  if (!threadId || unresolvedCount === 0) return null;

  return (
    <Tooltip content={`Send ${unresolvedCount} comment${unresolvedCount !== 1 ? "s" : ""} to agent`}>
      <button
        type="button"
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

/** Format unresolved comments into a prompt for the agent. */
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
