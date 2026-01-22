# Task Cleanup Audit

This directory contains sub-plans for removing all vestiges of the deprecated Task entity from the codebase.

## Sub-Plans

| # | Plan | Priority | Dependencies |
|---|------|----------|--------------|
| 01 | [Breaking Changes](./01-breaking-changes.md) | HIGH | None |
| 02 | [Schema Migration](./02-schema-migration.md) | MEDIUM | 01 |
| 03 | [Cleanup & Cosmetic](./03-cleanup-cosmetic.md) | LOW | 01, 02 |

## Execution Order

1. **01-breaking-changes** - Must be done first (runtime errors)
2. **02-schema-migration** - Requires 01 to be complete
3. **03-cleanup-cosmetic** - Can be done after 01 and 02

## Verification

After all sub-plans complete:

```bash
# Search for "task" in TypeScript (case-insensitive)
rg -i "task" --type ts -g '!node_modules' -g '!dist'

# Search for "Task" (PascalCase - likely type names)
rg "Task" --type ts -g '!node_modules' -g '!dist'

# Search in Rust code
rg -i "task" --type rust

# Ensure tests pass
pnpm test

# Ensure build succeeds
pnpm build
```

## Files Safe to Ignore

These mentions of "task" are intentional or external:
- References to background tasks (OS-level, not our Task entity)
- References to Tauri task APIs
- Third-party library references
- Generic programming concepts (e.g., "async task")
