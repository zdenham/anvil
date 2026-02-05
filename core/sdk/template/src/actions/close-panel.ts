export default {
  id: 'close-panel',
  title: 'Close',
  description: 'Close current panel',
  contexts: ['thread', 'plan'],

  async execute(_context, sdk) {
    await sdk.ui.closePanel();
    sdk.log.info('Closed panel');
  },
} satisfies QuickActionDefinition;
