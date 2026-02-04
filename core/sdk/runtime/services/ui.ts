import type { UIService } from '../../types.js';
import type { EmitEvent } from '../index.js';

export function createUIService(emitEvent: EmitEvent): UIService {
  return {
    async setInputContent(content: string): Promise<void> {
      emitEvent('ui:setInput', content);
    },

    async appendInputContent(content: string): Promise<void> {
      emitEvent('ui:appendInput', content);
    },

    async clearInput(): Promise<void> {
      emitEvent('ui:clearInput', undefined);
    },

    async focusInput(): Promise<void> {
      emitEvent('ui:focusInput', undefined);
    },

    async navigateToThread(threadId: string): Promise<void> {
      emitEvent('ui:navigate', { type: 'thread', id: threadId });
    },

    async navigateToPlan(planId: string): Promise<void> {
      emitEvent('ui:navigate', { type: 'plan', id: planId });
    },

    async navigateToNextUnread(): Promise<void> {
      emitEvent('ui:navigate', { type: 'nextUnread' });
    },

    async showToast(message: string, type?: 'info' | 'success' | 'error'): Promise<void> {
      emitEvent('ui:toast', { message, type });
    },

    async closePanel(): Promise<void> {
      emitEvent('ui:closePanel', undefined);
    },
  };
}
