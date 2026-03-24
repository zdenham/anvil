# Rename Mort to Anvil — Breadcrumb Task

## Objective

Exhaustively rename all references from mort/Mort/mortician/Mortician to anvil/Anvil equivalents across the entire codebase, following the plan at `plans/rename-mort-to-anvil.md`.

## Acceptance Criteria

1. All 18 phases in `plans/rename-mort-to-anvil.md` are marked complete
2. No remaining references to `mort`/`Mort`/`mortician`/`Mortician` in source code (except infrastructure URLs which get TODO comments, and the top-level directory name which is user-managed)
3. `cargo build` succeeds in `src-tauri/`
4. `pnpm build` succeeds
5. Tests pass (`pnpm test`, `cd agents && pnpm test`)
6. All file/directory renames use `git mv` to preserve history

## Context

- This is a Tauri desktop app + Node.js agents + Claude Agent SDK
- The plan has 18 phases, ordered so content changes happen before file renames
- Infrastructure URLs (fly.dev, R2 buckets) should NOT be changed — only get TODO comments
- The top-level directory (`mortician/`, `mort/`) is outside the repo and renamed manually by the user
- See `plans/rename-mort-to-anvil.md` for the full phase-by-phase breakdown with specific files and naming conventions

## Naming Convention Map

| Old | New |
| --- | --- |
| `mort` | `anvil` |
| `Mort` | `Anvil` |
| `MORT` | `ANVIL` |
| `mort_lib` | `anvil_lib` |
| `mortician` | `anvil` |
| `Mortician` | `Anvil` |
| `@mort/*` | `@anvil/*` |
| `com.mort.app` | `com.anvil.app` |
| `.mort` | `.anvil` |
| `mort-repl` | `anvil-repl` |
| `mort-types` | `anvil-types` |
