import { useState, useEffect, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useQuickActionsStore } from '@/entities/quick-actions/store.js';
import { useQuickActionExecutor } from '@/hooks/use-quick-action-executor.js';
import { paneLayoutService } from '@/stores/pane-layout/service.js';
import { cn } from '@/lib/utils.js';
import type { QuickActionMetadata } from '@/entities/quick-actions/types.js';

interface QuickActionsPanelProps {
  contextType: 'thread' | 'plan' | 'empty';
}

interface ActionItemProps {
  action: QuickActionMetadata;
  isSelected: boolean;
  isExecuting: boolean;
  onClick: () => void;
}

function ActionItem({ action, isSelected, isExecuting, onClick }: ActionItemProps) {
  return (
    <button
      onClick={onClick}
      disabled={isExecuting}
      className={cn(
        'font-mono px-1.5 py-0.5 rounded-full transition-colors',
        'focus:outline-none',
        'text-[10px] leading-none',
        isExecuting && 'cursor-not-allowed animate-pulse',
        'border border-surface-600',
        isSelected
          ? 'text-surface-200 border-white'
          : 'text-surface-500 hover:text-surface-400'
      )}
    >
      {action.title}
    </button>
  );
}

export function QuickActionsPanel({ contextType }: QuickActionsPanelProps) {
  const actions = useQuickActionsStore(
    useShallow((s) => s.getForContext(contextType))
  );
  // null = no selection (user is typing in input)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const { isExecuting, executingAction, execute } = useQuickActionExecutor();

  // Reset selection when actions change
  useEffect(() => {
    setSelectedIndex(null);
  }, [actions.length]);

  // Deselect when input is focused (user is typing)
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;
      // Check if focus moved to an input, textarea, or contenteditable
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        setSelectedIndex(null);
      }
    };

    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, []);

  // Deselect when user types in an input
  useEffect(() => {
    const handleInput = (e: Event) => {
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        setSelectedIndex(null);
      }
    };

    document.addEventListener('input', handleInput);
    return () => document.removeEventListener('input', handleInput);
  }, []);

  // Find the thread input element
  const findThreadInput = useCallback((): HTMLTextAreaElement | null => {
    const container = document.querySelector('[data-thread-input]');
    return container?.querySelector('textarea') ?? null;
  }, []);

  // Keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isExecuting) return;

    const target = e.target;
    const isInInput = target instanceof HTMLElement && (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    );

    // Check if cursor is at the end of an input/textarea
    const isCursorAtEnd = () => {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return target.selectionStart === target.value.length && target.selectionEnd === target.value.length;
      }
      return false;
    };

    // Check if cursor is at the start of an input/textarea
    const isCursorAtStart = () => {
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return target.selectionStart === 0 && target.selectionEnd === 0;
      }
      return false;
    };

    // Typing any character while quick action is selected → focus input
    if (selectedIndex !== null && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const input = findThreadInput();
      if (input) {
        setSelectedIndex(null);
        input.focus();
        // Don't prevent default - let the character be typed
        return;
      }
    }

    if (e.key === 'ArrowLeft') {
      if (selectedIndex !== null) {
        // Has selection - navigate left through quick actions
        e.preventDefault();
        if (selectedIndex > 0) {
          setSelectedIndex(selectedIndex - 1);
        } else {
          // At first action, deselect and return focus to input
          setSelectedIndex(null);
          const input = findThreadInput();
          if (input) {
            input.focus();
            // Move cursor to end
            input.setSelectionRange(input.value.length, input.value.length);
          }
        }
      } else if (isInInput && isCursorAtStart() && actions.length > 0) {
        // In input at start - select last quick action
        e.preventDefault();
        setSelectedIndex(actions.length - 1);
        (target as HTMLElement).blur();
      }
    } else if (e.key === 'ArrowRight') {
      if (selectedIndex === null) {
        // No selection - select the first action only if cursor is at end of input (or not in input)
        if (actions.length > 0 && (!isInInput || isCursorAtEnd())) {
          e.preventDefault();
          setSelectedIndex(0);
          if (isInInput) {
            (target as HTMLElement).blur();
          }
        }
        // Otherwise, let the default behavior happen (cursor moves in input)
      } else {
        // Has selection - move right through quick actions
        e.preventDefault();
        if (selectedIndex < actions.length - 1) {
          setSelectedIndex(selectedIndex + 1);
        }
      }
    } else if (e.key === 'Enter' && selectedIndex !== null && actions[selectedIndex]) {
      e.preventDefault();
      e.stopPropagation();
      execute(actions[selectedIndex]);
    } else if (e.key === 'Escape' && selectedIndex !== null) {
      // Escape deselects and returns to input
      e.preventDefault();
      setSelectedIndex(null);
      const input = findThreadInput();
      input?.focus();
    }
  }, [isExecuting, actions, selectedIndex, execute, findThreadInput]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleConfigure = useCallback(() => {
    paneLayoutService.setActiveTabView({ type: 'settings' });
  }, []);

  // Empty state - show setup prompt
  if (actions.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 pt-2 pb-3 border-t border-dashed border-surface-700">
        <span className="text-[9px] text-surface-500 font-mono">No quick actions</span>
        <button
          onClick={handleConfigure}
          className="text-[9px] text-surface-500 hover:text-surface-400 font-mono underline underline-offset-2"
        >
          configure
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-start gap-1 py-3 border-t border-dashed border-surface-700">
      {actions.map((action, index) => {
        const isThisExecuting = isExecuting && executingAction?.id === action.id;
        return (
          <ActionItem
            key={action.id}
            action={action}
            isSelected={!isExecuting && selectedIndex !== null && selectedIndex === index}
            isExecuting={isThisExecuting}
            onClick={() => execute(action)}
          />
        );
      })}
    </div>
  );
}
