import { cn } from "@/lib/utils";

export type StatusDotVariant = "running" | "unread" | "read";

interface StatusDotProps {
  variant: StatusDotVariant;
  className?: string;
  "data-testid"?: string;
}

/**
 * Reusable status indicator dot.
 *
 * Variants:
 * - running: Green with glow animation (uses .status-dot-running CSS class)
 * - unread: Blue (bg-blue-500)
 * - read: Grey (bg-zinc-400)
 */
export function StatusDot({ variant, className, ...props }: StatusDotProps) {
  return (
    <span
      className={cn(
        "w-2 h-2 rounded-full flex-shrink-0",
        variant === "running" && "status-dot-running",
        variant === "unread" && "bg-blue-500",
        variant === "read" && "bg-zinc-400",
        className
      )}
      {...props}
    />
  );
}
