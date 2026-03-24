# Phase 0g: Cleanup Old Runner Files

## Overview

Delete the legacy `simple-runner.ts` and `simple-runner-args.ts` files after the unified runner entry point is complete and verified. This is the final cleanup step that removes dead code from the codebase.

## Dependencies

- `00e-unified-entry-point.md` must be complete and all agent types verified working

## Parallel With

- Nothing (this is the final cleanup step for Phase 0)

## Files to Delete

1. `agents/src/simple-runner.ts`
2. `agents/src/simple-runner-args.ts`

## Pre-Deletion Verification

Before deleting, confirm all functionality has been preserved:

### 1. Verify No Remaining References

```bash
# Check for any imports of the old files
grep -r "simple-runner" agents/src/ --include="*.ts"
grep -r "from.*simple-runner" agents/src/ --include="*.ts"

# Also check for any external references
grep -r "simple-runner" . --include="*.json" --include="*.sh"
```

### 2. Verify Unified Runner Works

Run these commands to confirm the new unified runner handles all cases:

```bash
# Build the project first
pnpm --filter agents build

# Verify simple agent works through unified runner
node agents/dist/runner.js --agent simple --cwd /tmp/test --thread-id test-123 --anvil-dir /tmp/anvil --prompt "test"

# Verify task-based agents still work
node agents/dist/runner.js --agent execution --help
node agents/dist/runner.js --agent research --help
node agents/dist/runner.js --agent merge --help
```

### 3. Verify Event Protocol

Confirm stdout output format is unchanged for consumers (Tauri frontend):
- Log messages: `{"type":"log","level":"INFO","message":"..."}`
- Events: `{"type":"event","name":"...","payload":{...}}`
- State updates: `{"type":"state","data":{...}}`

## Handling Remaining References

If `grep` finds references:

1. Update imports to use the unified runner or `SimpleRunnerStrategy`
2. Run tests to verify functionality
3. Re-run the reference check
4. Only proceed with deletion when no references remain

## Deletion

```bash
rm agents/src/simple-runner.ts
rm agents/src/simple-runner-args.ts
```

## Post-Deletion Verification

```bash
# TypeScript compilation must succeed
pnpm --filter agents build

# Run the test suite
pnpm --filter agents test

# Verify all agent types work
node agents/dist/runner.js --agent simple --help
node agents/dist/runner.js --agent execution --help
node agents/dist/runner.js --agent research --help
node agents/dist/runner.js --agent merge --help
```

## Acceptance Criteria

- [ ] No files import from `simple-runner.ts` or `simple-runner-args.ts`
- [ ] Old files are deleted
- [ ] `pnpm --filter agents build` succeeds
- [ ] `pnpm --filter agents test` passes
- [ ] All agent types work via unified runner

## Rollback

If issues are discovered after deletion:
1. Restore files from git: `git checkout HEAD -- agents/src/simple-runner.ts agents/src/simple-runner-args.ts`
2. Investigate what was missed in the unified runner migration
3. Fix the issue in the unified runner before re-attempting cleanup

## Estimated Effort

Small (~15-30 mins)
