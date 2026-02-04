import { cn } from '@/lib/utils.js';
import type { QuickActionMetadata } from '@/entities/quick-actions/types.js';

interface QuickActionChipProps {
  action: QuickActionMetadata;
  isSelected: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function QuickActionChip({ action, isSelected, disabled, onClick }: QuickActionChipProps) {
  const handleClick = () => {
    if (disabled) return;
    onClick();
  };

  return (
    <button
      onClick={handleClick}
      disabled={disabled}
      aria-disabled={disabled}
      className={cn(
        'px-3 py-1.5 rounded-md text-sm whitespace-nowrap',
        'border border-surface-600 transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-accent-500',
        disabled && 'opacity-50 cursor-not-allowed',
        isSelected
          ? 'bg-surface-700 text-surface-100 border-accent-500'
          : 'bg-surface-800 text-surface-300 hover:bg-surface-700'
      )}
    >
      <span>{action.title}</span>
      {action.hotkey !== undefined && (
        <kbd className="ml-2 text-xs text-surface-500">{'\u2318'}{action.hotkey}</kbd>
      )}
    </button>
  );
}
