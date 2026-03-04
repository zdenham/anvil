# Repro & Debug Skill

Create a project-scoped Claude Code skill (`.claude/skills/repro-debug/`) that guides Claude through reproducing bugs and gathering evidence for plans — via structured log analysis and ad-hoc Playwright scripts.

## Context

We already have:
- **`/debug` skill** — dev server management, test runners, log tailing
- **`/query-clickhouse` skill** — remote ClickHouse log queries
- **Full E2E infrastructure** — page objects (`AppPage`, `TreeMenu`, `ThreadPage`, `ContentPane`), fixtures, `TEST_IDS`, `RepoHarness`, `wait-helpers`

This new skill fills the gap: **on-demand reproduction scripts** that an agent writes, runs, and uses as evidence when investigating bugs.

## Deliverables

### 1. `SKILL.md` — the main skill file

Frontmatter:
```yaml
name: Repro & Debug
description: Reproduce bugs with Playwright scripts and analyze structured logs to gather evidence for plans
user-invocable: true
argument-hint: "[bug description or investigation goal]"
allowed-tools: Bash, Read, Write, Glob, Grep, Edit
```

Sections to write:

#### Log Operations
- **Log location**: `~/.config/mortician-dev/logs/structured.jsonl`
- **Clear logs**: `rm -f ~/.config/mortician-dev/logs/structured.jsonl` (just delete the file; Rust backend recreates it on next write)
- **Read recent logs**: `tail -n 100 ~/.config/mortician-dev/logs/structured.jsonl | jq .`
- **Search by level**: `cat ~/.config/mortician-dev/logs/structured.jsonl | jq 'select(.level == "ERROR")'`
- **Search by message pattern**: `grep "pattern" ~/.config/mortician-dev/logs/structured.jsonl | jq .`
- **Search by component/target**: `cat ... | jq 'select(.target | test("hub"))'`
- **Time-windowed search**: explain the timestamp field format, show jq filter for "last N minutes"
- **Workflow tip**: Clear logs → reproduce the bug → read logs. This isolates the relevant entries.

#### Writing Playwright Repro Scripts
- **Output directory**: `e2e/debug/` (gitignored, ad-hoc scripts live here)
- **Template** with boilerplate: imports from `../lib/fixtures`, backend-reachable guard, basic structure
- **Running a script**: `npx playwright test e2e/debug/<script>.spec.ts --project=critical`
- **Prerequisites**: dev server + WS backend must be running (`pnpm dev`)

#### Available Page Objects & Helpers (reference card)

A compact reference table covering:

| Class | Import | Key Methods |
|-------|--------|-------------|
| `AppPage` | `e2e/lib/app-page.ts` | `goto()`, `waitForReady()`, `treeMenu()`, `threadPage()`, `contentPane()`, `pressKeys()`, `invokeWs()` |
| `TreeMenu` | `e2e/lib/tree-menu.ts` | `getThreads()`, `clickThread(id)`, `getPlans()`, `clickPlan(id)`, `getTerminals()`, `getSectionHeaders()` |
| `ThreadPage` | `e2e/lib/thread-page.ts` | `getMessages()`, `typePrompt(text)`, `submit()`, `waitForAssistantResponse()`, `waitForMessageCount(n)` |
| `ContentPane` | `e2e/lib/content-pane.ts` | `getActivePanel()`, `waitForFileContent()`, `waitForTerminal()`, `getFileContent()`, `getBreadcrumb()` |
| `RepoHarness` | `e2e/lib/repo-harness.ts` | `create()`, `register(page)`, `addFile()`, `commit()`, `cleanup()` |

Helpers from `e2e/lib/wait-helpers.ts`:
- `waitForTestId(page, id)` — locator for `[data-testid="..."]`
- `waitForAppReady(page)` — waits for main layout + tree menu
- `invokeWsCommand(page, cmd, args)` — send a WS command and get result
- `retryUntil(fn, opts)` — retry with timeout

#### TEST_IDS Quick Reference

Include the full `TEST_IDS` constant inline (or a condensed version grouped by area) so Claude doesn't need to read the source file every time. Key groups:
- Layout: `mainLayout`, `contentPane`, `treeMenu`
- Tree: `threadItem(id)`, `planItem(id)`, `terminalItem(id)`, `logsButton`
- Thread: `messageList`, `assistantMessage(n)`, `userMessage(n)`, `threadInput`
- Content Pane: `fileContent`, `terminalContent`, `planContentPane`
- Debug Panel: `debugPanel`, `eventList`, `eventDetail`, `networkDebugger`
- Tools: `bashTool(id)`, `editTool(id)`, etc.
- Permissions: `permissionPrompt(id)`, `permissionApproveButton`, `permissionDenyButton`

#### Investigation Workflow

Step-by-step guide for Claude:
1. **Understand the bug** — read the plan or issue description
2. **Clear logs** → start fresh
3. **Write a repro script** in `e2e/debug/` that exercises the suspected flow
4. **Run it** — capture pass/fail + screenshots
5. **Read logs** — search for errors, warnings, or unexpected patterns during the repro window
6. **Collect evidence** — screenshots, log excerpts, test output
7. **Update the plan** with findings

#### Script Patterns (cookbook)

A few ready-to-adapt examples:
- **Navigate and screenshot**: open app, navigate to a thread, take screenshot
- **Trigger a flow and assert state**: type a prompt, submit, wait for response, assert content
- **WS command probe**: invoke a WS command and log the result
- **Debug panel inspection**: open debug panel, read events/network

### 2. Gitignore entry

Add `e2e/debug/` to `.gitignore` so ad-hoc repro scripts don't pollute the repo.

### 3. Future (not in this PR)

Placeholders for later:
- **Profiler flows** — instructions for running perf profiles and reading flame graphs
- **Debug panel automation** — scripted interaction with Logs/FPS/Events/Network tabs
- **Screenshot diffing** — visual regression via Playwright's `toHaveScreenshot()`

## Phases

- [x] Write `SKILL.md` with all sections described above
- [x] Add `e2e/debug/` to `.gitignore`
- [x] Add a starter template file `e2e/debug/.gitkeep` or example script

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Notes

- This is almost entirely copywriting — the infrastructure (page objects, fixtures, test IDs) already exists
- The skill should be self-contained: Claude should rarely need to read source files when using it
- Keep the TEST_IDS reference current by including a note about where the source of truth lives (`src/test/test-ids.ts`)
