/**
 * Quick Action Executor
 *
 * Spawns Node.js processes to run quick actions and handles SDK events from stdout.
 * This is the Tauri-side executor that communicates with the SDK runtime.
 *
 * Design decisions implemented:
 * - #5 Runtime Dependency: Only Node.js required, detect if missing
 * - #7 Error Display: Toast notification with "View logs" link
 * - #10 SDK Communication: Uses stdout JSON for IPC
 * - #24 State Sync via Events: Entity operations call services
 * - #25 Action Timeout: 30-second timeout using Promise.race()
 * - #26 Error Detail Level: Shows message and stack trace
 * - #29 navigateToNextUnread() Empty Case: Navigates to empty state
 * - #33 SDK Write Operations: SDK emits events, Anvil handles writes
 */

import { Command, type Child } from '@tauri-apps/plugin-shell';
import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';
import type { ResolvedQuickAction } from '@/entities/quick-actions/types.js';
import { threadService } from '@/entities/threads/service.js';
import { useThreadStore } from '@/entities/threads/store.js';
import { planService } from '@/entities/plans/service.js';
import { navigationService } from '@/stores/navigation-service.js';
import { getActiveInputStore } from '@/stores/input-store.js';
import { toast } from '@/lib/toast.js';
import { logger } from '@/lib/logger-client.js';
import { FilesystemClient } from '@/lib/filesystem-client.js';
import { getRunnerPath } from '@/lib/paths.js';

const ACTION_TIMEOUT_MS = 30_000; // 30 seconds
const fs = new FilesystemClient();

export interface QuickActionExecutionContext {
  contextType: 'thread' | 'plan' | 'empty';
  threadId?: string;
  planId?: string;
  repository: {
    id: string;
    name: string;
    path: string;
  } | null;
  worktree: {
    id: string;
    path: string;
    branch: string | null;
  } | null;
  threadState?: {
    // Note: ThreadStatus includes 'paused' but we omit it here for SDK simplicity
    status: 'idle' | 'running' | 'completed' | 'error' | 'cancelled' | 'paused';
    messageCount: number;
    fileChanges: Array<{ path: string; operation: string }>;
  };
}

export interface QuickActionResult {
  success: boolean;
  error?: { message: string; stack?: string };
  timedOut?: boolean;
}

