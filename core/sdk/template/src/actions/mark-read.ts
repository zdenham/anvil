import { defineAction } from '@mort/sdk';

export default defineAction({
  id: 'mark-read',
  title: 'Mark Read',
  description: 'Mark as read without archiving',
  contexts: ['thread'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.markRead(context.threadId);
      sdk.log.info('Marked thread as read', { threadId: context.threadId });
    }
  },
});
