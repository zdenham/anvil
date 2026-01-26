import { cn } from "@/lib/utils";

export interface ShimmerTextProps {
  children: React.ReactNode;
  /** Whether to show shimmer effect (typically: isRunning) */
  isShimmering: boolean;
  /** Optional className for text styling */
  className?: string;
  /** HTML element to render as (default: "span") */
  as?: "span" | "div" | "p";
}

/**
 * Text that displays a shimmering animation effect.
 * Used to indicate loading/running states.
 *
 * The CSS animation is defined in index.css as `.animate-shimmer`
 */
export function ShimmerText({
  children,
  isShimmering,
  className,
  as: Component = "span",
}: ShimmerTextProps) {
  return (
    <Component
      className={cn(
        className,
        isShimmering && "animate-shimmer"
      )}
    >
      {children}
    </Component>
  );
}
