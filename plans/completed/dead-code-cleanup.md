# Dead Code Cleanup Plan

This plan identifies and ranks the largest chunks of dead code in the codebase for removal.

## Phases

- [x] Remove unused git.ts functions (156 lines)
- [x] Remove unused validators module (61 lines)
- [x] Remove deprecated hotkey functions (48 lines)
- [x] Remove unused permissions module (63 lines)
- [x] Remove unused shared prompts (33 lines)
- [x] Remove NodeFSAdapter and hello-world agent (40 lines)
- [x] Fix Rust code duplication (24 lines)
- [x] Clean up remaining small items

<!-- IMPORTANT: Mark phases complete with [x] as you finish them. Update this file immediately after completing each phase - do not batch updates. -->

---

## Summary

| Area | Dead Code (lines) | Priority |
|------|-------------------|----------|
| agents/src/ | ~378 lines | HIGH |
| src/ (frontend) | ~90 lines | MEDIUM |
| src-tauri/ (Rust) | ~47 lines | LOW |
| **Total** | **~515 lines** | - |

---

## Ranked Dead Code Items

### Rank 1: Unused Git Functions (agents/src/git.ts) — 156 lines
**Priority: HIGH** | **Confidence: HIGH**

The largest single concentration of dead code. These functions are marked `@deprecated` and have zero callers:

| Function | Lines | Notes |
|----------|-------|-------|
| `getChangedFilesSinceMergeBase()` | 63 | Lines 188-250; Complex function, no callers |
| `computeMergeBase()` | 25 | Lines 158-182; Internal helper only used by deprecated code |
| `getMergeBase()` | 17 | Lines 15-31; Explicitly `@deprecated` |
| `getFileDiffFromMergeBase()` | 18 | Lines 255-272; Never called |
| `generateThreadDiff()` | 15 | Lines 138-152; `@deprecated` |
| `isBinaryFile()` | 15 | Lines 344-358; Never used |
| `getFileDiff()` | 14 | Lines 326-339; Never imported |
| `createThreadBranch()` | 11 | Lines 104-114; `@deprecated`, replaced by workspace service |
| `createAndCheckoutBranch()` | 3 | Lines 392-394; Never called |

**Root Cause:** Replaced by workspace service implementations but never removed.

---

### Rank 2: Unused Permissions Module (agents/src/permissions/) — 63 lines
**Priority: HIGH** | **Confidence: HIGH**

**File:** `agents/src/permissions/permission-handler.ts`

| Function | Lines | Notes |
|----------|-------|-------|
| `initPermissionHandler()` | 24 | Lines 24-47; Only used in tests |
| `requestPermission()` | 34 | Lines 66-99; Never called in production |
| `cleanupPermissionHandler()` | 5 | Lines 104-108; Never called |

**Root Cause:** Infrastructure scaffolding never integrated into agent loop.

---

### Rank 3: Unused Validators Module (agents/src/validators/) — 61 lines
**Priority: HIGH** | **Confidence: HIGH**

**Files:**
- `agents/src/validators/index.ts` (38 lines)
- `agents/src/validators/types.ts` (23 lines)

| Export | Notes |
|--------|-------|
| `runValidators()` | Lines 12-37; Never called anywhere |
| `ValidationResult` | Type only used by unused function |
| `ValidationContext` | Type only used by unused function |
| `AgentValidator` | Interface with no implementations |

**Root Cause:** Validation framework was set up but never integrated.

**Recommendation:** Delete entire `validators/` directory.

---

### Rank 4: Deprecated Hotkey Functions (src/lib/hotkey-service.ts) — 48 lines
**Priority: HIGH** | **Confidence: HIGH**

| Function | Lines | Notes |
|----------|-------|-------|
| `saveControlPanelNavigationDownHotkey()` | 10 | Lines 145-154; `@deprecated` |
| `getSavedControlPanelNavigationDownHotkey()` | 5 | Lines 160-164; `@deprecated` |
| `saveControlPanelNavigationUpHotkey()` | 10 | Lines 171-180; `@deprecated` |
| `getSavedControlPanelNavigationUpHotkey()` | 5 | Lines 186-190; `@deprecated` |

