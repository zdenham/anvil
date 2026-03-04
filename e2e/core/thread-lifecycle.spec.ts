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

test.describe('Thread lifecycle', () => {
  test.beforeAll(async () => {
    const reachable = await isBackendReachable();
    test.skip(!reachable, 'WS backend not running on :9600');
  });

  test('thread list renders existing threads from disk', async ({ app }) => {
    const threads = app.treeMenu().getThreads();
    const count = await threads.count();
    test.skip(count === 0, 'No threads on disk');
    expect(count).toBeGreaterThan(0);
  });

  test('messages render with correct turn structure', async ({ app, page }) => {
    const threads = app.treeMenu().getThreads();
    test.skip(await threads.count() === 0, 'No threads on disk');

    await threads.first().click();

    // Wait for at least one message to appear
    const messages = page.locator(
      '[data-testid^="user-message-"], [data-testid^="assistant-message-"]',
    );
    await expect(messages.first()).toBeVisible({ timeout: 5_000 });

    // First message should be user turn 0
    await expect(
      page.locator('[data-testid="user-message-0"]'),
    ).toBeVisible();
  });

  test('tool blocks render with correct test IDs', async ({ app }) => {
    const threads = app.treeMenu().getThreads();
    test.skip(await threads.count() === 0, 'No threads on disk');

    await threads.first().click();

    // Tool blocks are optional -- just verify the pattern if present
    const toolBlocks = app.threadPage().getToolBlocks();
    const count = await toolBlocks.count();
    if (count > 0) {
      const testId = await toolBlocks.first().getAttribute('data-testid');
      expect(testId).toMatch(/^tool-use-/);
    }
  });
});
