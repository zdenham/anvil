# 10 - Hotkey Registration & Input Store

## Overview

Implement app-local hotkey registration (Cmd+0-9) and the input store for SDK-controlled input field manipulation.

## Files to Create

### `src/hooks/useQuickActionHotkeys.ts`

Hook for registering quick action hotkeys:

```typescript
import { useEffect } from 'react';
import { useQuickActionsStore } from '@/entities/quick-actions/store.js';
import { useQuickActionExecutor } from '@/hooks/useQuickActionExecutor.js';
import { useContentPanesStore, getActivePane } from '@/stores/content-panes/store.js';
import { useModalStore } from '@/stores/modal-store.js';
import type { ContentPaneView } from '@/components/content-pane/types.js';

/**
 * Check if the current view is a main view where quick actions are allowed.
 * Per DD #16: 'all' context means the three main views: thread, plan, and empty.
 * Quick actions are NOT shown on settings pages, logs pages, or when modals are open.
 */
function isMainView(view: ContentPaneView | undefined): boolean {
  if (!view) return false;
  return view.type === 'thread' || view.type === 'plan' || view.type === 'empty';
}

/**
 * Registers app-local hotkeys for quick actions (Cmd+0-9).
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

  // Subscribe to active pane changes to re-register handler when view changes
  const activePaneId = useContentPanesStore((s) => s.activePaneId);
  const panes = useContentPanesStore((s) => s.panes);

  // Subscribe to modal state
  const isModalOpen = useModalStore((s) => s.isOpen);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle Cmd+0-9
      if (!e.metaKey) return;
      if (!/^[0-9]$/.test(e.key)) return;

      // Don't trigger if already executing (DD #18)
      if (isExecuting) return;

      // Don't trigger if a modal is open (DD #16)
      if (isModalOpen) return;

      // Don't trigger if not on a main view (DD #16)
      // Main views are: thread, plan, empty
      // NOT allowed on: settings, logs
      const activePane = getActivePane();
      if (!isMainView(activePane?.view)) return;

      // Don't trigger if focus is in an input/textarea
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const hotkey = parseInt(e.key, 10);
      const action = Object.values(actions).find(
        (a) => a.hotkey === hotkey && a.enabled
      );

      if (action) {
        e.preventDefault();
        execute(action);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [actions, isExecuting, execute, activePaneId, panes, isModalOpen]);
}
```

### `src/stores/modal-store.ts`

