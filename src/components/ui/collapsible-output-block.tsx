import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const DEFAULT_MAX_COLLAPSED_HEIGHT = 300; // pixels

export interface CollapsibleOutputBlockProps {
  children: React.ReactNode;
  /** Current expand state */
  isExpanded: boolean;
  /** Callback when toggle is clicked */
  onToggle: () => void;
  /** Whether content exceeds threshold (controls overlay visibility) */
  isLongContent: boolean;
  /** Max height when collapsed in pixels (default: 300) */
  maxCollapsedHeight?: number;
  /** Border color variant */
  variant?: "default" | "error";
  /** Optional className for the container */
  className?: string;
}

/**
 * Internal overlay component with gradient and expand/collapse button.
 */
function OutputExpandCollapseOverlay({
  isExpanded,
  onToggle,
}: {
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle();
  };

  return (
    <div
      className={cn(
        "absolute bottom-0 left-0 right-0 flex items-end justify-center pb-2 pointer-events-none",
        !isExpanded && "h-16 bg-gradient-to-t from-zinc-950 to-transparent"
      )}
    >
      <button
        onClick={handleClick}
        className="flex items-center gap-1 px-2.5 py-1 text-xs text-zinc-300 bg-zinc-800 hover:bg-zinc-700 rounded-md transition-colors pointer-events-auto border border-zinc-700/50"
        aria-label={isExpanded ? "Collapse output" : "Expand output"}
      >
        {isExpanded ? (
          <>
            <ChevronUp className="h-3.5 w-3.5" />
            Collapse
          </>
        ) : (
          <>
            <ChevronDown className="h-3.5 w-3.5" />
            Expand
          </>
        )}
      </button>
    </div>
  );
}

/**
 * A container for long output that can be collapsed with a gradient overlay.
 * Shows a gradient fade when collapsed with a centered button at the bottom.
 */
export function CollapsibleOutputBlock({
  children,
  isExpanded,
  onToggle,
  isLongContent,
  maxCollapsedHeight = DEFAULT_MAX_COLLAPSED_HEIGHT,
  variant = "default",
  className,
}: CollapsibleOutputBlockProps) {
  const borderClass = variant === "error"
    ? "border-red-500/30"
    : "border-zinc-700/50";

  return (
    <div
      className={cn(
        "relative rounded border",
        borderClass,
        !isExpanded && isLongContent && "overflow-hidden",
        className
      )}
      style={
        !isExpanded && isLongContent
          ? { maxHeight: maxCollapsedHeight }
          : undefined
      }
    >
      {children}

      {/* Expand/Collapse overlay for long content */}
      {isLongContent && (
        <OutputExpandCollapseOverlay
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      )}
    </div>
  );
}
