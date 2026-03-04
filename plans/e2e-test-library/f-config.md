# Subplan F: Playwright Config & Runner Scripts

**Wave:** 1 (no dependencies — can run parallel with A)
**Outputs:** Updated `playwright.config.ts`, updated `package.json`, new `scripts/e2e-server.sh`

## Phases

- [x] Update `playwright.config.ts` with named projects (critical, core, comprehensive)
- [x] Add npm scripts to `package.json`
- [x] Create `scripts/e2e-server.sh` backend startup + test runner

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## 1. Updated `playwright.config.ts`

Replace the single `chromium` project with tiered projects:

```ts
import { defineConfig, devices } from '@playwright/test';

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
```

Key changes from current config:
- Remove `testDir: "./e2e"` (each project sets its own)
- Replace single `chromium` project with 3 tiered projects
- Add `dependencies` so core waits for critical, comprehensive waits for core
- Move `devices['Desktop Chrome']` into top-level `use` (shared across projects)

## 2. NPM Scripts in `package.json`

Add to `scripts`:

```json
{
  "test:e2e": "playwright test",
  "test:e2e:critical": "playwright test --project=critical",
  "test:e2e:pr": "playwright test --project=critical --project=core",
  "test:e2e:full": "playwright test"
}
```

## 3. `scripts/e2e-server.sh`

Starts the Rust WS backend, waits for it to be ready, runs tests, then cleans up.

```bash
#!/usr/bin/env bash
set -euo pipefail

# Start the WS backend
echo "Starting Rust WS server..."
cargo run &
SERVER_PID=$!

# Wait for port 9600 to be ready
echo "Waiting for WS server on :9600..."
for i in $(seq 1 30); do
  if nc -z localhost 9600 2>/dev/null; then
    echo "WS server ready."
    break
  fi
  if [ $i -eq 30 ]; then
    echo "ERROR: WS server failed to start within 30s"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
  fi
  sleep 1
done

# Run tests (pass through any args like --project=critical)
echo "Running E2E tests..."
pnpm playwright test "$@"
TEST_EXIT=$?

# Cleanup
kill $SERVER_PID 2>/dev/null || true
exit $TEST_EXIT
```

Make executable: `chmod +x scripts/e2e-server.sh`
