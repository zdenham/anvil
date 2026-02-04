import { useState, useEffect, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { QuickActionChip } from './quick-action-chip.js';
import { useQuickActionsStore } from '@/entities/quick-actions/store.js';
import { useQuickActionExecutor } from '@/hooks/use-quick-action-executor.js';
import { contentPanesService } from '@/stores/content-panes/service.js';

interface QuickActionsPanelProps {
  contextType: 'thread' | 'plan' | 'empty';
}

export function QuickActionsPanel({ contextType }: QuickActionsPanelProps) {
  const actions = useQuickActionsStore((s) => s.getForContext(contextType));
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { isExecuting, executingAction, execute } = useQuickActionExecutor();

  // Reset selection when actions change
  useEffect(() => {
    setSelectedIndex(0);
  }, [actions.length]);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isExecuting) return; // Disable navigation during execution

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(actions.length - 1, i + 1));
    } else if (e.key === 'Enter' && actions[selectedIndex]) {
      e.preventDefault();
      execute(actions[selectedIndex]);
    }
  }, [isExecuting, actions, selectedIndex, execute]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleConfigure = useCallback(() => {
    contentPanesService.setActivePaneView({ type: 'settings' });
  }, []);

  if (actions.length === 0) {
    return null;
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-t border-surface-700">
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-sm text-surface-400">Quick Actions</span>
        <button
          onClick={handleConfigure}
          className="text-xs text-accent-500 hover:text-accent-400 hover:underline"
        >
          Configure
        </button>
      </div>

      <div className="h-4 w-px bg-surface-600" />

      {isExecuting && (
        <div className="flex items-center gap-2 text-sm text-surface-300 shrink-0">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>{executingAction?.title}...</span>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto">
        {actions.map((action, index) => (
          <QuickActionChip
            key={action.id}
            action={action}
            isSelected={!isExecuting && selectedIndex === index}
            disabled={isExecuting}
            onClick={() => execute(action)}
          />
        ))}
      </div>
    </div>
  );
}
