import { appData } from '@/lib/app-data-store.js';
import { useDraftsStore } from './store.js';
import { DraftsFileSchema, type DraftsFile } from './types.js';

// Path relative to the data directory (e.g., ~/.mort/drafts.json)
const DRAFTS_PATH = 'drafts.json';

async function readDraftsFile(): Promise<DraftsFile> {
  try {
    const raw = await appData.readJson<unknown>(DRAFTS_PATH);
    if (!raw) {
      return { threads: {}, plans: {}, empty: '' };
    }
    return DraftsFileSchema.parse(raw);
  } catch {
    return { threads: {}, plans: {}, empty: '' };
  }
}

async function writeDraftsFile(data: DraftsFile): Promise<void> {
  await appData.writeJson(DRAFTS_PATH, data);
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
