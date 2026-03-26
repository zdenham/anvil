import { GuideContent } from "@/components/content-pane/guide-content";

interface EmptyStateProps {
  /** Whether the agent is currently running */
  isRunning?: boolean;
}

export function EmptyState({ isRunning: _isRunning = false }: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      className="flex-1 min-h-0 flex flex-col"
      role="status"
      aria-live="polite"
      aria-label="Empty thread"
    >
      <GuideContent />
    </div>
  );
}
