# Phase 10: Verification & Testing

> **Reminder: NAMING-ONLY change** - no functionality updates. See [00-overview.md](./00-overview.md).

**Priority**: Final phase - run after all changes complete.

## Automated Verification

### 1. TypeScript Compilation

```bash
pnpm typecheck
```

Expected: Zero errors

### 2. Rust Compilation

```bash
cd src-tauri && cargo check && cargo build
```

Expected: Zero errors, successful build

### 3. Full Application Build

```bash
pnpm build
```

Expected: Successful build, dist/ contains thread.html (not conversation.html)

### 4. Agent Runner Build

```bash
cd agents && pnpm build
```

Expected: Successful build

## Search Validation

After completion, these searches should return 0 results in source files:

```bash
# TypeScript/TSX files
rg -i "conversation" --type ts --type tsx \
  --glob '!plans/**' \
  --glob '!dist/**' \
  --glob '!node_modules/**'

# Rust files
rg -i "conversation" --type rust \
  --glob '!target/**'

# HTML files (excluding dist)
rg "conversation" --glob "*.html" --glob '!dist/**'
```

### Allowed Exceptions

These may still contain "conversation" and that's OK:
- `plans/completed/` - historical documentation
- `dist/` - will be regenerated
- `node_modules/` - third-party code
- Git history - can't change

## Manual Testing Checklist

### 1. Application Startup
- [ ] App launches without errors
- [ ] No console errors related to missing modules

### 2. Thread Panel
- [ ] Thread panel opens correctly
- [ ] Thread content displays
- [ ] Streaming works

### 3. Spotlight Integration
- [ ] Creating a task from spotlight works
- [ ] Thread opens after task creation

### 4. Agent Execution
- [ ] Agent spawns correctly
- [ ] Agent writes to correct directory (~/.mort/threads/)
- [ ] Agent events received by frontend

### 5. Data Migration (if existing data)
- [ ] Old ~/.mort/conversations/ data is inaccessible (expected)
- [ ] New threads created in ~/.mort/threads/

## Rollback Plan

If issues are found:
1. Git revert the rename commit
2. All changes are in source control
3. No database migrations needed

## Final Steps

1. Clean dist/ directory: `rm -rf dist/`
2. Full rebuild: `pnpm build`
3. Run application: `pnpm tauri dev`
4. Manual smoke test
5. Commit with message: "refactor: rename Conversation to Thread"
