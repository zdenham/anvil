import { cn } from "@/lib/utils";

interface WorkingIndicatorProps {
  className?: string;
}

/**
 * Pulsing green dot with "Working" text, shown while
 * the assistant is processing but hasn't started streaming content.
 *
 * Inspired by Claude Code's terminal status indicator.
 */
export function WorkingIndicator({ className }: WorkingIndicatorProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-4 py-3",
        className
      )}
      role="status"
      aria-label="Assistant is working"
    >
      <span
        className="working-dot"
        aria-hidden="true"
      />
      <span className="text-sm text-surface-400">Working</span>
      <span className="sr-only">Assistant is working on your request</span>
    </div>
  );
}
