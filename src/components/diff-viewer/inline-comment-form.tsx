import { memo, useRef, useState, useEffect, useCallback } from "react";
import { useDiffCommentStore } from "@/contexts/diff-comment-context";
import { commentService } from "@/entities/comments/service";
import { logger } from "@/lib/logger-client";
import type { InlineComment } from "@core/types/comments.js";

interface InlineCommentFormProps {
  /** The file path for the comment */
  filePath: string;
  /** The line number for the comment */
  lineNumber: number;
  /** The line type (addition/deletion/unchanged) */
  lineType: InlineComment["lineType"];
  /** Callback when the form is closed (cancel or submit) */
  onClose: () => void;
}

/**
 * Inline comment form that appears below a diff line.
 * Submit via Cmd+Enter or button click, cancel via Escape.
 * Reads worktreeId and threadId from DiffCommentProvider context.
 */
export const InlineCommentForm = memo(function InlineCommentForm({
  filePath,
  lineNumber,
  lineType,
  onClose,
}: InlineCommentFormProps) {
  const worktreeId = useDiffCommentStore((s) => s.worktreeId);
  const threadId = useDiffCommentStore((s) => s.threadId);
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = content.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await commentService.create({
        worktreeId,
        filePath,
        lineNumber,
        lineType,
        content: trimmed,
        threadId,
      });
      onClose();
    } catch (err) {
      logger.error("[InlineCommentForm] Failed to create comment", err);
      setIsSubmitting(false);
    }
  }, [content, isSubmitting, worktreeId, filePath, lineNumber, lineType, threadId, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [onClose, handleSubmit],
  );

  return (
    <div data-testid="inline-comment-form" className="sticky left-0 border-l-2 border-accent-400 border-t border-r border-b border-t-surface-700 border-r-surface-700 border-b-surface-700 bg-surface-700/50 ml-24 px-4 py-3">
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Add a comment..."
        rows={3}
        className="
          w-full bg-surface-900 text-surface-200 text-sm
          border border-surface-600 rounded px-3 py-2
          resize-y placeholder-surface-500
          focus:outline-none focus:border-accent-400
        "
        disabled={isSubmitting}
      />
      <div className="flex items-center justify-between mt-2">
        <span className="text-xs text-surface-500">
          {"\u2318"}+Enter to submit, Esc to cancel
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 text-xs text-surface-400 hover:text-surface-200 rounded"
            disabled={isSubmitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!content.trim() || isSubmitting}
            className="
              px-3 py-1 text-xs rounded
              bg-accent-500 text-accent-900
              hover:bg-accent-400
              disabled:opacity-50 disabled:cursor-not-allowed
            "
          >
            {isSubmitting ? "Saving..." : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
});
