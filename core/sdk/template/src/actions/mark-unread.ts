export default {
  id: 'mark-unread',
  title: 'Mark Unread',
  description: 'Return to inbox for later',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.markUnread(context.threadId);
      sdk.log.info('Marked thread as unread', { threadId: context.threadId });
      await sdk.ui.closePanel();
    } else if (context.contextType === 'plan' && context.planId) {
      await sdk.plans.markUnread(context.planId);
      sdk.log.info('Marked plan as unread', { planId: context.planId });
      await sdk.ui.closePanel();
    }
  },
} satisfies QuickActionDefinition;
