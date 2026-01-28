# Parallel Execution Plan: Main Window Refactor

## Overview

This document outlines the execution order and parallelization strategy for the 7 phases of the main window refactor. The goal is to maximize development velocity by running independent work streams in parallel while respecting hard dependencies.

---

## Dependency Graph

```
Phase 1 (Foundation)    Phase 2 (Tree Data Store)
        │                        │
        │                        │
        ▼                        ▼
        └──────────┬─────────────┘
                   │
                   ▼
           Phase 3 (Tree Menu UI)
                   │
                   ▼
           Phase 4 (Layout Assembly)
                   │
                   ▼
           Phase 6 (Regression Testing) ◄── GATE
                   │
                   ▼
           Phase 5 (Deprecation Cleanup)
                   │
                   ▼
           Phase 7 (NSPanel + Multi-Pane)
```

---

## Execution Waves

### Wave 1: Parallel Foundation Work

| Phase | Name | Can Start | Blocks |
|-------|------|-----------|--------|
| **Phase 1** | Foundation & Component Extraction | Immediately | Phase 3, Phase 4 |
| **Phase 2** | Tree Menu Data Structure | Immediately | Phase 3, Phase 4 |

**Why Parallel:** Phase 1 creates UI primitives (`ContentPane`, `ResizablePanel`, tree primitives). Phase 2 creates data layer (types, store, service, hooks). These are independent domains with no shared dependencies.

**Duration Estimate:** Both phases can complete concurrently.

**Completion Criteria:**
- Phase 1: All files in `src/components/content-pane/`, `src/components/tree/`, and `src/components/ui/resizable-panel.tsx` exist and export correctly
- Phase 2: All files in `src/stores/tree-menu/` exist, `useTreeData` hook works, `treeMenuService.hydrate()` succeeds

---

### Wave 2: Sequential UI Assembly

| Phase | Name | Depends On | Blocks |
|-------|------|------------|--------|
| **Phase 3** | Tree Menu UI | Phase 2 | Phase 4 |

**Why Sequential:** Phase 3 consumes types and hooks from Phase 2 (`useTreeData`, `TreeItemNode`, `RepoWorktreeSection`). Cannot start until Phase 2 types are finalized.

**Note:** Phase 3 can technically start as soon as Phase 2's types are defined, even if Phase 2's implementation isn't complete. However, for safety, wait for Phase 2 completion.

**Phase 1 Relationship:** Phase 3 does NOT directly depend on Phase 1. Tree menu components are self-contained. Phase 1's tree primitives (`TreeNode`, `TreeView`) are separate from Phase 3's tree menu components.

---

### Wave 3: Layout Integration

| Phase | Name | Depends On | Blocks |
|-------|------|------------|--------|
| **Phase 4** | Layout Assembly | Phase 1, Phase 2, Phase 3 | Phase 6 |

**Why Sequential:** Phase 4 integrates all previous work:
- `ContentPane` and `ResizablePanel` from Phase 1
- `useTreeMenuStore` and tree types from Phase 2
- `TreeMenu` component from Phase 3

**This is the critical path** - cannot start until all preceding phases are complete.

---

### Wave 4: Testing Gate

| Phase | Name | Depends On | Blocks |
|-------|------|------------|--------|
| **Phase 6** | Regression Testing | Phase 4 | Phase 5 |

**Why Gate:** Phase 6 is a **blocking gate**, not an implementation phase. It's a manual testing checklist that must pass before any deletions occur.

**Critical:** Do NOT skip this phase. All "MUST PASS" tests in Phase 6 must be verified before proceeding.

---

### Wave 5: Cleanup

| Phase | Name | Depends On | Blocks |
|-------|------|------------|--------|
| **Phase 5** | Deprecation Cleanup | Phase 6 (all tests pass) | Phase 7 |

**Why Sequential:** Phase 5 deletes files. Once deleted, rollback is harder. Must only execute after Phase 6 confirms new architecture works.

**Irreversible Actions:**
- Deletes `unified-inbox.tsx`, `inbox-item.tsx`, `inbox-header.tsx`
- Deletes `worktrees-page.tsx`
- Deletes `sidebar.tsx`
- Removes menu items from Rust code

---

### Wave 6: Enhancement

| Phase | Name | Depends On | Blocks |
|-------|------|------------|--------|
| **Phase 7** | NSPanel + Multi-Pane | Phase 5 | None |

**Why Last:** Phase 7 builds on the clean architecture established by Phase 5. It adds:
- Spotlight modifier detection (Enter vs Shift+Enter)
- Shared component usage in NSPanel
- Multi-pane data model foundation

**Phase 7 Split:**
- **6.x tasks (NSPanel Integration):** Implement immediately after Phase 5
- **7.x tasks (Multi-Pane):** Design now, implement later (deferred)

---

## Parallel Execution Timeline

