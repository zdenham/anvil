import { memo, useCallback, useState } from "react";
import { ArrowRight, ChevronUp, ChevronDown } from "lucide-react";
import { useDiffCommentStore } from "@/contexts/diff-comment-context";
import {
  isAgentSocketConnected,
  sendQueuedMessage,
  resumeSimpleAgent,
} from "@/lib/agent-service";
import { createThread } from "@/lib/thread-creation-service";
import { navigationService } from "@/stores/navigation-service";
import { logger } from "@/lib/logger-client";
import { useUnresolvedInDiff } from "@/hooks/use-unresolved-in-diff";
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

  const unresolvedComments = useUnresolvedInDiff(worktreeId, threadId);
  const unresolvedCount = unresolvedComments.length;

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isSending) return;

      if (!worktreePath) {
        logger.warn("[FloatingAddressButton] No worktreePath in context");
        return;
      }

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
          await navigationService.navigateToThread(threadId, { newTab: true });
        } else {
          const { threadId: newThreadId } = await createThread({ prompt, repoId, worktreeId, worktreePath });
          await navigationService.navigateToThread(newThreadId, { newTab: true });
        }
      } catch (err) {
        logger.error("[FloatingAddressButton] Failed to send comments to agent", err);
      } finally {
        setIsSending(false);
      }
    },
    [threadId, worktreeId, repoId, worktreePath, isSending, unresolvedComments],
  );

  if (unresolvedCount === 0) return null;

  const label = isSending
    ? "Sending..."
    : `Address ${unresolvedCount} comment${unresolvedCount !== 1 ? "s" : ""}`;

  return (
    <div className="fixed bottom-6 right-6 z-50 inline-flex items-center gap-1.5">
      <CommentNav count={unresolvedCount} />
      <button
        type="button"
        data-testid="floating-address-button"
        onClick={handleClick}
        disabled={isSending}
        className="
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
    </div>
  );
});

/** Returns sorted unresolved comment elements from the DOM. */
function getUnresolvedCommentEls(): HTMLElement[] {
  const all = Array.from(
    document.querySelectorAll<HTMLElement>('[data-testid^="inline-comment-"]'),
  );
  // Unresolved comments have border-amber-400; resolved have opacity-60
  const els = all.filter((el) => !el.classList.contains("opacity-60"));
  els.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  return els;
}

function scrollToComment(direction: "prev" | "next") {
  const els = getUnresolvedCommentEls();
  if (els.length === 0) return;

  // Use a point just above viewport center as the reference
  const refY = window.innerHeight * 0.4;

  if (direction === "next") {
    // First element whose top is below the reference point
    const target = els.find((el) => el.getBoundingClientRect().top > refY + 10);
    (target ?? els[0]).scrollIntoView({ behavior: "smooth", block: "center" });
  } else {
    // Last element whose top is above the reference point
    const above = els.filter((el) => el.getBoundingClientRect().top < refY - 10);
    const target = above.length > 0 ? above[above.length - 1] : els[els.length - 1];
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

const navBtnClass =
  "flex items-center justify-center w-3.5 h-3.5 rounded-sm bg-white text-surface-800 hover:bg-surface-200 shadow";

/** Up/down arrows that jump between unresolved comments. */
const CommentNav = memo(function CommentNav({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <div className="flex flex-col gap-px">
      <button
        type="button"
        aria-label="Previous comment"
        title="Previous comment"
        className={navBtnClass}
        onClick={() => scrollToComment("prev")}
      >
        <ChevronUp className="w-2.5 h-2.5" strokeWidth={3} />
      </button>
      <button
        type="button"
        aria-label="Next comment"
        title="Next comment"
        className={navBtnClass}
        onClick={() => scrollToComment("next")}
      >
        <ChevronDown className="w-2.5 h-2.5" strokeWidth={3} />
      </button>
    </div>
  );
});

function formatLineRef(c: InlineComment): string {
  const tag = c.lineType === "addition" ? " [added line]"
            : c.lineType === "deletion" ? " [deleted line]"
            : "";
  return `${c.filePath}:${c.lineNumber}${tag}`;
}

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
    "",
    "Note: mort-resolve-comment is a virtual command intercepted by the system. It will appear as \"denied\" in the tool output but the comments ARE resolved — this is expected behavior, do not retry.",
  ].join("\n");
}
