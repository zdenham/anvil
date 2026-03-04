import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Settings, ToggleLeft, ToggleRight } from 'lucide-react';
import { cn } from '@/lib/utils.js';
import type { QuickActionMetadata } from '@/entities/quick-actions/types.js';

interface QuickActionListItemProps {
  action: QuickActionMetadata;
  onEdit: () => void;
  onToggle: () => void;
}

export function QuickActionListItem({ action, onEdit, onToggle }: QuickActionListItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: action.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`quick-action-item-${action.id}`}
      className={cn(
        'flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-surface-800/50 border border-transparent hover:border-surface-700',
        isDragging && 'opacity-50 bg-surface-800',
        !action.enabled && 'opacity-50'
      )}
    >
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-surface-500 hover:text-surface-300 flex-shrink-0"
      >
        <GripVertical size={14} />
      </button>

      {/* Title with tooltip for description */}
      <span
        className={cn(
          'text-sm truncate min-w-0 flex-1',
          action.enabled ? 'text-surface-100' : 'text-surface-400'
        )}
        title={action.description || undefined}
      >
        {action.title}
      </span>

      {/* Contexts - inline compact badges */}
      <div className="flex gap-1 flex-shrink-0">
        {action.contexts.map((ctx) => (
          <span
            key={ctx}
            className="px-1 py-0.5 text-[10px] bg-surface-700/50 rounded text-surface-500"
          >
            {ctx}
          </span>
        ))}
      </div>

      {/* Hotkey */}
      <div className="w-10 flex-shrink-0 text-center">
        {action.hotkey !== undefined ? (
          <kbd className="px-1.5 py-0.5 text-xs bg-surface-700 rounded text-surface-300">
            {'\u2318'}{action.hotkey}
          </kbd>
        ) : (
          <span className="text-surface-600 text-xs">—</span>
        )}
      </div>

      {/* Toggle */}
      <button
        onClick={onToggle}
        className="text-surface-400 hover:text-surface-200 flex-shrink-0"
        title={action.enabled ? 'Disable' : 'Enable'}
      >
        {action.enabled ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
      </button>

      {/* Edit */}
      <button
        onClick={onEdit}
        className="text-surface-400 hover:text-surface-200 flex-shrink-0"
        title="Edit"
      >
        <Settings size={14} />
      </button>
    </div>
  );
}
