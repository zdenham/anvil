# Rename "Mort" to "Anvil"

Exhaustive rename of all references from mort/Mort/mortician/Mortician to anvil/Anvil equivalents across the entire codebase.

## Naming Convention Map

| Old | New | Where used |
| --- | --- | --- |
| `mort` | `anvil` | Package names, identifiers, env var prefixes, CLI binary |
| `Mort` | `Anvil` | UI display text, product name, Tauri config |
| `MORT` | `ANVIL` | Environment variable prefixes, build constants |
| `mort_lib` | `anvil_lib` | Rust library name |
| `mortician` | `anvil` | API package name, config dir, about text |
| `Mortician` | `Anvil` | Display text in about screen, onboarding |
| `@mort/*` | `@anvil/*` | npm scoped packages |
| `com.mort.app` | `com.anvil.app` | Tauri bundle identifier |
| `com.getmort.app.dev` | `com.getanvil.app.dev` | Tauri dev bundle identifier |
| `.mort` | `.anvil` | User data directory (\~/.mort → \~/.anvil) |
| `mort-repl` | `anvil-repl` | REPL command and event prefix |
| `mort-types` | `anvil-types` | SDK template types directory |
| `mort-server` | *(deferred — manual infra update)* | Infrastructure hostname ([Fly.io](http://Fly.io)) |

## Phases

- [x] Phase 1: Rust backend — Cargo.toml, src-tauri/src/\*.rs, paths, binary name

- [x] Phase 2: Tauri config — tauri.conf.json, tauri.conf.dev.json, bundle identifiers

- [x] Phase 3: Package names — all package.json files (@mort/\* → @anvil/\*)

- [x] Phase 4: Environment variables and build constants — MORT\_\* → ANVIL\_*, \_MORT*\_\_ → *ANVIL\**\_

- [x] Phase 5: Core library — core/lib/mort-dir.ts, core/types, core/sdk

- [x] Phase 6: Agents — mort-repl rename, imports, string constants, hooks

- [x] Phase 7: Frontend source — src/lib/, src/components/, src/stores/, src/entities/

- [x] Phase 8: Plugins — plugins/mort/ → plugins/anvil/, plugin.json

- [x] Phase 9: Scripts — [build-mort.sh](http://build-mort.sh), [dev-mort.sh](http://dev-mort.sh), env presets, [internal-build.sh](http://internal-build.sh)

- [ ] Phase 10: Documentation — docs/\*.md, [README.md](http://README.md)

- [ ] Phase 11: Plans and completed plans — rename references in plans/\*\*/\*.md

- [x] Phase 12: Test fixtures and mocks — test-mort-directory.ts, mock files, vitest config

- [x] Phase 13: File and directory renames — git mv for files/dirs with "mort" in the name

- [x] Phase 14: Data migration strategy — handle existing \~/.mort → \~/.anvil for users

- [x] Phase 15: Infrastructure references — add TODO comments to infra URLs (deferred for manual update)

- [x] Phase 16: Git branch convention — update mort/task-\* prefix references

- [ ] Phase 17: Verify build — ensure cargo build, pnpm build, and tests pass

- [ ] Phase 18: Update [CLAUDE.md](http://CLAUDE.md) and memory files

&lt;!-- IMPORTANT: Mark phases complete with \[x\] as you finish them. Update this file immediately after completing each phase - do not batch updates. --&gt;

---

## Phase 1: Rust Backend

**Files:**

- `src-tauri/Cargo.toml` — package name `mort` → `anvil`, lib name `mort_lib` → `anvil_lib`, default-run `mort` → `anvil`
- `src-tauri/src/paths.rs` — `.mort` directory name → `.anvil`, `mortician` config dir → `anvil`, function names like `ensure_mort_directories`
- `src-tauri/src/lib.rs` — `mort_lib::run()` → `anvil_lib::run()`, function references
- `src-tauri/src/main.rs` — `mort_lib` references
- `src-tauri/src/identity.rs` — `mort-server.fly.dev` URL → add `// TODO(anvil-rename): update when infra is migrated` comment, leave URL as-is
- `src-tauri/src/shell.rs` — `mort-installation-scripts` URL → add `// TODO(anvil-rename): update when infra is migrated` comment, leave URL as-is
- `src-tauri/src/logging/mod.rs`, `logging/config.rs` — `mortician` logging context
- `src-tauri/src/menu.rs` — `"Mort"` menu label → `"Anvil"`
- `src-tauri/src/tray.rs` — `"Mort"` tooltip → `"Anvil"`
- `src-tauri/src/icons.rs` — `/tmp/mortician` fallback path → `/tmp/anvil`

**Approach:** Search all `.rs` files for `mort`, `Mort`, `mortician`, `Mortician` and replace. Be careful with `mort_lib` → `anvil_lib` (snake_case convention).

## Phase 2: Tauri Config

**Files:**

- `src-tauri/tauri.conf.json`:
  - `"productName": "Mort"` → `"Anvil"`
  - `"identifier": "com.mort.app"` → `"com.anvil.app"`
  - Bundle resource paths referencing `plugins/mort/` → `plugins/anvil/`
  - Bundle resource paths referencing `mort-types` → `anvil-types`
- `src-tauri/tauri.conf.dev.json`:
  - `"productName": "Mort Dev"` → `"Anvil Dev"`
  - `"identifier": "com.getmort.app.dev"` → `"com.getanvil.app.dev"`

## Phase 3: Package Names

**Files (name field + any cross-references):**

- `/package.json` — `"name": "mort"` → `"name": "anvil"`
- `/agents/package.json` — `"name": "@mort/agents"` → `"name": "@anvil/agents"`
- `/sidecar/package.json` — `"name": "@mort/sidecar"` → `"name": "@anvil/sidecar"`
- `/migrations/package.json` — `"name": "@mort/migrations"` → `"name": "@anvil/migrations"`
- `/core/sdk/package.json` — `"name": "@mort/sdk-runner"` → `"name": "@anvil/sdk-runner"`
- `/api/package.json` — `"name": "mortician-api"` → `"name": "anvil-api"`

**Also update:**

- Any `dependencies` or `devDependencies` referencing `@mort/*` packages
- pnpm workspace references using `@mort/*`
- Import statements using `@mort/*` (these may be path aliases, not npm imports — check tsconfig)

## Phase 4: Environment Variables and Build Constants

**Env vars to rename (grep all source + scripts):**

- `MORT_APP_SUFFIX` → `ANVIL_APP_SUFFIX`
- `MORT_DATA_DIR` → `ANVIL_DATA_DIR`
- `MORT_CONFIG_DIR` → `ANVIL_CONFIG_DIR`
- `MORT_SKIP_MAIN_WINDOW` → `ANVIL_SKIP_MAIN_WINDOW`
- `MORT_DISABLE_HMR` → `ANVIL_DISABLE_HMR`
- `MORT_VITE_PORT` → `ANVIL_VITE_PORT`
- `MORT_SPOTLIGHT_HOTKEY` → `ANVIL_SPOTLIGHT_HOTKEY`
- `MORT_CLIPBOARD_HOTKEY` → `ANVIL_CLIPBOARD_HOTKEY`
- `MORT_TEMPLATE_DIR` → `ANVIL_TEMPLATE_DIR`
- `MORT_SDK_TYPES_PATH` → `ANVIL_SDK_TYPES_PATH`
- `MORT_WS_PORT` → `ANVIL_WS_PORT`

**Build constants:**

- `__MORT_APP_SUFFIX__` → `__ANVIL_APP_SUFFIX__`
- `__MORT_WS_PORT__` → `__ANVIL_WS_PORT__`

**Files:** vite.config.ts, vitest.config.\*.ts, env preset scripts, Rust [build.rs](http://build.rs) (if any), all .rs and .ts files referencing these.

## Phase 5: Core Library

**Files:**

- `core/lib/mort-dir.ts` → rename file to `anvil-dir.ts`, update `getMortDir()` → `getAnvilDir()` and all callers
- `core/types/skills.ts` — `'mort'` skill source → `'anvil'`
- `core/sdk/template/mort-types/` → rename directory to `anvil-types/`
- `core/sdk/__tests__/harness/mort-fixture.ts` → rename to `anvil-fixture.ts`
- Update all imports referencing these files

## Phase 6: Agents

**Directory renames:**

- `agents/src/lib/mort-repl/` → `agents/src/lib/anvil-repl/`

**File renames:**

- `agents/src/lib/mort-repl/mort-sdk.ts` → `agents/src/lib/anvil-repl/anvil-sdk.ts`
- `agents/src/testing/services/test-mort-directory.ts` → `test-anvil-directory.ts`
- `agents/src/experimental/__tests__/mort-repl.integration.test.ts` → `anvil-repl.integration.test.ts`
- `agents/dist/cli/mort.js` → `agents/dist/cli/anvil.js` (generated, but check entry point config)

**String constants:**

- `"mort-repl result:\n"` → `"anvil-repl result:\n"`
- `"mort-repl error:\n"` → `"anvil-repl error:\n"`
- `"mort-repl:child-spawn"` → `"anvil-repl:child-spawn"`
- REPL command pattern: `mort-repl` → `anvil-repl`

**Import paths:** Update all imports referencing `mort-repl`, `mort-sdk`, `test-mort-directory`.

## Phase 7: Frontend Source

**Key files (non-exhaustive — use grep):**

- `src/lib/agent-service.ts` — CLI path `"agents/dist/cli/mort.js"` → `"anvil.js"`
- `src/lib/mort-bootstrap.ts` → rename to `anvil-bootstrap.ts`, update function names and references
- `src/lib/filesystem-client.ts` — `getMortDir()` calls
- `src/lib/paths.ts` — `MORT_TYPES_DIR = 'mort-types'` → `'anvil-types'`
- `src/lib/quick-actions-init.ts` — same MORT_TYPES_DIR reference
- `src/lib/tauri-shims/api-app.ts` — `"mort-web"` → `"anvil-web"`
- `src/lib/triggers/handlers/skill-handler.ts` — `skill.source === 'mort'` → `'anvil'`, `/mort:` prefix → `/anvil:`
- `src/components/settings/quick-actions-settings.tsx` — display text `~/.mort/`
- `src/components/main-window/settings/skills-settings.tsx` — display text `~/.mort/skills/`, `Mort-specific`
- `src/components/main-window/settings/env-file-settings.tsx` — `.mort/.env`
- `src/components/main-window/settings/about-settings.tsx` — `"Mortician v{version}"` → `"Anvil v{version}"`
- `src/components/onboarding/steps/WelcomeStep.tsx` — `"Mortician"` → `"Anvil"`
- `src/components/spotlight/spotlight.tsx` — `"Mort"` filter, `"mort"` build package
- `src/components/thread/tool-blocks/` — REPL output parsing strings
- `src/entities/threads/listeners.ts` — `"mort-repl:child-spawn"`
- `src/stores/*/types.ts` — comments `~/.mort/ui/`
- `src/components/ui/resizable-panel.tsx` — comment `~/.mort/`
- `src/test/mocks/tauri-api.ts` — `MOCK_MORT_DIR`, branch filter `"mort/"`

**Approach:** `grep -ri "mort" src/` and update every occurrence. Most are straightforward string replacements.

## Phase 8: Plugins

- `git mv plugins/mort/ plugins/anvil/`
- Update `plugins/anvil/.claude-plugin/plugin.json`: name → `"anvil"`, author name → `"Anvil"`
- Update any references to `plugins/mort/` throughout codebase (tauri.conf.json bundle resources, agent code)

## Phase 9: Scripts

**File renames:**

- `scripts/build-mort.sh` → `scripts/build-anvil.sh`
- `scripts/dev-mort.sh` → `scripts/dev-anvil.sh`

**Content updates:**

- `scripts/env-presets/dev.sh` — all `MORT_*` env vars → `ANVIL_*`, `.mort-dev` → `.anvil-dev`
- `scripts/env-presets/*.json` — check for mort references
- `scripts/internal-build.sh` — references to [build-mort.sh](http://build-mort.sh), mort binary name
- Any other scripts in `scripts/` referencing mort

## Phase 10: Documentation

- `README.md` — title and all references
- `docs/data-models.md` — `~/.mort/` paths
- `docs/testing.md` — `.mort` test fixtures
- `docs/fly-redis.md` — `mort-redis` infrastructure references
- `docs/patterns/adapters.md` — example code with `mortDir`
- `docs/agents.md` — any mort references

## Phase 11: Plans

- All files in `plans/**/*.md` containing "mort" — bulk rename references
- Directory renames: `plans/mort-repl/` → `plans/anvil-repl/`, `plans/completed/mort-repl/` → `plans/completed/anvil-repl/`
- Files named `mort-*.md` → `anvil-*.md`

**Decision:** Full replacement — update both file/directory names AND content within historical plans to reference anvil.

## Phase 12: Test Fixtures and Mocks

- `agents/src/testing/services/test-mort-directory.ts` — rename file and class/function names
- `core/sdk/__tests__/harness/mort-fixture.ts` — rename
- `src/test/mocks/tauri-api.ts` — `MOCK_MORT_DIR` → `MOCK_ANVIL_DIR`, branch prefix `"mort/"` → `"anvil/"`
- `vitest.config.ui.ts` — `__MORT_APP_SUFFIX__` → `__ANVIL_APP_SUFFIX__`, `__MORT_WS_PORT__` → `__ANVIL_WS_PORT__`
- Any test files referencing `.mort` paths

## Phase 13: File and Directory Renames (git mv)

All renames should use `git mv` to preserve history. Order matters — rename leaf files before parent directories.

**Directories:**

1. `core/sdk/template/mort-types/` → `anvil-types/`
2. `agents/src/lib/mort-repl/` → `anvil-repl/`
3. `plugins/mort/` → `plugins/anvil/`
4. `plans/mort-repl/` → `plans/anvil-repl/` (if renaming plans)
5. `plans/completed/mort-repl/` → `plans/completed/anvil-repl/`
6. `plans/completed/mort-cli-fixes/` → `plans/completed/anvil-cli-fixes/`

**Files (non-exhaustive — generate full list with** `find . -name '*mort*'`**):**

1. `core/lib/mort-dir.ts` → `anvil-dir.ts`
2. `agents/src/lib/mort-repl/mort-sdk.ts` → (renamed with parent dir)
3. `agents/src/testing/services/test-mort-directory.ts` → `test-anvil-directory.ts`
4. `agents/src/experimental/__tests__/mort-repl.integration.test.ts` → `anvil-repl.integration.test.ts`
5. `core/sdk/__tests__/harness/mort-fixture.ts` → `anvil-fixture.ts`
6. `scripts/build-mort.sh` → `build-anvil.sh`
7. `scripts/dev-mort.sh` → `dev-anvil.sh`
8. `src/lib/mort-bootstrap.ts` → `anvil-bootstrap.ts`

## Phase 14: Data Migration Strategy

Existing users have data at `~/.mort/`. We need a migration path.

**Decision:** Copy migration. On first launch of "Anvil", copy `~/.mort` → `~/.anvil` if `~/.anvil` doesn't already exist. No symlinks.

**Implementation:**

- Check if `~/.anvil` exists → use it
- Else if `~/.mort` exists → recursively copy `~/.mort` → `~/.anvil` (leave `~/.mort` intact as a safety net)
- Else → create `~/.anvil` fresh

**Implementation location:** `src-tauri/src/paths.rs` or `src/lib/anvil-bootstrap.ts` (whichever runs first on startup).

**Note:** The old `~/.mort` directory is left in place — users can clean it up manually once they've confirmed everything works.

## Phase 15: Infrastructure References (Deferred — Manual Update Later)

These reference external services. **Do NOT change the URLs/names themselves** — only add TODO comments so they can be found and updated when infra is migrated.

**URLs/names to flag with** `// TODO(anvil-rename): update when infra is migrated`**:**

- `https://mort-server.fly.dev/identity` — in `src-tauri/src/identity.rs`
- `https://mort-server.fly.dev/logs` — in logging config
- `mort-installation-scripts` R2 bucket path — in `src-tauri/src/shell.rs`
- `mort-redis` [Fly.io](http://Fly.io) app — in docs/fly-redis.md
- `mort-builds` Wrangler R2 bucket — in wrangler config
- `.wrangler/state/v3/r2/mort-builds` — local wrangler state

**Action:** Add TODO comments only. The actual infra rename happens separately and manually.

## Phase 16: Git Branch Convention

- Update code that creates branches with `mort/task-*` prefix → `anvil/task-*`
- Update any code that filters/detects these branches (e.g., `b.startsWith("mort/")` → `b.startsWith("anvil/")`)
- Existing remote branches don't need renaming (they're historical)

## Phase 17: Verify Build

After all renames:

1. `pnpm install` — ensure workspace resolution works with new package names
2. `cd src-tauri && cargo build` — verify Rust compilation
3. `pnpm build` — verify TypeScript compilation
4. `cd agents && pnpm test` — run agent tests
5. `pnpm test` — run all tests
6. Fix any broken imports, missing references, or compilation errors

## Phase 18: Update [CLAUDE.md](http://CLAUDE.md) and Memory Files

- Update `CLAUDE.md` if it references mort-specific paths
- Update `~/.claude/projects/-Users-zac-Documents-juice-mort-mortician/memory/MEMORY.md` — this references mort throughout
- Update any memory files that reference mort-specific patterns

---

## Execution Notes

- **Do file content changes BEFORE file/directory renames** — this avoids broken imports during the transition
- **Use** `git mv` for all renames to preserve history
- **Commit in logical chunks** — one commit per phase or group of related phases
- **The top-level directory** (`mortician/`) and parent (`mort/`) are outside the repo — will be renamed manually by the user
- **pnpm lockfile** will need regeneration after package name changes
- Total estimated files to touch: \~100+ source files, \~20 config files, \~20 docs/plans