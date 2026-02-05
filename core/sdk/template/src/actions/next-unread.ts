export default {
  id: 'next-unread',
  title: 'Next Unread',
  description: 'Proceed to next unread item',
  contexts: ['empty'],

  async execute(_context, sdk) {
    await sdk.ui.navigateToNextUnread();
    sdk.log.info('Navigated to next unread');
  },
} satisfies QuickActionDefinition;
