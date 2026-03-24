import type { Page } from '@playwright/test';
import { TreeMenu } from './tree-menu';
import { ThreadPage } from './thread-page';
import { ContentPane } from './content-pane';
import { waitForAppReady, invokeWsCommand } from './wait-helpers';
import { TEST_IDS } from './test-ids';

/**
 * Top-level page object for the Anvil app.
 * All sub-page objects are accessed through this class.
 */
export class AppPage {
  constructor(private page: Page) {}

  async goto(): Promise<void> {
    await this.page.goto('/');
  }

  async waitForReady(): Promise<void> {
    await waitForAppReady(this.page);
  }

  async isLoaded(): Promise<boolean> {
    return this.page
      .locator(`[data-testid="${TEST_IDS.mainLayout}"]`)
      .isVisible();
  }

  treeMenu(): TreeMenu {
    return new TreeMenu(this.page);
  }

  threadPage(): ThreadPage {
    return new ThreadPage(this.page);
  }

  contentPane(): ContentPane {
    return new ContentPane(this.page);
  }

  /** Press a keyboard shortcut (e.g. 'Meta+n', 'Control+Shift+p'). */
  async pressKeys(keys: string): Promise<void> {
    await this.page.keyboard.press(keys);
  }

  /** Invoke a WS command from the browser context. */
  async invokeWs<T = unknown>(
    cmd: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    return invokeWsCommand<T>(this.page, cmd, args);
  }
}
