import { ReactNode } from "react";

interface TabButtonProps {
  children: ReactNode;
  active: boolean;
  onClick: () => void;
  badge?: number;
  icon?: ReactNode;
  className?: string;
}

/**
 * Tab button for the workspace sidebar.
 * Supports optional badge for counts (e.g., file changes).
 */
export function TabButton({
  children,
  active,
  onClick,
  badge,
  icon,
  className = "",
}: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full px-3 py-2 text-left text-sm font-medium font-mono transition-colors
        flex items-center gap-2
        ${active
          ? "bg-surface-700/30 text-surface-200 border-l-2 border-accent-500"
          : "text-surface-400 hover:text-surface-300 hover:bg-surface-800/30 border-l-2 border-transparent"
        }
        ${className}
      `}
    >
      {icon}
      <span className="flex-1 truncate">{children}</span>
      {badge !== undefined && badge > 0 && (
        <span className="px-1.5 py-0.5 text-xs rounded-full bg-surface-700 text-surface-300">
          {badge}
        </span>
      )}
    </button>
  );
}
