import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQuickActionHotkeys } from '../use-quick-action-hotkeys.js';
import { useQuickActionsStore } from '@/entities/quick-actions/store.js';
import { usePaneLayoutStore } from '@/stores/pane-layout/store.js';
import { useModalStore } from '@/stores/modal-store.js';
import type { PaneLayoutPersistedState } from '@core/types/pane-layout.js';

// Mock the executor hook
const executeMock = vi.fn();
let mockIsExecuting = false;
vi.mock('@/hooks/use-quick-action-executor.js', () => ({
  useQuickActionExecutor: () => ({
    get isExecuting() {
      return mockIsExecuting;
    },
    execute: executeMock,
  }),
}));

/** Helper to seed the pane-layout store with a given active tab view. */
function seedPaneLayout(viewType: string, extra: Record<string, unknown> = {}): void {
  const state: PaneLayoutPersistedState = {
    root: { type: 'leaf', groupId: 'g1' },
    groups: {
      g1: {
        id: 'g1',
        tabs: [{ id: 't1', view: { type: viewType, ...extra } }],
        activeTabId: 't1',
      },
    },
    activeGroupId: 'g1',
  };
  usePaneLayoutStore.getState().hydrate(state);
}

describe('useQuickActionHotkeys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsExecuting = false;

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
    seedPaneLayout('thread', { threadId: 'thread-123' });

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
    seedPaneLayout('settings');

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).not.toHaveBeenCalled();
  });

  // DD #16 Compliance: Logs page
  it('does NOT trigger hotkeys on logs page (DD #16)', () => {
    seedPaneLayout('logs');

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
    seedPaneLayout('thread', { threadId: 'thread-123' });

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).toHaveBeenCalled();
  });

  it('triggers hotkeys on plan view (DD #16)', () => {
    seedPaneLayout('plan', { planId: 'plan-123' });

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).toHaveBeenCalled();
  });

  it('triggers hotkeys on empty view (DD #16)', () => {
    seedPaneLayout('empty');

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).toHaveBeenCalled();
  });

  it('does NOT trigger hotkeys when no active group', () => {
    usePaneLayoutStore.setState({
      root: { type: 'leaf', groupId: '' },
      groups: {},
      activeGroupId: '',
      _hydrated: true,
    });

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).not.toHaveBeenCalled();
  });

  it('does NOT trigger hotkeys when focus is in input field', () => {
    renderHook(() => useQuickActionHotkeys());

    // Create and focus an input element
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    // Dispatch event with input as target
    const event = new KeyboardEvent('keydown', { key: '1', metaKey: true, bubbles: true });
    input.dispatchEvent(event);

    expect(executeMock).not.toHaveBeenCalled();

    // Cleanup
    document.body.removeChild(input);
  });

  it('does NOT trigger hotkeys when focus is in textarea field', () => {
    renderHook(() => useQuickActionHotkeys());

    // Create and focus a textarea element
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    // Dispatch event with textarea as target
    const event = new KeyboardEvent('keydown', { key: '1', metaKey: true, bubbles: true });
    textarea.dispatchEvent(event);

    expect(executeMock).not.toHaveBeenCalled();

    // Cleanup
    document.body.removeChild(textarea);
  });

  it('does NOT trigger hotkeys when focus is in contentEditable element', () => {
    renderHook(() => useQuickActionHotkeys());

    // Create and focus a contentEditable element
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    div.focus();

    // Dispatch event with div as target
    const event = new KeyboardEvent('keydown', { key: '1', metaKey: true, bubbles: true });
    div.dispatchEvent(event);

    expect(executeMock).not.toHaveBeenCalled();

    // Cleanup
    document.body.removeChild(div);
  });

  it('does NOT trigger hotkeys when isExecuting is true (DD #18)', () => {
    mockIsExecuting = true;

    renderHook(() => useQuickActionHotkeys());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '1', metaKey: true }));
    expect(executeMock).not.toHaveBeenCalled();
  });
});
