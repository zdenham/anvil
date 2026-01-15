import { ReactNode } from "react";
import { cn } from "../../lib/utils";

interface ResultItemProps {
  icon: ReactNode | null;
  title: string;
  subtitle: string;
  isSelected: boolean;
  onSelect: () => void;
  onActivate: () => void;
  compact?: boolean; // Smaller height, monospace font for file results
  "data-testid"?: string;
}

export const ResultItem = ({
  icon,
  title,
  subtitle,
  isSelected,
  onSelect,
  onActivate,
  compact = false,
  "data-testid": testId,
}: ResultItemProps) => {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex items-center cursor-pointer transition-all duration-100",
        compact ? "gap-2 px-3 h-8" : "gap-3 px-3 h-14",
        isSelected
          ? "bg-surface-700 text-surface-100"
          : "text-surface-300 hover:bg-surface-700/50"
      )}
      onMouseMove={(e) => {
        // Only select on actual mouse movement, not synthetic events from window resize
        const hasActualMovement = e.movementX !== 0 || e.movementY !== 0;
        if (hasActualMovement && !isSelected) {
          onSelect();
        }
      }}
      onClick={onActivate}
    >
      {icon && icon}
      <div className="flex flex-col min-w-0 flex-1">
        <span
          className={cn(
            "truncate",
            compact ? "text-xs font-mono" : "font-medium"
          )}
        >
          {title}
        </span>
        {subtitle && (
          <span className="text-xs text-surface-400 truncate">{subtitle}</span>
        )}
      </div>
      {isSelected && <EnterIcon compact={compact} />}
    </div>
  );
};

const EnterIcon = ({ compact }: { compact?: boolean }) => (
  <div
    className={cn(
      "flex items-center gap-1 text-surface-400",
      compact ? "text-[10px]" : "text-xs"
    )}
  >
    <kbd
      className={cn(
        "rounded bg-surface-600 font-medium",
        compact ? "px-1 py-0.5 text-[10px]" : "px-1.5 py-0.5"
      )}
    >
      ↵
    </kbd>
  </div>
);
