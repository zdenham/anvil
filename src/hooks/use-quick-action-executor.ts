/**
 * Quick Action Executor Hook
 *
 * React hook for executing quick actions from UI components.
 * Provides execution state tracking and prevents concurrent execution.
 *
 * Design decisions implemented:
 * - #7 Error Display: Toast notification with "View logs" link
 * - #11 Execution UX: Shows loading state, doesn't block interaction
 * - #17 Execution Feedback: Spinner with action name
 * - #18 No Concurrent Actions: Prevent execution while one is running
 */

import { useState, useCallback } from 'react';
import {
  executeQuickAction,
  type QuickActionExecutionContext,
} from '@/lib/quick-action-executor.js';
import { quickActionService } from '@/entities/quick-actions/service.js';
import type { QuickActionMetadata } from '@/entities/quick-actions/types.js';
import { toast } from '@/lib/toast.js';
import { getActivePane } from '@/stores/content-panes/store.js';
import { useThreadStore } from '@/entities/threads/store.js';
import { usePlanStore } from '@/entities/plans/store.js';
import { logger } from '@/lib/logger-client.js';
import { contentPanesService } from '@/stores/content-panes/service.js';

interface ExecutorState {
  isExecuting: boolean;
  executingAction: QuickActionMetadata | null;
}

interface UseQuickActionExecutorReturn {
  /** Whether an action is currently executing */
  isExecuting: boolean;
  /** The action currently being executed, if any */
  executingAction: QuickActionMetadata | null;
  /** Execute a quick action */
  execute: (action: QuickActionMetadata) => Promise<void>;
}

/**
 * Build the execution context from current application state.
 *
 * Note: Repository and worktree information is limited because the repo store
 * only contains basic Repository metadata (keyed by name), not full RepositorySettings
 * with worktree details. Full context would require async settings loading.
 * For now, we provide what's synchronously available.
 */
function buildExecutionContext(): QuickActionExecutionContext {
  const activePane = getActivePane();
  const view = activePane?.view;

  // Determine context type from active view
  let contextType: 'thread' | 'plan' | 'empty' = 'empty';
  let threadId: string | undefined;
  let planId: string | undefined;

  if (view?.type === 'thread') {
    contextType = 'thread';
    threadId = view.threadId;
  } else if (view?.type === 'plan') {
    contextType = 'plan';
    planId = view.planId;
  }

  // Get thread data if viewing a thread
  let repository: QuickActionExecutionContext['repository'] = null;
  let worktree: QuickActionExecutionContext['worktree'] = null;
  let threadState: QuickActionExecutionContext['threadState'] = undefined;

  if (threadId) {
    const thread = useThreadStore.getState().threads[threadId];
    if (thread) {
      // Get thread state for file changes, message count
      const state = useThreadStore.getState().threadStates[threadId];
      if (state) {
        threadState = {
          status: thread.status,
          messageCount: state.messages?.length ?? 0,
          fileChanges: state.fileChanges?.map((fc) => ({
            path: fc.path,
            operation: fc.operation,
          })) ?? [],
        };
      }

      // Note: Full repository/worktree info would require async settings loading.
      // For basic context, we use the thread's repoId and worktreeId directly.
      // Actions can use these IDs to look up full details if needed.
      repository = {
        id: thread.repoId,
        name: thread.repoId, // Name not available without settings lookup
        path: '', // Path requires settings lookup
      };

      worktree = {
        id: thread.worktreeId,
        path: '', // Path requires settings lookup
        branch: null, // Branch requires settings lookup
      };
    }
  }

  // Get plan's repo/worktree if viewing a plan
  if (planId && !threadId) {
    const plan = usePlanStore.getState().plans[planId];
    if (plan) {
      repository = {
        id: plan.repoId,
        name: plan.repoId, // Name not available without settings lookup
        path: '', // Path requires settings lookup
      };

      worktree = {
        id: plan.worktreeId,
        path: '', // Path requires settings lookup
        branch: null, // Branch requires settings lookup
      };
    }
  }

  return {
    contextType,
    threadId,
    planId,
    repository,
    worktree,
    threadState,
  };
}

/**
 * Navigate to logs panel to show error details.
 */
async function openLogsPanel(): Promise<void> {
  try {
    await contentPanesService.setActivePaneView({ type: 'logs' });
  } catch (error) {
    logger.warn('[useQuickActionExecutor] Failed to open logs panel:', error);
  }
}

/**
 * Hook providing quick action execution with state tracking.
 *
 * Usage:
 * ```tsx
 * const { isExecuting, executingAction, execute } = useQuickActionExecutor();
 *
 * return (
 *   <button onClick={() => execute(action)} disabled={isExecuting}>
 *     {isExecuting ? `Running ${executingAction?.title}...` : action.title}
 *   </button>
 * );
 * ```
 */
export function useQuickActionExecutor(): UseQuickActionExecutorReturn {
  const [state, setState] = useState<ExecutorState>({
    isExecuting: false,
    executingAction: null,
  });

  const execute = useCallback(async (action: QuickActionMetadata) => {
    // Prevent concurrent execution (DD #18)
    if (state.isExecuting) {
      logger.warn('[useQuickActionExecutor] Ignoring execution request - already executing');
      return;
    }

    const resolved = quickActionService.resolve(action.id);
    if (!resolved) {
      toast.error('Action not found');
      return;
    }

    logger.info('[useQuickActionExecutor] Starting execution:', {
      actionId: action.id,
      actionTitle: action.title,
    });

    setState({ isExecuting: true, executingAction: action });

    try {
      const execContext = buildExecutionContext();

      logger.info('[useQuickActionExecutor] Execution context:', {
        contextType: execContext.contextType,
        threadId: execContext.threadId,
        planId: execContext.planId,
        hasRepository: !!execContext.repository,
        hasWorktree: !!execContext.worktree,
      });

      const result = await executeQuickAction(resolved, execContext);

      if (!result.success) {
        // Show toast with "View logs" action (DD #7)
        if (result.timedOut) {
          toast.error('Action timed out after 30 seconds', {
            action: {
              label: 'View logs',
              onClick: openLogsPanel,
            },
          });
        } else {
          toast.error(result.error?.message ?? 'Action failed', {
            action: {
              label: 'View logs',
              onClick: openLogsPanel,
            },
          });
        }
      }
    } catch (e) {
      logger.error('[useQuickActionExecutor] Execution error:', e);
      toast.error(`Action error: ${e instanceof Error ? e.message : String(e)}`, {
        action: {
          label: 'View logs',
          onClick: openLogsPanel,
        },
      });
    } finally {
      setState({ isExecuting: false, executingAction: null });
    }
  }, [state.isExecuting]);

  return {
    isExecuting: state.isExecuting,
    executingAction: state.executingAction,
    execute,
  };
}