```
Time ──────────────────────────────────────────────────────────►

┌─────────────────────────────────────────────────────────────────┐
│ WAVE 1: PARALLEL FOUNDATION                                      │
│                                                                  │
│   ┌─────────────────────┐                                        │
│   │ Phase 1             │                                        │
│   │ Foundation &        │                                        │
│   │ Component Extraction│                                        │
│   └─────────────────────┘                                        │
│                                                                  │
│   ┌─────────────────────┐                                        │
│   │ Phase 2             │  ◄── Can run simultaneously            │
│   │ Tree Data Store     │                                        │
│   └─────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ WAVE 2: UI ASSEMBLY                                              │
│                                                                  │
│   ┌─────────────────────┐                                        │
│   │ Phase 3             │  ◄── Requires Phase 2 types            │
│   │ Tree Menu UI        │                                        │
│   └─────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ WAVE 3: INTEGRATION                                              │
│                                                                  │
│   ┌─────────────────────┐                                        │
│   │ Phase 4             │  ◄── Requires Phases 1, 2, 3           │
│   │ Layout Assembly     │                                        │
│   └─────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ WAVE 4: TESTING GATE                                             │
│                                                                  │
│   ┌─────────────────────┐                                        │
│   │ Phase 6             │  ◄── Manual testing, MUST PASS         │
│   │ Regression Testing  │                                        │
│   └─────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ WAVE 5: CLEANUP                                                  │
│                                                                  │
│   ┌─────────────────────┐                                        │
│   │ Phase 5             │  ◄── Destructive, no rollback          │
│   │ Deprecation Cleanup │                                        │
│   └─────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│ WAVE 6: ENHANCEMENT                                              │
│                                                                  │
│   ┌─────────────────────┐                                        │
│   │ Phase 7             │  ◄── NSPanel integration now,          │
│   │ NSPanel + Multi-Pane│      Multi-pane deferred               │
│   └─────────────────────┘                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## Critical Path

The critical path (longest sequence of dependent tasks) is:

```
Phase 2 → Phase 3 → Phase 4 → Phase 6 → Phase 5 → Phase 7
```

**Optimization Opportunity:** Since Phase 1 runs in parallel with Phase 2, starting Phase 1 early does not extend the critical path. Focus resources on Phase 2 completion to unblock Phase 3.

---

## Checkpoints & Gates

### Checkpoint 1: Wave 1 Complete
**Criteria:**
- [ ] `pnpm typecheck` passes
- [ ] Phase 1 barrel exports work: `import { ContentPane, ResizablePanel } from "@/components/content-pane"`
- [ ] Phase 2 hydration works: `treeMenuService.hydrate()` runs without error
- [ ] `useTreeData()` returns valid sections array

### Checkpoint 2: Wave 2 Complete
**Criteria:**
- [ ] `TreeMenu` component renders sections with items
- [ ] Keyboard navigation works (arrow keys, Enter)
- [ ] Status dots display correctly

### Checkpoint 3: Wave 3 Complete
**Criteria:**
- [ ] Main window renders with new layout
- [ ] Tree selection opens content in pane
- [ ] Panel resize works with persistence
- [ ] Settings/Logs accessible from header icons

### Gate: Phase 6 (BLOCKING)
**Criteria:**
- [ ] All "MUST PASS" tests in Phase 6 checklist verified
- [ ] Thread views render identically in NSPanel and main window
- [ ] Plan views render identically in NSPanel and main window
- [ ] No regressions in existing functionality

### Checkpoint 4: Wave 5 Complete
**Criteria:**
- [ ] All deprecated files deleted
- [ ] `pnpm typecheck` passes
- [ ] `pnpm build` succeeds
- [ ] Application launches and functions correctly

### Checkpoint 5: Wave 6 Complete
**Criteria:**
- [ ] Enter from Spotlight → main window content pane
- [ ] Shift+Enter from Spotlight → NSPanel
- [ ] Pop-out button works
- [ ] Bidirectional tree/pane sync works

---

## Risk Mitigation

### Risk: Phase 2 Delayed
**Impact:** Blocks Phases 3, 4, 5, 6, 7 (entire critical path)
**Mitigation:**
- Start Phase 2 immediately with highest priority
- Phase 1 can absorb delay without impact
- Consider splitting Phase 2 tasks across multiple developers

### Risk: Phase 6 Reveals Regressions
**Impact:** Delays Phase 5, requires rework in Phases 1-4
**Mitigation:**
- Perform mini-regression checks after each wave
- Don't wait until Phase 6 to test basic functionality
- Build automated smoke tests alongside implementation

### Risk: Merge Conflicts Between Parallel Phases
**Impact:** Integration overhead when merging Phase 1 and Phase 2
**Mitigation:**
- Phase 1 and Phase 2 touch different directories (low conflict risk)
- Use feature branches, merge to main frequently
- Coordinate on shared type definitions early

---

## Resource Allocation Suggestion

For a team with 2 developers:

| Developer | Wave 1 | Wave 2 | Wave 3 | Waves 4-6 |
|-----------|--------|--------|--------|-----------|
| Dev A | Phase 1 | Phase 3 (assist) | Phase 4 | Phases 5-7 |
| Dev B | Phase 2 | Phase 3 (lead) | Phase 4 (assist) | Phase 6 testing |

For a solo developer:
1. Start Phase 1 and Phase 2 concurrently (context-switch between them)
2. Complete whichever finishes first, then focus on the other
3. Proceed sequentially through remaining phases

---

## Summary

| Wave | Phases | Parallelism | Key Milestone |
|------|--------|-------------|---------------|
| 1 | Phase 1, Phase 2 | **PARALLEL** | Foundation complete |
| 2 | Phase 3 | Sequential | Tree menu UI complete |
| 3 | Phase 4 | Sequential | New layout integrated |
| 4 | Phase 6 | **GATE** | Regression tests pass |
| 5 | Phase 5 | Sequential | Old code deleted |
| 6 | Phase 7 | Sequential | NSPanel integration complete |

**Maximum Parallelism:** 2 streams (Wave 1 only)
**Total Sequential Dependency Chain:** 6 phases
**Critical Path:** Phase 2 → Phase 3 → Phase 4 → Phase 6 → Phase 5 → Phase 7
