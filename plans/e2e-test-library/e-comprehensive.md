# Subplan E: Comprehensive Tests (<5min)

**Wave:** 3 (depends on B: Page Objects & Fixtures)
**Outputs:** `e2e/comprehensive/settings.spec.ts`, `e2e/comprehensive/keyboard-navigation.spec.ts`, `e2e/comprehensive/debug-panel.spec.ts`, `e2e/comprehensive/plan-viewer.spec.ts`

## Phases

- [x] Write `settings.spec.ts`
- [x] Write `keyboard-navigation.spec.ts`
- [x] Write `debug-panel.spec.ts`
- [x] Write `plan-viewer.spec.ts`

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

All specs import `{ test, expect }` from `../lib/fixtures` and use the `app` fixture.
All include the backend-reachability skip guard.
Create `e2e/comprehensive/` directory.

## `comprehensive/settings.spec.ts`

```
test('settings panel opens from tree menu button')
  → click settings-button in tree menu
  → page.locator(TEST_IDS.settingsView) visible

test('about section shows version info')
  → page.locator(TEST_IDS.aboutSettings) visible
  → contains version text

test('settings sections are navigable')
  → hotkeySettings, repositorySettings, skillsSettings visible
  → click between them
```

Test IDs: `settingsView`, `settingsSection(name)`, `hotkeySettings`, `repositorySettings`, `skillsSettings`, `aboutSettings`, `settingsButton`

## `comprehensive/keyboard-navigation.spec.ts`

```
test('Cmd+K opens command palette')
  → press Meta+k (or Ctrl+k)
  → page.locator(TEST_IDS.commandPalette) visible
  → command-palette-input is focused

test('arrow keys navigate command palette items')
  → type a query
  → press ArrowDown
  → verify focus/selection moves

test('Escape closes command palette')
  → open palette, press Escape
  → palette no longer visible

test('Cmd+N creates new thread')
  → press Meta+n
  → thread input appears and is focused
```

Test IDs: `commandPalette`, `commandPaletteInput`, `commandPaletteItem(n)`, `threadInput`

## `comprehensive/debug-panel.spec.ts`

```
test('debug panel opens')
  → trigger debug panel (may need keyboard shortcut or menu)
  → page.locator(TEST_IDS.debugPanel) visible

test('event list populates')
  → page.locator(TEST_IDS.eventList) visible
  → wait for at least one child element (or check empty state)

test('clicking event shows detail view')
  → if events exist, click first one
  → page.locator(TEST_IDS.eventDetail) visible
```

Test IDs: `debugPanel`, `eventList`, `eventDetail`, `networkDebugger`

## `comprehensive/plan-viewer.spec.ts`

```
test('plan list renders in tree menu')
  → app.treeMenu().getPlans() count ≥ 0
  → skip if no plans on disk

test('clicking plan shows plan content')
  → click first plan item
  → page.locator(TEST_IDS.planContentPane) visible

test('plan content shows phases')
  → plan-content element contains checkbox/list items

test('plan loading/error states render correctly')
  → verify plan-loading-state or plan-empty-state shows before content loads
  → or verify plan-not-found-state for invalid plan
```

Test IDs: `planItem(id)`, `planContentPane`, `planContent`, `planEmptyState`, `planLoadingState`, `planErrorState`, `planNotFoundState`
