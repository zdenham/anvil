# 11 - Drafts Entity

## Overview

Implement persistent draft storage for input content across navigation. Drafts are stored per-thread/plan and persist across app restarts.

## Tauri Compatibility Note

This implementation uses the `persistence` singleton from `@/lib/persistence.js` for all file system operations. This is critical because:

1. **Node.js path module is NOT available** in Tauri's renderer process (browser-like environment)
2. **`@tauri-apps/plugin-fs` is NOT used** in this codebase - instead, all FS operations go through Tauri IPC commands via the `FilesystemClient`
3. The `persistence` layer handles path resolution relative to the data directory (e.g., `~/.mort/`) and abstracts away platform differences

Do NOT use `import * as path from 'path'` or `import * as fs from '@tauri-apps/plugin-fs'` in renderer process code.

## Files to Create

### `src/entities/drafts/types.ts`

```typescript
import { z } from 'zod';

export const DraftsFileSchema = z.object({
  threads: z.record(z.string(), z.string()),  // threadId -> draft content
  plans: z.record(z.string(), z.string()),     // planId -> draft content
  empty: z.string().default(''),               // draft for empty state
});

export type DraftsFile = z.infer<typeof DraftsFileSchema>;
```

### `src/entities/drafts/store.ts`

```typescript
import { create } from 'zustand';

interface DraftsState {
  threadDrafts: Record<string, string>;
  planDrafts: Record<string, string>;
  emptyDraft: string;
  _hydrated: boolean;

  // Mutations (called by service)
  hydrate: (data: {
    threads: Record<string, string>;
    plans: Record<string, string>;
    empty: string;
  }) => void;
  _setThreadDraft: (threadId: string, content: string) => void;
  _setPlanDraft: (planId: string, content: string) => void;
  _setEmptyDraft: (content: string) => void;
  _clearThreadDraft: (threadId: string) => void;
  _clearPlanDraft: (planId: string) => void;
  _clearEmptyDraft: () => void;
}

export const useDraftsStore = create<DraftsState>((set) => ({
  threadDrafts: {},
  planDrafts: {},
  emptyDraft: '',
  _hydrated: false,

  hydrate: (data) => set({
    threadDrafts: data.threads,
    planDrafts: data.plans,
    emptyDraft: data.empty,
    _hydrated: true,
  }),

  _setThreadDraft: (threadId, content) => set((s) => ({
    threadDrafts: { ...s.threadDrafts, [threadId]: content },
  })),

  _setPlanDraft: (planId, content) => set((s) => ({
    planDrafts: { ...s.planDrafts, [planId]: content },
  })),

  _setEmptyDraft: (content) => set({ emptyDraft: content }),

  _clearThreadDraft: (threadId) => set((s) => {
    const { [threadId]: _, ...rest } = s.threadDrafts;
    return { threadDrafts: rest };
  }),

  _clearPlanDraft: (planId) => set((s) => {
    const { [planId]: _, ...rest } = s.planDrafts;
    return { planDrafts: rest };
  }),

  _clearEmptyDraft: () => set({ emptyDraft: '' }),
}));
```

### `src/entities/drafts/service.ts`

