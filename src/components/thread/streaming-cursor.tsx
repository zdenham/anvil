import { cn } from "@/lib/utils";

interface StreamingCursorProps {
  className?: string;
}

/**
 * Animated blinking cursor shown at end of streaming text.
 */
export function StreamingCursor({ className }: StreamingCursorProps) {
  return (
    <>
      <span
        className={cn(
          "inline-block w-2 h-5 ml-0.5 bg-current align-text-bottom",
          "animate-pulse",
          className
        )}
        aria-hidden="true"
      />
      <span className="sr-only">Assistant is typing</span>
    </>
  );
}
