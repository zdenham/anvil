import { memo } from "react";
import { Plus } from "lucide-react";

interface CommentGutterButtonProps {
  /** Callback when the button is clicked */
  onClick: () => void;
  /** Line number for test identification */
  lineNumber?: number;
}

/**
 * Small "+" button that appears on hover in the gutter area of a diff line.
 * Clicking opens the inline comment form below that line.
 *
 * Rendered as an absolutely-positioned overlay on the old-line-number cell.
 * Uses CSS group-hover to show on hover.
 */
export const CommentGutterButton = memo(function CommentGutterButton({
  onClick,
  lineNumber,
}: CommentGutterButtonProps) {
  return (
    <button
      type="button"
      data-testid={lineNumber != null ? `comment-gutter-button-${lineNumber}` : "comment-gutter-button"}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="
        absolute left-0 top-0 z-10
        w-6 h-6 flex items-center justify-center
        bg-accent-500 text-accent-900 rounded
        gutter-btn opacity-0 group-hover:opacity-100
        transition-opacity duration-100
        hover:bg-accent-400
        cursor-pointer
      "
      aria-label="Add comment"
    >
      <Plus className="w-3.5 h-3.5" />
    </button>
  );
});
