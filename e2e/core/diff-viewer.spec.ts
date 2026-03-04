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

test.describe('Diff viewer', () => {
  test.beforeAll(async () => {
    const reachable = await isBackendReachable();
    test.skip(!reachable, 'WS backend not running on :9600');
  });

  test('changes view renders', async ({ page }) => {
    const uncommitted = page.locator(
      '[data-testid="uncommitted-item"]',
    );
    const isVisible = await uncommitted.isVisible().catch(() => false);
    test.skip(!isVisible, 'No uncommitted changes visible');

    await uncommitted.click();

    const changesView = page.locator('[data-testid="changes-view"]');
    await expect(changesView).toBeVisible({ timeout: 5_000 });
  });

  test('diff file cards show file paths', async ({ page }) => {
    const uncommitted = page.locator(
      '[data-testid="uncommitted-item"]',
    );
    const isVisible = await uncommitted.isVisible().catch(() => false);
    test.skip(!isVisible, 'No uncommitted changes visible');

    await uncommitted.click();

    const fileCards = page.locator('[data-testid^="diff-file-card-"]');
    await expect(fileCards.first()).toBeVisible({ timeout: 5_000 });

    const headers = page.locator('[data-testid^="diff-file-header-"]');
    const count = await headers.count();
    expect(count).toBeGreaterThan(0);
  });
});