// Zod schema for SDK events (trust boundary - IPC from child process)
const SDKEventSchema = z.discriminatedUnion('event', [
  z.object({
    event: z.literal('ui:setInput'),
    payload: z.string(),
  }),
  z.object({
    event: z.literal('ui:appendInput'),
    payload: z.string(),
  }),
  z.object({
    event: z.literal('ui:clearInput'),
    payload: z.undefined().optional(),
  }),
  z.object({
    event: z.literal('ui:focusInput'),
    payload: z.undefined().optional(),
  }),
  z.object({
    event: z.literal('ui:navigate'),
    payload: z.object({
      type: z.enum(['thread', 'plan', 'nextUnread', 'empty']),
      id: z.string().optional(),
    }),
  }),
  z.object({
    event: z.literal('ui:toast'),
    payload: z.object({
      message: z.string(),
      type: z.enum(['info', 'success', 'error']).optional(),
    }),
  }),
  z.object({
    event: z.literal('ui:closePanel'),
    payload: z.undefined().optional(),
  }),
  z.object({
    event: z.literal('thread:archive'),
    payload: z.object({ threadId: z.string() }),
  }),
  z.object({
    event: z.literal('thread:markRead'),
    payload: z.object({ threadId: z.string() }),
  }),
  z.object({
    event: z.literal('thread:markUnread'),
    payload: z.object({ threadId: z.string() }),
  }),
  z.object({
    event: z.literal('plan:archive'),
    payload: z.object({ planId: z.string() }),
  }),
  z.object({
    event: z.literal('plan:markUnread'),
    payload: z.object({ planId: z.string() }),
  }),
  z.object({
    event: z.literal('log'),
    payload: z.object({
      level: z.enum(['info', 'warn', 'error', 'debug']),
      message: z.string(),
      data: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
  z.object({
    event: z.literal('error'),
    payload: z.string(),
  }),
]);

type SDKEvent = z.infer<typeof SDKEventSchema>;

/**
 * Execute a quick action by spawning a Node.js process.
 *
 * @param action - The resolved quick action to execute
 * @param execContext - The current execution context (thread, plan, repo info)
 * @returns QuickActionResult indicating success/failure
 */
export async function executeQuickAction(
  action: ResolvedQuickAction,
  execContext: QuickActionExecutionContext
): Promise<QuickActionResult> {
  const dataDir = await fs.getDataDir();

  // Resolve path to the built JS file
  const actionJsPath = fs.joinPath(action.projectPath, 'dist', action.entryPoint);

  // Get the runner path - bundled with app, resolved via paths.ts
  const runnerPath = await getRunnerPath();

  logger.info('[quick-action-executor] Executing action', {
    actionId: action.id,
    actionTitle: action.title,
    actionJsPath,
    runnerPath,
    contextType: execContext.contextType,
  });

  // Resolve the user's shell PATH so macOS GUI apps can find `node`
  const shellPath = await invoke<string>("get_shell_path");

  // Spawn Node process (running pre-built JS)
  const command = Command.create('node', [
    runnerPath,
    '--action', actionJsPath,
    '--context', JSON.stringify(execContext),
    '--anvil-dir', dataDir,
  ], { env: { PATH: shellPath } });

  let child: Child;
  let errorOutput = '';

  // Handle stdout events from SDK
  command.stdout.on('data', (line: string) => {
    try {
      const parsed = JSON.parse(line);
      const result = SDKEventSchema.safeParse(parsed);
      if (result.success) {
        handleSDKEvent(result.data);
      }
    } catch {
      // Not JSON, ignore (could be console.log from user action)
      logger.debug('[quick-action-executor] Non-JSON stdout:', line);
    }
  });

  // Capture stderr for error reporting
  command.stderr.on('data', (line: string) => {
    errorOutput += line + '\n';
    logger.debug('[quick-action-executor] stderr line received');
  });

  // Execute with timeout
  const executionPromise = new Promise<QuickActionResult>((resolve) => {
    command.on('close', (data) => {
      if (data.code === 0) {
        logger.info('[quick-action-executor] Action completed successfully');
        resolve({ success: true });
      } else {
        logger.error('[quick-action-executor] Action failed with code:', data.code);
        resolve({
          success: false,
          error: { message: errorOutput || 'Action failed', stack: errorOutput },
        });
      }
    });

    command.on('error', (err) => {
      logger.error('[quick-action-executor] Command error:', err);
      resolve({
        success: false,
        error: { message: String(err) },
      });
    });
  });

  const timeoutPromise = new Promise<QuickActionResult>((resolve) => {
    setTimeout(() => {
      resolve({
        success: false,
        timedOut: true,
        error: { message: 'Action timed out after 30 seconds' },
      });
    }, ACTION_TIMEOUT_MS);
  });

  child = await command.spawn();

  const result = await Promise.race([executionPromise, timeoutPromise]);

  // Kill process if it timed out
  if (result.timedOut) {
    logger.error('[quick-action-executor] Killing timed out process');
    await child.kill();
  }

  return result;
}

/**
 * Handle an SDK event received from the child process.
 * Routes events to appropriate services and stores.
 * Exported for testing.
 */
export async function handleSDKEvent(event: SDKEvent): Promise<void> {
  logger.debug('[quick-action-executor] Handling SDK event:', event.event);

  switch (event.event) {
    // Entity operations - call services (writes to disk, emits through event-bridge)
    case 'thread:archive':
      await threadService.archive(event.payload.threadId);
      break;
    case 'thread:markRead':
      useThreadStore.getState().markThreadAsRead(event.payload.threadId);
      break;
    case 'thread:markUnread':
      await useThreadStore.getState().markThreadAsUnread(event.payload.threadId);
      break;
    case 'plan:archive':
      await planService.archive(event.payload.planId);
      break;
    case 'plan:markUnread':
      await planService.markAsUnread(event.payload.planId);
      break;

    // UI operations - handled locally (no disk persistence needed)
    // Uses the active input store registry (whichever area the user is interacting with)
    case 'ui:setInput':
      getActiveInputStore()?.getState().setContent(event.payload);
      break;
    case 'ui:appendInput':
      getActiveInputStore()?.getState().appendContent(event.payload);
      break;
    case 'ui:clearInput':
      getActiveInputStore()?.getState().clearContent();
      break;
    case 'ui:focusInput':
      getActiveInputStore()?.getState().requestFocus();
      break;
    case 'ui:navigate':
      await handleNavigation(event.payload);
      break;
    case 'ui:toast':
      toast[event.payload.type ?? 'info'](event.payload.message);
      break;
    case 'ui:closePanel':
      // Use navigationService to clear BOTH tree selection AND content pane
      await navigationService.navigateToView({ type: 'empty' });
      break;

    // Logging - route to main logger
    case 'log':
      logger[event.payload.level](
        `[quick-action] ${event.payload.message}`,
        event.payload.data
      );
      break;

    // Error from action
    case 'error':
      logger.error('[quick-action] Error:', { message: event.payload });
      break;
  }
}

/**
 * Handle navigation events from the SDK.
 * Uses navigationService to ensure both tree selection AND content pane are updated.
 */
async function handleNavigation(payload: { type: string; id?: string }): Promise<void> {
  logger.info('[quick-action-executor] Navigation:', payload);

  switch (payload.type) {
    case 'thread':
      if (payload.id) await navigationService.navigateToThread(payload.id);
      break;
    case 'plan':
      if (payload.id) await navigationService.navigateToPlan(payload.id);
      break;
    case 'nextUnread':
      const nextItem = await findNextUnreadItem();
      if (nextItem) {
        if (nextItem.type === 'thread') {
          await navigationService.navigateToThread(nextItem.id);
        } else {
          await navigationService.navigateToPlan(nextItem.id);
        }
      } else {
        // Navigate to empty state if no unread items (DD #29)
        await navigationService.navigateToView({ type: 'empty' });
      }
      break;
    case 'empty':
      await navigationService.navigateToView({ type: 'empty' });
      break;
  }
}

/**
 * Find the next unread item (thread or plan).
 * Returns the most recently updated unread item.
 */
async function findNextUnreadItem(): Promise<{ id: string; type: 'thread' | 'plan' } | null> {
  // Check threads first
  const unreadThreads = useThreadStore.getState().getUnreadThreads();
  if (unreadThreads.length > 0) {
    // Sort by updatedAt descending (most recent first)
    const sorted = [...unreadThreads].sort((a, b) => b.updatedAt - a.updatedAt);
    return { id: sorted[0].id, type: 'thread' };
  }

  // Then check plans
  const unreadPlans = planService.getUnreadPlans();
  if (unreadPlans.length > 0) {
    const sorted = [...unreadPlans].sort((a, b) => b.updatedAt - a.updatedAt);
    return { id: sorted[0].id, type: 'plan' };
  }

  return null;
}
