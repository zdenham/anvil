import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQuickActionHotkeys } from '../use-quick-action-hotkeys.js';
import { useQuickActionsStore } from '@/entities/quick-actions/store.js';
import { useContentPanesStore } from '@/stores/content-panes/store.js';
import { useModalStore } from '@/stores/modal-store.js';

// Mock the executor hook
const executeMock = vi.fn();
vi.mock('@/hooks/use-quick-action-executor.js', () => ({
  useQuickActionExecutor: () => ({
    isExecuting: false,
    execute: executeMock,
  }),
}));

describe('useQuickActionHotkeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup test actions
    useQuickActionsStore.setState({
      actions: {
        'test-uuid': {
          id: 'test-uuid',
          title: 'Test Action',
          hotkey: 1,
          enabled: true,
          contexts: ['thread'],
          order: 0,
          script: 'test.ts',
        },
      },
    });

    // Default to thread view (main view where hotkeys should work)
    useContentPanesStore.setState({
      panes: {
        'pane-1': {
          id: 'pane-1',
          view: { type: 'thread', threadId: 'thread-123' },
        },
      },
      activePaneId: 'pane-1',
    });

    // No modal open by default
    useModalStore.setState({ openCount: 0, isOpen: false });
  });

  it('registers keydown event listener', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    renderHook(() => useQuickActionHotkeys());
    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('removes keydown event listener on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useQuickActionHotkeys());
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
  });

  it('ignores non-meta key presses', () => {
    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: false }));
    expect(executeMock).not.toHaveBeenCalled();
  });

  // DD #16 Compliance: Settings page
  it('does NOT trigger hotkeys on settings page (DD #16)', () => {
    useContentPanesStore.setState({
      panes: {
        'pane-1': {
          id: 'pane-1',
          view: { type: 'settings' },
        },
      },
      activePaneId: 'pane-1',
    });

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).not.toHaveBeenCalled();
  });

  // DD #16 Compliance: Logs page
  it('does NOT trigger hotkeys on logs page (DD #16)', () => {
    useContentPanesStore.setState({
      panes: {
        'pane-1': {
          id: 'pane-1',
          view: { type: 'logs' },
        },
      },
      activePaneId: 'pane-1',
    });

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).not.toHaveBeenCalled();
  });

  // DD #16 Compliance: Modal open
  it('does NOT trigger hotkeys when modal is open (DD #16)', () => {
    useModalStore.setState({ openCount: 1, isOpen: true });

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).not.toHaveBeenCalled();
  });

  // DD #16 Compliance: Main views work
  it('triggers hotkeys on thread view (DD #16)', () => {
    useContentPanesStore.setState({
      panes: {
        'pane-1': {
          id: 'pane-1',
          view: { type: 'thread', threadId: 'thread-123' },
        },
      },
      activePaneId: 'pane-1',
    });

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).toHaveBeenCalled();
  });

  it('triggers hotkeys on plan view (DD #16)', () => {
    useContentPanesStore.setState({
      panes: {
        'pane-1': {
          id: 'pane-1',
          view: { type: 'plan', planId: 'plan-123' },
        },
      },
      activePaneId: 'pane-1',
    });

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).toHaveBeenCalled();
  });

  it('triggers hotkeys on empty view (DD #16)', () => {
    useContentPanesStore.setState({
      panes: {
        'pane-1': {
          id: 'pane-1',
          view: { type: 'empty' },
        },
      },
      activePaneId: 'pane-1',
    });

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).toHaveBeenCalled();
  });

  it('does NOT trigger hotkeys when no active pane', () => {
    useContentPanesStore.setState({
      panes: {},
      activePaneId: null,
    });

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).not.toHaveBeenCalled();
  });
});
