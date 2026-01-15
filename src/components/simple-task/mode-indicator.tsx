import { cn } from "@/lib/utils";
import type { AgentMode } from "@/entities/agent-mode";
import { AGENT_MODE_CONFIG } from "@/entities/agent-mode";

interface ModeIndicatorProps {
  mode: AgentMode;
  variant?: "full" | "compact";
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export function ModeIndicator({
  mode,
  variant = "compact",
  onClick,
  disabled = false,
  className,
}: ModeIndicatorProps) {
  const config = AGENT_MODE_CONFIG[mode];
  const label = variant === "full" ? config.label : config.shortLabel;
  const Component = onClick ? "button" : "span";

  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "text-[11px] font-medium uppercase px-2 py-0.5 rounded",
        // Transition classes for visual feedback on mode change
        "transition-all duration-150 ease-in-out [-webkit-app-region:no-drag]",
        onClick && !disabled && "cursor-pointer hover:opacity-80 active:scale-95",
        onClick && disabled && "opacity-50 cursor-not-allowed",
        config.className,
        className
      )}
      title={config.description}
      role="status"
      aria-label={`Agent mode: ${config.label}${onClick ? ". Click to change." : ""}`}
      data-testid="mode-indicator"
      data-mode={mode}
    >
      {label}
    </Component>
  );
}

interface ModeIndicatorWithShortcutProps extends ModeIndicatorProps {
  showShortcut?: boolean;
}

export function ModeIndicatorWithShortcut({
  showShortcut = true,
  ...props
}: ModeIndicatorWithShortcutProps) {
  return (
    <div className="flex items-center gap-2">
      <ModeIndicator {...props} />
      {showShortcut && (
        <span className="text-[10px] text-surface-500">Shift+Tab</span>
      )}
    </div>
  );
}
