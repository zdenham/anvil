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
      className={cn(
        'flex items-center gap-3 p-3 rounded-md bg-surface-800 border border-surface-700',
        isDragging && 'opacity-50',
        !action.enabled && 'opacity-50'
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-surface-500 hover:text-surface-300"
      >
        <GripVertical size={16} />
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('font-medium', action.enabled ? 'text-surface-100' : 'text-surface-400')}>
            {action.title}
          </span>
          {action.hotkey !== undefined && (
            <kbd className="px-1.5 py-0.5 text-xs bg-surface-700 rounded text-surface-300">
              {'\u2318'}{action.hotkey}
            </kbd>
          )}
        </div>
        {action.description && (
          <p className="text-sm text-surface-400 truncate">{action.description}</p>
        )}
        <div className="flex gap-1 mt-1">
          {action.contexts.map((ctx) => (
            <span
              key={ctx}
              className="px-1.5 py-0.5 text-xs bg-surface-700 rounded text-surface-400"
            >
              {ctx}
            </span>
          ))}
        </div>
      </div>

      <button
        onClick={onToggle}
        className="text-surface-400 hover:text-surface-200"
        title={action.enabled ? 'Disable' : 'Enable'}
      >
        {action.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
      </button>

      <button
        onClick={onEdit}
        className="text-surface-400 hover:text-surface-200"
        title="Edit"
      >
        <Settings size={16} />
      </button>
    </div>
  );
}