All marked with `@deprecated` JSDoc: "Use Command+P command palette instead"

---

### Rank 5: Unused Shared Prompts (agents/src/agent-types/shared-prompts.ts) — 33 lines
**Priority: MEDIUM** | **Confidence: HIGH**

| Constant | Lines | Notes |
|----------|-------|-------|
| `COMMIT_STRATEGY` | 19 | Lines 5-23; Never imported |
| `MINIMAL_CHANGES` | 8 | Lines 25-32; Never imported |
| `EXPLORATION_TOOLS` | 6 | Lines 34-39; Never imported |

Only `PLAN_CONVENTIONS`, `SUB_AGENT_POLICY`, and `RECURSIVE_SUBAGENT` are actually used.

---

### Rank 6: NodeFSAdapter + Hello-World Agent — 40 lines
**Priority: MEDIUM** | **Confidence: HIGH**

**File:** `agents/src/adapters/node-fs-adapter.ts` (30 lines)
- Entire `NodeFSAdapter` class is exported but never imported anywhere

**File:** `agents/src/agent-types/hello-world.ts` (10 lines)
- Agent config exported but NOT registered in `agent-types/index.ts`
- Unreachable via `getAgentConfig()`

---

### Rank 7: Rust Code Duplication — 24 lines
**Priority: MEDIUM** | **Confidence: HIGH**

**Duplicate function `is_allowed_navigation`:**
- `src-tauri/src/lib.rs` (lines 48-71)
- `src-tauri/src/panels.rs` (lines 24-47)

Both implementations are identical. Should extract to shared module or remove duplicate.

---

### Rank 8: Deprecated Frontend Functions — 28 lines
**Priority: LOW** | **Confidence: HIGH**

| Function | File | Lines | Notes |
|----------|------|-------|-------|
| `extractChangedFilePaths()` | `src/lib/utils/thread-diff-generator.ts` | 13 | `@deprecated`, use `extractFileChanges` |
| `switchControlPanelClientSide()` | `src/lib/hotkey-service.ts` | 8 | `@deprecated`, use `showControlPanelWithView` |
| `showControlPanel()` (duplicate) | `src/lib/tauri-commands.ts` | 7 | Duplicate of `panelCommands.showControlPanel` |

---

### Rank 9: Rust Minor Items — 23 lines
**Priority: LOW** | **Confidence: MEDIUM-HIGH**

| Item | File | Lines | Notes |
|------|------|-------|-------|
| `git_prune_worktrees()` | `git_commands.rs` | 13 | Public but not `#[tauri::command]`, only used internally - should be private |
| Duplicate header comments | `mort_commands.rs` | 7 | Lines 288-294; "Thread Commands" header duplicated |
| `get_threads_dir()` | `thread_commands.rs` | 3 | Trivial wrapper, can inline |

---

### Rank 10: Empty/Legacy Exports — 6 lines
**Priority: LOW** | **Confidence: MEDIUM**

| Item | File | Notes |
|------|------|-------|
| `processCommands` | `src/lib/tauri-commands.ts` | Empty exported object with only comments |
| `threadId` field | `src/components/control-panel/use-control-panel-params.ts` | Deprecated legacy field |

---

## Implementation Notes

### Safe to Remove Immediately (no dependencies)
1. All deprecated `git.ts` functions
2. Entire `validators/` directory
3. Deprecated hotkey functions
4. Unused prompt constants
5. `NodeFSAdapter` class
6. Duplicate `is_allowed_navigation` in panels.rs

### Requires Migration Check
1. `hello-world.ts` - decide: delete or register
2. Permissions module - confirm no future plans
3. `threadId` legacy field - confirm migration complete

### Test Updates Needed
- `extractChangedFilePaths()` is used in test mocks - update tests before removal
- Permissions module has test file - remove test file too