```typescript
import { persistence } from '@/lib/persistence.js';
import { useDraftsStore } from './store.js';
import { DraftsFileSchema, type DraftsFile } from './types.js';

// Path relative to the data directory (e.g., ~/.mort/drafts.json)
const DRAFTS_PATH = 'drafts.json';

async function readDraftsFile(): Promise<DraftsFile> {
  try {
    const raw = await persistence.readJson<unknown>(DRAFTS_PATH);
    if (!raw) {
      return { threads: {}, plans: {}, empty: '' };
    }
    return DraftsFileSchema.parse(raw);
  } catch {
    return { threads: {}, plans: {}, empty: '' };
  }
}

async function writeDraftsFile(data: DraftsFile): Promise<void> {
  await persistence.writeJson(DRAFTS_PATH, data);
}

// Simple debounce implementation for draft writes
function debounce<T extends (...args: unknown[]) => Promise<void>>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn(...args);
      timeoutId = null;
    }, delay);
  };
}

// Debounced write to avoid excessive disk writes
const debouncedWrite = debounce(async () => {
  const state = useDraftsStore.getState();
  await writeDraftsFile({
    threads: state.threadDrafts,
    plans: state.planDrafts,
    empty: state.emptyDraft,
  });
}, 500);

export const draftService = {
  /**
   * Hydrate drafts from disk
   */
  async hydrate(): Promise<void> {
    const data = await readDraftsFile();
    useDraftsStore.getState().hydrate(data);
  },

  // ═══════════════════════════════════════════════════════════════════
  // Thread drafts
  // ═══════════════════════════════════════════════════════════════════

  getThreadDraft(threadId: string): string {
    return useDraftsStore.getState().threadDrafts[threadId] ?? '';
  },

  async saveThreadDraft(threadId: string, content: string): Promise<void> {
    useDraftsStore.getState()._setThreadDraft(threadId, content);
    debouncedWrite();
  },

  async clearThreadDraft(threadId: string): Promise<void> {
    useDraftsStore.getState()._clearThreadDraft(threadId);
    debouncedWrite();
  },

  // ═══════════════════════════════════════════════════════════════════
  // Plan drafts
  // ═══════════════════════════════════════════════════════════════════

  getPlanDraft(planId: string): string {
    return useDraftsStore.getState().planDrafts[planId] ?? '';
  },

  async savePlanDraft(planId: string, content: string): Promise<void> {
    useDraftsStore.getState()._setPlanDraft(planId, content);
    debouncedWrite();
  },

  async clearPlanDraft(planId: string): Promise<void> {
    useDraftsStore.getState()._clearPlanDraft(planId);
    debouncedWrite();
  },

  // ═══════════════════════════════════════════════════════════════════
  // Empty state draft
  // ═══════════════════════════════════════════════════════════════════

  getEmptyDraft(): string {
    return useDraftsStore.getState().emptyDraft;
  },

  async saveEmptyDraft(content: string): Promise<void> {
    useDraftsStore.getState()._setEmptyDraft(content);
    debouncedWrite();
  },

  async clearEmptyDraft(): Promise<void> {
    useDraftsStore.getState()._clearEmptyDraft();
    debouncedWrite();
  },

  // ═══════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Get draft for current context
   */
  getDraftForContext(context: {
    type: 'thread' | 'plan' | 'empty';
    id?: string;
  }): string {
    switch (context.type) {
      case 'thread':
        return context.id ? this.getThreadDraft(context.id) : '';
      case 'plan':
        return context.id ? this.getPlanDraft(context.id) : '';
      case 'empty':
        return this.getEmptyDraft();
    }
  },

  /**
   * Save draft for current context
   */
  async saveDraftForContext(
    context: { type: 'thread' | 'plan' | 'empty'; id?: string },
    content: string
  ): Promise<void> {
    switch (context.type) {
      case 'thread':
        if (context.id) await this.saveThreadDraft(context.id, content);
        break;
      case 'plan':
        if (context.id) await this.savePlanDraft(context.id, content);
        break;
      case 'empty':
        await this.saveEmptyDraft(content);
        break;
    }
  },

  /**
   * Clear draft for current context (called after sending message)
   */
  async clearDraftForContext(context: {
    type: 'thread' | 'plan' | 'empty';
    id?: string;
  }): Promise<void> {
    switch (context.type) {
      case 'thread':
        if (context.id) await this.clearThreadDraft(context.id);
        break;
      case 'plan':
        if (context.id) await this.clearPlanDraft(context.id);
        break;
      case 'empty':
        await this.clearEmptyDraft();
        break;
    }
  },
};
```

### `src/entities/drafts/index.ts`

```typescript
export { useDraftsStore } from './store.js';
export { draftService } from './service.js';
export type { DraftsFile } from './types.js';
```

### `src/hooks/useDraftSync.ts`

Hook for syncing drafts with input on navigation:

