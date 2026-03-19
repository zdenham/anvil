import { useEffect } from 'react';
import { useQuickActionsStore } from '@/entities/quick-actions/store.js';
import { useQuickActionExecutor } from '@/hooks/use-quick-action-executor.js';
import { usePaneLayoutStore, getActiveTab } from '@/stores/pane-layout/store.js';
import { useModalStore } from '@/stores/modal-store.js';
import type { ContentPaneView } from '@/components/content-pane/types.js';
import type { QuickActionContext, QuickActionMetadata } from '@/entities/quick-actions/types.js';

/**
 * Check if the current view is a main view where quick actions are allowed.
 * Per DD #16: 'all' context means the three main views: thread, plan, and empty.
 * Quick actions are NOT shown on settings pages, logs pages, or when modals are open.
 */
function isMainView(view: ContentPaneView | undefined): boolean {
  if (!view) return false;
  return view.type === 'thread' || view.type === 'plan' || view.type === 'empty';
}

function viewTypeToActionContext(viewType: ContentPaneView['type']): QuickActionContext {
  if (viewType === 'thread') return 'thread';
  if (viewType === 'plan') return 'plan';
  return 'empty';
}

function actionMatchesContext(action: QuickActionMetadata, context: QuickActionContext): boolean {
  return action.contexts.includes(context) || action.contexts.includes('all');
}

/**
 * Registers app-local hotkeys for quick actions (Cmd+1-9).
 * Hotkeys only trigger when:
 * - App window is focused
 * - User is on a main view (thread, plan, or empty) - NOT settings or logs
 * - No modal is currently open
 * - No action is currently executing
 * - Focus is not in an input field
 */
export function useQuickActionHotkeys() {
  const actions = useQuickActionsStore((s) => s.actions);
  const { isExecuting, execute } = useQuickActionExecutor();

  // Subscribe to active group/tab changes so the handler re-registers when view changes
  const activeGroupId = usePaneLayoutStore((s) => s.activeGroupId);
  const groups = usePaneLayoutStore((s) => s.groups);

  // Subscribe to modal state
  const isModalOpen = useModalStore((s) => s.isOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle Cmd+1-9 (Cmd+0 is reserved for zoom reset)
      if (!e.metaKey) return;
      if (!/^[1-9]$/.test(e.key)) return;

      // Don't trigger if already executing (DD #18)
      if (isExecuting) return;

      // Don't trigger if a modal is open (DD #16)
      if (isModalOpen) return;

      // Don't trigger if not on a main view (DD #16)
      // Main views are: thread, plan, empty
      // NOT allowed on: settings, logs
      const activeTab = getActiveTab();
      if (!isMainView(activeTab?.view)) return;

      // Don't trigger if focus is in an input/textarea
      const target = e.target;
      if (target instanceof HTMLElement) {
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.contentEditable === 'true'
        ) {
          return;
        }
      }

      const context = viewTypeToActionContext(activeTab!.view.type);
      const hotkey = parseInt(e.key, 10);
      const action = Object.values(actions).find(
        (a) => a.hotkey === hotkey && a.enabled && actionMatchesContext(a, context)
      );

      if (action) {
        e.preventDefault();
        execute(action);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions, isExecuting, execute, activeGroupId, groups, isModalOpen]);
}
