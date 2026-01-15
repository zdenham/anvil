import { memo } from "react";
import { Check, X } from "lucide-react";

interface InlineDiffActionsProps {
  /** Callback when user accepts the change */
  onAccept?: () => void;
  /** Callback when user rejects the change */
  onReject?: () => void;
  /** Whether this block is focused (for keyboard hints) */
  isFocused?: boolean;
}

/**
 * Accept/reject action buttons for pending edit diffs.
 * Shows keyboard shortcuts when focused.
 */
export const InlineDiffActions = memo(function InlineDiffActions({
  onAccept,
  onReject,
  isFocused,
}: InlineDiffActionsProps) {
  return (
    <div className="flex items-center justify-end gap-2 px-3 py-2 bg-surface-800 border-t border-surface-700">
      {/* Reject button */}
      {onReject && (
        <button
          type="button"
          onClick={onReject}
          className="
            flex items-center gap-1.5 px-3 py-1.5
            text-sm font-medium
            text-red-400 hover:text-red-300
            bg-red-500/10 hover:bg-red-500/20
            border border-red-500/30 hover:border-red-500/50
            rounded
            transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500
          "
          aria-label="Reject change"
        >
          <X className="w-4 h-4" aria-hidden="true" />
          <span>Reject</span>
          {isFocused && (
            <kbd className="ml-1 px-1 text-xs bg-red-500/20 rounded">n</kbd>
          )}
        </button>
      )}

      {/* Accept button */}
      {onAccept && (
        <button
          type="button"
          onClick={onAccept}
          className="
            flex items-center gap-1.5 px-3 py-1.5
            text-sm font-medium
            text-emerald-400 hover:text-emerald-300
            bg-emerald-500/10 hover:bg-emerald-500/20
            border border-emerald-500/30 hover:border-emerald-500/50
            rounded
            transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500
          "
          aria-label="Accept change"
        >
          <Check className="w-4 h-4" aria-hidden="true" />
          <span>Accept</span>
          {isFocused && (
            <kbd className="ml-1 px-1 text-xs bg-emerald-500/20 rounded">y</kbd>
          )}
        </button>
      )}
    </div>
  );
});
