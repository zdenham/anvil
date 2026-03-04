---
name: Repro & Debug
description: Iterate on bug hypotheses using Playwright repro scripts, structured logs, and source code analysis
user-invocable: true
argument-hint: "[bug description or investigation goal]"
---

# Repro & Debug

Investigate bugs by writing Playwright repro scripts, reading structured logs, and cross-referencing source code — iterate until you can explain the root cause.

## Goal

Iterate until you have a **concrete hypothesis** about what's going wrong and where. Use repro scripts, log analysis, and source code reading together — keep looping until the evidence points to a specific cause.

Your tools:
- **Repro scripts** (`e2e/debug/`) — exercise the suspected flow in a real browser
- **Structured logs** — see what the backend actually did during the repro
- **Source code** — cross-reference log output and test behavior against the implementation

Don't stop at "it fails" — dig into *why*. Clear logs, repro, read logs, read the relevant code, refine your script, repeat. When you can explain the root cause and point to the responsible code, you're done investigating.

## Log Operations

Log file: `~/.config/mortician-dev/logs/structured.jsonl` (JSONL format, recreated by Rust backend on next write)

```bash
# Clear logs (isolate relevant entries before reproducing)
rm -f ~/.config/mortician-dev/logs/structured.jsonl

# Read recent logs
tail -n 100 ~/.config/mortician-dev/logs/structured.jsonl | jq .

# Search by level
cat ~/.config/mortician-dev/logs/structured.jsonl | jq 'select(.level == "ERROR")'

# Search by message pattern
grep "pattern" ~/.config/mortician-dev/logs/structured.jsonl | jq .

# Search by component/target
cat ~/.config/mortician-dev/logs/structured.jsonl | jq 'select(.target | test("hub"))'

# Time-windowed (timestamps are ISO 8601, e.g. 2026-03-03T12:00:00Z)
cat ~/.config/mortician-dev/logs/structured.jsonl | jq 'select(.timestamp > "2026-03-03T12:00:00")'
```

## Writing Repro Scripts

Output directory: `e2e/debug/` (gitignored). Prerequisites: dev server running (`pnpm dev`).

```typescript
// e2e/debug/repro-<name>.spec.ts
import { test } from '../lib/fixtures';

test('repro: <description>', async ({ app }) => {
  await app.goto();
  await app.waitForReady();

  // Your reproduction steps here
});
```

Run with: `npx playwright test e2e/debug/repro-<name>.spec.ts --project=critical`

## Reference Files

Read these files for API details as needed:

| What | File |
|------|------|
| Page objects & fixtures | `e2e/lib/fixtures.ts` |
| AppPage | `e2e/lib/app-page.ts` |
| TreeMenu | `e2e/lib/tree-menu.ts` |
| ThreadPage | `e2e/lib/thread-page.ts` |
| ContentPane | `e2e/lib/content-pane.ts` |
| RepoHarness | `e2e/lib/repo-harness.ts` |
| Wait helpers | `e2e/lib/wait-helpers.ts` |
| TEST_IDS (source of truth) | `src/test/test-ids.ts` |
| Existing E2E tests (examples) | `e2e/*.spec.ts` |
| Visual jank debugging | `.claude/skills/repro-debug/visual-jank.md` |
| HTML snapshots | `.claude/skills/repro-debug/html-snapshots.md` |

## Adding Debug Logs to Source Code

Use the centralized logger — **never `console.log`**:

```typescript
import { logger } from "@/lib/logger-client";

logger.log("debug: value is", someValue);
```

You may add temporary `logger.*` calls anywhere, including the render path, to trace behavior during a debugging session. **But you must remove all debug logging before finishing.** Do not leave debug logs in production code.

**Cleanup checklist** (do this before closing out any investigation):
1. Remove all `logger.*` calls you added during the session
2. Delete any ad-hoc repro scripts from `e2e/debug/` that are no longer needed
3. Clear the structured log file: `rm -f ~/.config/mortician-dev/logs/structured.jsonl`
4. Run `git diff` to verify no debug logging remains in staged changes

## Script Patterns

**Navigate and inspect:**
```typescript
test('repro: inspect thread', async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  const tree = app.treeMenu();
  const threads = await tree.getThreads();
  await tree.clickThread(threads[0].id);
  const thread = app.threadPage();
  const messages = await thread.getMessages();
  console.log('Messages:', messages);
});
```

**Trigger a flow and assert:**
```typescript
test('repro: send message', async ({ app, repo }) => {
  await app.goto();
  await app.waitForReady();
  const thread = app.threadPage();
  await thread.typePrompt('test input');
  await thread.submit();
  await thread.waitForAssistantResponse();
  const messages = await thread.getMessages();
  // Log evidence (repro scripts are gitignored, console.log is fine here)
  console.log('Messages:', messages);
});
```

**WS command probe:**
```typescript
import { invokeWsCommand } from '../lib/wait-helpers';

test('repro: ws probe', async ({ app }) => {
  await app.goto();
  await app.waitForReady();
  const result = await invokeWsCommand(app.page, 'some_command', { arg: 'value' });
  console.log('Result:', result);
});
```
