import { defineAction } from '@mort/sdk';

export default defineAction({
  id: 'example',
  title: 'Example Action',
  description: 'Demonstrates SDK usage patterns',
  contexts: ['thread', 'plan', 'empty'],

  async execute(context, sdk) {
    // Log context information
    sdk.log.info('Example action executed', {
      contextType: context.contextType,
      threadId: context.threadId,
      planId: context.planId,
      repo: context.repository?.name,
    });

    // Show what context we're in
    let message: string;
    switch (context.contextType) {
      case 'thread':
        message = `In thread: ${context.threadId}`;
        break;
      case 'plan':
        message = `In plan: ${context.planId}`;
        break;
      case 'empty':
        message = 'In empty state';
        break;
    }

    await sdk.ui.showToast(message, 'info');
  },
});
