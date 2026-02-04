import { defineAction } from '@mort/sdk';

export default defineAction({
  id: 'next-unread',
  title: 'Next Unread',
  description: 'Proceed to next unread item',
  contexts: ['thread', 'plan'],

  async execute(_context, sdk) {
    await sdk.ui.navigateToNextUnread();
    sdk.log.info('Navigated to next unread');
  },
});
