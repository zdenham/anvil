import { eventBus } from '@/entities/events.js';
import { quickActionService } from './service.js';
import { threadService } from '@/entities/threads/index.js';
import { planService } from '@/entities/plans/index.js';
import { useThreadStore } from '@/entities/threads/store.js';
import { logger } from '@/lib/logger-client.js';

export function setupQuickActionListeners(): () => void {
  const handleRegistryChanged = async () => {
    logger.info('[QuickActionListener] Registry changed, rehydrating...');
    await quickActionService.hydrate();
  };

  const handleManifestChanged = async () => {
    logger.info('[QuickActionListener] Manifest changed, rehydrating...');
    await quickActionService.hydrate();
  };

  const handleThreadArchive = async (payload: { threadId: string }) => {
    logger.info(`[QuickActionListener] SDK thread archive: ${payload.threadId}`);
    await threadService.archive(payload.threadId);
  };

  const handleThreadMarkRead = async (payload: { threadId: string }) => {
    logger.info(`[QuickActionListener] SDK thread markRead: ${payload.threadId}`);
    useThreadStore.getState().markThreadAsRead(payload.threadId);
  };

  const handleThreadMarkUnread = async (payload: { threadId: string }) => {
    logger.info(`[QuickActionListener] SDK thread markUnread: ${payload.threadId}`);
    await useThreadStore.getState().markThreadAsUnread(payload.threadId);
  };

  const handleThreadDelete = async (payload: { threadId: string }) => {
    logger.info(`[QuickActionListener] SDK thread delete: ${payload.threadId}`);
    await threadService.delete(payload.threadId);
  };

  const handlePlanArchive = async (payload: { planId: string }) => {
    logger.info(`[QuickActionListener] SDK plan archive: ${payload.planId}`);
    await planService.archive(payload.planId);
  };

  const handlePlanMarkRead = async (payload: { planId: string }) => {
    logger.info(`[QuickActionListener] SDK plan markRead: ${payload.planId}`);
    await planService.markAsRead(payload.planId);
  };

  const handlePlanMarkUnread = async (payload: { planId: string }) => {
    logger.info(`[QuickActionListener] SDK plan markUnread: ${payload.planId}`);
    await planService.markAsUnread(payload.planId);
  };

  const handlePlanDelete = async (payload: { planId: string }) => {
    logger.info(`[QuickActionListener] SDK plan delete: ${payload.planId}`);
    await planService.delete(payload.planId);
  };

  const handleNavigate = async (payload: { route: string }) => {
    logger.info(`[QuickActionListener] SDK navigate: ${payload.route}`);
  };

  const handleNavigateToNextUnread = async () => {
    logger.info('[QuickActionListener] SDK navigateToNextUnread');
  };

  eventBus.on('quick-actions:registry-changed', handleRegistryChanged);
  eventBus.on('quick-actions:manifest-changed', handleManifestChanged);
  eventBus.on('sdk:thread:archive', handleThreadArchive);
  eventBus.on('sdk:thread:markRead', handleThreadMarkRead);
  eventBus.on('sdk:thread:markUnread', handleThreadMarkUnread);
  eventBus.on('sdk:thread:delete', handleThreadDelete);
  eventBus.on('sdk:plan:archive', handlePlanArchive);
  eventBus.on('sdk:plan:markRead', handlePlanMarkRead);
  eventBus.on('sdk:plan:markUnread', handlePlanMarkUnread);
  eventBus.on('sdk:plan:delete', handlePlanDelete);
  eventBus.on('sdk:navigate', handleNavigate);
  eventBus.on('sdk:navigateToNextUnread', handleNavigateToNextUnread);

  logger.info('[QuickActionListener] Quick action listeners initialized');

  return () => {
    eventBus.off('quick-actions:registry-changed', handleRegistryChanged);
    eventBus.off('quick-actions:manifest-changed', handleManifestChanged);
    eventBus.off('sdk:thread:archive', handleThreadArchive);
    eventBus.off('sdk:thread:markRead', handleThreadMarkRead);
    eventBus.off('sdk:thread:markUnread', handleThreadMarkUnread);
    eventBus.off('sdk:thread:delete', handleThreadDelete);
    eventBus.off('sdk:plan:archive', handlePlanArchive);
    eventBus.off('sdk:plan:markRead', handlePlanMarkRead);
    eventBus.off('sdk:plan:markUnread', handlePlanMarkUnread);
    eventBus.off('sdk:plan:delete', handlePlanDelete);
    eventBus.off('sdk:navigate', handleNavigate);
    eventBus.off('sdk:navigateToNextUnread', handleNavigateToNextUnread);
  };
}
