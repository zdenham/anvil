import { defineAction } from '@mort/sdk';

export default defineAction({
  id: 'mark-unread',
  title: 'Mark Unread',
  description: 'Return to inbox for later',
  contexts: ['thread'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.markUnread(context.threadId);
      sdk.log.info('Marked thread as unread', { threadId: context.threadId });
    }
  },
});
