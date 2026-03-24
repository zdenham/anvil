# Sub-Plan 3: Full Command Coverage + Playwright E2E + Cleanup

**Prerequisite:** [frontend-transport.md](./frontend-transport.md) — transport wrappers in place, app works in Chrome with proof-of-concept commands
**Delivers:** All ~93 data commands routed through WS, Playwright running real E2E tests, `anvil-test` deleted

## Context

After sub-plans 1 and 2, the WS server handles ~10 commands and the frontend routes through the transport layer. This plan completes the coverage: all ~83 remaining data commands get WS handlers, Playwright connects to the real backend, and the unused `anvil-test` binary is removed.

## Phases

- [x] Route remaining stateless commands by domain (filesystem, git, threads, worktrees, etc.)
- [x] Route remaining stateful commands (terminals, file watcher, profiling, diagnostics)
- [x] Add WS push events for server-initiated messages (agent, terminal, file watcher)
- [x] Playwright spike: install, configure, verify basic navigation against Vite + WS
- [x] Delete `anvil-test` binary and references
- [x] First real E2E test: thread list loads, select thread, content pane renders

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1: Remaining Stateless Commands

This is the largest phase by line count but the most mechanical — each command is a thin dispatch entry calling the extracted function.

### Commands by domain

**Filesystem (remaining ~8):**
`fs_write_file`, `fs_mkdir`, `fs_remove`, `fs_remove_dir_all`, `fs_move`, `fs_copy_file`, `fs_copy_directory`, `fs_is_git_repo`

Already extracted pattern from ws-server.md phase 2. Same approach.

**Git (remaining ~22):**
`git_fetch`, `git_get_default_branch`, `git_get_branch_commit`, `git_create_branch`, `git_checkout_branch`, `git_checkout_commit`, `git_delete_branch`, `git_branch_exists`, `git_create_worktree`, `git_remove_worktree`, `git_list_worktrees`, `git_ls_files`, `git_ls_files_untracked`, `git_get_head_commit`, `git_diff_files`, `git_get_branch_commits`, `git_diff_commit`, `git_diff_range`, `git_get_merge_base`, `git_get_remote_branch_commit`, `git_show_file`, `git_grep`, `git_rm`

All async, all stateless. The dispatch entries just deserialize args and call the function.

**Anvil commands (remaining ~4):**
`fs_get_repo_dir`, `fs_get_repo_source_path`, `fs_get_home_dir`, `fs_list_dir_names`, `get_agent_types`

**Other stateless (~6):**
`initialize_shell_environment`, `is_shell_initialized`, `check_documents_access`, `get_shell_path`, `run_internal_update`, `get_buffered_logs`, `clear_logs`, `kill_process`, `write_memory_snapshot`, `get_process_memory`, `worktree_create`, `worktree_delete`, `worktree_rename`, `worktree_touch`, `worktree_sync`, `remove_repository_data`

### Implementation approach

The dispatch function will grow large (~93 arms). Organize by extracting domain-specific dispatch modules:

```rust
// ws_server.rs
async fn dispatch(cmd: &str, args: Value, state: &WsState) -> Result<Value, String> {
    match cmd {
        c if c.starts_with("fs_") => dispatch_filesystem(c, args).await,
        c if c.starts_with("git_") => dispatch_git(c, args).await,
        c if c.starts_with("worktree_") => dispatch_worktree(c, args).await,
        c if c.starts_with("lock_") => dispatch_lock(c, args, state).await,
        // ... other prefixes
        _ => Err(format!("unknown command: {cmd}")),
    }
}
```

Each `dispatch_*` function lives in the respective module or in a new `ws_dispatch.rs` file.

### Verification

After this phase, test every domain with websocat. A script to exercise all commands:

```bash
# Test filesystem
echo '{"id":1,"cmd":"fs_write_file","args":{"path":"/tmp/ws-test.txt","contents":"hello"}}' | websocat ws://127.0.0.1:9600
echo '{"id":2,"cmd":"fs_read_file","args":{"path":"/tmp/ws-test.txt"}}' | websocat ws://127.0.0.1:9600
echo '{"id":3,"cmd":"fs_remove","args":{"path":"/tmp/ws-test.txt"}}' | websocat ws://127.0.0.1:9600

# Test git
echo '{"id":4,"cmd":"git_list_anvil_branches","args":{"repo_path":"."}}' | websocat ws://127.0.0.1:9600
```

