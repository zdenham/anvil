# Remove All `mort` / `mortician` References

Going forward we only use `anvil`. Remove all legacy `mort` references, delete stale files, and redact hardcoded personal paths.

## Phases

- [x] Remove migration code from `src-tauri/src/paths.rs`
- [x] Update stale accessibility reference trees
- [x] Delete `presentation.html`
- [x] Regenerate `agents/package-lock.json`
- [x] Redact hardcoded paths in test fixtures
- [x] Clean up `example-events.json`
- [x] Redact path in `src/adapters/tauri-fs-adapter.ts` comment

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Phase 1 — Remove migration code from `src-tauri/src/paths.rs` ✓

Deleted `migrate_legacy_data_dir()` and `copy_dir_recursive()` and the call site in `initialize()`.

## Phase 2 — Update accessibility reference trees ✓

Replaced `.mort-dev` → `.anvil-dev` in the three reference tree snapshot files.

## Phase 3 — Delete `presentation.html`

Delete `presentation.html` from the repo root. It contains old architecture slides with `~/.mort/` references and is not part of the product.

## Phase 4 — Regenerate `agents/package-lock.json`

`agents/package.json` already uses `@anvil/agents`, but the lockfile still says `@mort/agents` on lines 2 and 8. Run `pnpm install --lockfile-only` in `agents/` to regenerate it.

## Phase 5 — Redact hardcoded paths in test fixtures

Replace `/Users/zac/...` paths with generic placeholders in these test files:

| File | What to change |
|---|---|
| `src/components/control-panel/plan-and-changes-tabs.ui.test.tsx` | Replace `/Users/zac/Documents/juice/mort/mortician/` → `/Users/test/project/` (5 occurrences). This also removes the `mort/mortician` reference. |
| `src/components/thread/tool-state.ui.test.tsx` | Replace `/Users/zac/Documents/README.md` → `/Users/test/Documents/README.md` |
| `src/lib/__tests__/image-paths.test.ts` | Replace `/Users/zac/Desktop/...` → `/Users/test/Desktop/...` |
| `agents/src/lib/__tests__/permission-evaluator.test.ts` | Replace `/Users/zac/project` → `/Users/test/project` (throughout) |

Run the affected test suites after to confirm nothing breaks.

## Phase 6 — Clean up `example-events.json`

This file has extensive `/Users/zac/Documents/juice/mort/mortician/` paths and `mort-logo.tsx` references throughout. Two options:

- **Option A (recommended)**: Delete the file if it's only used as a development reference / sample data and isn't imported by any code.
- **Option B**: If it's imported somewhere, do a bulk find-replace of `/Users/zac/Documents/juice/mort/mortician/` → `/Users/test/project/` and `mort-logo` → `anvil-logo`.

Check for imports before deciding: `grep -r "example-events" src/ agents/`.

## Phase 7 — Redact path in `src/adapters/tauri-fs-adapter.ts` comment

Line 8 has a doc comment example: `e.g., /Users/zac/.claude/skills`. Change to `e.g., /Users/<user>/.claude/skills` or just `e.g., ~/.claude/skills`.
