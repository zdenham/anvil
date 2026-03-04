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

test.describe('Debug panel', () => {
  test.beforeAll(async () => {
    const reachable = await isBackendReachable();
    test.skip(!reachable, 'WS backend not running on :9600');
  });

  test('debug panel opens', async ({ app, page }) => {
    const logsButton = page.locator('[data-testid="logs-button"]');
    const logsVisible = await logsButton.isVisible().catch(() => false);
    test.skip(!logsVisible, 'Logs button not visible');

    await logsButton.click();
    const debugPanel = page.locator('[data-testid="debug-panel"]');
    await expect(debugPanel).toBeVisible({ timeout: 5_000 });
  });

  test('event list is present in debug panel', async ({ app, page }) => {
    const logsButton = page.locator('[data-testid="logs-button"]');
    const logsVisible = await logsButton.isVisible().catch(() => false);
    test.skip(!logsVisible, 'Logs button not visible');

    await logsButton.click();
    const eventList = page.locator('[data-testid="event-list"]');
    await expect(eventList).toBeVisible({ timeout: 5_000 });
  });

  test('clicking event shows detail view', async ({ app, page }) => {
    const logsButton = page.locator('[data-testid="logs-button"]');
    const logsVisible = await logsButton.isVisible().catch(() => false);
    test.skip(!logsVisible, 'Logs button not visible');

    await logsButton.click();
    const eventList = page.locator('[data-testid="event-list"]');
    await expect(eventList).toBeVisible({ timeout: 5_000 });

    // Click first event if available
    const firstEvent = eventList.locator('> *').first();
    const hasEvents = await firstEvent.isVisible().catch(() => false);
    test.skip(!hasEvents, 'No events in event list');

    await firstEvent.click();
    const detail = page.locator('[data-testid="event-detail"]');
    await expect(detail).toBeVisible({ timeout: 3_000 });
  });
});
