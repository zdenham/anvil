# E2E Test Library & Priority-Tiered Test Suite

## Goal

Build a modular E2E testing helper library and a priority-tiered test suite so that:
- **Critical** tests run in <30s and gate every commit
- **Core** tests run in <2min and gate PRs
- **Comprehensive** tests run in <5min on nightly/manual trigger

All tests exercise the real Rust backend via the existing WS transport layer (`:9600`).

## Implementation Notes

Key findings from Phase 1 implementation:

- **Always use `localhost`, never `127.0.0.1`** — Vite dev server binds IPv6 only; headless Chromium can't reach `127.0.0.1` for the WS server either. Changed `src/lib/invoke.ts` WS_URL to `ws://localhost:9600/ws`.
- **Dev server runs on port 1421** (not 1420). Playwright config updated to match.
- **Use `type()` not `fill()`** for the thread input textarea — `fill()` bypasses React's `onChange`, so the Zustand store never gets the value and submit is a no-op.
- **Backend skip pattern** — `beforeAll` uses Node.js `net.createConnection` to check if `:9600` is reachable; skips the entire suite if not. Agent test additionally skips if `ANTHROPIC_API_KEY` is missing.
- **Full agent loop takes ~6s** — subprocess spawn + socket connect + API round-trip + stream render.

## Phases

- [x] Prove the approach with a single "hello world" E2E test
- [x] Build the E2E helper library (`e2e/lib/`)
- [x] Write Critical test specs
- [x] Write Core Workflow test specs
- [x] Write Comprehensive test specs
- [x] Update Playwright config with named projects + test runner scripts

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Architecture

### Current State

```
e2e/
  smoke.spec.ts              # basic render + WS reachability
  thread-navigation.spec.ts  # tree menu + content pane render
playwright.config.ts         # auto-starts Vite, Chromium only
src/test/test-ids.ts         # 180+ centralized test IDs (already done)
```

- WS server (`:9600`) must be started manually (`cargo run`)
- Frontend transport (`src/lib/invoke.ts`) routes all data commands to WS
- `src/test/test-ids.ts` already has comprehensive test ID coverage
- No helper abstractions — raw Playwright API in each spec

### Target State

```
e2e/
  lib/
    fixtures.ts          # custom test fixtures (page helpers, repo setup)
    app-page.ts          # Page Object: full app navigation
    thread-page.ts       # Page Object: thread interaction
    tree-menu.ts         # Page Object: tree menu / sidebar
    content-pane.ts      # Page Object: content pane panels
    repo-harness.ts      # dummy repo setup/teardown for isolated tests
    wait-helpers.ts      # common wait/retry patterns
    test-ids.ts          # re-export from src/test/test-ids.ts
  critical/
    app-loads.spec.ts
    ws-connectivity.spec.ts
    basic-navigation.spec.ts
  core/
    thread-lifecycle.spec.ts
    file-browsing.spec.ts
    search.spec.ts
    terminal-render.spec.ts
    diff-viewer.spec.ts
  comprehensive/
    settings.spec.ts
    keyboard-navigation.spec.ts
    debug-panel.spec.ts
    plan-viewer.spec.ts
playwright.config.ts     # updated with named projects
```

---

## Phase 1: Hello World E2E Test

**Purpose:** Prove the full E2E loop works before building abstractions. One test that sends a prompt to the agent and confirms we get a response.

This test validates the entire chain: Playwright → Vite frontend → WS transport → Rust backend → Agent process → Response rendered in UI.

### What it does

1. Navigate to the app
2. Set up a dummy repo (or use the existing dev repo if one is configured)
3. Create a thread with a simple prompt ("Say hello")
4. Wait for an assistant message to appear in the message list
5. Assert the response contains text (not empty, not an error)

### Decisions made

- **Repo setup:** Uses whatever repo is already configured in dev (option a). Evolve to temp repo harness in Phase 2.
- **Thread creation:** Drives the UI — `Cmd+N` creates thread, `type()` into textarea, `Enter` submits. This tests the real user flow.
- **Agent response:** Skips gracefully via `test.skip(!process.env.ANTHROPIC_API_KEY)`. Backend availability checked in `beforeAll` via Node `net.createConnection`.

### What was built

- `e2e/lib/test-ids.ts` — barrel re-export
- `e2e/lib/wait-helpers.ts` — `waitForAppReady()`, `waitForWsReady()`, `invokeWsCommand()`
- `e2e/critical/hello-world.spec.ts` — 3 tests, all passing headless in ~8s

---

## Phase 2: E2E Helper Library (`e2e/lib/`)

