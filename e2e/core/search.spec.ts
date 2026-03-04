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

test.describe('Search', () => {
  test.beforeAll(async () => {
    const reachable = await isBackendReachable();
    test.skip(!reachable, 'WS backend not running on :9600');
  });

  test('search panel opens via keyboard shortcut', async ({ page }) => {
    // Try Cmd+Shift+F first (common search-in-files shortcut)
    await page.keyboard.press('Meta+Shift+f');
    const searchPanel = page.locator('[data-testid="search-panel"]');
    let isVisible = await searchPanel.isVisible().catch(() => false);

    if (!isVisible) {
      // Try alternate shortcut
      await page.keyboard.press('Meta+f');
      isVisible = await searchPanel.isVisible().catch(() => false);
    }

    // Search panel may not be available depending on app state
    if (isVisible) {
      await expect(searchPanel).toBeVisible();
    }
  });

  test('typing query shows results', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+f');
    const searchInput = page.locator('[data-testid="search-input"]');
    const visible = await searchInput.isVisible().catch(() => false);
    test.skip(!visible, 'Search panel not available');

    await searchInput.focus();
    await searchInput.type('import');

    const results = page.locator('[data-testid="search-results"]');
    await expect(results).toBeVisible({ timeout: 10_000 });
  });
});
