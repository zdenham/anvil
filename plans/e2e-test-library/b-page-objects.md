# Subplan B: Page Objects & Fixtures

**Wave:** 2 (depends on A: Foundation Helpers)
**Outputs:** `e2e/lib/app-page.ts`, `e2e/lib/tree-menu.ts`, `e2e/lib/thread-page.ts`, `e2e/lib/content-pane.ts`, `e2e/lib/fixtures.ts`

## Phases

- [x] Build `app-page.ts` (top-level page object)
- [x] Build `tree-menu.ts`, `thread-page.ts`, `content-pane.ts`
- [x] Build `fixtures.ts` (custom Playwright test fixture)
- [x] Verify by refactoring `hello-world.spec.ts` to use the new fixtures

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## 1. `e2e/lib/app-page.ts` — Top-Level Page Object

Wraps the full app surface. All other page objects are accessed through this.

```ts
import type { Page } from '@playwright/test';
import { TreeMenu } from './tree-menu';
import { ThreadPage } from './thread-page';
import { ContentPane } from './content-pane';
import { waitForAppReady, invokeWsCommand } from './wait-helpers';
import { TEST_IDS } from './test-ids';

export class AppPage {
  constructor(private page: Page) {}

  async goto(): Promise<void>;          // page.goto('/')
  async waitForReady(): Promise<void>;  // waitForAppReady(this.page)
  isLoaded(): Promise<boolean>;         // check main-layout visible

  treeMenu(): TreeMenu;                 // new TreeMenu(this.page)
  threadPage(): ThreadPage;             // new ThreadPage(this.page)
  contentPane(): ContentPane;           // new ContentPane(this.page)

  /** Invoke a WS command from browser context */
  async invokeWs<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}
```

## 2. `e2e/lib/tree-menu.ts` — Sidebar Navigation

```ts
export class TreeMenu {
  constructor(private page: Page) {}

  /** All visible thread items */
  getThreads(): Locator;                   // [data-testid^="thread-item-"]
  clickThread(id: string): Promise<void>;  // click specific thread
  getPlans(): Locator;                     // [data-testid^="plan-item-"]
  clickPlan(id: string): Promise<void>;
  getTerminals(): Locator;                 // [data-testid^="terminal-item-"]
  getSectionHeaders(): Locator;            // tree-section elements
  isVisible(): Promise<boolean>;
}
```

## 3. `e2e/lib/thread-page.ts` — Thread Interaction

```ts
export class ThreadPage {
  constructor(private page: Page) {}

  getMessages(): Locator;                        // message-list children
  getMessageByTurn(n: number): Locator;          // assistant-message-{n} or user-message-{n}
  getToolBlocks(): Locator;                       // [data-testid^="tool-use-"]
  waitForMessageCount(n: number, timeout?: number): Promise<void>;

  /** Type into thread input (uses type() not fill() for React compatibility) */
  typePrompt(text: string): Promise<void>;
  submit(): Promise<void>;                        // press Enter on the textarea

  /** Wait for assistant response at the expected turn index */
  waitForAssistantResponse(turnIndex?: number, timeout?: number): Promise<Locator>;
}
```

Key: `typePrompt` must use `page.locator('[data-testid="thread-input"] textarea').type(text)` — never `fill()` (bypasses React onChange).

## 4. `e2e/lib/content-pane.ts` — Content Area

```ts
export class ContentPane {
  constructor(private page: Page) {}

  isVisible(): Promise<boolean>;
  getActivePanel(): Promise<'file' | 'terminal' | 'thread' | 'plan' | 'pr' | 'unknown'>;

  waitForFileContent(timeout?: number): Promise<Locator>;
  waitForTerminal(timeout?: number): Promise<Locator>;
  getFileContent(): Promise<string>;
  getBreadcrumb(): Locator;
}
```

Panel detection logic: check which of `file-content`, `terminal-content`, `plan-content-pane`, `pr-content`, `message-list` is visible.

## 5. `e2e/lib/fixtures.ts` — Custom Playwright Fixtures

```ts
import { test as base } from '@playwright/test';
import { AppPage } from './app-page';
import { RepoHarness } from './repo-harness';

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
```

## 6. Validation: Refactor `hello-world.spec.ts`

After all page objects are built, refactor the existing hello-world test to use `test` from `fixtures.ts` and `app.threadPage()` methods. This confirms the fixtures wire up correctly.

## Test IDs to use (from `src/test/test-ids.ts`)

- Layout: `mainLayout`, `contentPane`, `contentPaneHeader`
- Tree: `treeMenu`, `treePanelHeader`, `threadItem(id)`, `planItem(id)`, `terminalItem(id)`, `treeSection(name)`
- Thread: `threadInput`, `messageList`, `assistantMessage(n)`, `userMessage(n)`, `toolUse(id)`
- Content: `fileContent`, `terminalContent`, `planContentPane`, `prContent`, `breadcrumb`
- State: `loadingSpinner`, `emptyState`
