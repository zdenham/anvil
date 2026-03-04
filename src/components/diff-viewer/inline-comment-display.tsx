import { memo, useCallback } from "react";
import { Check, RotateCcw, Trash2 } from "lucide-react";
import { useDiffCommentStore } from "@/contexts/diff-comment-context";
import { commentService } from "@/entities/comments/service";
import { logger } from "@/lib/logger-client";
import type { InlineComment } from "@core/types/comments.js";

interface InlineCommentDisplayProps {
  /** Comments to display for this line */
  comments: InlineComment[];
}

/**
 * Displays comments for a single diff line.
 * Shows comment content, relative timestamp, and resolution controls.
 */
export const InlineCommentDisplay = memo(function InlineCommentDisplay({
  comments,
}: InlineCommentDisplayProps) {
  if (comments.length === 0) return null;

  return (
    <div className="sticky left-0 ml-24 py-1 space-y-1">
      {comments.map((comment) => (
        <CommentItem key={comment.id} comment={comment} />
      ))}
    </div>
  );
});

function CommentItem({ comment }: { comment: InlineComment }) {
  const worktreeId = useDiffCommentStore((s) => s.worktreeId);

  const handleResolve = useCallback(async () => {
    try {
      await commentService.resolve(worktreeId, comment.id);
    } catch (err) {
      logger.error("[CommentItem] Failed to resolve comment", err);
    }
  }, [worktreeId, comment.id]);

  const handleUnresolve = useCallback(async () => {
    try {
      await commentService.unresolve(worktreeId, comment.id);
    } catch (err) {
      logger.error("[CommentItem] Failed to unresolve comment", err);
    }
  }, [worktreeId, comment.id]);

  const handleDelete = useCallback(async () => {
    try {
      await commentService.delete(worktreeId, comment.id);
    } catch (err) {
      logger.error("[CommentItem] Failed to delete comment", err);
    }
  }, [worktreeId, comment.id]);

  const timeAgo = formatRelativeTime(comment.createdAt);

  if (comment.resolved) {
    return (
      <div data-testid={`inline-comment-${comment.id}`} className="flex items-start gap-2 px-3 py-2.5 bg-surface-800/50 border-l-2 border-t border-r border-b border-surface-600 opacity-60">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-surface-400 line-through whitespace-pre-wrap">
            {comment.content}
          </p>
          <span className="text-[10px] text-surface-500">{timeAgo}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={handleUnresolve}
            className="p-1 text-surface-500 hover:text-surface-300 rounded hover:bg-surface-700"
            aria-label="Reopen comment"
            title="Reopen"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="p-1 text-surface-500 hover:text-red-400 rounded hover:bg-surface-700"
            aria-label="Delete comment"
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-testid={`inline-comment-${comment.id}`} className="flex items-start gap-2 px-3 py-2.5 bg-surface-800 border-l-2 border-amber-400 border-t border-r border-b border-t-surface-700 border-r-surface-700 border-b-surface-700">
      <div className="flex-1 min-w-0">
        <p className="text-sm text-surface-200 whitespace-pre-wrap">
          {comment.content}
        </p>
        <span className="text-[10px] text-surface-500">{timeAgo}</span>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          type="button"
          onClick={handleResolve}
          className="p-1 text-surface-500 hover:text-emerald-400 rounded hover:bg-surface-700"
          aria-label="Resolve comment"
          title="Resolve"
        >
          <Check className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="p-1 text-surface-500 hover:text-red-400 rounded hover:bg-surface-700"
          aria-label="Delete comment"
          title="Delete"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

/** Format a timestamp as relative time (e.g., "2m ago", "1h ago"). */
function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
