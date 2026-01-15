import { File } from "lucide-react";

/**
 * Empty state displayed when there are no changes to show.
 */
export function DiffEmptyState() {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-center justify-center py-12 text-surface-400"
      role="status"
      aria-live="polite"
    >
      <File className="w-12 h-12 mb-4 opacity-50" aria-hidden="true" />
      <p className="text-sm">No changes to display</p>
    </div>
  );
}
