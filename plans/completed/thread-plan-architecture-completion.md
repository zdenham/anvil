# Thread-Plan Architecture Completion Plan

## Overview

This plan tracks remaining TODOs from the thread-plan architecture implementation (`plans/completed/thread-plan-architecture.md`).

**Sub-plans directory:** `plans/thread-plan-architecture-completion/`

## Quick Start

```bash
# Phase 1: Runner Fix (sequential - unblocks agent spawning)
anvil run plans/thread-plan-architecture-completion/00-runner-fix.md

# Phase 2: Parallel Implementation (no file conflicts)
anvil run plans/thread-plan-architecture-completion/01-relations-wiring.md &
anvil run plans/thread-plan-architecture-completion/02-plan-view-header.md &
anvil run plans/thread-plan-architecture-completion/03-test-mocks.md &
wait

# Phase 3: Verification (sequential)
anvil run plans/thread-plan-architecture-completion/04-verification.md
```

## Sub-Plans

| Sub-Plan | Scope | Parallelizable |
|----------|-------|----------------|
| `00-runner-fix.md` | Fix --task-id -> --repo-id mismatch | No (run first) |
| `01-relations-wiring.md` | Wire relationService in plan-input-area.tsx | Yes |
| `02-plan-view-header.md` | Wire useRelatedThreads hook | Yes |
| `03-test-mocks.md` | Fix/verify Vitest mock setup | Yes |
| `04-verification.md` | Final checks and cleanup | No (run last) |

## Dependency Graph

```
                          ┌─────────────────┐
                          │ 00-runner-fix   │  (unblocks agent spawning)
                          └────────┬────────┘
                                   │
    ┌──────────────────────────────┼──────────────────────────────────┐
    │                              │                                  │
    ▼                              ▼                                  ▼
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────┐
│ 01-relations    │    │ 02-plan-view-header │    │ 03-test-mocks   │
│    wiring       │    │                     │    │                 │
└────────┬────────┘    └──────────┬──────────┘    └────────┬────────┘
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
                                  ▼
                          ┌─────────────────┐
                          │ 04-verification │  (final - run last)
                          └─────────────────┘
```

## Related Plans

This plan references but does NOT duplicate:
- `plans/control-panel-view-mode-refactor/` - Handles UI-related TODOs separately
- `plans/remove-task-id-from-runner.md` - Detailed runner fix (00-runner-fix references this)

## Success Criteria

After all phases complete:

- [ ] Agent can be spawned from spotlight (runner accepts --repo-id)
- [ ] Plan view header shows correct related thread count
- [ ] Creating thread from plan creates "referenced" relation
- [ ] All tests pass
- [ ] No TypeScript errors
- [ ] No remaining TODOs from thread-plan architecture refactor

## Files Summary

| File | Sub-Plan |
|------|----------|
| `agents/src/runners/*.ts` | 00-runner-fix |
| `src/components/control-panel/plan-input-area.tsx` | 01-relations-wiring |
| `src/components/control-panel/plan-view-header.tsx` | 02-plan-view-header |
| `src/entities/threads/__tests__/service.test.ts` | 03-test-mocks |