### 2a. Re-export Test IDs (`e2e/lib/test-ids.ts`)

Barrel re-export so tests import from `e2e/lib/` instead of reaching into `src/`:

```ts
export { TEST_IDS } from '../../src/test/test-ids';
```

### 2b. Repo Harness (`e2e/lib/repo-harness.ts`)

Creates an isolated dummy git repository for each test (or test suite) so tests don't depend on local dev state.

```ts
export class RepoHarness {
  readonly repoPath: string;

  /** Create a temp directory, git init, add a dummy file, initial commit */
  static async create(): Promise<RepoHarness>;

  /** Register this repo with the app via WS commands */
  async register(page: Page): Promise<{ repoId: string; worktreeId: string }>;

  /** Clean up the temp directory */
  async cleanup(): Promise<void>;

  /** Add files to the repo for test scenarios */
  async addFile(relativePath: string, content: string): Promise<void>;

  /** Create a commit with all staged changes */
  async commit(message: string): Promise<void>;
}
```

Key behaviors:
- Uses `os.tmpdir()` + random suffix for isolation
- Runs `git init`, creates `README.md`, runs initial commit
- `register()` calls `validate_repository` via WS to register with the app
- `cleanup()` removes the temp dir in `afterAll`/`afterEach`

### 2c. Custom Playwright Fixtures (`e2e/lib/fixtures.ts`)

Extend Playwright's `test` with app-specific fixtures:

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

### 2d. Page Objects

Each page object wraps a logical UI area with typed methods:

**`app-page.ts`** — top-level app navigation:
- `goto()` — navigate to base URL
- `waitForReady()` — wait for main layout + WS connection
- `getTreeMenu()` → `TreeMenu`
- `getContentPane()` → `ContentPane`
- `isLoaded()` — boolean check
- `invokeWs(cmd, args)` — send a WS command from browser context (replaces standalone ws-client)

**`tree-menu.ts`** — sidebar navigation:
- `getThreads()` — list visible thread items
- `clickThread(id)` — click a thread item
- `getPlans()` — list visible plan items
- `clickPlan(id)` — click a plan item
- `getSectionHeaders()` — get section labels

**`thread-page.ts`** — thread interaction:
- `getMessages()` — list messages in thread
- `getMessageByTurn(n)` — specific message
- `getToolBlocks()` — list tool use blocks
- `waitForMessageCount(n)` — wait for N messages to render
- `typePrompt(text)` — type into thread input
- `submit()` — click submit or press Enter
- `waitForAssistantResponse()` — wait for assistant message to appear

**`content-pane.ts`** — content area:
- `getActivePanel()` — which panel is showing (file/terminal/thread)
- `waitForFileContent()` — wait for file viewer
- `waitForTerminal()` — wait for terminal render
- `getFileContent()` — text content of file viewer

### 2e. Wait Helpers (`e2e/lib/wait-helpers.ts`)

Common patterns:
- `waitForTestId(page, id, opts?)` — wait for element by test ID
- `waitForWsReady(page)` — wait for WS connection to be established
- `waitForNoSpinner(page)` — wait for loading state to clear
- `retryUntil(fn, opts?)` — generic retry with timeout

### Note on WS assertions

Rather than a standalone WS client class, WS commands are invoked via `page.evaluate()` through the `AppPage.invokeWs()` method. This keeps everything in the browser context (matching how the real app works) and avoids managing a separate Node.js WebSocket connection.

---

## Phase 3: Critical Tests (<30s)

These run on every commit. They verify the app is fundamentally functional.

### `critical/app-loads.spec.ts`
- App renders `main-layout` within 5s
- No console errors on load
- No uncaught exceptions

### `critical/ws-connectivity.spec.ts`
- WS connection established to `:9600`
- Can invoke `get_paths_info` and get valid response
- Can invoke `fs_list_directory` on working dir

### `critical/basic-navigation.spec.ts`
- Tree menu renders with at least one section
- Clicking a thread item loads content pane
- Content pane switches between thread/file/terminal views

**Total: ~6 assertions, <30s**

Migrate existing `smoke.spec.ts` and `thread-navigation.spec.ts` into these files.

---

## Phase 4: Core Workflow Tests (<2min)

These run on PR checks. They verify primary user workflows end-to-end.

### `core/thread-lifecycle.spec.ts`
- Thread list renders existing threads from disk
- Clicking thread shows message list
- Messages render with correct turn structure (user/assistant alternation)
- Tool blocks render with correct test IDs
- Scroll to bottom on thread load