Store for tracking modal open state (required for DD #16 compliance):

```typescript
import { create } from 'zustand';

/**
 * Simple store for tracking whether any modal is currently open.
 * Used by hotkey handlers to disable hotkeys when modals are open (DD #16).
 *
 * Modal components should call openModal() on mount and closeModal() on unmount.
 * For modals using Radix UI Dialog, integrate with onOpenChange callback.
 */
interface ModalState {
  /** Count of currently open modals (supports nested modals) */
  openCount: number;

  /** Derived: true if any modal is open */
  isOpen: boolean;

  /** Call when a modal opens */
  openModal: () => void;

  /** Call when a modal closes */
  closeModal: () => void;
}

export const useModalStore = create<ModalState>((set) => ({
  openCount: 0,
  isOpen: false,

  openModal: () =>
    set((state) => ({
      openCount: state.openCount + 1,
      isOpen: true,
    })),

  closeModal: () =>
    set((state) => ({
      openCount: Math.max(0, state.openCount - 1),
      isOpen: state.openCount - 1 > 0,
    })),
}));

/**
 * Get current modal state (non-reactive, for use outside React).
 */
export function getModalState(): Pick<ModalState, 'isOpen' | 'openCount'> {
  const { isOpen, openCount } = useModalStore.getState();
  return { isOpen, openCount };
}
```

### `src/hooks/useModalTracking.ts`

Hook for automatically tracking modal state:

```typescript
import { useEffect } from 'react';
import { useModalStore } from '@/stores/modal-store.js';

/**
 * Hook to automatically track modal open/close state.
 * Call this in modal components to register with the modal store.
 *
 * @param isOpen - Whether the modal is currently open
 *
 * @example
 * function MyModal({ open, onOpenChange }) {
 *   useModalTracking(open);
 *   return <Dialog open={open} onOpenChange={onOpenChange}>...</Dialog>;
 * }
 */
export function useModalTracking(isOpen: boolean) {
  const openModal = useModalStore((s) => s.openModal);
  const closeModal = useModalStore((s) => s.closeModal);

  useEffect(() => {
    if (isOpen) {
      openModal();
      return () => closeModal();
    }
  }, [isOpen, openModal, closeModal]);
}
```

### `src/stores/input-store.ts`

Store for external input control:

```typescript
import { create } from 'zustand';

interface InputState {
  // Current active input content
  content: string;

  // For focusing from outside
  focusRequested: boolean;

  // Actions
  setContent: (content: string) => void;
  appendContent: (content: string) => void;
  clearContent: () => void;
  requestFocus: () => void;
  clearFocusRequest: () => void;
}

export const useInputStore = create<InputState>((set, get) => ({
  content: '',
  focusRequested: false,

  setContent: (content) => set({ content }),

  appendContent: (content) => set((s) => ({ content: s.content + content })),

  clearContent: () => set({ content: '' }),

  requestFocus: () => set({ focusRequested: true }),

  clearFocusRequest: () => set({ focusRequested: false }),
}));
```

### `src/hooks/useInputControl.ts`

Hook for connecting input components to the store:

```typescript
import { useEffect, useRef } from 'react';
import { useInputStore } from '@/stores/input-store.js';

/**
 * Hook for connecting an input element to the input store.
 * Handles external content updates and focus requests.
 */
export function useInputControl() {
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null);
  const content = useInputStore((s) => s.content);
  const focusRequested = useInputStore((s) => s.focusRequested);
  const clearFocusRequest = useInputStore((s) => s.clearFocusRequest);

  // Handle focus requests
  useEffect(() => {
    if (focusRequested && inputRef.current) {
      inputRef.current.focus();
      clearFocusRequest();
    }
  }, [focusRequested, clearFocusRequest]);

  return {
    inputRef,
    value: content,
    onChange: (value: string) => useInputStore.getState().setContent(value),
  };
}
```

## Files to Modify

### `src/App.tsx` (or root component)

Add the hotkey provider:

```typescript
import { useQuickActionHotkeys } from '@/hooks/useQuickActionHotkeys.js';

function App() {
  // Register quick action hotkeys at app level
  useQuickActionHotkeys();

  return (
    // ... rest of app
  );
}
```

### Input component (e.g., `src/components/reusable/thread-input.tsx`)

Connect to input store:

```typescript
import { useInputControl } from '@/hooks/useInputControl.js';

function ThreadInput() {
  const { inputRef, value, onChange } = useInputControl();

  return (
    <textarea
      ref={inputRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      // ... other props
    />
  );
}
```

## Alternative: No Dedicated Input Field Focus

If the app uses a different input pattern (e.g., command palette), the input store might need adjustment. The key patterns are:

1. **Content manipulation**: SDK can set/append/clear input content
2. **Focus control**: SDK can request focus on the input
3. **Bidirectional sync**: Local edits update the store, store changes update the input

## Design Decisions Referenced

- **#8 Hotkeys**: App-local only (not system-wide), Cmd+0-9 pool
- **#16 Context Scope**: Hotkeys only active on main views (thread, plan, empty) - NOT on settings, logs, or when modals are open
- **#18 No Concurrent Actions**: Hotkeys disabled during execution
- **#31 Unified Hotkey Pool**: All actions share single Cmd+0-9 pool

## Acceptance Criteria

- [ ] Cmd+0-9 triggers corresponding action
- [ ] Hotkeys only work when app window is focused
- [ ] Hotkeys don't trigger when typing in input fields
- [ ] Hotkeys disabled during action execution
- [ ] **Hotkeys disabled on settings page (DD #16)**
- [ ] **Hotkeys disabled on logs page (DD #16)**
- [ ] **Hotkeys disabled when any modal is open (DD #16)**
- [ ] **Hotkeys only work on thread, plan, and empty views (DD #16)**
- [ ] Modal store correctly tracks open/close state
- [ ] Nested modals properly tracked (openCount)
- [ ] Input store correctly manages content state
- [ ] Focus requests properly focus the input
- [ ] Content changes from SDK update the input
- [ ] Local edits update the store

## Compliance Notes

### Design Decisions Review

**Compliant with:**
- #8 Hotkeys: App-local (window event listeners), Cmd+0-9 pool
- #16 Context Scope: `isMainView()` helper checks for thread/plan/empty views only; `isModalOpen` check prevents hotkeys when modals are open; settings and logs pages explicitly excluded
- #18 No Concurrent Actions: `isExecuting` check prevents hotkey triggers during execution
- #31 Unified Hotkey Pool: Single search through all actions for hotkey matches

**Considerations:**
- #32 Draft Persistence: The input store is in-memory only. Per design decision #32, drafts should persist to `~/.anvil/drafts.json`. Either integrate with the draft persistence system or clarify that this input store is separate from draft persistence.

## Verification & Testing

### TypeScript Compilation Checks

Run from project root to verify all new files compile without errors:

```bash
# Verify TypeScript compilation succeeds
npx tsc --noEmit

# If using a specific tsconfig for source files:
npx tsc --noEmit -p tsconfig.json
```

### Type Interface Verification

Create a temporary test file to verify exported types are correct:

```typescript
// test-types.ts (temporary, delete after verification)
import { useQuickActionHotkeys } from '@/hooks/useQuickActionHotkeys.js';
import { useInputStore } from '@/stores/input-store.js';
import { useInputControl } from '@/hooks/useInputControl.js';
import { useModalStore, getModalState } from '@/stores/modal-store.js';
import { useModalTracking } from '@/hooks/useModalTracking.js';

// Verify useQuickActionHotkeys is a hook (returns void)
const _hotkeysResult: void = useQuickActionHotkeys();

// Verify input store shape
const inputState = useInputStore.getState();
const _content: string = inputState.content;
const _focusRequested: boolean = inputState.focusRequested;
inputState.setContent('test');
inputState.appendContent('test');
inputState.clearContent();
inputState.requestFocus();
inputState.clearFocusRequest();

// Verify modal store shape
const modalState = useModalStore.getState();
const _openCount: number = modalState.openCount;
const _isOpen: boolean = modalState.isOpen;
modalState.openModal();
modalState.closeModal();

// Verify getModalState helper
const { isOpen, openCount } = getModalState();
const _isOpen2: boolean = isOpen;
const _openCount2: number = openCount;

// Verify useModalTracking (accepts boolean)
useModalTracking(true);
useModalTracking(false);

// Verify useInputControl return shape
const control = useInputControl();
const _ref: React.RefObject<HTMLTextAreaElement | HTMLInputElement> = control.inputRef;
const _value: string = control.value;
control.onChange('test');
```

Run: `npx tsc --noEmit test-types.ts` then delete the file.

### Unit Tests for Input Store

```typescript
// src/stores/__tests__/input-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useInputStore } from '../input-store.js';

describe('useInputStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useInputStore.setState({ content: '', focusRequested: false });
  });

  it('setContent updates content', () => {
    useInputStore.getState().setContent('hello');
    expect(useInputStore.getState().content).toBe('hello');
  });

  it('appendContent appends to existing content', () => {
    useInputStore.getState().setContent('hello');
    useInputStore.getState().appendContent(' world');
    expect(useInputStore.getState().content).toBe('hello world');
  });

  it('clearContent resets content to empty string', () => {
    useInputStore.getState().setContent('hello');
    useInputStore.getState().clearContent();
    expect(useInputStore.getState().content).toBe('');
  });

  it('requestFocus sets focusRequested to true', () => {
    useInputStore.getState().requestFocus();
    expect(useInputStore.getState().focusRequested).toBe(true);
  });

  it('clearFocusRequest sets focusRequested to false', () => {
    useInputStore.getState().requestFocus();
    useInputStore.getState().clearFocusRequest();
    expect(useInputStore.getState().focusRequested).toBe(false);
  });
});
```

Run: `npm test -- src/stores/__tests__/input-store.test.ts`

### Unit Tests for Modal Store

```typescript
// src/stores/__tests__/modal-store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useModalStore, getModalState } from '../modal-store.js';

describe('useModalStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useModalStore.setState({ openCount: 0, isOpen: false });
  });

  it('openModal increments count and sets isOpen', () => {
    useModalStore.getState().openModal();
    expect(useModalStore.getState().openCount).toBe(1);
    expect(useModalStore.getState().isOpen).toBe(true);
  });

  it('closeModal decrements count and updates isOpen', () => {
    useModalStore.getState().openModal();
    useModalStore.getState().closeModal();
    expect(useModalStore.getState().openCount).toBe(0);
    expect(useModalStore.getState().isOpen).toBe(false);
  });

  it('handles nested modals correctly', () => {
    useModalStore.getState().openModal();
    useModalStore.getState().openModal();
    expect(useModalStore.getState().openCount).toBe(2);
    expect(useModalStore.getState().isOpen).toBe(true);

    useModalStore.getState().closeModal();
    expect(useModalStore.getState().openCount).toBe(1);
    expect(useModalStore.getState().isOpen).toBe(true); // Still open!

    useModalStore.getState().closeModal();
    expect(useModalStore.getState().openCount).toBe(0);
    expect(useModalStore.getState().isOpen).toBe(false);
  });

  it('closeModal does not go below zero', () => {
    useModalStore.getState().closeModal();
    expect(useModalStore.getState().openCount).toBe(0);
    expect(useModalStore.getState().isOpen).toBe(false);
  });

  it('getModalState returns current state', () => {
    useModalStore.getState().openModal();
    const state = getModalState();
    expect(state.isOpen).toBe(true);
    expect(state.openCount).toBe(1);
  });
});
```

Run: `npm test -- src/stores/__tests__/modal-store.test.ts`

### Integration Tests for Hotkey Hook

```typescript
// src/hooks/__tests__/useQuickActionHotkeys.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useQuickActionHotkeys } from '../useQuickActionHotkeys.js';
import { useQuickActionsStore } from '@/entities/quick-actions/store.js';
import { useContentPanesStore } from '@/stores/content-panes/store.js';
import { useModalStore } from '@/stores/modal-store.js';

// Mock the executor hook
const executeMock = vi.fn();
vi.mock('@/hooks/useQuickActionExecutor.js', () => ({
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
```

Run: `npm test -- src/hooks/__tests__/useQuickActionHotkeys.test.tsx`

### Manual Verification Checklist

1. **Hotkey Registration**
   ```bash
   # Start the app
   npm run tauri dev
   ```
   - Assign hotkey 1 to an action in settings
   - Press Cmd+1 while on thread view -> action should trigger
   - Press Cmd+1 while typing in input -> action should NOT trigger

2. **DD #16 Context Scope Compliance**
   Verify hotkeys are disabled on non-main views:
   - Press Cmd+1 while on **settings page** -> action should NOT trigger
   - Press Cmd+1 while on **logs page** -> action should NOT trigger
   - Press Cmd+1 while a **modal is open** (e.g., action edit modal) -> action should NOT trigger

   Verify hotkeys work on main views:
   - Press Cmd+1 while on **thread view** -> action SHOULD trigger
   - Press Cmd+1 while on **plan view** -> action SHOULD trigger
   - Press Cmd+1 while on **empty view** (no thread/plan selected) -> action SHOULD trigger

3. **Modal Tracking Integration**
   - Open a modal (e.g., settings modal, confirmation dialog)
   - Press Cmd+1 -> action should NOT trigger
   - Close the modal
   - Press Cmd+1 -> action SHOULD trigger
   - Test with nested modals (if applicable): open modal A, open modal B from A
   - Close modal B -> hotkeys still disabled (modal A still open)
   - Close modal A -> hotkeys enabled

4. **Input Store Integration**
   - Open browser DevTools console
   - Run: `window.__INPUT_STORE__ = require('@/stores/input-store').useInputStore`
   - Run: `window.__INPUT_STORE__.getState().setContent('test from console')`
   - Verify the input field updates to show "test from console"
   - Run: `window.__INPUT_STORE__.getState().requestFocus()`
   - Verify the input field receives focus

5. **Concurrent Execution Prevention (DD #18)**
   - Trigger a slow action (or mock one with setTimeout)
   - While executing, press another hotkey
   - Verify the second action does NOT trigger

### Lint & Format Checks

```bash
# ESLint check
npx eslint src/hooks/useQuickActionHotkeys.ts src/stores/input-store.ts src/stores/modal-store.ts src/hooks/useInputControl.ts src/hooks/useModalTracking.ts

# Prettier format check
npx prettier --check src/hooks/useQuickActionHotkeys.ts src/stores/input-store.ts src/stores/modal-store.ts src/hooks/useInputControl.ts src/hooks/useModalTracking.ts
```

### Build Verification

```bash
# Full build to ensure no runtime issues
npm run build

# Verify the built files exist
ls -la dist/
```
