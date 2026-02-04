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