```typescript
import { useEffect, useRef } from 'react';
import { draftService } from '@/entities/drafts/service.js';
import { useInputStore } from '@/stores/input-store.js';

interface Context {
  type: 'thread' | 'plan' | 'empty';
  id?: string;
}

/**
 * Syncs input content with drafts on navigation.
 * - Saves current input as draft when navigating away
 * - Restores draft when navigating to a context
 */
export function useDraftSync(currentContext: Context) {
  const previousContext = useRef<Context | null>(null);
  const content = useInputStore((s) => s.content);
  const setContent = useInputStore((s) => s.setContent);

  useEffect(() => {
    // Save draft for previous context
    if (previousContext.current) {
      draftService.saveDraftForContext(previousContext.current, content);
    }

    // Restore draft for new context
    const draft = draftService.getDraftForContext(currentContext);
    setContent(draft);

    // Update previous context
    previousContext.current = currentContext;

    // Cleanup: save on unmount
    return () => {
      if (previousContext.current) {
        const currentContent = useInputStore.getState().content;
        draftService.saveDraftForContext(previousContext.current, currentContent);
      }
    };
  }, [currentContext.type, currentContext.id]);
}

/**
 * Clears the draft after sending a message.
 * Call this after successfully sending a message.
 */
export function clearCurrentDraft(context: Context) {
  draftService.clearDraftForContext(context);
  useInputStore.getState().clearContent();
}
```

## Files to Modify

### `src/entities/index.ts`

Add draft hydration:

```typescript
import { draftService } from './drafts/index.js';

export async function hydrateEntities(): Promise<void> {
  // ... existing hydration ...

  await draftService.hydrate();
}
```

### Input component usage

```typescript
import { useDraftSync, clearCurrentDraft } from '@/hooks/useDraftSync.js';

function ThreadView({ threadId }: { threadId: string }) {
  useDraftSync({ type: 'thread', id: threadId });

  const handleSend = async () => {
    // ... send message ...
    clearCurrentDraft({ type: 'thread', id: threadId });
  };

  // ...
}
```

## Design Decisions Referenced

- **#28 Context Switching During Execution**: Draft preserved across navigation
- **#32 Draft Persistence**: Persisted to disk, keyed by UUID, survives restarts

## Acceptance Criteria

- [ ] Drafts persisted to `~/.mort/drafts.json`
- [ ] Draft saved when navigating away
- [ ] Draft restored when navigating to context
- [ ] Draft cleared after sending message
- [ ] Debounced writes avoid excessive disk I/O
- [ ] Empty state has its own draft
- [ ] Drafts survive app restart
- [ ] Service hydrated on app start

## Verification & Testing

### TypeScript Compilation Checks

1. **Verify types compile without errors:**
   ```bash
   cd /Users/zac/Documents/juice/mort/mortician && npx tsc --noEmit
   ```
   Expected: No type errors related to drafts entity files.

2. **Verify Zod schema exports:**
   Create a test file or run in TypeScript to verify:
   ```typescript
   import { DraftsFileSchema, type DraftsFile } from '@/entities/drafts/types.js';

   // Verify schema parses correctly
   const testData: DraftsFile = {
     threads: { 'uuid-1': 'draft content' },
     plans: { 'uuid-2': 'plan draft' },
     empty: 'empty state draft',
   };
   DraftsFileSchema.parse(testData); // Should not throw
   ```

3. **Verify store interface completeness:**
   ```typescript
   import { useDraftsStore } from '@/entities/drafts/store.js';

   // Check all required methods exist
   const state = useDraftsStore.getState();
   console.assert(typeof state.hydrate === 'function');
   console.assert(typeof state._setThreadDraft === 'function');
   console.assert(typeof state._setPlanDraft === 'function');
   console.assert(typeof state._setEmptyDraft === 'function');
   console.assert(typeof state._clearThreadDraft === 'function');
   console.assert(typeof state._clearPlanDraft === 'function');
   console.assert(typeof state._clearEmptyDraft === 'function');
   console.assert(typeof state._hydrated === 'boolean');
   ```

### Import Verification

4. **Verify barrel export works:**
   ```typescript
   import { useDraftsStore, draftService, type DraftsFile } from '@/entities/drafts/index.js';

   // All exports should be defined
   console.assert(useDraftsStore !== undefined);
   console.assert(draftService !== undefined);
   ```

