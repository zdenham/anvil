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

test.describe('App loads', () => {
  test.beforeAll(async () => {
    const reachable = await isBackendReachable();
    test.skip(!reachable, 'WS backend not running on :9600');
  });

  test('app renders main layout within 5s', async ({ app }) => {
    // app fixture already did goto + waitForReady
    expect(await app.isLoaded()).toBe(true);
  });

  test('no console errors on load', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    await page.goto('/');
    await page.waitForTimeout(2000);
    // Filter out expected noise (e.g., favicon 404)
    const realErrors = errors.filter((e) => !e.includes('favicon'));
    expect(realErrors).toEqual([]);
  });

  test('no uncaught exceptions on load', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));
    await page.goto('/');
    await page.waitForTimeout(2000);
    expect(pageErrors).toEqual([]);
  });
});
