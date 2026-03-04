import { test, expect } from '../lib/fixtures';
import type { AppPage } from '../lib/app-page';
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

/** Expand the first tree section if collapsed */
async function expandFirstSection(app: AppPage) {
  const sectionHeader = app.treeMenu().getSectionHeaders().first();
  await expect(sectionHeader).toBeVisible({ timeout: 5_000 });
  const headerButton = sectionHeader.locator('[role="treeitem"][aria-expanded]').first();
  if ((await headerButton.getAttribute('aria-expanded')) === 'false') {
    await headerButton.click();
  }
}

test.describe('Basic navigation', () => {
  test.beforeAll(async () => {
    const reachable = await isBackendReachable();
    test.skip(!reachable, 'WS backend not running on :9600');
  });

  test('tree menu renders with at least one section', async ({ app }) => {
    expect(await app.treeMenu().isVisible()).toBe(true);
    const headers = app.treeMenu().getSectionHeaders();
    await expect(headers.first()).toBeVisible({ timeout: 5_000 });
  });

  test('clicking a thread item loads content pane', async ({ app }) => {
    await expandFirstSection(app);

    const threads = app.treeMenu().getThreads();
    const count = await threads.count();
    test.skip(count === 0, 'No threads available on disk');

    await threads.first().click();
    // Wait for the content pane to become visible after navigation
    await expect(
      app.page.locator('[data-testid="content-pane"]'),
    ).toBeVisible({ timeout: 10_000 });
  });

  test('content pane switches between views', async ({ app }) => {
    await expandFirstSection(app);

    const threads = app.treeMenu().getThreads();
    if ((await threads.count()) > 0) {
      await threads.first().click();
      // Wait for the thread's message list to appear before asserting
      await expect(
        app.page.locator('[data-testid="message-list"]'),
      ).toBeVisible({ timeout: 10_000 });
      const panel = await app.contentPane().getActivePanel();
      expect(panel).toBe('thread');
    }
  });
});
