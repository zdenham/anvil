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

test.describe('Settings', () => {
  test.beforeAll(async () => {
    const reachable = await isBackendReachable();
    test.skip(!reachable, 'WS backend not running on :9600');
  });

  test('settings panel opens from tree menu', async ({ app, page }) => {
    const settingsButton = page.locator('[data-testid="settings-button"]');
    await expect(settingsButton).toBeVisible({ timeout: 5_000 });
    await settingsButton.click();
    const settingsView = page.locator('[data-testid="settings-view"]');
    await expect(settingsView).toBeVisible({ timeout: 5_000 });
  });

  test('about section shows version info', async ({ app, page }) => {
    const settingsButton = page.locator('[data-testid="settings-button"]');
    await settingsButton.click();
    const aboutSettings = page.locator('[data-testid="about-settings"]');
    await expect(aboutSettings).toBeVisible({ timeout: 5_000 });
    const text = await aboutSettings.textContent();
    expect(text).toBeTruthy();
  });

  test('settings sections are navigable', async ({ app, page }) => {
    const settingsButton = page.locator('[data-testid="settings-button"]');
    await settingsButton.click();

    for (const section of [
      'hotkey-settings',
      'repository-settings',
      'skills-settings',
    ]) {
      const el = page.locator(`[data-testid="${section}"]`);
      const isPresent = (await el.count()) > 0;
      expect(isPresent).toBe(true);
    }
  });
});
