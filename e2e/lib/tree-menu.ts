import type { Page, Locator } from '@playwright/test';
import { TEST_IDS } from './test-ids';

/**
 * Page object for the sidebar tree menu.
 * Provides accessors for threads, plans, terminals, and section headers.
 */
export class TreeMenu {
  constructor(private page: Page) {}

  async isVisible(): Promise<boolean> {
    return this.page
      .locator(`[data-testid="${TEST_IDS.treeMenu}"]`)
      .isVisible();
  }

  getThreads(): Locator {
    return this.page.locator('[data-testid^="thread-item-"]');
  }

  async clickThread(id: string): Promise<void> {
    await this.page
      .locator(`[data-testid="${TEST_IDS.threadItem(id)}"]`)
      .click();
  }

  getPlans(): Locator {
    return this.page.locator('[data-testid^="plan-item-"]');
  }

  async clickPlan(id: string): Promise<void> {
    await this.page
      .locator(`[data-testid="${TEST_IDS.planItem(id)}"]`)
      .click();
  }

  getTerminals(): Locator {
    return this.page.locator('[data-testid^="terminal-item-"]');
  }

  getSectionHeaders(): Locator {
    return this.page.locator('[data-testid^="repo-worktree-section-"]');
  }
}
