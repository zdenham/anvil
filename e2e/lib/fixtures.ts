import { test as base } from '@playwright/test';
import { AppPage } from './app-page';
import { RepoHarness } from './repo-harness';

/**
 * Custom Playwright fixtures for Mort E2E tests.
 *
 * - `app`: navigates to '/', waits for ready, provides page objects
 * - `repo`: creates a temporary git repo, registers it via WS, cleans up after
 */
export const test = base.extend<{
  app: AppPage;
  repo: RepoHarness;
}>({
  app: async ({ page }, use) => {
    const app = new AppPage(page);
    await app.goto();
    await app.waitForReady();
    await use(app);
  },
  repo: async ({ page }, use) => {
    const repo = await RepoHarness.create();
    await repo.register(page);
    await use(repo);
    await repo.cleanup();
  },
});

export { expect } from '@playwright/test';
