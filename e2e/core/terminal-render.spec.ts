import { test, expect } from '../lib/fixtures';
import net from 'net';

async function isBackendReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(
      { host: 'localhost', port: 9600 },
      () => {
        socket.destroy();
        resolve(true);
      },
    );
    socket.on('error', () => resolve(false));
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

test.describe('Terminal render', () => {
  test.beforeAll(async () => {
    const reachable = await isBackendReachable();
    test.skip(!reachable, 'WS backend not running on :9600');
  });

  test('terminal panel renders when terminal is selected', async ({ app, page }) => {
    const terminals = app.treeMenu().getTerminals();
    const count = await terminals.count();
    test.skip(count === 0, 'No terminal sessions available');

    await terminals.first().click();
    await app.contentPane().waitForTerminal();

    const terminalContent = page.locator(
      '[data-testid="terminal-content"]',
    );
    await expect(terminalContent).toBeVisible();
  });
});
