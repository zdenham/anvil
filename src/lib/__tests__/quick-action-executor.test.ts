/**
 * Quick Action Executor Tests
 *
 * Tests for the SDK event handler that processes events from quick actions.
 * Focus on verifying that UI operations correctly update both tree selection
 * AND content pane state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all dependencies before importing the module under test
vi.mock('@/stores/tree-menu/service', () => ({
  treeMenuService: {
    setSelectedItem: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/stores/content-panes/service', () => ({
  contentPanesService: {
    setActivePaneView: vi.fn().mockResolvedValue(undefined),
    clearActivePane: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/stores/navigation-service', () => ({
  navigationService: {
    navigateToView: vi.fn().mockResolvedValue(undefined),
    navigateToThread: vi.fn().mockResolvedValue(undefined),
    navigateToPlan: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/entities/threads/service', () => ({
  threadService: {
    archive: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/entities/threads/store', () => ({
  useThreadStore: {
    getState: () => ({
      markThreadAsRead: vi.fn(),
      markThreadAsUnread: vi.fn().mockResolvedValue(undefined),
      getUnreadThreads: vi.fn().mockReturnValue([]),
    }),
  },
}));

vi.mock('@/entities/plans/service', () => ({
  planService: {
    archive: vi.fn().mockResolvedValue(undefined),
    markAsUnread: vi.fn().mockResolvedValue(undefined),
    getUnreadPlans: vi.fn().mockReturnValue([]),
  },
}));

vi.mock('@/stores/input-store', () => ({
  useInputStore: {
    getState: () => ({
      setContent: vi.fn(),
      appendContent: vi.fn(),
      clearContent: vi.fn(),
      requestFocus: vi.fn(),
    }),
  },
}));

vi.mock('@/lib/toast', () => ({
  toast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/logger-client', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/lib/filesystem-client', () => ({
  FilesystemClient: class MockFilesystemClient {
    getDataDir = vi.fn().mockResolvedValue('/mock/data/dir');
    joinPath = vi.fn((...parts: string[]) => parts.join('/'));
  },
}));

vi.mock('@/lib/paths', () => ({
  getRunnerPath: vi.fn().mockResolvedValue('/mock/runner.js'),
}));

vi.mock('@tauri-apps/plugin-shell', () => ({
  Command: {
    create: vi.fn(),
  },
}));

// Import the module under test - must use dynamic import after mocks
import { handleSDKEvent } from '../quick-action-executor.js';
import { treeMenuService } from '@/stores/tree-menu/service';
import { contentPanesService } from '@/stores/content-panes/service';
import { navigationService } from '@/stores/navigation-service';

describe('handleSDKEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('ui:closePanel', () => {
    it('should navigate to empty view (clearing both tree selection and content pane)', async () => {
      await handleSDKEvent({ event: 'ui:closePanel' });

      // The fix: should use navigationService to clear BOTH tree selection AND content pane
      expect(navigationService.navigateToView).toHaveBeenCalledWith({ type: 'empty' });

      // Should NOT call treeMenuService directly (let navigationService handle it)
      expect(treeMenuService.setSelectedItem).not.toHaveBeenCalled();
    });
  });

  describe('ui:navigate with type empty', () => {
    it('should navigate to empty view (clearing both tree selection and content pane)', async () => {
      await handleSDKEvent({
        event: 'ui:navigate',
        payload: { type: 'empty' },
      });

      // The fix: should use navigationService for empty navigation too
      expect(navigationService.navigateToView).toHaveBeenCalledWith({ type: 'empty' });
    });
  });

  describe('ui:navigate with type thread', () => {
    it('should navigate to thread', async () => {
      await handleSDKEvent({
        event: 'ui:navigate',
        payload: { type: 'thread', id: 'thread-123' },
      });

      expect(navigationService.navigateToThread).toHaveBeenCalledWith('thread-123');
    });

    it('should not navigate if thread id is missing', async () => {
      await handleSDKEvent({
        event: 'ui:navigate',
        payload: { type: 'thread' },
      });

      expect(navigationService.navigateToThread).not.toHaveBeenCalled();
    });
  });

  describe('ui:navigate with type plan', () => {
    it('should navigate to plan', async () => {
      await handleSDKEvent({
        event: 'ui:navigate',
        payload: { type: 'plan', id: 'plan-456' },
      });

      expect(navigationService.navigateToPlan).toHaveBeenCalledWith('plan-456');
    });

    it('should not navigate if plan id is missing', async () => {
      await handleSDKEvent({
        event: 'ui:navigate',
        payload: { type: 'plan' },
      });

      expect(navigationService.navigateToPlan).not.toHaveBeenCalled();
    });
  });
});
