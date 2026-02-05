export default {
  id: 'archive',
  title: 'Archive',
  description: 'Complete and file away',
  contexts: ['thread', 'plan'],

  async execute(context, sdk) {
    if (context.contextType === 'thread' && context.threadId) {
      await sdk.threads.archive(context.threadId);
      sdk.log.info('Archived thread', { threadId: context.threadId });
    } else if (context.contextType === 'plan' && context.planId) {
      await sdk.plans.archive(context.planId);
      sdk.log.info('Archived plan', { planId: context.planId });
    }
  },
} satisfies QuickActionDefinition;