5. **Verify hook exports:**
   ```typescript
   import { useDraftSync, clearCurrentDraft } from '@/hooks/useDraftSync.js';

   console.assert(typeof useDraftSync === 'function');
   console.assert(typeof clearCurrentDraft === 'function');
   ```

### Runtime Behavior Tests

6. **Test file creation on first write:**
   - Delete `~/.mort/drafts.json` if it exists
   - Call `draftService.saveThreadDraft('test-id', 'test content')`
   - Wait 600ms (debounce delay + buffer)
   - Verify `~/.mort/drafts.json` exists and contains:
     ```json
     {
       "threads": { "test-id": "test content" },
       "plans": {},
       "empty": ""
     }
     ```

7. **Test hydration from existing file:**
   - Write a test `drafts.json` file:
     ```json
     {
       "threads": { "abc": "thread draft" },
       "plans": { "def": "plan draft" },
       "empty": "empty draft"
     }
     ```
   - Call `await draftService.hydrate()`
   - Verify `useDraftsStore.getState()._hydrated === true`
   - Verify `draftService.getThreadDraft('abc') === 'thread draft'`
   - Verify `draftService.getPlanDraft('def') === 'plan draft'`
   - Verify `draftService.getEmptyDraft() === 'empty draft'`

8. **Test context-based operations:**
   ```typescript
   // Test getDraftForContext
   await draftService.saveThreadDraft('t1', 'thread content');
   await draftService.savePlanDraft('p1', 'plan content');
   await draftService.saveEmptyDraft('empty content');

   console.assert(draftService.getDraftForContext({ type: 'thread', id: 't1' }) === 'thread content');
   console.assert(draftService.getDraftForContext({ type: 'plan', id: 'p1' }) === 'plan content');
   console.assert(draftService.getDraftForContext({ type: 'empty' }) === 'empty content');
   console.assert(draftService.getDraftForContext({ type: 'thread', id: 'nonexistent' }) === '');
   ```

9. **Test draft clearing:**
   ```typescript
   await draftService.saveThreadDraft('clear-test', 'content');
   console.assert(draftService.getThreadDraft('clear-test') === 'content');
   await draftService.clearThreadDraft('clear-test');
   console.assert(draftService.getThreadDraft('clear-test') === '');
   ```

### Integration Checks

10. **Verify hydrateEntities includes drafts:**
    - Check `src/entities/index.ts` imports and calls `draftService.hydrate()`
    - Run app startup and verify `useDraftsStore.getState()._hydrated === true`

11. **Verify persistence layer is available:**
    ```typescript
    import { persistence } from '@/lib/persistence.js';

    // Check that readJson and writeJson methods exist
    console.assert(typeof persistence.readJson === 'function');
    console.assert(typeof persistence.writeJson === 'function');
    ```

### Dependency Verification

12. **Verify persistence layer works with drafts path:**
    ```typescript
    import { persistence } from '@/lib/persistence.js';

    // Test that persistence resolves paths correctly within the data directory
    const testPath = await persistence.getAbsolutePath('drafts.json');
    console.log('Drafts path:', testPath);
    // Expected: /Users/<user>/.mort/drafts.json (or ~/.mort-dev/drafts.json in dev)
    ```

13. **Verify debounce is self-contained:**
    The debounce function is implemented inline in the service to avoid external dependencies.
    No additional imports are required.

### Edge Cases to Test

14. **Malformed JSON handling:**
    - Write invalid JSON to `~/.mort/drafts.json`
    - Call `await draftService.hydrate()`
    - Should not throw, should return default empty state

15. **Missing file handling:**
    - Delete `~/.mort/drafts.json`
    - Call `await draftService.hydrate()`
    - Should not throw, should initialize with empty state

16. **Concurrent write debouncing:**
    - Rapidly call `saveThreadDraft` multiple times
    - Verify only one write occurs (check file modification time or mock fs)

### Manual Testing Checklist

- [ ] Navigate between threads and verify draft content is preserved
- [ ] Navigate from thread to plan and back, verify both drafts preserved
- [ ] Navigate to empty state and back, verify empty draft preserved
- [ ] Send a message and verify draft is cleared
- [ ] Restart app and verify drafts are restored
- [ ] Check `~/.mort/drafts.json` contains expected structure after various operations
