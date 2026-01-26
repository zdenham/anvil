import { cn } from "@/lib/utils";

export interface CollapsibleBlockProps {
  /** Whether block is expanded */
  isExpanded: boolean;
  /** Callback when header is clicked */
  onToggle: () => void;
  /** Content for the always-visible header */
  header: React.ReactNode;
  /** Content shown when expanded */
  children: React.ReactNode;
  /** Optional testId for the container */
  testId?: string;
  /** Accessible label for the block */
  ariaLabel?: string;
  /** Optional className for the container */
  className?: string;
  /** Optional className for the header */
  headerClassName?: string;
}

/**
 * A clickable header that expands/collapses content below.
 *
 * Handles keyboard interaction (Enter/Space) and sets proper ARIA attributes.
 * The header should typically include an `ExpandChevron` component.
 */
export function CollapsibleBlock({
  isExpanded,
  onToggle,
  header,
  children,
  testId,
  ariaLabel,
  className,
  headerClassName,
}: CollapsibleBlockProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      className={cn("group", className)}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      {/* Clickable header */}
      <div
        className={cn("cursor-pointer select-none", headerClassName)}
        onClick={onToggle}
        role="button"
        aria-expanded={isExpanded}
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        {header}
      </div>

      {/* Expandable content */}
      {isExpanded && children}
    </div>
  );
}
