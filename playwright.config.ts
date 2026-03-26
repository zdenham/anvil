import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for Anvil E2E tests.
 *
 * Tests run against the Vite dev server + Rust WS backend.
 * The Vite dev server is started automatically via `webServer`.
 * The sidecar WS server must already be running.
 * Start it with `ANVIL_SIDECAR_NO_AUTH=1` to bypass per-session token auth.
 *
 * Projects are tiered: critical → core → comprehensive.
 * Each tier depends on the previous, so failures in earlier
 * tiers short-circuit the run.
 */
export default defineConfig({
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:1421',
    trace: 'on-first-retry',
    ...devices['Desktop Chrome'],
  },

  projects: [
    {
      name: 'critical',
      testDir: './e2e/critical',
      timeout: 30_000,
    },
    {
      name: 'core',
      testDir: './e2e/core',
      timeout: 60_000,
      dependencies: ['critical'],
    },
    {
      name: 'comprehensive',
      testDir: './e2e/comprehensive',
      timeout: 120_000,
      dependencies: ['core'],
    },
  ],

  webServer: {
    command: 'pnpm vite --port 1421',
    port: 1421,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
