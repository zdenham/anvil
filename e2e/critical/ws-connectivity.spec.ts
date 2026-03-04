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

test.describe('WS connectivity', () => {
  test.beforeAll(async () => {
    const reachable = await isBackendReachable();
    test.skip(!reachable, 'WS backend not running on :9600');
  });

  test('WS connection established to :9600', async ({ page }) => {
    const result = await page.evaluate(async () => {
      return new Promise<string>((resolve) => {
        const ws = new WebSocket('ws://localhost:9600/ws');
        ws.onopen = () => {
          ws.close();
          resolve('connected');
        };
        ws.onerror = () => resolve('error');
        setTimeout(() => resolve('timeout'), 5000);
      });
    });
    expect(result).toBe('connected');
  });

  test('can invoke get_paths_info and get valid response', async ({ app }) => {
    const result = await app.invokeWs('get_paths_info', {});
    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
  });

  test('can invoke is_shell_initialized', async ({ app }) => {
    const result = await app.invokeWs('is_shell_initialized', {});
    expect(typeof result).toBe('boolean');
  });
});
