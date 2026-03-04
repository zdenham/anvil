# Subplan D: Core Workflow Tests (<2min)

**Wave:** 3 (depends on B: Page Objects & Fixtures)
**Outputs:** `e2e/core/thread-lifecycle.spec.ts`, `e2e/core/file-browsing.spec.ts`, `e2e/core/search.spec.ts`, `e2e/core/terminal-render.spec.ts`, `e2e/core/diff-viewer.spec.ts`

## Phases

- [x] Write `thread-lifecycle.spec.ts`
- [x] Write `file-browsing.spec.ts`
- [x] Write `search.spec.ts`
- [x] Write `terminal-render.spec.ts`
- [x] Write `diff-viewer.spec.ts`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

All specs import `{ test, expect }` from `../lib/fixtures` and use the `app` fixture.
All include the backend-reachability skip guard.
Create `e2e/core/` directory.

## `core/thread-lifecycle.spec.ts`

Tests the primary thread reading workflow (no live agent needed).

```
test('thread list renders existing threads from disk')
  → app.treeMenu().getThreads() count ≥ 1 (skip if no threads on disk)

test('clicking thread shows message list')
  → click first thread
  → app.threadPage().getMessages() visible

test('messages render with correct turn structure')
  → user-message-0, assistant-message-1 pattern
  → alternating user/assistant

test('tool blocks render with correct test IDs')
  → app.threadPage().getToolBlocks() count ≥ 0
  → if present, check data-testid matches tool-use-* pattern
```

## `core/file-browsing.spec.ts`

Tests file viewing via WS commands.

```
test('can read a file via WS and see content in pane')
  → app.invokeWs('fs_read_file', { path: '<known file>' })
  → or navigate to file through UI
  → app.contentPane().waitForFileContent()

test('file path shows in breadcrumb')
  → app.contentPane().getBreadcrumb() contains file name

test('file content is non-empty')
  → app.contentPane().getFileContent() length > 0
```

Note: May need to use WS `fs_read_file` to load a file, or click a file reference in a thread. Use whichever path exists in the UI.

## `core/search.spec.ts`

Tests the search panel.

```
test('search panel opens')
  → keyboard shortcut or click to open search
  → page.locator(TEST_IDS.searchPanel) visible

test('typing query shows results')
  → focus search input, type a known term (e.g., "import")
  → wait for search-results to have children

test('clicking result navigates to file')
  → click first search result
  → content pane shows file content
```

Test ID references: `searchPanel`, `searchInput`, `searchResults`, `searchResult(n)`, `fileContent`

## `core/terminal-render.spec.ts`

Tests terminal panel rendering.

```
test('terminal panel renders when terminal is selected')
  → click a terminal item (if any exist) or trigger terminal view
  → app.contentPane().waitForTerminal()
  → terminal-content is visible

test('terminal content area has expected structure')
  → terminal-content contains expected child elements
```

Test ID references: `terminalContent`, `terminalItem(id)`

## `core/diff-viewer.spec.ts`

Tests the changes/diff view.

```
test('changes view renders')
  → navigate to changes view (uncommitted item or tab)
  → page.locator(TEST_IDS.changesView) visible

test('diff file cards show file paths')
  → diff-file-card elements exist
  → diff-file-header elements contain path text

test('diff sections can expand/collapse')
  → click a diff file header
  → verify content toggles
```

Test ID references: `changesView`, `changesDiffContent`, `diffFileCard(path)`, `diffFileHeader(path)`, `uncommittedItem`