### `core/file-browsing.spec.ts`
- Navigate to a file via WS `fs_read_file` command
- File content renders in content pane
- File path shows in header
- Syntax highlighting applied (code blocks have expected classes)

### `core/search.spec.ts`
- Search panel opens
- Type query into search input
- Results appear in search results area
- Clicking result navigates to file

### `core/terminal-render.spec.ts`
- Terminal panel renders
- Terminal output area is visible
- Terminal sessions list (if applicable) shows items

### `core/diff-viewer.spec.ts`
- Changes view renders diff file cards
- Diff file headers show file paths
- Expand/collapse diff sections works

**Total: ~20 assertions, <2min**

---

## Phase 5: Comprehensive Tests (<5min)

These run nightly or on manual trigger. Cover secondary workflows and edge cases.

### `comprehensive/settings.spec.ts`
- Settings panel opens from control panel
- About section shows version info
- Settings are persisted (change → reload → verify)

### `comprehensive/keyboard-navigation.spec.ts`
- Tab navigation moves focus through tree → content
- Arrow keys navigate tree items
- Enter opens selected item
- Hotkey shortcuts trigger correct actions

### `comprehensive/debug-panel.spec.ts`
- Debug panel opens
- Event list populates with agent events
- Clicking event shows detail view
- Memory guard / event count limits work

### `comprehensive/plan-viewer.spec.ts`
- Plan list renders from disk
- Clicking plan shows plan content
- Plan phases render with checkbox states
- Plan loading/error states render correctly

**Total: ~20 assertions, <5min**

---

## Phase 6: Playwright Config & Runner Scripts

### Updated `playwright.config.ts`

Add named projects:

```ts
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
```

### NPM Scripts (`package.json`)

```json
{
  "test:e2e": "playwright test",
  "test:e2e:critical": "playwright test --project=critical",
  "test:e2e:pr": "playwright test --project=critical --project=core",
  "test:e2e:full": "playwright test"
}
```

### Backend Startup

The WS server must be running for tests. Options:
1. **Manual** (current): `cargo run` in separate terminal
2. **Script** (recommended): Add `scripts/e2e-server.sh` that starts WS server, waits for ready, runs tests, then kills server
3. **Playwright globalSetup** (advanced): Start server in `globalSetup`, tear down in `globalTeardown`

Recommend option 2 for now, with option 3 as future enhancement.

---

## File Inventory

### New files to create:
- `e2e/lib/fixtures.ts` — custom Playwright fixtures
- `e2e/lib/app-page.ts` — AppPage page object
- `e2e/lib/thread-page.ts` — ThreadPage page object
- `e2e/lib/tree-menu.ts` — TreeMenu page object
- `e2e/lib/content-pane.ts` — ContentPane page object
- `e2e/lib/repo-harness.ts` — dummy repo setup/teardown
- `e2e/lib/wait-helpers.ts` — common wait utilities
- `e2e/lib/test-ids.ts` — re-export barrel
- `e2e/critical/hello-world.spec.ts` (Phase 1)
- `e2e/critical/app-loads.spec.ts`
- `e2e/critical/ws-connectivity.spec.ts`
- `e2e/critical/basic-navigation.spec.ts`
- `e2e/core/thread-lifecycle.spec.ts`
- `e2e/core/file-browsing.spec.ts`
- `e2e/core/search.spec.ts`
- `e2e/core/terminal-render.spec.ts`
- `e2e/core/diff-viewer.spec.ts`
- `e2e/comprehensive/settings.spec.ts`
- `e2e/comprehensive/keyboard-navigation.spec.ts`
- `e2e/comprehensive/debug-panel.spec.ts`
- `e2e/comprehensive/plan-viewer.spec.ts`
- `scripts/e2e-server.sh` — backend start + test runner

### Existing files to modify:
- `playwright.config.ts` — add named projects
- `package.json` — add e2e npm scripts
- `e2e/smoke.spec.ts` → move to `e2e/critical/`
- `e2e/thread-navigation.spec.ts` → move to `e2e/critical/`

### Already done (no changes needed):
- `src/test/test-ids.ts` — 180+ test IDs already defined
- Component `data-testid` attributes — already applied

---

## Priority Order

If time is limited, implement in this order:
1. **Hello world test** (Phase 1) — proves the approach works end-to-end
2. **Helper library** (Phase 2) — unlocks clean test writing
3. **Critical tests** (Phase 3) — immediate value, fast feedback
4. **Core tests** (Phase 4) — primary workflow coverage
5. **Config/scripts** (Phase 6) — ergonomics
6. **Comprehensive tests** (Phase 5) — completeness
