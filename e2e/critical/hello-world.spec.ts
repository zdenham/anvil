import { test, expect } from '../lib/fixtures';

/**
 * Hello World E2E Test — Phase 1
 *
 * Proves the full E2E loop works end-to-end:
 *   Playwright -> Vite frontend -> WS transport -> Rust backend -> Agent process -> Response in UI
 *
 * Prerequisites:
 * - Rust WS server running (start the Tauri app or `cargo run`)
 * - At least one repository configured in the app
 * - ANTHROPIC_API_KEY environment variable set (agent test skips otherwise)
 */

// Check if the WS backend is reachable before running any tests.
// All tests depend on it -- the frontend won't render without it.
async function isWsBackendReachable(): Promise<boolean> {
  try {
    const net = await import('net');
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
  } catch {
    return false;
  }
}

test.describe('Hello World E2E', () => {
  test.beforeAll(async () => {
    const reachable = await isWsBackendReachable();
    test.skip(
      !reachable,
      'Rust WS backend not running on :9600 -- start the app first',
    );
  });

  test('can create a thread, send a prompt, and receive an assistant response', async ({
    app,
  }) => {
    // Skip if no API key -- agent can't respond without one
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    test.skip(
      !hasApiKey,
      'ANTHROPIC_API_KEY not set -- skipping live agent test',
    );

    // 1. Verify at least one worktree section exists (repo is configured)
    const tree = app.treeMenu();
    const sections = tree.getSectionHeaders();
    await expect(sections.first()).toBeVisible({ timeout: 10_000 });

    // 2. Create a new thread via Cmd+N (or Ctrl+N on non-Mac)
    const isMac = process.platform === 'darwin';
    const thread = app.threadPage();

    await app.pressKeys(isMac ? 'Meta+n' : 'Control+n');

    // 3. Type a simple prompt and submit
    await thread.typePrompt('Say hello in exactly 3 words');
    await thread.submit();

    // 4. Wait for the user message to render (optimistic UI)
    const userMessage = thread.getMessageByTurn(0);
    await expect(userMessage).toBeVisible({ timeout: 5_000 });

    // 5. Wait for an assistant message to appear
    const assistantMessage = await thread.waitForAssistantResponse(
      1,
      60_000,
    );

    // 6. Verify the response has actual text content
    const messageText = await assistantMessage.textContent();
    expect(messageText).toBeTruthy();
    expect(messageText!.trim().length).toBeGreaterThan(0);
  });

});
