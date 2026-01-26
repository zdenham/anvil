import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatusIconProps {
  /** Whether to show success (check) or failure (x) */
  isSuccess: boolean;
  /** Size of the icon (default: "md") */
  size?: "sm" | "md" | "lg";
  /** Optional className for additional styling */
  className?: string;
}

/**
 * Simple success/failure icon indicator.
 *
 * Different from `ToolStatusIcon` which handles running/pending states.
 * This is specifically for binary success/failure after completion.
 */
export function StatusIcon({
  isSuccess,
  size = "md",
  className,
}: StatusIconProps) {
  const sizeClasses = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  const iconClass = cn(
    sizeClasses[size],
    isSuccess ? "text-green-400" : "text-red-400",
    className
  );

  return isSuccess ? (
    <Check className={iconClass} />
  ) : (
    <X className={iconClass} />
  );
}
