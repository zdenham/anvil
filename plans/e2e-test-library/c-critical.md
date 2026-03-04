# Subplan C: Critical Tests (<30s)

**Wave:** 3 (depends on B: Page Objects & Fixtures)
**Outputs:** `e2e/critical/app-loads.spec.ts`, `e2e/critical/ws-connectivity.spec.ts`, `e2e/critical/basic-navigation.spec.ts`

## Phases

- [x] Migrate `smoke.spec.ts` and `thread-navigation.spec.ts` into the critical/ specs
- [x] Write `app-loads.spec.ts`
- [x] Write `ws-connectivity.spec.ts`
- [x] Write `basic-navigation.spec.ts`
- [x] Delete old `e2e/smoke.spec.ts` and `e2e/thread-navigation.spec.ts`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

All specs import `{ test, expect }` from `../lib/fixtures` and use the `app` fixture.
All include the backend-reachability skip guard in `beforeAll`.

## `critical/app-loads.spec.ts`

Migrates tests from `smoke.spec.ts` + `hello-world.spec.ts` (the non-agent ones).

```
test('app renders main-layout within 5s')
  → app fixture handles goto + waitForReady
  → assert main-layout visible

test('no console errors on load')
  → page.on('console', ...) capture errors before goto
  → assert no 'error' level console messages

test('no uncaught exceptions')
  → page.on('pageerror', ...) capture before goto
  → assert no page errors
```

## `critical/ws-connectivity.spec.ts`

Migrates from `smoke.spec.ts` WS tests.

```
test('WS connection established to :9600')
  → app.invokeWs round-trip or waitForWsReady

test('can invoke get_paths_info and get valid response')
  → app.invokeWs('get_paths_info', {})
  → assert result is object

test('can invoke fs_list_directory on working dir')
  → app.invokeWs('fs_list_directory', { path: '.' })
  → assert result contains entries
```

## `critical/basic-navigation.spec.ts`

Migrates from `thread-navigation.spec.ts`.

```
test('tree menu renders with at least one section')
  → app.treeMenu().isVisible()
  → app.treeMenu().getSectionHeaders() count > 0

test('clicking a thread item loads content pane')
  → find first thread, click it
  → app.contentPane().isVisible()
  → content pane shows message-list

test('content pane switches between views')
  → click thread → verify thread view
  → click terminal (if available) → verify terminal view
  → or just verify content-pane re-renders on navigation
```

## Migration notes

- `e2e/smoke.spec.ts` (3 tests) → split between `app-loads` and `ws-connectivity`
- `e2e/thread-navigation.spec.ts` (4 tests) → all move to `basic-navigation`
- `e2e/critical/hello-world.spec.ts` — keep as-is (it's the live agent test, separate concern)
- After migration, delete the old files at the e2e root
