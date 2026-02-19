import { useEffect, useRef } from 'react';
import { draftService } from '@/entities/drafts/service.js';
import { useInputStore, useInputStoreInstance } from '@/stores/input-store.js';

interface Context {
  type: 'thread' | 'plan' | 'empty';
  id?: string;
}

/**
 * Syncs input content with drafts on navigation.
 * - Saves current input as draft when navigating away
 * - Restores draft when navigating to a context
 *
 * Must be called within an InputStoreProvider.
 */
export function useDraftSync(currentContext: Context) {
  const previousContext = useRef<Context | null>(null);
  const setContent = useInputStore((s) => s.setContent);
  const store = useInputStoreInstance();

  useEffect(() => {
    // Save draft for previous context
    if (previousContext.current) {
      const currentContent = store.getState().content;
      draftService.saveDraftForContext(previousContext.current, currentContent);
    }

    // Restore draft for new context
    const draft = draftService.getDraftForContext(currentContext);
    setContent(draft);

    // Update previous context
    previousContext.current = currentContext;

    // Cleanup: save on unmount
    return () => {
      if (previousContext.current) {
        const content = store.getState().content;
        draftService.saveDraftForContext(previousContext.current, content);
      }
    };
  }, [currentContext.type, currentContext.id]);
}

/**
 * Clears the draft after sending a message.
 * Call this after successfully sending a message.
 */
export function clearCurrentDraft(
  context: Context,
  clearContent: () => void,
) {
  draftService.clearDraftForContext(context);
  clearContent();
}
