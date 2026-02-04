import { eventBus } from '@/entities/events.js';
import { quickActionService } from './service.js';
import { threadService } from '@/entities/threads/index.js';
import { planService } from '@/entities/plans/index.js';
import { useThreadStore } from '@/entities/threads/store.js';
import { logger } from '@/lib/logger-client.js';

export function setupQuickActionListeners(): void {
  // When registry changes on disk (e.g., from another window), refresh
  eventBus.on('quick-actions:registry-changed', async () => {
    logger.info('[QuickActionListener] Registry changed, rehydrating...');
    await quickActionService.hydrate();
  });

  // When manifest is rebuilt, refresh
  eventBus.on('quick-actions:manifest-changed', async () => {
    logger.info('[QuickActionListener] Manifest changed, rehydrating...');
    await quickActionService.hydrate();
  });

  // SDK write operation event handlers (DD #24, #33)
  // The SDK emits events through stdout, Mort handles the actual disk write
  // These handlers perform the mutation and update Zustand stores

  eventBus.on('sdk:thread:archive', async (payload: { threadId: string }) => {
    logger.info(`[QuickActionListener] SDK thread archive: ${payload.threadId}`);
    await threadService.archive(payload.threadId);
  });

  // Note: threadService.unarchive() does not exist yet - will need to be implemented
  // eventBus.on('sdk:thread:unarchive', async (payload: { threadId: string }) => {
  //   await threadService.unarchive(payload.threadId);
  // });

  eventBus.on('sdk:thread:markRead', async (payload: { threadId: string }) => {
    logger.info(`[QuickActionListener] SDK thread markRead: ${payload.threadId}`);
    // Thread read state is managed via the store
    useThreadStore.getState().markThreadAsRead(payload.threadId);
  });

  eventBus.on('sdk:thread:markUnread', async (payload: { threadId: string }) => {
    logger.info(`[QuickActionListener] SDK thread markUnread: ${payload.threadId}`);
    // Thread read state is managed via the store
    await useThreadStore.getState().markThreadAsUnread(payload.threadId);
  });

  eventBus.on('sdk:thread:delete', async (payload: { threadId: string }) => {
    logger.info(`[QuickActionListener] SDK thread delete: ${payload.threadId}`);
    await threadService.delete(payload.threadId);
  });

  eventBus.on('sdk:plan:archive', async (payload: { planId: string }) => {
    logger.info(`[QuickActionListener] SDK plan archive: ${payload.planId}`);
    await planService.archive(payload.planId);
  });

  // Note: planService.unarchive() does not exist yet - will need to be implemented
  // eventBus.on('sdk:plan:unarchive', async (payload: { planId: string }) => {
  //   await planService.unarchive(payload.planId);
  // });

  eventBus.on('sdk:plan:markRead', async (payload: { planId: string }) => {
    logger.info(`[QuickActionListener] SDK plan markRead: ${payload.planId}`);
    await planService.markAsRead(payload.planId);
  });

  eventBus.on('sdk:plan:markUnread', async (payload: { planId: string }) => {
    logger.info(`[QuickActionListener] SDK plan markUnread: ${payload.planId}`);
    await planService.markAsUnread(payload.planId);
  });

  eventBus.on('sdk:plan:delete', async (payload: { planId: string }) => {
    logger.info(`[QuickActionListener] SDK plan delete: ${payload.planId}`);
    await planService.delete(payload.planId);
  });

  // Navigation events (these update UI state, not disk)
  eventBus.on('sdk:navigate', async (payload: { route: string }) => {
    logger.info(`[QuickActionListener] SDK navigate: ${payload.route}`);
    // Router navigation handled by UI layer
    // TODO: Implement navigation routing when executor is built
  });

  eventBus.on('sdk:navigateToNextUnread', async () => {
    logger.info('[QuickActionListener] SDK navigateToNextUnread');
    // Find and navigate to next unread item, or empty state if none (DD #29)
    // TODO: Implement navigation to next unread when executor is built
  });

  logger.info('[QuickActionListener] Quick action listeners initialized');
}
