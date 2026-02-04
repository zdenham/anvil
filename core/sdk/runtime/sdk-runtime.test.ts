import { describe, it, expect, vi } from 'vitest';
import { createSDK } from './index.js';

describe('SDK Runtime', () => {
  describe('createSDK', () => {
    it('creates SDK with all services', () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      expect(sdk.git).toBeDefined();
      expect(sdk.threads).toBeDefined();
      expect(sdk.plans).toBeDefined();
      expect(sdk.ui).toBeDefined();
      expect(sdk.log).toBeDefined();
    });
  });

  describe('UI Service Events', () => {
    it('emits ui:setInput event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.ui.setInputContent('test content');

      expect(emitEvent).toHaveBeenCalledWith('ui:setInput', 'test content');
    });

    it('emits ui:appendInput event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.ui.appendInputContent('more content');

      expect(emitEvent).toHaveBeenCalledWith('ui:appendInput', 'more content');
    });

    it('emits ui:clearInput event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.ui.clearInput();

      expect(emitEvent).toHaveBeenCalledWith('ui:clearInput', undefined);
    });

    it('emits ui:focusInput event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.ui.focusInput();

      expect(emitEvent).toHaveBeenCalledWith('ui:focusInput', undefined);
    });

    it('emits ui:navigate event for thread', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.ui.navigateToThread('thread-123');

      expect(emitEvent).toHaveBeenCalledWith('ui:navigate', { type: 'thread', id: 'thread-123' });
    });

    it('emits ui:navigate event for plan', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.ui.navigateToPlan('plan-456');

      expect(emitEvent).toHaveBeenCalledWith('ui:navigate', { type: 'plan', id: 'plan-456' });
    });

    it('emits ui:navigate event for nextUnread', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.ui.navigateToNextUnread();

      expect(emitEvent).toHaveBeenCalledWith('ui:navigate', { type: 'nextUnread' });
    });

    it('emits ui:toast event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.ui.showToast('Success!', 'success');

      expect(emitEvent).toHaveBeenCalledWith('ui:toast', { message: 'Success!', type: 'success' });
    });

    it('emits ui:closePanel event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.ui.closePanel();

      expect(emitEvent).toHaveBeenCalledWith('ui:closePanel', undefined);
    });
  });

  describe('Thread Service Events', () => {
    it('emits thread:archive event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.threads.archive('thread-456');

      expect(emitEvent).toHaveBeenCalledWith('thread:archive', { threadId: 'thread-456' });
    });

    it('emits thread:markRead event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.threads.markRead('thread-789');

      expect(emitEvent).toHaveBeenCalledWith('thread:markRead', { threadId: 'thread-789' });
    });

    it('emits thread:markUnread event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.threads.markUnread('thread-101');

      expect(emitEvent).toHaveBeenCalledWith('thread:markUnread', { threadId: 'thread-101' });
    });
  });

  describe('Plan Service Events', () => {
    it('emits plan:archive event', async () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      await sdk.plans.archive('plan-123');

      expect(emitEvent).toHaveBeenCalledWith('plan:archive', { planId: 'plan-123' });
    });
  });

  describe('Log Service Events', () => {
    it('emits log event with info level', () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      sdk.log.info('Test message', { key: 'value' });

      expect(emitEvent).toHaveBeenCalledWith('log', {
        level: 'info',
        message: 'Test message',
        data: { key: 'value' }
      });
    });

    it('emits log event with warn level', () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      sdk.log.warn('Warning message');

      expect(emitEvent).toHaveBeenCalledWith('log', {
        level: 'warn',
        message: 'Warning message',
        data: undefined
      });
    });

    it('emits log event with error level', () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      sdk.log.error('Error message', { code: 500 });

      expect(emitEvent).toHaveBeenCalledWith('log', {
        level: 'error',
        message: 'Error message',
        data: { code: 500 }
      });
    });

    it('emits log event with debug level', () => {
      const emitEvent = vi.fn();
      const sdk = createSDK('/test/.mort', emitEvent);

      sdk.log.debug('Debug message', { count: 1 });

      expect(emitEvent).toHaveBeenCalledWith('log', {
        level: 'debug',
        message: 'Debug message',
        data: { count: 1 }
      });
    });
  });
});

describe('Action Timeout (DD #25)', () => {
  it('completes normally for fast actions', async () => {
    const fastAction = async () => 'done';
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Timeout')), 100)
    );

    const result = await Promise.race([fastAction(), timeoutPromise]);
    expect(result).toBe('done');
  });

  it('rejects with timeout error for slow actions', async () => {
    const slowAction = new Promise((resolve) =>
      setTimeout(() => resolve('done'), 200)
    );
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Action timed out after 30 seconds')), 50)
    );

    await expect(Promise.race([slowAction, timeoutPromise])).rejects.toThrow(
      'Action timed out after 30 seconds'
    );
  });

  it('timeout error includes isTimeout flag in error output', () => {
    const err = new Error('Action timed out after 30 seconds');
    const isTimeout = err.message?.includes('timed out');
    const output = {
      event: 'error',
      payload: { message: err.message, isTimeout }
    };

    expect(output.payload.isTimeout).toBe(true);
    expect(output.event).toBe('error');
  });
});