## Phase 2: Remaining Stateful Commands

### Terminal commands (5 remaining)
`spawn_terminal`, `write_terminal`, `resize_terminal`, `kill_terminal`, `kill_terminals_by_cwd`

These need both `TerminalState` and `AppHandle` (for emitting `terminal:output` events). In WS context, the AppHandle is replaced by WS push messages — phase 3 handles the event emission side.

For now, extract the core logic from each terminal command into a function that accepts a callback for event emission instead of AppHandle:

```rust
// terminal.rs
pub fn spawn(
    manager: &mut TerminalManager,
    cols: u16, rows: u16, cwd: &str,
    on_output: impl Fn(u32, &str) + Send + 'static,
    on_exit: impl Fn(u32) + Send + 'static,
) -> Result<u32, String> { /* ... */ }
```

The Tauri command passes `app.emit(...)` as the callback. The WS handler passes a closure that sends a WS push message.

### File watcher commands (3)
`start_watch`, `stop_watch`, `list_watches`

Same pattern — `start_watch` needs event emission for file change notifications. Extract with callback.

### Profiling commands (2 stateful)
`capture_cpu_profile`, `start_trace`

These use `ProfilingState`. Add `Arc<Mutex<ProfilingState>>` to `WsState`.

### Agent hub commands (already done in ws-server.md phase 3)
`send_to_agent`, `list_connected_agents`, `get_agent_socket_path`

### Diagnostics
`update_diagnostic_config` — needs `DiagnosticConfigState`, already accessible via AgentHub.

### WsState final shape

```rust
pub struct WsState {
    pub lock_manager: Arc<LockManager>,
    pub terminal_state: TerminalState,
    pub agent_hub: Arc<AgentHub>,
    pub file_watcher_state: FileWatcherState,
    pub profiling_state: Arc<Mutex<ProfilingState>>,
    pub diagnostic_config: DiagnosticConfigState,
    // For push events — list of connected WS clients
    pub clients: Arc<RwLock<Vec<WsClient>>>,
}
```

## Phase 3: WS Push Events

Server-initiated messages for events that currently go through Tauri's `app.emit()`.

### Event types to push

| Event | Source | Payload |
|-------|--------|---------|
| `agent:message` | AgentHub unix socket | Thread ID + message JSON |
| `terminal:output` | PTY read loop | Terminal ID + output string |
| `terminal:exit` | PTY exit | Terminal ID + exit code |
| `file-watcher:changed` | notify crate | Watch ID + paths |

### WS push message format

```json
{
  "event": "terminal:output",
  "payload": { "id": 1, "data": "$ ls\nfoo bar\n" }
}
```

No `id` field (no request to respond to). The frontend's `events.ts` wrapper dispatches these to registered listeners.

### Implementation

Maintain a list of connected WS clients (`Arc<RwLock<Vec<Sender>>>`). When an event fires:
1. AgentHub/TerminalManager/FileWatcher calls a shared `broadcast_event(event, payload)` function
2. That function serializes and sends to all connected WS clients
3. Disconnected clients are cleaned up on send failure

### Tauri event compatibility

The `app.emit()` calls in Tauri command handlers remain — they serve the WebView. The WS push is an additional path for browser clients. Both fire from the same source (callback pattern from phase 2).

## Phase 4: Playwright Spike

### Install

```bash
pnpm add -D @playwright/test
npx playwright install chromium  # only need Chromium for dev
```

### Configuration

