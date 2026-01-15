import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskMetadata } from "../entities";

/**
 * Parsed hotkey modifiers for tracking key release state
 */
interface HotkeyModifiers {
  meta: boolean;    // Command on Mac, Ctrl on Windows/Linux
  ctrl: boolean;    // Control key
  alt: boolean;     // Alt/Option key
  shift: boolean;   // Shift key
}

/**
 * Navigation trigger with direction support
 */
interface NavigationTrigger {
  count: number;
  direction: 'forward' | 'backward';
}

/**
 * Configuration options for keyboard navigation behavior.
 */
export interface KeyboardNavigationConfig {
  /** Array of tasks to navigate through */
  tasks: TaskMetadata[];
  /** Callback when a task is selected (Enter key or Meta key release) */
  onSelect: (task: TaskMetadata) => void;
  /** Optional callback when Meta key is released while navigating */
  onMetaKeyRelease?: (task: TaskMetadata) => void;
  /** External navigation trigger with direction support */
  externalNavigateTrigger?: NavigationTrigger;
  /** Current hotkey string for modifier parsing */
  currentHotkey?: string;
}

/**
 * Parse a hotkey string to extract required modifiers
 */
function parseHotkey(hotkeyString: string): HotkeyModifiers {
  const parts = hotkeyString.toLowerCase().split('+');
  return {
    meta: parts.includes('command') || parts.includes('cmd') || parts.includes('meta'),
    ctrl: parts.includes('control') || parts.includes('ctrl'),
    alt: parts.includes('alt') || parts.includes('option'),
    shift: parts.includes('shift')
  };
}

/**
 * Return type for the keyboard navigation hook.
 */
export interface KeyboardNavigationState {
  /** Currently selected task index */
  selectedIndex: number;
  /** Ref to attach to the container element for keyboard events */
  containerRef: React.RefObject<HTMLDivElement>;
  /** Ref to attach to the list element for auto-scrolling */
  listRef: React.RefObject<HTMLUListElement>;
  /** Currently selected task (if any) */
  selectedTask: TaskMetadata | null;
  /** Whether any meta keys from the hotkey are currently pressed */
  isMetaPressed: boolean;
}

/**
 * Custom hook for keyboard navigation through a list of tasks.
 *
 * Provides arrow key navigation with wrapping, Enter to select,
 * and automatic focus management and scrolling.
 *
 * @param config - Configuration options for the navigation behavior
 * @returns Navigation state and refs for integration with components
 */
