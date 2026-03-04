import type { Page, Locator } from '@playwright/test';

/**
 * Wait for an element with the given data-testid to be visible.
 */
export function waitForTestId(
  page: Page,
  testId: string,
  opts?: { timeout?: number },
): Locator {
  return page.locator(`[data-testid="${testId}"]`).first();
}

/**
 * Wait for the WS connection to be established by checking that the app
 * can successfully invoke a command over the WebSocket.
 */
export async function waitForWsReady(page: Page, timeout = 10_000): Promise<void> {
  await page.waitForFunction(
    async () => {
      return new Promise<boolean>((resolve) => {
        try {
          const ws = new WebSocket('ws://localhost:9600/ws');
          ws.onopen = () => {
            ws.close();
            resolve(true);
          };
          ws.onerror = () => resolve(false);
          setTimeout(() => resolve(false), 3000);
        } catch {
          resolve(false);
        }
      });
    },
    undefined,
    { timeout, polling: 1000 },
  );
}

/**
 * Wait for the app's main layout to render and the WS backend to be reachable.
 */
export async function waitForAppReady(page: Page, timeout = 15_000): Promise<void> {
  // Wait for main layout to render
  await page.locator('[data-testid="main-layout"]').waitFor({
    state: 'visible',
    timeout,
  });

  // Wait for tree menu (confirms store hydration happened)
  await page.locator('[data-testid="tree-menu"]').waitFor({
    state: 'visible',
    timeout: 10_000,
  });
}

/**
 * Invoke a WS command from the browser context.
 * This opens a fresh WebSocket, sends one command, and returns the result.
 */
export async function invokeWsCommand<T = unknown>(
  page: Page,
  cmd: string,
  args: Record<string, unknown> = {},
  timeout = 10_000,
): Promise<T> {
  return page.evaluate(
    async ({ cmd, args, timeout }) => {
      return new Promise<T>((resolve, reject) => {
        const ws = new WebSocket('ws://localhost:9600/ws');
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error(`WS command "${cmd}" timed out after ${timeout}ms`));
        }, timeout);

        ws.onopen = () => {
          ws.send(JSON.stringify({ id: 1, cmd, args }));
        };
        ws.onmessage = (event) => {
          clearTimeout(timer);
          const data = JSON.parse(event.data);
          ws.close();
          if (data.error) {
            reject(new Error(data.error));
          } else {
            resolve(data.result);
          }
        };
        ws.onerror = () => {
          clearTimeout(timer);
          reject(new Error(`WS connection error for command "${cmd}"`));
        };
      });
    },
    { cmd, args, timeout },
  );
}

/**
 * Wait for all loading spinners to disappear.
 */
export async function waitForNoSpinner(page: Page, timeout = 10_000): Promise<void> {
  await page.locator('[data-testid="loading-spinner"]').waitFor({
    state: 'hidden',
    timeout,
  });
}

/**
 * Generic retry-until pattern with configurable timeout and interval.
 */
export async function retryUntil<T>(
  fn: () => Promise<T>,
  opts?: { timeout?: number; interval?: number; message?: string },
): Promise<T> {
  const timeout = opts?.timeout ?? 10_000;
  const interval = opts?.interval ?? 250;
  const message = opts?.message ?? 'retryUntil timed out';
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {
      // keep retrying
    }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(message);
}
