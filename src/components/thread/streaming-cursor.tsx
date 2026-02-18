import { cn } from "@/lib/utils";

interface StreamingCursorProps {
  className?: string;
}

/**
 * Animated blinking cursor shown at end of streaming text.
 * Renders as a block-level line with a visible caret.
 */
export function StreamingCursor({ className }: StreamingCursorProps) {
  return (
    <div className={cn("mt-1", className)}>
      <span
        className="inline-block w-2.5 h-5 bg-surface-300 rounded-sm animate-cursor-blink"
        aria-hidden="true"
      />
      <span className="sr-only">Assistant is typing</span>
    </div>
  );
}
