import { useShallow } from 'zustand/react/shallow';
import { useQuickActionsStore } from '@/entities/quick-actions/store.js';
import { useQuickActionExecutor } from '@/hooks/use-quick-action-executor.js';
import { paneLayoutService } from '@/stores/pane-layout/service.js';
import { usePaneLayoutStore } from '@/stores/pane-layout/store.js';
import { cn } from '@/lib/utils.js';
import type { QuickActionMetadata, QuickActionContext } from '@/entities/quick-actions/types.js';
import type { ContentPaneView } from '@/components/content-pane/types.js';
import { useCallback } from 'react';

interface ActionItemProps {
  action: QuickActionMetadata;
  isExecuting: boolean;
  onClick: () => void;
}

function ActionItem({ action, isExecuting, onClick }: ActionItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={isExecuting}
      className={cn(
        'font-mono px-1.5 py-0.5 transition-colors',
        'focus:outline-none',
        'text-[10px] leading-none',
        isExecuting && 'cursor-not-allowed animate-pulse',
        'text-surface-600 hover:text-surface-400'
      )}
    >
      {action.title}
      {action.hotkey != null && (
        <span className="ml-1 text-surface-700">{'\u2318'}{action.hotkey}</span>
      )}
    </button>
  );
}

function viewTypeToActionContext(viewType: ContentPaneView['type']): QuickActionContext {
  if (viewType === 'thread') return 'thread';
  if (viewType === 'plan') return 'plan';
  return 'empty';
}

export function QuickActionsPanel() {
  const activeViewType = usePaneLayoutStore((s) => {
    const group = s.groups[s.activeGroupId];
    if (!group) return undefined;
    const tab = group.tabs.find((t) => t.id === group.activeTabId);
    return tab?.view.type;
  });

  const context = activeViewType ? viewTypeToActionContext(activeViewType) : 'empty';

  const actions = useQuickActionsStore(
    useShallow((s) =>
      Object.values(s.actions)
        .filter((a) => a.enabled && (a.contexts.includes(context) || a.contexts.includes('all')))
        .sort((a, b) => a.order - b.order)
    )
  );
  const { isExecuting, executingAction, execute } = useQuickActionExecutor();

  const handleConfigure = useCallback(() => {
    paneLayoutService.setActiveTabView({ type: 'settings' });
  }, []);

  if (actions.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-surface-600 font-mono">No quick actions</span>
        <button
          onClick={handleConfigure}
          className="text-[10px] text-surface-600 hover:text-surface-400 font-mono underline underline-offset-2"
        >
          configure
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {actions.map((action) => {
        const isThisExecuting = isExecuting && executingAction?.id === action.id;
        return (
          <ActionItem
            key={action.id}
            action={action}
            isExecuting={isThisExecuting}
            onClick={() => execute(action)}
          />
        );
      })}
    </div>
  );
}
