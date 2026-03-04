import type { Page, Locator } from '@playwright/test';
import { TEST_IDS } from './test-ids';

/**
 * Page object for thread interaction — message list, input, and responses.
 */
export class ThreadPage {
  constructor(private page: Page) {}

  getMessages(): Locator {
    return this.page
      .locator(`[data-testid="${TEST_IDS.messageList}"] > *`);
  }

  getMessageByTurn(n: number): Locator {
    return this.page.locator(
      `[data-testid="${TEST_IDS.assistantMessage(n)}"], ` +
      `[data-testid="${TEST_IDS.userMessage(n)}"]`,
    );
  }

  getToolBlocks(): Locator {
    return this.page.locator('[data-testid^="tool-use-"]');
  }

  async waitForMessageCount(
    n: number,
    timeout = 10_000,
  ): Promise<void> {
    await this.page
      .locator(`[data-testid="${TEST_IDS.messageList}"]`)
      .locator(
        '[data-testid^="user-message-"], [data-testid^="assistant-message-"]',
      )
      .nth(n - 1)
      .waitFor({ state: 'visible', timeout });
  }

  /**
   * Type into the thread input.
   * Uses type() instead of fill() to trigger React's onChange.
   */
  async typePrompt(text: string): Promise<void> {
    const textarea = this.page.locator(
      `[data-testid="${TEST_IDS.threadInput}"] textarea`,
    );
    await textarea.focus();
    await textarea.type(text);
  }

  async submit(): Promise<void> {
    const textarea = this.page.locator(
      `[data-testid="${TEST_IDS.threadInput}"] textarea`,
    );
    await textarea.press('Enter');
  }

  async waitForAssistantResponse(
    turnIndex = 1,
    timeout = 60_000,
  ): Promise<Locator> {
    const locator = this.page.locator(
      `[data-testid="${TEST_IDS.assistantMessage(turnIndex)}"]`,
    );
    await locator.waitFor({ state: 'visible', timeout });
    return locator;
  }
}
