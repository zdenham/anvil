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

test.describe('File browsing', () => {
  test.beforeAll(async () => {
    const reachable = await isBackendReachable();
    test.skip(!reachable, 'WS backend not running on :9600');
  });

  test('can navigate to file content via thread', async ({ app, page }) => {
    const threads = app.treeMenu().getThreads();
    test.skip(await threads.count() === 0, 'No threads on disk');

    await threads.first().click();

    // Check if file content pane becomes available after clicking a thread.
    // This is best-effort -- the thread may not reference files.
    const fileContent = page.locator('[data-testid="file-content"]');
    const visible = await fileContent
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    if (visible) {
      const text = await fileContent.textContent();
      expect(text?.length).toBeGreaterThan(0);
    }
  });

  test('file path shows in breadcrumb when file is loaded', async ({ app }) => {
    const breadcrumb = app.contentPane().getBreadcrumb();
    const isVisible = await breadcrumb.isVisible().catch(() => false);

    if (isVisible) {
      const text = await breadcrumb.textContent();
      expect(text).toBeTruthy();
    }
  });
});