```typescript
// playwright.config.ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: `http://localhost:${process.env.ANVIL_VITE_PORT ?? 1420}`,
    headless: true,
  },
  webServer: {
    command: 'ANVIL_DATA_DIR=/tmp/anvil-e2e pnpm dev',
    port: parseInt(process.env.ANVIL_VITE_PORT ?? '1420'),
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
```

### Spike test

```typescript
// e2e/smoke.spec.ts
import { test, expect } from '@playwright/test';

test('app loads in browser', async ({ page }) => {
  await page.goto('/');
  // App should render without Tauri — verify no crash
  await expect(page.locator('body')).toBeVisible();
});

test('ws transport connects', async ({ page }) => {
  await page.goto('/');
  // Check that WS connection is established
  const wsConnected = await page.evaluate(() => {
    return new Promise<boolean>((resolve) => {
      const ws = new WebSocket('ws://127.0.0.1:9600');
      ws.onopen = () => { ws.close(); resolve(true); };
      ws.onerror = () => resolve(false);
    });
  });
  expect(wsConnected).toBe(true);
});
```

### Verification

```bash
npx playwright test e2e/smoke.spec.ts --headed  # visual confirmation
npx playwright test e2e/smoke.spec.ts            # headless CI mode
```

## Phase 5: Delete `anvil-test`

Remove the unused native test binary and its references.

### Files to delete
- `src-tauri/src/bin/anvil-test/` — entire directory

### Files to update
- `docs/testing.md` — remove references to anvil-test
- `src-tauri/Cargo.toml` — remove `[[bin]]` target for anvil-test (if present)
- Any CI config that builds or runs anvil-test

### Verification
- `cargo build` succeeds without anvil-test
- `pnpm dev` still works
- No references to "anvil-test" or "anvil_test" remain in the codebase (grep check)

## Phase 6: First Real E2E Test

### Test: Thread list → select thread → content renders

```typescript
// e2e/thread-navigation.spec.ts
import { test, expect } from '@playwright/test';
import { setupTestRepo } from './helpers/test-repo';

test.beforeAll(async () => {
  // Create a test repository with a known thread
  await setupTestRepo('/tmp/anvil-e2e/repos/test-repo');
});

test('thread list loads and thread selection renders content', async ({ page }) => {
  await page.goto('/');

  // Wait for the app to initialize and load repositories
  const threadList = page.locator('[data-testid="thread-list"]');
  await expect(threadList).toBeVisible({ timeout: 10_000 });

  // At least one thread should appear
  const firstThread = threadList.locator('[data-testid="thread-item"]').first();
  await expect(firstThread).toBeVisible();

  // Click the thread
  await firstThread.click();

  // Content pane should render with thread content
  const contentPane = page.locator('[data-testid="content-pane"]');
  await expect(contentPane).toBeVisible();

  // Verify some content loaded (message list, not empty state)
  const messageList = contentPane.locator('[data-testid="message-list"]');
  await expect(messageList).toBeVisible();
});
```

### Test data setup

Create a helper that:
1. Creates a git repo at the test path
2. Writes a minimal thread JSON file in the expected format
3. The app discovers it via `validate_repository` / `get_paths_info`

### Data test IDs

The E2E tests rely on `data-testid` attributes. Add them sparingly to key navigation elements:
- `thread-list` on the thread list container
- `thread-item` on each thread entry
- `content-pane` on the content pane
- `message-list` on the message list

These are stable selectors that won't break with styling changes.

## Risks

| Risk | Mitigation |
|------|-----------|
| ~83 command extractions is a lot of mechanical Rust | Organize by domain, test each domain independently. Consider generating dispatch entries from a macro or build script if the boilerplate is excessive. |
| Terminal event emission pattern change is non-trivial | The callback extraction in phase 2 is the riskiest change. Test terminal spawn/output thoroughly before and after. |
| Playwright startup timing | Use `webServer` config with port wait. Add generous timeouts for initial load. |
| Test data isolation | Use `ANVIL_DATA_DIR=/tmp/anvil-e2e` to isolate from real user data. Clean up in `beforeAll`/`afterAll`. |
| `anvil-test` deletion breaks something | Grep for all references before deleting. It's described as unmaintained — unlikely to have hidden dependents. |

## Output

After this plan completes:
- **All ~93 data commands** are routable over WebSocket
- **Server push events** work for agent messages, terminal output, and file changes
- **Playwright** can run E2E tests against the real Rust backend via Chrome
- **`anvil-test`** is deleted
- **One real E2E test** validates the end-to-end flow: app loads → threads list → content renders
