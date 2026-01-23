interface EmptyStateProps {
  /** Whether the agent is currently running */
  isRunning?: boolean;
}

export function EmptyState({ isRunning: _isRunning = false }: EmptyStateProps) {
  // Render blank to avoid jarring flash of placeholder content when switching threads
  // The flash happens because there's a brief moment where messages haven't loaded yet
  return (
    <div
      data-testid="empty-state"
      className="flex-1"
      role="status"
      aria-live="polite"
      aria-label="Loading thread content"
    />
  );
}
