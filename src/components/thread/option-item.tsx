import { ChevronRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface OptionItemProps {
  /** 0-based index */
  index: number;
  /** Display label */
  label: string;
  /** Optional description (shown inline after label) */
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
  return (
    <div
      role={variant === "radio" ? "radio" : "checkbox"}
      aria-checked={isSelected}
      tabIndex={isFocused ? 0 : -1}
      data-testid={`option-item-${index}`}
      onClick={disabled ? undefined : onActivate}
      className={cn(
        "flex items-center gap-2 px-2 py-1 cursor-pointer transition-colors rounded font-mono text-sm",
        isFocused && !disabled && "bg-surface-800",
        isSelected && !isFocused && "text-accent-400",
        disabled && "opacity-50 cursor-not-allowed",
        !disabled && !isFocused && !isSelected && "text-surface-300"
      )}
    >
      {/* Chevron indicator for focused item, check for selected in multi-select */}
      <span className="w-4 shrink-0 flex items-center justify-center">
        {variant === "checkbox" && isSelected ? (
          <Check className="w-3.5 h-3.5 text-accent-400" />
        ) : isFocused ? (
          <ChevronRight className="w-3.5 h-3.5 text-accent-400" />
        ) : null}
      </span>
      <span className={cn(isFocused && "text-surface-100")}>
        {label}
      </span>
      {description && (
        <span className="text-surface-500 text-xs ml-1">{description}</span>
      )}
    </div>
  );
}
