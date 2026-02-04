import { defineAction } from '@mort/sdk';

export default defineAction({
  id: 'archive-and-next',
  title: 'Archive & Next',
  description: 'Archive current item and go to next unread',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.archive(context.threadId);
    } else if (context.contextType === 'plan' && context.planId) {
      await sdk.plans.archive(context.planId);
    }

    await sdk.ui.navigateToNextUnread();
    sdk.log.info('Archived and navigated to next unread');
  },
});
