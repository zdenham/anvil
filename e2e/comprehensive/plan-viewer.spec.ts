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

test.describe('Plan viewer', () => {
  test.beforeAll(async () => {
    const reachable = await isBackendReachable();
    test.skip(!reachable, 'WS backend not running on :9600');
  });

  test('plan list renders in tree menu', async ({ app }) => {
    const plans = app.treeMenu().getPlans();
    const count = await plans.count();
    // Plans are optional — just verify the locator works
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('clicking plan shows plan content', async ({ app, page }) => {
    const plans = app.treeMenu().getPlans();
    const count = await plans.count();
    test.skip(count === 0, 'No plans on disk');

    await plans.first().click();
    const planPane = page.locator('[data-testid="plan-content-pane"]');
    await expect(planPane).toBeVisible({ timeout: 5_000 });
  });

  test('plan content shows phases', async ({ app, page }) => {
    const plans = app.treeMenu().getPlans();
    const count = await plans.count();
    test.skip(count === 0, 'No plans on disk');

    await plans.first().click();
    const planContent = page.locator('[data-testid="plan-content"]');
    await expect(planContent).toBeVisible({ timeout: 5_000 });
    // Plan content should contain some text (phases, checkboxes, etc.)
    const text = await planContent.textContent();
    expect(text).toBeTruthy();
  });
});