export function useKeyboardTaskNavigation(config: KeyboardNavigationConfig): KeyboardNavigationState {
  const {
    tasks,
    onSelect,
    onMetaKeyRelease,
    externalNavigateTrigger,
    currentHotkey = "",
  } = config;

  const [selectedIndex, setSelectedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Parse the current hotkey to determine required modifiers
  const requiredModifiers = currentHotkey ? parseHotkey(currentHotkey) : { meta: false, ctrl: false, alt: false, shift: false };

  // Track pressed modifiers dynamically based on the actual hotkey
  const [pressedModifiers, setPressedModifiers] = useState<HotkeyModifiers>({
    meta: false, ctrl: false, alt: false, shift: false
  });

  // Track previous trigger value to prevent spurious navigation when tasks.length changes
  // Without this, if externalNavigateTrigger stays the same but tasks.length changes,
  // the effect would re-run and potentially advance the selection unexpectedly.
  const prevTriggerRef = useRef<NavigationTrigger>({ count: 0, direction: 'forward' });

  // Get the currently selected task
  const selectedTask = tasks.length > 0 ? tasks[selectedIndex] : null;

  // Handle keyboard navigation
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (tasks.length === 0) return;

    // Track all modifiers that are part of the hotkey
    setPressedModifiers(prev => ({
      meta: requiredModifiers.meta ? (prev.meta || event.metaKey) : prev.meta,
      ctrl: requiredModifiers.ctrl ? (prev.ctrl || event.ctrlKey) : prev.ctrl,
      alt: requiredModifiers.alt ? (prev.alt || event.altKey) : prev.alt,
      shift: requiredModifiers.shift ? (prev.shift || event.shiftKey) : prev.shift,
    }));

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % tasks.length);
        break;

      case 'ArrowUp':
        event.preventDefault();
        setSelectedIndex((prev) => prev === 0 ? tasks.length - 1 : prev - 1);
        break;

      case 'Tab':
        event.preventDefault();
        if (event.shiftKey) {
          // Shift+Tab - move backwards
          setSelectedIndex((prev) => prev === 0 ? tasks.length - 1 : prev - 1);
        } else {
          // Tab - move forwards
          setSelectedIndex((prev) => (prev + 1) % tasks.length);
        }
        break;

      case 'Enter':
        event.preventDefault();
        if (selectedTask) {
          onSelect(selectedTask);
        }
        break;
    }
  }, [tasks, selectedTask, onSelect, requiredModifiers]);

  // Handle modifier key release
  const handleKeyUp = useCallback((event: KeyboardEvent) => {
    // Update modifier states and check if all hotkey modifiers are released
    const newModifiers = {
      meta: requiredModifiers.meta ? (pressedModifiers.meta && event.metaKey) : false,
      ctrl: requiredModifiers.ctrl ? (pressedModifiers.ctrl && event.ctrlKey) : false,
      alt: requiredModifiers.alt ? (pressedModifiers.alt && event.altKey) : false,
      shift: requiredModifiers.shift ? (pressedModifiers.shift && event.shiftKey) : false,
    };

    setPressedModifiers(newModifiers);

    // Check if all required modifiers are now released
    const allModifiersReleased = Object.values(newModifiers).every(pressed => !pressed);
    if (allModifiersReleased && selectedTask && onMetaKeyRelease) {
      onMetaKeyRelease(selectedTask);
    }
  }, [pressedModifiers, requiredModifiers, selectedTask, onMetaKeyRelease]);

  // Handle external navigation trigger (from hotkey press)
  useEffect(() => {
    if (
      externalNavigateTrigger !== undefined &&
      externalNavigateTrigger.count > prevTriggerRef.current.count &&
      tasks.length > 0
    ) {
      if (externalNavigateTrigger.direction === 'forward') {
        setSelectedIndex((prev) => (prev + 1) % tasks.length);
      } else {
        setSelectedIndex((prev) => prev === 0 ? tasks.length - 1 : prev - 1);
      }
      prevTriggerRef.current = externalNavigateTrigger;
    }
  }, [externalNavigateTrigger, tasks.length]);

  // Add keyboard event listeners to container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('keydown', handleKeyDown);
    container.addEventListener('keyup', handleKeyUp);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      container.removeEventListener('keyup', handleKeyUp);
    };
  }, [handleKeyDown, handleKeyUp]);

  // Reset selected index when tasks change
  useEffect(() => {
    if (selectedIndex >= tasks.length) {
      setSelectedIndex(Math.max(0, tasks.length - 1));
    }
  }, [tasks.length, selectedIndex]);

  // Focus container on mount to enable keyboard navigation
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.focus();
    }
  }, []);

  // Auto-scroll to keep selected item visible
  useEffect(() => {
    if (listRef.current && tasks.length > 0) {
      const selectedElement = listRef.current.children[selectedIndex] as HTMLLIElement;
      if (selectedElement) {
        selectedElement.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
        });
      }
    }
  }, [selectedIndex, tasks.length]);

  // Calculate if any required modifier keys are currently pressed
  const isMetaPressed = Object.entries(requiredModifiers).some(
    ([key, required]) => required && pressedModifiers[key as keyof HotkeyModifiers]
  );

  return {
    selectedIndex,
    containerRef,
    listRef,
    selectedTask,
    isMetaPressed,
  };
}