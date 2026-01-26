import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ExpandChevronProps {
  /** Whether the associated content is expanded */
  isExpanded: boolean;
  /** Size variant affecting both icon size and margins */
  size?: "sm" | "md";
  /** Custom className to override default spacing */
  className?: string;
}

/**
 * A chevron icon that rotates based on expanded state.
 *
 * Size variants:
 * - `sm`: `-ml-1 -mr-1` (for inline command display)
 * - `md`: `-ml-1 -mr-1.5` (for description headers)
 */
export function ExpandChevron({
  isExpanded,
  size = "md",
  className,
}: ExpandChevronProps) {
  const sizeClasses = {
    sm: "-ml-1 -mr-1",
    md: "-ml-1 -mr-1.5",
  };

  const Icon = isExpanded ? ChevronDown : ChevronRight;

  return (
    <Icon
      className={cn(
        "h-4 w-4 shrink-0 text-white",
        sizeClasses[size],
        className
      )}
    />
  );
}
