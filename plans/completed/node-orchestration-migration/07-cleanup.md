# Phase 7: Cleanup

## Goal

Final cleanup, terminology updates, and removal of deprecated code.

## Prerequisites

- [06-simplify-frontend.md](./06-simplify-frontend.md) complete

## Tasks

### 1. Delete workspace-service.ts

```bash
rm src/lib/workspace-service.ts
```

Remove all imports and usages throughout the codebase.

### 2. Rename "workspace" → "worktree"

Search and replace throughout codebase:
- `workspace` → `worktree`
- `Workspace` → `Worktree`
- Variable names, function names, comments
- Keep consistent terminology

**Exception:** Don't rename if it refers to VS Code workspaces or similar external concepts.

### 3. Clean Up Rust Commands

Review `src-tauri/src/` for commands that are no longer needed:

**Keep (low-level primitives):**
- File system operations used by frontend
- Process spawning
- System tray, window management

**Remove (business logic moved to Node):**
- Worktree allocation commands
- Thread creation commands
- Any orchestration logic

### 4. Remove Deprecated Frontend Code

- Remove unused imports
- Delete commented-out code
- Remove feature flags if migration is complete

### 5. Update Documentation

- Update any docs referencing old flow
- Update CLI usage examples
- Update developer guides

### 6. Final Type Cleanup

- Remove unused type definitions
- Ensure consistent types across core/agents/frontend

## Verification Checklist

### Functionality
- [ ] Runner accepts: `node runner.js --agent planning --task-id xxx --thread-id yyy --prompt "..." --mort-dir ~/.mort`
- [ ] Node reads task metadata from disk to get repositoryName
- [ ] Node allocates worktree without frontend involvement
- [ ] Node creates thread entity and emits `thread:created` event
- [ ] No Tauri round-trips for worktree operations during agent start
- [ ] All operations are synchronous (cleanup works on process exit)

### Code Quality
- [ ] All "workspace" renamed to "worktree"
- [ ] workspace-service.ts deleted
- [ ] No unused imports or dead code
- [ ] Consistent terminology throughout

### Tests
- [ ] Existing tests pass
- [ ] New unit tests for adapters
- [ ] New unit tests for services
- [ ] Integration tests for orchestration
- [ ] E2E tests for full flow

### Documentation
- [ ] CLI usage documented
- [ ] Architecture documented
- [ ] Migration notes for future reference

## Rollback Plan

If issues discovered after migration:

1. **Quick fix:** Add `--legacy-mode` flag to runner that uses old flow
2. **Revert:** Keep old workspace-service.ts in git history for easy revert
3. **Feature flag:** Environment variable to switch between flows

## Post-Migration

After successful migration:

1. Monitor for issues in production use
2. Collect performance metrics (startup time, etc.)
3. Consider additional optimizations
4. Document lessons learned
