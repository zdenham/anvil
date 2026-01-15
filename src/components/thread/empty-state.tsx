import { MessageSquare } from "lucide-react";

interface EmptyStateProps {
  /** Whether the agent is currently running */
  isRunning?: boolean;
}

export function EmptyState({ isRunning = false }: EmptyStateProps) {
  return (
    <div
      data-testid="empty-state"
      className="flex flex-col items-center justify-center flex-1 gap-3 text-surface-400"
      role="status"
      aria-live="polite"
    >
      <MessageSquare className="h-12 w-12 opacity-50" aria-hidden="true" />
      {isRunning ? (
        <>
          <p className="text-sm">Waiting for response...</p>
          <AnimatedDots />
        </>
      ) : (
        <p className="text-sm">No messages yet</p>
      )}
    </div>
  );
}

function AnimatedDots() {
  return (
    <span className="inline-flex gap-1" aria-hidden="true">
      <span className="h-2 w-2 rounded-full bg-current animate-bounce [animation-delay:-0.3s]" />
      <span className="h-2 w-2 rounded-full bg-current animate-bounce [animation-delay:-0.15s]" />
      <span className="h-2 w-2 rounded-full bg-current animate-bounce" />
    </span>
  );
}
