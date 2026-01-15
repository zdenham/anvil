import { Circle, Square, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface OptionItemProps {
  /** 0-based index */
  index: number;
  /** Display label */
  label: string;
  /** Optional description (shown below label) */
  description?: string;
  /** Whether this option is selected */
  isSelected: boolean;
  /** Whether this option has keyboard focus */
  isFocused: boolean;
  /** Radio for single-select, checkbox for multi-select */
  variant: "radio" | "checkbox";
  /** Whether interaction is disabled */
  disabled?: boolean;
  /** Called when option is clicked or activated */
  onActivate: () => void;
}

export function OptionItem({
  index,
  label,
  description,
  isSelected,
  isFocused,
  variant,
  disabled,
  onActivate,
}: OptionItemProps) {
  const displayNumber = index + 1;

  return (
    <div
      role={variant === "radio" ? "radio" : "checkbox"}
      aria-checked={isSelected}
      tabIndex={isFocused ? 0 : -1}
      data-testid={`option-item-${index}`}
      onClick={disabled ? undefined : onActivate}
      className={cn(
        "flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors rounded-md",
        isFocused && "ring-2 ring-accent-500/50 bg-surface-800",
        isSelected && !isFocused && "bg-accent-500/10",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      <SelectionIcon variant={variant} isSelected={isSelected} />
      <div className="flex-1 min-w-0">
        <span className="text-sm text-surface-200">{label}</span>
        {description && (
          <p className="text-xs text-surface-400 mt-0.5">{description}</p>
        )}
      </div>
      <kbd className="px-1.5 py-0.5 text-xs font-mono bg-surface-700 rounded text-surface-400">
        {displayNumber}
      </kbd>
    </div>
  );
}

function SelectionIcon({
  variant,
  isSelected,
}: {
  variant: "radio" | "checkbox";
  isSelected: boolean;
}) {
  if (variant === "radio") {
    return isSelected ? (
      <div className="w-4 h-4 rounded-full bg-accent-500 flex items-center justify-center">
        <div className="w-2 h-2 rounded-full bg-white" />
      </div>
    ) : (
      <Circle className="w-4 h-4 text-surface-500" />
    );
  }

  return isSelected ? (
    <CheckSquare className="w-4 h-4 text-accent-500" />
  ) : (
    <Square className="w-4 h-4 text-surface-500" />
  );
}
