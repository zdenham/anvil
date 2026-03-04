import type { Page, Locator } from '@playwright/test';
import { TEST_IDS } from './test-ids';

type PanelKind = 'file' | 'terminal' | 'thread' | 'plan' | 'pr' | 'unknown';

/**
 * Page object for the right-side content pane.
 * Provides panel detection, waiters, and content accessors.
 */
export class ContentPane {
  constructor(private page: Page) {}

  async isVisible(): Promise<boolean> {
    return this.page
      .locator(`[data-testid="${TEST_IDS.contentPane}"]`)
      .isVisible();
  }

  async getActivePanel(): Promise<PanelKind> {
    const checks: Array<[string, PanelKind]> = [
      [TEST_IDS.fileContent, 'file'],
      [TEST_IDS.terminalContent, 'terminal'],
      [TEST_IDS.messageList, 'thread'],
      [TEST_IDS.planContentPane, 'plan'],
      [TEST_IDS.prContent, 'pr'],
    ];

    for (const [testId, panel] of checks) {
      const visible = await this.page
        .locator(`[data-testid="${testId}"]`)
        .isVisible()
        .catch(() => false);
      if (visible) return panel;
    }

    return 'unknown';
  }

  async waitForFileContent(timeout = 10_000): Promise<Locator> {
    const locator = this.page.locator(
      `[data-testid="${TEST_IDS.fileContent}"]`,
    );
    await locator.waitFor({ state: 'visible', timeout });
    return locator;
  }

  async waitForTerminal(timeout = 10_000): Promise<Locator> {
    const locator = this.page.locator(
      `[data-testid="${TEST_IDS.terminalContent}"]`,
    );
    await locator.waitFor({ state: 'visible', timeout });
    return locator;
  }

  async getFileContent(): Promise<string> {
    const el = this.page.locator(
      `[data-testid="${TEST_IDS.fileContent}"]`,
    );
    return (await el.textContent()) ?? '';
  }

  getBreadcrumb(): Locator {
    return this.page.locator(
      `[data-testid="${TEST_IDS.breadcrumb}"]`,
    );
  }
}
